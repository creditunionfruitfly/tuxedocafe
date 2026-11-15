"""Bake Duchess's cream longhair in rest space on the current master atlas."""
import argparse
import base64
import hashlib
from io import BytesIO
import json
from pathlib import Path

import numpy as np
from PIL import Image
from scipy.ndimage import distance_transform_edt, gaussian_filter, map_coordinates

from coat_paint import bitmap, chart_gradient, color, fur_grain, mix, smooth, soften_leather, unit
from prepare import register_iris
from reproject import raster, read_atlas

TEXTURES = Path(__file__).resolve().parent
GUIDES = TEXTURES.parent / 'master/notes'
ROSTER = TEXTURES.parents[2] / 'data/cats.json'


def leather(pigment, rest, occupied, surface, fur, model):
    nose = occupied & (surface == 1)
    x, y, z = rest[nose].T
    wing = np.abs(x)
    dyed = mix(color('#A96365'), color(model['leather']['nose']), smooth(.2968, .3042, y))
    nostrils = np.hypot((wing - .0037) / .00154, (y - .2985 - .24 * (wing - .0037)) / .00095)
    cleft = (1 - smooth(.00012, .00051, wing)) * (1 - smooth(.2975, .3005, y))
    shadow = np.maximum(.82 * (1 - smooth(.20, 1.18, nostrils)), .57 * cleft)
    dyed += (np.sin(x * 6820 + y * 5200) + np.sin(z * 8800 - y * 4120))[:, None] * [1.7, 1.2, 1.4]
    pigment[nose] = mix(dyed, color('#663D43'), shadow)
    soften_leather(pigment, rest, nose, fur & (rest[..., 2] > .233), .00125)
    pigment[occupied & (surface == 2)] = color(model['leather']['pads'])
    ears = occupied & (surface == 3)
    pigment[ears] = mix(color('#967068'), color('#D0AAA2'), smooth(.331, .375, rest[ears, 1]))
    soften_leather(pigment, rest, ears, fur & (rest[..., 1] > .330), .0041)
    pigment[occupied & (surface == 4)] = color('#5D4042')


def coat(out, model, rng):
    atlas = read_atlas(GUIDES / 'atlas.json')
    rest, chart, surface = raster(atlas, surface=None, surface_map=True)
    occupied = chart >= 0
    guide = np.asarray(Image.open(GUIDES / 'uv_surface.png'))
    if not np.array_equal(occupied, guide[..., 3] > 0) or not np.array_equal(surface[occupied], guide[..., 0][occupied]):
        raise ValueError('Duchess raster disagrees with the master surface guide')
    labels = atlas['charts']
    fur = occupied & (surface == 0)
    x, y, z = rest[fur].T
    side = np.abs(x)
    tail = chart[fur] == labels.index('tail')
    inner_lip = np.isin(chart[fur], [labels.index('mouthUpper'), labels.index('mouthLower')])
    ruff = smooth(.104, .153, z) * smooth(.135, .192, y) * (1 - smooth(.289, .336, y))
    cheeks = smooth(.155, .199, z) * smooth(.254, .280, y) * (1 - smooth(.311, .338, y)) * smooth(.014, .036, side)
    britches = (1 - smooth(-.154, -.084, z)) * smooth(.072, .118, y) * (1 - smooth(.183, .238, y))
    chin = smooth(.202, .242, z) * (1 - smooth(.277, .301, y))
    pale = np.maximum.reduce([.93 * ruff, .65 * cheeks, .52 * chin, .28 * britches])
    pale[tail | inner_lip] = 0
    # Arc distance follows the curve into the hanging end of the tail.
    arc = .272 - y + .70 * (-z - .226)
    rings = smooth(.25, .96, np.cos(123 * arc + .22 * np.sin(x * 196)))
    rings *= tail * smooth(.018, .056, arc) * (1 - .49 * smooth(.218, .284, arc))

    length = model['coat']['furLengthMm']
    mm = length['body'] + (length['chest'] - length['body']) * ruff
    mm += (length['cheeks'] - mm) * cheeks
    mm += (length['britches'] - mm) * britches
    mm[tail] = length['tail']
    mm[inner_lip] = 0
    fall = np.maximum.reduce([smooth(.102, .187, z), 1 - smooth(.128, .236, y), britches])
    fall[tail] = 1 - smooth(.121, .230, y[tail])
    grain = fur_grain(x + .15 * z, y + .13 * z, z - .24 * y, fall, rng)
    cloud = map_coordinates(rng.standard_normal((28, 28, 28), dtype=np.float32),
                            (x * 157, y * 93, z * 134), order=1, mode='grid-wrap')
    base, cream, shade = [color(model['coat']['palette'][key]) for key in ('base', 'pale', 'shade')]
    pigment = np.broadcast_to(base, (*chart.shape, 3)).copy()
    pelt = mix(mix(base, cream, pale), shade, .085 + .21 * rings + .10 * smooth(.10, 1.1, cloud))
    pelt += (3.9 * cloud + 5.2 * grain)[:, None] * [1, 1, .91]
    pelt[inner_lip] = color('#715354')
    pigment[fur] = pelt
    leather(pigment, rest, occupied, surface, fur, model)

    mask = np.zeros((*chart.shape, 4), dtype=np.float32)
    mask[fur] = np.column_stack((pale, rings * .24, np.zeros_like(pale), mm / 35)) * 255
    distance, (rows, cols) = distance_transform_edt(~occupied, return_indices=True)
    gutter = ~occupied & (distance <= 14)
    relief = np.zeros(chart.shape, dtype=np.float32)
    relief[fur] = (grain + .39 * cloud) * (mm / 35)**.6
    relief[gutter] = relief[rows[gutter], cols[gutter]]
    islands = np.where(fur, chart, -1)
    islands[gutter] = islands[rows[gutter], cols[gutter]]
    du, dv = chart_gradient(relief, islands)
    normal = unit(np.stack((-du * .165, -dv * .165, np.ones_like(du)), axis=-1))
    normal[~fur] = [0, 0, 1]

    surface_normal = unit(np.asarray(Image.open(GUIDES / 'uv_normal.png'), dtype=np.float32)[fur, :3] / 127.5 - 1)
    direction = np.column_stack((.30 * np.tanh(x * 39), -.21 - .82 * fall, -1 + .87 * fall))
    direction[tail, 1] = -.34 - .68 * fall[tail]
    direction[tail, 2] = -.99 + .63 * fall[tail]
    direction = unit(direction - surface_normal * (direction * surface_normal).sum(axis=-1, keepdims=True))
    flow = np.full_like(pigment, 127.5)
    flow[fur] = (direction + 1) * 127.5
    for name, pixels in (('body', pigment), ('coat', mask), ('normal', (normal + 1) * 127.5), ('flow', flow)):
        pixels[gutter] = pixels[rows[gutter], cols[gutter]]
        full = bitmap(pixels)
        bands = (band.resize((1024, 1024), Image.Resampling.BOX) for band in full.split())
        Image.merge(full.mode, list(bands)).save(out / f'{name}-1024.png')
        if name != 'flow':
            full.save(out / f'{name}-2048.png')


def iris(out, model):
    source = json.loads((TEXTURES / 'originals/eyes/duchess.json').read_text())
    raw = base64.b64decode(source['data'])
    if hashlib.sha256(raw).hexdigest() != source['sha256']:
        raise ValueError('Duchess iris source hash mismatch')
    reference = np.asarray(register_iris(Image.open(BytesIO(raw)).convert('RGB')), dtype=np.float32)
    y, x = (np.indices(reference.shape[:2], dtype=np.float32) + .5) / reference.shape[0] - .5
    radius, angle = np.hypot(x, y), np.arctan2(y, x)
    luma = reference @ np.array([.2126, .7152, .0722])
    middle = np.median(luma[(radius > .17) & (radius < .35) & (np.abs(x) > .064)])
    fibers = np.clip((luma - middle) / 255, -.20, .20) * smooth(35, 83, luma)
    fibers += .037 * np.sin(119 * angle + 4.1 * np.sin(radius * 17))
    limbus = smooth(.335, .415, radius)
    hue = mix(color(model['eyes']['iris']), color(model['eyes']['limbal']), limbus)
    hue += (fibers * (1 - .55 * limbus))[:, :, None] * [145, 168, 180]
    hue = mix(hue, color('#243B45'), smooth(.412, .432, radius))
    slit = (np.abs(x) / .047)**1.62 + (np.abs(y) / .250)**1.62
    bitmap(mix(hue, color('#060B10'), 1 - smooth(.93, 1.06, slit))).save(out / 'eye-512.png')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('output', type=Path)
    out = parser.parse_args().output
    out.mkdir(parents=True, exist_ok=True)
    model = next(cat['model'] for cat in json.loads(ROSTER.read_text())['cats'] if cat['id'] == 'duchess')
    rng = np.random.default_rng(810244)
    coat(out, model, rng)
    iris(out, model)
    noise = rng.standard_normal((256, 256), dtype=np.float32)
    strand = gaussian_filter(noise, (5, .56), mode='wrap') - gaussian_filter(noise, (12, 2.5), mode='wrap')
    bitmap(np.clip(128 + 24 * strand / strand.std(), 32, 224)).convert('RGB').save(out / 'strand-256.png')


if __name__ == '__main__':
    main()
