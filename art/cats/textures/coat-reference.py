"""Exact anatomical mask/UV guides for original generated resident coat painting.

This is a technical registration guide, not a replacement for generated fur art.
All residents use the same atlas; lower LODs retain those UV coordinates.
"""
import json
import os
from pathlib import Path

import numpy as np
from PIL import Image
from scipy.ndimage import distance_transform_edt

ROOT = Path(__file__).parent
GUIDES = Path(os.environ.get('CAT_UV_GUIDES', ROOT.parent / 'master' / 'notes'))
DEST = ROOT / 'generated' / 'references'


def soft(value, edge, width=.01):
    return np.clip((value - edge) / width + .5, 0, 1)


def rgb(value):
    return np.array([int(value[i:i+2], 16) for i in (1, 3, 5)], dtype=float) / 255


def mix(a, b, weight):
    return a * (1 - weight[..., None]) + b * weight[..., None]


def main():
    DEST.mkdir(parents=True, exist_ok=True)
    surface = np.asarray(Image.open(GUIDES / 'uv_surface.png').convert('RGBA'))
    position = np.asarray(Image.open(GUIDES / 'uv_position.png').convert('RGB'), dtype=float) / 255
    normal = np.asarray(Image.open(GUIDES / 'uv_normal.png').convert('RGB'), dtype=float) / 127.5 - 1
    x, y, z = position[..., 0] * .2 - .1, position[..., 1] * .4, position[..., 2] * .7 - .42
    chart, valid = surface[..., 1], surface[..., 3] > 0
    fur = valid & (surface[..., 0] == 0)
    torso, head, tail = chart == 4, chart == 0, chart == 13
    legs, paws = (chart >= 5) & (chart <= 8), (chart >= 9) & (chart <= 12)
    neck = soft(z, .045) * (1-soft(y, .29)) * (1-soft(np.abs(x), .040))
    belly = torso * (1-soft(y, .19)) * (1-soft(normal[..., 1], -.05, .3))
    chin = soft(z, .18) * (1-soft(y, .308))
    muzzle = chart == 1
    socks = (paws | legs) * (1-soft(y, .055))
    # Pattern coordinates are in rest-space metres, so chart seams cannot move markings.
    angular = np.arctan2(y - .225, x)
    phase = z * 164 + np.sin(angular * 3 + z * 11) * 1.4 + np.sin(z * 43) * .3
    mackerel = soft(np.cos(phase), .64, .22)
    legbars = soft(np.cos(y * 205 + z * 17), .62, .25)
    rings = soft(np.cos(z * 150 + y * 26), .42, .28)
    facebars = soft(np.cos(x * 260 + y * 52 + z * 35), .60, .28)
    classic = soft(np.cos(np.sqrt(((z+.035)*46)**2 + ((y-.235)*42)**2) + np.sin(z*31)), .40, .32)
    # Broken dark rosette outlines around warm centres, with slight spatial irregularity.
    rz = z * 23 + .19 * np.sin(y*65)
    ry = y * 35 + .15 * np.cos(z*55)
    rr = np.hypot((rz - np.floor(rz) - .5)*1.1, ry - np.floor(ry) - .5)
    rosette = soft(rr, .24, .06) * (1-soft(rr, .39, .06)) * soft(np.sin(rz*7+ry*3), -.65, .5)
    residents = json.loads((ROOT.parents[2] / 'data' / 'cats.json').read_text())['cats']
    for cat in residents:
        ident, coat = cat['id'], cat['model']['coat']
        palette = coat['palette']
        base = rgb(palette.get('base', palette.get('black', '#777777')))
        color = np.broadcast_to(base, (*x.shape, 3)).copy()
        white = np.zeros(x.shape)
        marking = np.zeros(x.shape)
        partition = np.zeros(x.shape)
        if ident in ('mochi', 'waffles'):
            white = np.maximum.reduce([neck, chin * .85, socks, muzzle.astype(float)])
            if ident == 'waffles':
                white = np.maximum.reduce([white, belly, legs*(1-soft(y,.10)), head*(1-soft(np.abs(x),.012))*soft(z,.205)])
        elif ident in ('pepper', 'biscuit'):
            marking = np.where(torso, mackerel if ident == 'pepper' else classic,
                       np.where(legs | paws, legbars, np.where(tail, rings, facebars)))
            color = mix(color, rgb(palette['stripe']), marking * (.92 if ident == 'pepper' else .7))
            white = np.maximum(chin * .7, belly * .45)
        elif ident == 'clementine':
            partition = soft(np.sin(z*32+x*53)+np.sin(y*41-z*9), .10, .22)
            partition = np.where(chart == 2, 1, np.where(chart == 3, 0, partition))
            partition = np.where(head, soft(x, 0, .008), partition)
            color = mix(color, rgb(palette['orange']), partition)
            white = np.maximum.reduce([neck, belly, (legs|paws).astype(float), chin, head*(1-soft(np.abs(x),.011))*soft(z,.205)])
            marking = mackerel * partition * .22
        elif ident == 'juniper':
            marking = np.where(torso, rosette, np.where(tail, rings, np.where(legs | paws, legbars, facebars)))
            color = mix(color, rgb(palette['rosetteInner']), torso*(1-soft(rr,.28,.10))*.8)
            color = mix(color, rgb(palette['rosette']), marking)
            white = np.maximum(chin, belly)
        elif ident == 'duchess':
            white = np.maximum(neck, chin) * .7
            marking = tail * rings * .14
            color = mix(color, rgb(palette['shade']), marking)
        pale = rgb(palette.get('white', palette.get('pale', palette.get('belly', '#F4EDDD'))))
        color = mix(color, pale, white)
        length = coat['furLengthMm']
        mm = np.full(x.shape, length['body'], dtype=float)
        mm = np.where(neck > .4, length['chest'], mm)
        mm = np.where(head | muzzle, length['cheeks'], mm)
        mm = np.where(tail, length['tail'], mm)
        # Fur maps must stay white on anatomical material charts in merged lower LODs.
        color[~fur] = 1
        mask = np.stack((white, marking, partition, np.clip(mm/35, 0, 1)), axis=2)
        mask[~fur] = [0, 0, 0, 0]
        # Three-pixel nearest-surface bleed fits the six-pixel atlas gutters.
        distance, nearest = distance_transform_edt(~valid, return_indices=True)
        padded = (~valid) & (distance <= 3)
        color[padded] = color[nearest[0][padded], nearest[1][padded]]
        mask[padded] = mask[nearest[0][padded], nearest[1][padded]]
        for name, pixels in [(ident, color), (ident+'-coat', mask)]:
            path = DEST / f'{name}.png'
            temporary = path.with_name('.'+path.name+'.tmp')
            Image.fromarray(np.uint8(np.clip(pixels,0,1)*255)).save(temporary, format='PNG')
            temporary.replace(path)
            Path(str(path)+'.prov.yaml').write_text("source: art/cats/textures/coat-reference.py\ntool: deterministic anatomical UV registration guide\ndate: '2026-10-17'\nlicense: original\nauthor_role: artist\nnotes: Exact rest-space markings and semantic surface masks; generated coat art is authored against this guide\n")
        print(ident, int(fur.sum()), 'fur texels')


if __name__ == '__main__':
    main()
