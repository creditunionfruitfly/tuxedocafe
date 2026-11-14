"""Paint Biscuit on the current master atlas. Run after npm run assets."""
import argparse
import base64
import hashlib
from io import BytesIO
import json
from pathlib import Path

import numpy as np
from PIL import Image
from scipy.ndimage import distance_transform_edt, gaussian_filter

from coat_paint import bitmap, color, fur_grain, mix, ribbon, smooth, soften_leather, stroke, unit
from prepare import register_iris
from reproject import raster, read_atlas

ROOT = Path(__file__).resolve().parents[3]
GUIDES = ROOT / 'art/cats/master/notes'


def markings(x, y, z, tail, grain):
    side = np.abs(x)
    # Warp the two enclosing flank bands and leave a tapered break in the outer one.
    u = (z + .051 + .004 * np.tanh(x * 48)) / .081
    v = (y - .222 + .105 * (z + .051)) / .053
    u, v = u + .17 * v + .07 * v**2, v + .08 * np.sin(2.1 * u)
    radius, angle = np.hypot(u, v), np.arctan2(v, u)
    radius += grain * .020
    outer = ribbon(radius - (1.05 + .11 * np.sin(angle + .5) + .075 * np.cos(3 * angle)), .129, .085)
    outer *= 1 - .86 * smooth(.70, .98, np.cos(angle - .79))
    inner = ribbon(radius - (.58 + .09 * np.sin(2 * angle - .7)), .13, .09)
    centre = (1 - smooth(.19, .37, np.hypot((u + .08) * .89, (v + .018) * 1.15))) * .92
    flank = np.maximum.reduce([outer * .94, inner * .84, centre]) * smooth(.020, .041, side)
    haunch = ribbon(z + .164 + .025 * np.sin((y - .23) * 26) + grain * .0013, .008, .004)
    haunch *= smooth(.158, .21, y) * (1 - smooth(.263, .297, y)) * smooth(.031, .048, side)

    # Two mirrored sets of brush strokes follow the shoulder blades.
    shoulder = (y > .238) & (z > .009) & (z < .138)
    points = np.column_stack((side[shoulder], z[shoulder]))
    wings = np.zeros_like(x)
    wings[shoulder] = np.maximum.reduce([
        stroke(points, [(.002, .083), (.017, .112), (.037, .133), (.052, .093)], .0064),
        stroke(points, [(.003, .079), (.025, .080), (.053, .099), (.044, .052)], .0072),
        stroke(points, [(.005, .069), (.027, .062), (.049, .056), (.045, .024)], .0061) * .84,
    ])
    wings *= smooth(.239, .269, y)
    dorsal = ribbon(side + .0015 * np.sin(z * 45), .005, .004)
    dorsal *= smooth(.273, .295, y) * smooth(-.222, -.179, z) * (1 - smooth(.094, .142, z))

    brow = .331 + .76 * side - 1.47 * np.maximum(side - .014, 0)
    forehead = ribbon(y - brow + .0007 * grain, .0022, .0015)
    forehead *= smooth(.199, .224, z) * (1 - smooth(.021, .032, side))
    cheek = y - .300 - .40 * (z - .203) + .0009 * grain
    cheekbars = np.maximum(ribbon(cheek, .0022, .0016), ribbon(cheek - .009, .0024, .0018) * .74)
    cheekbars *= smooth(.024, .036, side) * smooth(.178, .198, z) * (1 - smooth(.218, .243, z))

    leg_phase = 204 * y + 38 * z + 1.35 * np.sin(z * 42) + .12 * grain
    legbars = smooth(.34, .87, np.cos(leg_phase)) * smooth(.023, .048, y) * (1 - smooth(.111, .147, y))

    # Measure along the curved tail so the markings wrap its cross-section.
    path = np.array([(.263, -.217), (.239, -.248), (.212, -.277), (.178, -.303),
                     (.136, -.321), (.095, -.337), (.049, -.356)])
    segments = np.diff(path, axis=0)
    segment_lengths = np.linalg.norm(segments, axis=1)
    samples = np.column_stack((y[tail], z[tail]))
    offset = samples[:, None, :] - path[None, :-1]
    t = np.clip(np.einsum('nki,ki->nk', offset, segments) / segment_lengths**2, 0, 1)
    nearest = np.linalg.norm(offset - t[..., None] * segments, axis=2).argmin(axis=1)
    along = np.r_[0, np.cumsum(segment_lengths[:-1])][nearest] + t[np.arange(len(samples)), nearest] * segment_lengths[nearest]
    tail_phase = along * 224 + .34 * np.sin(along * 45) + .09 * grain[tail]
    rings = smooth(.25, .88, np.cos(tail_phase)) * smooth(.018, .050, along)
    tailbands = np.zeros_like(x)
    tailbands[tail] = np.maximum(rings * .93, smooth(.220, .236, along) * .69)
    return np.maximum.reduce([flank, haunch * .69, wings * .97, dorsal * .70,
                              forehead * .67, cheekbars * .54, legbars * .62, tailbands])


def anatomical_pigments(pigment, rest, surface, occupied, fur, model):
    nose = occupied & (surface == 1)
    x, y, _ = rest[nose].T
    leather = color(model['leather']['nose'])
    lobe = smooth(.301, .314, y)
    crease = (1 - smooth(.0008, .0034, np.abs(x))) * (1 - smooth(.297, .307, y))
    pigment[nose] = mix(leather * .70, leather * .94, lobe * (1 - .55 * crease))
    soften_leather(pigment, rest, nose, fur & (rest[..., 2] > .222), .0028)
    pads = occupied & (surface == 2)
    pigment[pads] = color(model['leather']['pads']) * .83
    ears = occupied & (surface == 3)
    ear_tip = smooth(.336, .379, rest[ears, 1])
    pigment[ears] = mix(np.array([169, 104, 80]), np.array([217, 152, 117]), ear_tip)
    soften_leather(pigment, rest, ears, fur & (rest[..., 1] > .32), .0043)
    pigment[occupied & (surface == 4)] = [85, 42, 36]


def body(out, atlas, model, rng):
    rest, chart = raster(atlas, surface=None)
    surface_guide = np.asarray(Image.open(GUIDES / 'uv_surface.png').convert('RGBA'))
    surface, occupied = surface_guide[..., 0], surface_guide[..., 3] != 0
    fur = occupied & (surface == 0)
    if not np.array_equal(chart >= 0, occupied):
        raise ValueError('Biscuit coat raster does not match the restored atlas')
    x, y, z = rest[fur].T
    normal = unit(np.asarray(Image.open(GUIDES / 'uv_normal.png'), dtype=np.float32)[fur, :3] / 127.5 - 1)
    atlas_chart = chart[fur]
    tail = atlas_chart == atlas['charts'].index('tail')
    inner_lip = np.isin(atlas_chart, [atlas['charts'].index(name) for name in ('mouthUpper', 'mouthLower')])
    flank = smooth(.020, .058, np.abs(x)) * (1 - smooth(.223, .282, y))
    upright = np.maximum.reduce([1 - smooth(.127, .201, y), flank * .72, smooth(.325, .362, y)])
    grain = fur_grain(x, y, z, upright, rng)

    marking = markings(x, y, z, tail, grain)
    chin = smooth(.182, .232, z) * (1 - smooth(.282, .310, y))
    belly = (1 - smooth(.166, .213, y)) * (1 - smooth(.020, .043, np.abs(x)))
    belly *= smooth(.132, .159, y) * smooth(-.147, -.103, z) * (1 - smooth(.034, .083, z))
    wash = np.maximum(chin * .91, belly * .77)
    chest = smooth(.073, .124, z) * (1 - smooth(.035, .051, np.abs(x)))
    chest *= smooth(.153, .193, y) * (1 - smooth(.249, .285, y))
    cheeks = smooth(.183, .225, z) * smooth(.269, .286, y) * (1 - smooth(.317, .341, y))
    cheeks *= np.maximum(smooth(.010, .023, np.abs(x)), chin)
    tail_length = tail * smooth(.231, .270, -z)
    length = model['coat']['furLengthMm']
    mm = length['body'] + (length['chest'] - length['body']) * chest
    mm += (length['cheeks'] - mm) * cheeks
    mm += (length['tail'] - length['body']) * tail_length

    palette = model['coat']['palette']
    base, stripe, pale = (color(palette[key]) for key in ('base', 'stripe', 'pale'))
    pigment = np.broadcast_to(base, (*chart.shape, 3)).copy()
    warmth = .06 + .13 * smooth(.289, .169, y) + .035 * np.sin(24 * z + 20 * y)
    pelt = mix(base, pale, warmth)
    pelt = mix(pelt, stripe, marking * (.68 + .043 * grain) * (1 - .51 * wash))
    pelt = mix(pelt, pale, wash)
    lip = smooth(.229, .246, z) * (1 - smooth(.009, .016, np.abs(x)))
    pelt = mix(pelt, np.array([138, 83, 60]), inner_lip * (.49 + .40 * lip))
    pigment[fur] = pelt + grain[:, None] * np.array([4.9, 5.7, 5.2])
    anatomical_pigments(pigment, rest, surface, occupied, fur, model)

    mask = np.zeros((*chart.shape, 4), dtype=np.uint8)
    mask[fur] = np.rint(np.column_stack((wash, marking, np.zeros_like(wash), mm / 35)) * 255).astype(np.uint8)
    distance, (rows, cols) = distance_transform_edt(~occupied, return_indices=True)
    gutter = (~occupied) & (distance <= 8)

    relief = np.zeros(chart.shape, dtype=np.float32)
    relief[fur] = grain * (mm / 6)**.45
    relief[gutter] = relief[rows[gutter], cols[gutter]]
    fur_charts = np.where(fur, chart, -1)
    islands = np.where(gutter, fur_charts[rows, cols], fur_charts)
    padded = np.pad(relief, 1, mode='edge')
    padded_chart = np.pad(islands, 1, mode='edge')
    left, right = padded_chart[1:-1, :-2] == islands, padded_chart[1:-1, 2:] == islands
    up, down = padded_chart[:-2, 1:-1] == islands, padded_chart[2:, 1:-1] == islands
    du = np.where(right, padded[1:-1, 2:], relief) - np.where(left, padded[1:-1, :-2], relief)
    dv = np.where(down, padded[2:, 1:-1], relief) - np.where(up, padded[:-2, 1:-1], relief)
    normal_map = unit(np.stack((-du * .078, -dv * .078, np.ones_like(relief)), axis=-1))
    normal_map[~fur] = [0, 0, 1]

    flow = np.full_like(pigment, 128)
    direction = np.column_stack((.23 * np.tanh(x * 27) + .06 * np.sin(z * 62),
                                 -.28 - .80 * upright, -1 + .82 * upright))
    direction[tail, 1:] = np.column_stack((-.30 - .74 * smooth(.24, .08, y[tail]),
                                           -.93 + .51 * smooth(.24, .08, y[tail])))
    flow[fur] = (unit(direction - normal * (direction * normal).sum(axis=-1, keepdims=True)) + 1) * 127.5

    for label, pixels in (('body', pigment), ('coat', mask), ('normal', (normal_map + 1) * 127.5), ('flow', flow)):
        pixels[gutter] = pixels[rows[gutter], cols[gutter]]
        full = bitmap(pixels)
        full.resize((1024, 1024), Image.Resampling.BOX).save(out / f'{label}-1024.png')
        if label != 'flow':
            full.save(out / f'{label}-2048.png')


def eye(out, model):
    # Preserve the original registered iris fibers and soft pupil edge.
    source = json.loads((Path(__file__).parent / 'originals/eyes/biscuit.json').read_text())
    raw = base64.b64decode(source['data'])
    if hashlib.sha256(raw).hexdigest() != source['sha256']:
        raise ValueError('Biscuit iris source hash mismatch')
    art = np.asarray(register_iris(Image.open(BytesIO(raw)).convert('RGB')), dtype=np.float32)
    y, x = (np.indices(art.shape[:2], dtype=np.float32) + .5) / art.shape[0] - .5
    r = np.hypot(x, y)
    red = art[..., 0]
    mid = np.median(red[(r > .14) & (r < .34) & (np.abs(x) > .06)])
    limbus = smooth(.353, .414, r)
    hue = mix(color(model['eyes']['iris']), color(model['eyes']['limbal']), limbus)
    fibers = np.clip((red - mid) / 255, -.54, .40) * (1 - .62 * limbus)
    hue += fibers[..., None] * np.array([117, 100, 67])
    hue = mix(hue, np.array([28, 14, 9]), smooth(.414, .429, r))
    pupil = (1 - smooth(19, 48, red)) * (1 - smooth(.205, .235, r))
    bitmap(mix(hue, np.array([9, 6, 5]), pupil)).save(out / 'eye-512.png')


def strand(out, rng):
    noise = rng.standard_normal((256, 256), dtype=np.float32)
    detail = gaussian_filter(noise, (4, .63), mode='wrap') - gaussian_filter(noise, (9, 2.7), mode='wrap')
    bitmap(np.clip(128 + 22 * detail / detail.std(), 32, 224)).convert('RGB').save(out / 'strand-256.png')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('output', type=Path)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    roster = json.loads((ROOT / 'data/cats.json').read_text())['cats']
    model = next(cat['model'] for cat in roster if cat['id'] == 'biscuit')
    rng = np.random.default_rng(102467)
    body(args.output, read_atlas(GUIDES / 'atlas.json'), model, rng)
    eye(args.output, model)
    strand(args.output, rng)


if __name__ == '__main__':
    main()
