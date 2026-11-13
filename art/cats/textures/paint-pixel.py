"""Author Pixel's de-lit coat and iris on the restored master atlas.

Run after npm run assets. Output is the lossless source set for the KTX2 bake.
"""
import argparse
import json
from pathlib import Path

import numpy as np
from PIL import Image
from scipy.ndimage import distance_transform_edt, gaussian_filter, map_coordinates

from reproject import raster, read_atlas

ROOT = Path(__file__).resolve().parents[3]
GUIDES = ROOT / 'art/cats/master/notes'


def color(hex_color):
    return np.array(list(bytes.fromhex(hex_color[1:])), dtype=np.float32)


def smooth(a, b, value):
    t = np.clip((value - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


def mix(a, b, weight):
    return a + (b - a) * weight[..., None]


def unit(vector):
    return vector / np.maximum(np.linalg.norm(vector, axis=-1, keepdims=True), 1e-6)


def bitmap(pixels):
    return Image.fromarray(np.uint8(np.clip(np.rint(pixels), 0, 255)))


def body(out, atlas, model, rng):
    rest, chart = raster(atlas)
    semantic = np.asarray(Image.open(GUIDES / 'uv_surface.png').convert('RGBA'))
    surface, occupied = semantic[..., 0], semantic[..., 3] != 0
    fur = chart >= 0
    if not np.array_equal(fur, occupied & (surface == 0)):
        raise ValueError('Pixel coat raster does not match the restored atlas')
    x, y, z = rest[fur].T

    # The same rest-space point has the same grain on either side of a UV cut.
    # Stretch the grain down the legs and back along the head, body and tail.
    lattice = rng.standard_normal((48, 48, 48), dtype=np.float32)
    back = np.stack((x * 1200 + np.sin(z * 64) * .8, y * 1120, z * 315))
    down = np.stack((x * 1160, y * 290, z * 1190 + np.sin(y * 67) * .6))
    upright = 1 - smooth(.10, .185, y)
    upright *= 1 - smooth(.025, .055, np.abs(x) * .15 + np.abs(z + .188)) * smooth(.14, .22, -z)
    upright = np.maximum(upright, smooth(.328, .369, y))
    grain = map_coordinates(lattice, back, order=1, mode='grid-wrap') * (1 - upright)
    grain += map_coordinates(lattice, down, order=1, mode='grid-wrap') * upright
    fine = map_coordinates(lattice, back * 1.91 + 13.1, order=1, mode='grid-wrap')
    height = np.clip(grain * .78 + fine * .22, -2.5, 2.5)

    # Keep the pelt within a few sRGB codes of its base. Lighting supplies the gloss.
    coat = model['coat']
    base = color(coat['palette']['base'])
    pigment = np.broadcast_to(base, (*chart.shape, 3)).copy()
    pigment[fur] = base + height[:, None] * 1.55
    pigment[occupied & (surface == 1)] = color(model['leather']['nose'])
    pigment[occupied & (surface == 2)] = color(model['leather']['pads'])
    pigment[occupied & (surface == 3)] = [29, 23, 28]
    pigment[occupied & (surface == 4)] = [23, 13, 17]
    nearest = distance_transform_edt(~occupied, return_distances=False, return_indices=True)
    rows, cols = nearest
    pigment[~occupied] = pigment[rows[~occupied], cols[~occupied]]

    # Fur length is continuous in rest space. The three marking channels stay zero.
    length = coat['furLengthMm']
    chest = smooth(.034, .097, z) * (1 - smooth(.032, .066, np.abs(x))) * (1 - smooth(.247, .293, y))
    cheeks = smooth(.133, .199, z) * smooth(.25, .286, y) * (1 - smooth(.325, .36, y))
    tail = smooth(.224, .270, -z)
    mm = length['body'] + chest * (length['chest'] - length['body'])
    mm += cheeks * (length['cheeks'] - mm) + tail * (length['tail'] - length['body'])
    mask = np.zeros((*chart.shape, 4), dtype=np.uint8)
    mask[fur, 3] = np.uint8(np.rint(mm * 255 / 35))
    mask[~occupied] = mask[rows[~occupied], cols[~occupied]]

    # The height derivatives stay within their UV island. Dilating the nearest
    # fur height into each gutter avoids a false beveled edge in the normal map.
    relief = np.zeros(chart.shape, dtype=np.float32)
    relief[fur] = height
    relief[~occupied] = relief[rows[~occupied], cols[~occupied]]
    padded = np.pad(relief, 1, mode='edge')
    same = np.where(occupied, chart, chart[rows, cols])
    padded_chart = np.pad(same, 1, mode='edge')
    dx0, dx1 = padded[1:-1, :-2], padded[1:-1, 2:]
    dy0, dy1 = padded[:-2, 1:-1], padded[2:, 1:-1]
    du = np.where(same == padded_chart[1:-1, 2:], dx1, relief) - np.where(same == padded_chart[1:-1, :-2], dx0, relief)
    dv = np.where(same == padded_chart[2:, 1:-1], dy1, relief) - np.where(same == padded_chart[:-2, 1:-1], dy0, relief)
    normals = unit(np.stack((-du * .067, -dv * .067, np.ones_like(relief)), axis=-1))
    normals[occupied & ~fur] = [0, 0, 1]
    normals[~occupied] = normals[rows[~occupied], cols[~occupied]]

    direction = unit(np.stack((.07 * np.sin(z * 24 + y * 31),
                              np.where(y > .34, 1, -1) * upright - .24 * (1 - upright),
                              -1 + upright), axis=-1))
    n = unit(np.asarray(Image.open(GUIDES / 'uv_normal.png'), dtype=np.float32)[fur, :3] / 127.5 - 1)
    direction = unit(direction - n * (direction * n).sum(axis=-1, keepdims=True))
    flow = np.zeros_like(pigment)
    flow[fur] = (direction + 1) * 127.5
    flow[occupied & ~fur] = [128, 128, 128]
    flow[~occupied] = flow[rows[~occupied], cols[~occupied]]

    for label, pixels in (('body', pigment), ('coat', mask), ('normal', (normals + 1) * 127.5), ('flow', flow)):
        full = bitmap(pixels)
        phone = full.resize((1024, 1024), Image.Resampling.BOX)
        phone.save(out / f'{label}-1024.png')
        if label != 'flow':
            full.save(out / f'{label}-2048.png')


def eyes(out, model):
    # Retain the original Pixel iris fibers. Grade the registered cap's pigment
    # with the roster colors while retaining its centered slit and dark bleed.
    source = ROOT / 'public/assets/art/cats/textures/pixel/eye.png'
    art = np.asarray(Image.open(source).convert('RGB'), dtype=np.float32)
    y, x = (np.indices(art.shape[:2], dtype=np.float32) + .5) / art.shape[0] - .5
    r = np.hypot(x, y)
    red = art[..., 0]
    mid = np.median(red[(r > .18) & (r < .35) & (np.abs(x) > .06)])
    texture = np.clip((red - mid) / 255, -.55, .45)
    limbus = smooth(.35, .413, r)
    hue = mix(color(model['eyes']['iris']), color(model['eyes']['limbal']), limbus)
    hue += texture[..., None] * np.array([100, 88, 65]) * (1 - .72 * limbus[..., None])
    bleed = np.array([15, 11, 12])
    hue = mix(hue, bleed, smooth(.416, .428, r))
    pupil = (1 - smooth(22, 66, red)) * (1 - smooth(.207, .235, r))
    hue = mix(hue, np.array([6, 5, 7]), pupil)
    bitmap(hue).save(out / 'eye-512.png')


def strand(out, rng):
    noise = rng.standard_normal((256, 256), dtype=np.float32)
    detail = gaussian_filter(noise, (4.4, .7), mode='wrap') - gaussian_filter(noise, (10, 3.3), mode='wrap')
    density = bitmap(np.clip(128 + 22 * detail / detail.std(), 32, 224))
    density.convert('RGB').save(out / 'strand-256.png')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('output', type=Path)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    roster = json.loads((ROOT / 'data/cats.json').read_text())['cats']
    model = next(cat['model'] for cat in roster if cat['id'] == 'pixel')
    rng = np.random.default_rng(831614)
    body(args.output, read_atlas(GUIDES / 'atlas.json'), model, rng)
    eyes(args.output, model)
    strand(args.output, rng)


if __name__ == '__main__':
    main()
