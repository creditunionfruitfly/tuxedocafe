"""Paint Waffles in rest space on either shared UV atlas after asset restoration."""
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
ROOT = TEXTURES.parents[2]
GUIDES = TEXTURES.parent / 'master/notes'


def tuxedo(points, grain, cloud):
    x, y, z = points.T
    side = np.abs(x)
    chest_width = .043 - .023 * smooth(.206, .308, y)
    chest_front = np.interp(y, [.127, .171, .222, .265, .298], [.015, .084, .119, .150, .186])
    chest = np.minimum(chest_width - np.abs(x - .0027 * np.sin(49 * y)), z - chest_front)
    chest = np.minimum(chest, .301 - y)

    belly_top = .176 + .012 * np.cos(10 * (z + .056)) - .004 * np.sin(37 * z + x * 32)
    belly = np.minimum.reduce([belly_top - y, z + .203 - .18 * side,
                               y - .109, .134 - z])
    belly = np.minimum(belly, .059 - side)
    # Stop the torso spotting from spilling down the dark part of each leg.
    foreleg = smooth(.046, .085, z) * (1 - smooth(.142, .181, y))
    hindleg = (1 - smooth(-.107, -.054, z)) * (1 - smooth(.154, .198, y))
    clearance = .013 - .034 * np.maximum(foreleg, hindleg) * smooth(.004, .024, side)
    chest, belly = np.minimum(chest, clearance), np.minimum(belly, clearance)

    muzzle_width = .026 - .005 * smooth(.289, .316, y)
    muzzle_top = .313 - .26 * side + .0014 * np.sin(109 * x + .7)
    muzzle = np.minimum.reduce([muzzle_width - side, muzzle_top - y,
                                z - (.202 + .31 * side), y - .254])
    bridge_width = .010 - .0074 * smooth(.309, .330, y)
    bridge_center = .0010 * np.sin(155 * (y - .306))
    bridge_top = .329 - .47 * np.abs(x - .0014)
    bridge = np.minimum.reduce([bridge_width - np.abs(x - bridge_center), bridge_top - y,
                                z - (.228 - .29 * (y - .309)), y - .294])

    # Wrists sit at 41 mm and the hocks at 76 mm in the shared rest pose.
    front_cuff = .096 + .21 * (z - .092) + .0025 * np.tanh(x * 85) + .002 * np.sin(169 * z)
    rear_cuff = .092 + .26 * (z + .197) - .0023 * np.tanh(x * 85) + .0027 * np.sin(117 * z + 24 * x)
    socks = np.maximum(np.minimum(front_cuff - y, z - .059),
                       np.minimum(rear_cuff - y, -.106 - z))
    # The same signed pigment boundary crosses every UV cut and follows the fibers.
    boundary = np.maximum.reduce([chest, belly, muzzle, bridge, socks])
    edge = 1 - .38 * smooth(.171, .232, z)
    white = smooth(-.0020, .0015, boundary + edge * (.00105 * grain + .00115 * cloud))

    bib_ruff = smooth(-.017, .008, chest) * smooth(.127, .161, y)
    belly_fringe = smooth(-.010, .008, belly) * smooth(.118, .143, y)
    cheek_ruff = smooth(.159, .205, z) * smooth(.267, .282, y)
    cheek_ruff *= (1 - smooth(.302, .336, y)) * smooth(.009, .021, side)
    return white, bib_ruff, belly_fringe, cheek_ruff


def leather_colors(pigment, rest, surface, occupied, fur, model):
    nose = occupied & (surface == 1)
    x, y, z = rest[nose].T
    side = np.abs(x)
    pink = color(model['leather']['nose'])
    lobe = smooth(.2975, .3040, y)
    pores = .9 * np.sin(3900 * x + 7300 * y) + .6 * np.sin(5700 * z - 2300 * x)
    dyed = mix(color('#A35D67'), pink, lobe) + pores[:, None] * np.array([2.8, 2.0, 2.1])
    nostril = np.hypot((side - .0038) / .00157, (y - .2987 - .24 * (side - .0038)) / .00093)
    crease = (1 - smooth(.00008, .00052, side)) * (1 - smooth(.2977, .3004, y))
    shadow = np.maximum(.84 * (1 - smooth(.24, 1.18, nostril)), .51 * crease)
    pigment[nose] = mix(dyed, color('#663D45'), shadow)
    soften_leather(pigment, rest, nose, fur & (rest[..., 2] > .233), .00135)

    pads = occupied & (surface == 2)
    x, y, z = rest[pads].T
    pad_detail = .17 + .11 * np.sin(71 * z + 46 * x) + .09 * np.sin(x * 842 - y * 218)
    pigment[pads] = mix(color(model['leather']['pads']), color('#9F645F'), pad_detail)
    ears = occupied & (surface == 3)
    pigment[ears] = mix(color('#4C3239'), color('#AC7D7F'), smooth(.336, .371, rest[ears, 1]))
    soften_leather(pigment, rest, ears, fur & (rest[..., 1] > .330), .004)
    pigment[occupied & (surface == 4)] = color('#563337')


def save_map(out, name, pixels):
    full = bitmap(pixels)
    channels = [channel.resize((1024, 1024), Image.Resampling.BOX) for channel in full.split()]
    # Coat alpha is a length channel. Keep it independent of the spotting mask in RGB.
    Image.merge(full.mode, channels).save(out / f'{name}-1024.png')
    if name != 'flow':
        full.save(out / f'{name}-2048.png')


def body(out, atlas, model, rng, master):
    rest, chart, surface = raster(atlas, surface=None, surface_map=True)
    occupied = chart >= 0
    if master:
        guide = np.asarray(Image.open(GUIDES / 'uv_surface.png'))
        if not np.array_equal(occupied, guide[..., 3] > 0) or not np.array_equal(surface[occupied], guide[..., 0][occupied]):
            raise ValueError('Waffles raster and master surface guide disagree')
    names = atlas['charts']
    fur = occupied & (surface == 0)
    p = rest[fur]
    x, y, z = p.T
    tail = chart[fur] == names.index('tail')
    inner_lip = np.isin(chart[fur], [names.index('mouthUpper'), names.index('mouthLower')])
    upright = np.maximum.reduce([1 - smooth(.143, .256, y), smooth(.129, .216, z),
                                 smooth(.020, .054, np.abs(x)) * (1 - smooth(.210, .285, y))])
    grain = fur_grain(x + .20 * z, y + .095 * z, z - .19 * y, upright, rng)
    cloud = map_coordinates(rng.standard_normal((28, 28, 28), dtype=np.float32),
                            (x * 172, y * 149, z * 122), order=1, mode='grid-wrap')
    white, chest, belly, cheeks = tuxedo(p, grain, cloud)
    white[tail | inner_lip] = 0
    length = model['coat']['furLengthMm']
    mm = length['body'] + (length['chest'] - length['body']) * np.maximum(chest, .79 * belly)
    mm += (length['cheeks'] - mm) * cheeks
    mm[tail] = length['body'] + (length['tail'] - length['body']) * smooth(.229, .251, -z[tail])
    mm[inner_lip] = 0

    base, cream = (color(model['coat']['palette'][key]) for key in ('base', 'white'))
    pigment = np.broadcast_to(base, (*chart.shape, 3)).copy()
    dark = base + grain[:, None] * np.array([6.3, 6.3, 7.4]) + cloud[:, None] * 2.6
    light = cream + grain[:, None] * np.array([6.7, 6.8, 7.4]) + cloud[:, None] * 3.6
    pelt = mix(dark, light, white)
    face = smooth(.231, .245, z)
    follicles = np.zeros_like(x)
    for across, high in ((.0067, .2941), (.0118, .2944), (.0095, .2898), (.0140, .2905), (.0161, .2965)):
        d = np.hypot((np.abs(x) - across) / .00095, (y - high - .00035 * np.sign(x)) / .00065)
        follicles = np.maximum(follicles, 1 - smooth(.15, 1.25, d))
    pelt = mix(pelt, color('#A49892'), follicles * white * face * .42)
    pelt[inner_lip] = color('#685052')
    pigment[fur] = pelt
    leather_colors(pigment, rest, surface, occupied, fur, model)

    mask = np.zeros((*chart.shape, 4), dtype=np.float32)
    mask[fur] = np.column_stack((white, np.zeros_like(white), np.zeros_like(white), mm / 35)) * 255
    distance, (rows, cols) = distance_transform_edt(~occupied, return_indices=True)
    gutter = ~occupied & (distance <= 12)

    # Extend surface values through the gutters to keep downsampled levels clean.
    relief = np.zeros(chart.shape, dtype=np.float32)
    relief[fur] = (grain + .32 * cloud) * (mm / 6)**.58
    relief[gutter] = relief[rows[gutter], cols[gutter]]
    fur_charts = np.where(fur, chart, -1)
    islands = np.where(gutter, fur_charts[rows, cols], fur_charts)
    du, dv = chart_gradient(relief, islands)
    normal_map = unit(np.stack((-du * .112, -dv * .112, np.ones_like(relief)), axis=-1))
    normal_map[~fur] = [0, 0, 1]

    for name, pixels in (('body', pigment), ('coat', mask), ('normal', (normal_map + 1) * 127.5)):
        pixels[gutter] = pixels[rows[gutter], cols[gutter]]
        save_map(out, name, pixels)

    if master:
        normal = unit(np.asarray(Image.open(GUIDES / 'uv_normal.png'), dtype=np.float32)[fur, :3] / 127.5 - 1)
        direction = np.column_stack((.24 * np.tanh(x * 31) + .05 * np.sin(z * 62),
                                     -.20 - .86 * upright, -1 + .92 * upright))
        direction[tail, 1] = -.36 - .72 * smooth(.245, .075, y[tail])
        direction[tail, 2] = -.95 + .58 * smooth(.245, .075, y[tail])
        direction = unit(direction - normal * (direction * normal).sum(axis=-1, keepdims=True))
        flow = np.full_like(pigment, 127.5)
        flow[fur] = (direction + 1) * 127.5
        flow[gutter] = flow[rows[gutter], cols[gutter]]
        save_map(out, 'flow', flow)


def iris(out, model):
    source = json.loads((TEXTURES / 'originals/eyes/waffles.json').read_text())
    raw = base64.b64decode(source['data'])
    if hashlib.sha256(raw).hexdigest() != source['sha256']:
        raise ValueError('Waffles iris source hash mismatch')
    reference = np.asarray(register_iris(Image.open(BytesIO(raw)).convert('RGB')), dtype=np.float32)
    y, x = (np.indices(reference.shape[:2], dtype=np.float32) + .5) / reference.shape[0] - .5
    distance = np.hypot(x, y)
    red = reference[..., 0]
    mid = np.median(red[(distance > .16) & (distance < .34) & (np.abs(x) > .056)])
    limbus = smooth(.330, .414, distance)
    hue = mix(color(model['eyes']['iris']), color(model['eyes']['limbal']), limbus)
    fibers = np.clip((red - mid) / 255, -.46, .24)
    hue += fibers[..., None] * np.array([129, 111, 84]) * (1 - .56 * limbus[..., None])
    hue = mix(hue, color('#291C10'), smooth(.412, .430, distance))
    pupil = (1 - smooth(14, 55, red)) * (1 - smooth(.201, .226, distance))
    bitmap(mix(hue, color('#0B0907'), pupil)).save(out / 'eye-512.png')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('output', type=Path)
    parser.add_argument('--registration-v1', action='store_true')
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    model = next(cat['model'] for cat in json.loads((ROOT / 'data/cats.json').read_text())['cats'] if cat['id'] == 'waffles')
    atlas = TEXTURES / 'registration-v1/atlas.json' if args.registration_v1 else GUIDES / 'atlas.json'
    rng = np.random.default_rng(627213)
    body(args.output, read_atlas(atlas), model, rng, master=not args.registration_v1)
    if not args.registration_v1:
        iris(args.output, model)
        noise = rng.standard_normal((256, 256), dtype=np.float32)
        strand = gaussian_filter(noise, (4.5, .62), mode='wrap') - gaussian_filter(noise, (11, 2.6), mode='wrap')
        bitmap(np.clip(128 + 23 * strand / strand.std(), 32, 224)).convert('RGB').save(args.output / 'strand-256.png')


if __name__ == '__main__':
    main()
