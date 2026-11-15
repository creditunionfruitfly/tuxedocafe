"""Bake Clementine's calico patches in rest space on the shared cat UVs."""
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


def patch_distance(points, center, radii):
    """Signed distance approximation for a pigment island with rounded edges."""
    return (1 - np.linalg.norm((points - center) / radii, axis=1)) * min(radii)


def calico(points, grain, cloud):
    x, y, z = points.T
    side = np.abs(x)
    white_bib_width = .057 - .028 * smooth(.188, .289, y)
    white_bib_front = np.interp(y, [.126, .177, .218, .264, .301], [.008, .064, .111, .145, .168])
    chest = np.minimum.reduce([white_bib_width - np.abs(x - .003 * np.sin(46 * y)),
                                z - white_bib_front, .305 - y])
    belly_height = .164 + .016 * np.cos(11 * (z + .077)) - .004 * np.sin(55 * z + 63 * x)
    belly = np.minimum.reduce([belly_height - y, z + .216 - .32 * side, .123 - z, .055 - side])
    front_cuff = .180 + .015 * smooth(.037, .100, z) + .008 * np.sin(z * 61 + x * 129)
    hind_cuff = .170 + .013 * smooth(-.205, -.129, z) + .008 * np.sin(z * 69 - x * 114)
    legs = np.maximum(np.minimum(front_cuff - y, z - .032),
                      np.minimum.reduce([hind_cuff - y, -.086 - z, z + .229]))

    muzzle_top = .315 - .38 * side + .0015 * np.sin(x * 178 + .5)
    muzzle_width = .029 - .010 * smooth(.284, .313, y)
    muzzle = np.minimum.reduce([muzzle_top - y, muzzle_width - side,
                                z - (.207 + .43 * side), y - .266])
    blaze_width = .011 - .0074 * smooth(.315, .350, y)
    blaze_center = .0015 * np.sin((y - .311) * 111) - .0008
    blaze_top = .345 - .47 * np.abs(x - .0018)
    blaze = np.minimum.reduce([blaze_top - y, blaze_width - np.abs(x - blaze_center),
                               z - (.227 - .46 * (y - .311)), y - .298])

    # +X is the kitten's left. Let the crown and cheek meet on an irregular edge.
    split = -.0015 + .0046 * np.sin(51 * y + 26 * z) + .0018 * np.sin(105 * z - 83 * y)
    orange_head = np.minimum.reduce([x - split, y - .269, z - .150 + .015 * smooth(.302, .335, y)])
    shoulder = patch_distance(points, (.043, .260, .085), (.067, .070, .092))
    shoulder -= .003 * np.sin(87 * z - 59 * y)
    mid_back = patch_distance(points, (-.047, .254, -.070), (.071, .063, .083))
    mid_back += .005 * np.sin(96 * z + 50 * x) * np.cos(39 * y)
    rump = patch_distance(points, (.042, .242, -.184), (.054, .074, .058))

    # Two irregular islands curl around the tail, with a black base and tip.
    tail_axis = .250 - y + .62 * (-z - .231)
    band = np.minimum(tail_axis - .056, .127 - tail_axis) + .49 * x + .004 * np.sin(x * 155)
    tip_side = np.minimum.reduce([tail_axis - .168, .224 - tail_axis, .009 - x])
    orange_tail = np.minimum(np.maximum(band, tip_side), -.232 - z)
    orange_boundary = np.maximum.reduce([orange_head, shoulder, mid_back, rump, orange_tail])
    white_boundary = np.maximum.reduce([chest, belly, legs, muzzle, blaze])
    wisps = .00076 * grain + .00125 * cloud
    white = smooth(-.0018, .00135, white_boundary + wisps)
    orange = smooth(-.0023, .0018, orange_boundary + 1.25 * wisps)

    # Broken, low-contrast mackerel traces follow the coat inside orange islands.
    stripe_phase = 178 * (z + .24 * (.252 - y) + .28 * x) + .95 * np.sin(y * 92 + 44 * x)
    pelt_bands = smooth(.38, .93, np.cos(stripe_phase)) * (.56 + .22 * np.sin(21 * z + 29 * y))
    brow_bands = smooth(.34, .96, np.cos(335 * x - 77 * y + 2.7 * np.sin(46 * y)))
    cheek_bands = smooth(.50, .98, np.cos(490 * (y + .31 * side) - 94 * z))
    brow_weight = smooth(.300, .329, y)
    face_bands = cheek_bands + (brow_bands - cheek_bands) * brow_weight
    face_bands *= 1 - smooth(.340, .360, y)  # Keep the ear solid orange.
    tail_bands = smooth(.47, .96, np.cos(224 * tail_axis + 1.3 * np.sin(87 * x)))
    markings = pelt_bands * (1 - smooth(.268, .303, y))
    markings += .67 * face_bands * smooth(.144, .205, z) * smooth(.267, .298, y)
    markings += .40 * tail_bands * smooth(.241, .276, -z)

    chest_ruff = smooth(-.014, .009, chest) * smooth(.153, .193, y)
    cheek_ruff = smooth(.165, .207, z) * smooth(.270, .286, y)
    cheek_ruff *= (1 - smooth(.309, .336, y)) * smooth(.006, .018, side)
    return white, orange, np.clip(markings, 0, 1), chest_ruff, cheek_ruff


def leather_colors(pigment, rest, surface, occupied, fur, model):
    nose = occupied & (surface == 1)
    x, y, z = rest[nose].T
    wing = np.abs(x)
    pink = color(model['leather']['nose'])
    dyed = mix(color('#A26668'), pink, smooth(.2967, .3037, y))
    pores = .7 * np.sin(4300 * x + 6200 * y) + .55 * np.sin(5700 * z - 2500 * x)
    nostrils = np.hypot((wing - .0037) / .00158, (y - .2986 - .24 * (wing - .0037)) / .0010)
    cleft = (1 - smooth(.00013, .00053, wing)) * (1 - smooth(.2974, .3008, y))
    shadows = np.maximum(.85 * (1 - smooth(.16, 1.19, nostrils)), .60 * cleft)
    pigment[nose] = mix(dyed + pores[:, None] * [3.0, 2.2, 2.4], color('#63383D'), shadows)
    soften_leather(pigment, rest, nose, fur & (rest[..., 2] > .233), .00105)

    pads = occupied & (surface == 2)
    x, y, z = rest[pads].T
    detail = .14 + .12 * np.sin(76 * z + 47 * x) + .06 * np.sin(834 * x - 215 * y)
    pigment[pads] = mix(color(model['leather']['pads']), color('#975D61'), detail)
    ears = occupied & (surface == 3)
    pigment[ears] = mix(color('#694449'), color('#BC9591'), smooth(.335, .376, rest[ears, 1]))
    soften_leather(pigment, rest, ears, fur & (rest[..., 1] > .330), .0048)
    pigment[occupied & (surface == 4)] = color('#4D3338')


def write_map(out, name, pixels):
    full = bitmap(pixels)
    # Box filter each channel independently. Coat alpha encodes length.
    downsampled = [band.resize((1024, 1024), Image.Resampling.BOX) for band in full.split()]
    Image.merge(full.mode, downsampled).save(out / f'{name}-1024.png')
    if name != 'flow':
        full.save(out / f'{name}-2048.png')


def body(out, atlas, model, rng, master):
    rest, chart, surface = raster(atlas, surface=None, surface_map=True)
    occupied = chart >= 0
    if master:
        guide = np.asarray(Image.open(GUIDES / 'uv_surface.png'))
        if not np.array_equal(occupied, guide[..., 3] > 0) or not np.array_equal(surface[occupied], guide[..., 0][occupied]):
            raise ValueError('Clementine raster disagrees with the master surface guide')
    names = atlas['charts']
    fur = occupied & (surface == 0)
    points = rest[fur]
    x, y, z = points.T
    tail = chart[fur] == names.index('tail')
    inner_lip = np.isin(chart[fur], [names.index('mouthUpper'), names.index('mouthLower')])
    upright = np.maximum.reduce([1 - smooth(.147, .258, y), smooth(.136, .222, z),
                                 smooth(.024, .056, np.abs(x)) * (1 - smooth(.211, .274, y))])
    grain = fur_grain(x + .16 * z, y + .11 * z, z - .18 * y, upright, rng)
    cloud = map_coordinates(rng.standard_normal((29, 29, 29), dtype=np.float32),
                            (x * 165, y * 149, z * 119), order=1, mode='grid-wrap')
    white, orange, stripes, chest, cheeks = calico(points, grain, cloud)
    white[inner_lip] = orange[inner_lip] = 0
    length = model['coat']['furLengthMm']
    mm = length['body'] + (length['chest'] - length['body']) * chest
    mm += (length['cheeks'] - mm) * cheeks
    tail_weight = smooth(.230, .257, -z[tail])
    mm[tail] = length['body'] + (length['tail'] - length['body']) * tail_weight
    mm[inner_lip] = 0

    black, amber, cream = (color(model['coat']['palette'][key]) for key in ('black', 'orange', 'white'))
    pigment = np.broadcast_to(black, (*chart.shape, 3)).copy()
    dark = black + grain[:, None] * [9.0, 8.8, 9.5] + cloud[:, None] * 3.1
    ginger = mix(amber, color('#985322'), stripes * .31) + grain[:, None] * [11, 10, 8] + cloud[:, None] * 4
    light = cream + grain[:, None] * [8.1, 7.9, 7.5] + cloud[:, None] * 3.6
    pelt = mix(mix(dark, ginger, orange), light, white)
    follicles = np.zeros_like(x)
    for across, high in ((.0067, .2941), (.0118, .2944), (.0095, .2898), (.0140, .2905), (.0161, .2965)):
        d = np.hypot((np.abs(x) - across) / .00095, (y - high - .0003 * np.sign(x)) / .00068)
        follicles = np.maximum(follicles, 1 - smooth(.15, 1.25, d))
    pelt = mix(pelt, color('#AC9C95'), follicles * white * smooth(.229, .247, z) * .46)
    pelt[inner_lip] = color('#58454A')
    pigment[fur] = pelt
    leather_colors(pigment, rest, surface, occupied, fur, model)

    colored_orange = orange * (1 - white)
    mask = np.zeros((*chart.shape, 4), dtype=np.float32)
    mask[fur] = np.column_stack((white, stripes * colored_orange, colored_orange, mm / 35)) * 255
    distance, (rows, cols) = distance_transform_edt(~occupied, return_indices=True)
    gutter = ~occupied & (distance <= 12)
    relief = np.zeros(chart.shape, dtype=np.float32)
    relief[fur] = (grain + .31 * cloud) * (mm / 6)**.64
    relief[gutter] = relief[rows[gutter], cols[gutter]]
    fur_charts = np.where(fur, chart, -1)
    islands = np.where(gutter, fur_charts[rows, cols], fur_charts)
    du, dv = chart_gradient(relief, islands)
    normal = unit(np.stack((-du * .119, -dv * .119, np.ones_like(du)), axis=-1))
    normal[~fur] = [0, 0, 1]
    for name, pixels in (('body', pigment), ('coat', mask), ('normal', (normal + 1) * 127.5)):
        pixels[gutter] = pixels[rows[gutter], cols[gutter]]
        write_map(out, name, pixels)

    if master:
        normal = unit(np.asarray(Image.open(GUIDES / 'uv_normal.png'), dtype=np.float32)[fur, :3] / 127.5 - 1)
        direction = np.column_stack((.29 * np.tanh(x * 38) + .055 * np.sin(z * 55),
                                     -.18 - .91 * upright, -1 + .94 * upright))
        direction[tail, 1] = -.32 - .77 * smooth(.245, .075, y[tail])
        direction[tail, 2] = -.96 + .60 * smooth(.245, .075, y[tail])
        direction = unit(direction - normal * (direction * normal).sum(axis=-1, keepdims=True))
        flow = np.full_like(pigment, 127.5)
        flow[fur] = (direction + 1) * 127.5
        flow[gutter] = flow[rows[gutter], cols[gutter]]
        write_map(out, 'flow', flow)


def iris(out, model):
    source = json.loads((TEXTURES / 'originals/eyes/clementine.json').read_text())
    raw = base64.b64decode(source['data'])
    if hashlib.sha256(raw).hexdigest() != source['sha256']:
        raise ValueError('Clementine iris source hash mismatch')
    reference = np.asarray(register_iris(Image.open(BytesIO(raw)).convert('RGB')), dtype=np.float32)
    y, x = (np.indices(reference.shape[:2], dtype=np.float32) + .5) / reference.shape[0] - .5
    distance = np.hypot(x, y)
    angle = np.arctan2(y, x)
    gray = reference @ np.array([.2126, .7152, .0722])
    median = np.median(gray[(distance > .19) & (distance < .34) & (np.abs(x) > .10)])
    fibers = np.clip((gray - median) / 255, -.19, .18)
    spokes = (.027 * np.sin(111 * angle + 3.2 * np.sin(18 * distance)) +
              .019 * np.sin(193 * angle + 5.1 * np.cos(11 * distance)))
    original_pupil = (1 - smooth(24, 61, gray)) * (1 - smooth(.241, .285, distance))
    fibers = (fibers * (1 - original_pupil) + spokes) * (1 - .48 * smooth(.35, .42, distance))
    limbus = smooth(.332, .417, distance)
    hue = mix(color(model['eyes']['iris']), color(model['eyes']['limbal']), limbus)
    hue += (fibers * 198)[..., None] * [1.01, 1.0, .95]
    collar = .13 * np.exp(-((distance - .175 - .011 * np.sin(13 * angle)) / .035)**2)
    hue = mix(hue, color('#B1AD7C'), collar)
    hue = mix(hue, color('#252F32'), smooth(.408, .428, distance))
    # A tapered daylight slit, with the reflection left to the cornea mesh.
    slit = (np.abs(x) / .052)**1.7 + (np.abs(y) / .252)**1.7
    pupil = 1 - smooth(.94, 1.045, slit)
    bitmap(mix(hue, color('#080C0D'), pupil)).save(out / 'eye-512.png')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('output', type=Path)
    parser.add_argument('--registration-v1', action='store_true')
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    roster = json.loads((ROOT / 'data/cats.json').read_text())['cats']
    model = next(cat['model'] for cat in roster if cat['id'] == 'clementine')
    atlas = TEXTURES / 'registration-v1/atlas.json' if args.registration_v1 else GUIDES / 'atlas.json'
    rng = np.random.default_rng(262421)
    body(args.output, read_atlas(atlas), model, rng, master=not args.registration_v1)
    if not args.registration_v1:
        iris(args.output, model)
        noise = rng.standard_normal((256, 256), dtype=np.float32)
        strand = gaussian_filter(noise, (4.9, .55), mode='wrap') - gaussian_filter(noise, (12, 2.5), mode='wrap')
        bitmap(np.clip(128 + 22 * strand / strand.std(), 32, 224)).convert('RGB').save(args.output / 'strand-256.png')


if __name__ == '__main__':
    main()
