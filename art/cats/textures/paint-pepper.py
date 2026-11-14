"""Bake Pepper's mackerel coat and photo-sampled iris on the restored master."""
import argparse
import base64
import hashlib
from io import BytesIO
import json
from pathlib import Path

import numpy as np
from PIL import Image
from scipy.interpolate import CubicSpline
from scipy.ndimage import distance_transform_edt, map_coordinates
from scipy.spatial import cKDTree

from coat_paint import bitmap, color, fur_grain, mix, ribbon, smooth, soften_leather, stroke, unit
from prepare import register_iris
from reproject import raster, read_atlas

ROOT = Path(__file__).resolve().parents[3]
GUIDES = ROOT / 'art/cats/master/notes'


def torso_stripes(x, y, z, grain):
    spine = np.interp(z, [-.231, -.172, .025, .11, .17], [.271, .307, .294, .308, .288])
    side = np.abs(x)
    # Fraction of the way around a cross-section from the spine to the belly.
    drop = np.arctan2(side / .05, (y - spine + .073) / .073) / np.pi
    lateral = np.tanh(x * 48)
    edge = grain * .0012
    markings = np.zeros_like(x)
    # The width, sweep and end of each ribbon vary from hip to shoulder.
    pattern = (
        (-.224, .006, -.013, .60), (-.195, .005, -.013, .71),
        (-.158, .006, -.023, .77), (-.124, .004, -.018, .69),
        (-.091, .005, -.025, .81), (-.058, .005, -.018, .76),
        (-.025, .004, -.019, .73), (.006, .005, -.015, .79),
        (.038, .005, -.022, .73), (.069, .004, -.017, .67),
        (.099, .005, -.020, .59), (.123, .004, -.017, .50),
    )
    sweep = np.sin(np.pi * drop) + .22 * np.sin(2 * np.pi * drop)
    drift = .009 * drop**2 + lateral * (.0015 + .0018 * np.sin(y * 51)) * drop
    for start, width, bend, reach in pattern:
        path = start + bend * sweep + drift + .0031 * np.sin(15 * drop + 27 * start)
        path += lateral * (.0019 + .0039 * smooth(.0, .32, drop)) * np.sin(43 * start + 9 * drop)
        thin = (.84 + .10 * np.sin(12 * drop + 49 * start)) * (1 - .59 * smooth(.30, reach, drop))
        bar = ribbon(z - path + edge, width * thin, .0020)
        np.maximum(markings, bar * (1 - smooth(reach - .11, reach + .018, drop)), out=markings)
    markings *= smooth(.132, .170, y) * smooth(-.239, -.219, z)
    dorsal = ribbon(x - .002 * np.sin(z * 27) + edge, .006, .003)
    dorsal *= (1 - smooth(.12, .29, drop)) * smooth(-.245, -.228, z) * (1 - smooth(.129, .169, z))

    # Sloped planes wrap each necklace continuously across the throat and neck.
    throat = y - .35 * (.152 - z) - .019 * (side / .053)**2 + edge
    necklaces = np.maximum.reduce([
        ribbon(throat - .247, .0046, .0020),
        ribbon(throat - .223, .0041, .0021),
        .90 * ribbon(throat - .197, .0038, .0021),
    ])
    necklaces *= smooth(.080, .129, z) * (1 - smooth(.165, .205, z))
    return np.maximum.reduce([markings, dorsal, necklaces])


def face_stripes(x, y, z, grain):
    side = np.abs(x)
    forehead = (y > .323) & (z > .199) & (side < .042)
    point = np.column_stack((side[forehead], y[forehead] + .0008 * grain[forehead]))
    brow = np.zeros_like(x)
    # The two mirrored central strokes overlap at the low point of the M.
    brow[forehead] = np.maximum.reduce([
        stroke(point, [(-.004, .335), (.004, .327), (.011, .343), (.014, .344)], .0023) * .91,
        stroke(point, [(.009, .338), (.013, .347), (.015, .348), (.017, .342)], .0025),
        stroke(point, [(.014, .348), (.019, .345), (.025, .332), (.031, .323)], .0025),
        .71 * stroke(point, [(.023, .347), (.029, .345), (.033, .338), (.038, .330)], .0022),
    ]) * smooth(.191, .211, z[forehead])
    crown = ribbon(side - (.012 + .004 * np.sin(75 * (z - .187))) + .0006 * grain, .0019, .0015)
    crown *= smooth(.341, .348, y) * smooth(.170, .188, z) * (1 - smooth(.208, .222, z))

    cheek = (side > .020) & (z > .151) & (z < .247) & (y > .276) & (y < .337)
    point = np.column_stack((z[cheek], y[cheek] + grain[cheek] * .001))
    whisker_bars = np.zeros_like(x)
    whisker_bars[cheek] = np.maximum.reduce([
        .88 * stroke(point, [(.248, .322), (.234, .323), (.206, .306), (.166, .313)], .0031),
        .88 * stroke(point, [(.237, .307), (.217, .311), (.198, .286), (.169, .292)], .0032),
        .65 * stroke(point, [(.224, .298), (.205, .296), (.196, .279), (.175, .282)], .0023),
    ]) * smooth(.020, .027, side[cheek])
    eyelid = np.hypot((side - .0178) / .0085, (y - .3218) / .0054)
    lid = .59 * ribbon(eyelid - 1.04, .18, .15) * smooth(.218, .231, z)
    return np.maximum.reduce([brow, crown * .82, whisker_bars, lid])


def leg_bars(x, y, z, grain):
    front_axis = y + .26 * (z - .095) + .0032 * np.sin(224 * (z - .075) + 21 * x)
    rear_axis = y + .20 * (z + .17) + .0044 * np.sin(102 * (z + .18) - 17 * x)
    front, rear = np.zeros_like(x), np.zeros_like(x)
    for center, width in ((.022, .003), (.045, .004), (.069, .004), (.095, .0045), (.125, .005), (.149, .005)):
        np.maximum(front, ribbon(front_axis - center + grain * .0008, width, .0023), out=front)
    for center, width in ((.025, .004), (.054, .0045), (.089, .004), (.118, .005), (.151, .006), (.180, .005)):
        np.maximum(rear, ribbon(rear_axis - center + grain * .0009, width, .0024), out=rear)
    front *= smooth(.052, .076, z) * (1 - smooth(.143, .176, y))
    rear *= (1 - smooth(-.112, -.069, z)) * (1 - smooth(.167, .206, y))
    return np.maximum(front, rear)


def tail_pattern(x, y, z, grain):
    # Arc length along the tail, with crosswise jitter at the fur scale.
    heights = [.048, .075, .115, .157, .197, .229, .257, .277]
    depths = [-.359, -.348, -.329, -.312, -.291, -.259, -.233, -.229]
    sample_y = np.linspace(heights[-1], heights[0], 240)
    spine = np.column_stack((sample_y, CubicSpline(heights, depths)(sample_y)))
    _, near = cKDTree(spine).query(np.column_stack((y, z)))
    tangent = unit(np.gradient(spine, axis=0))[near]
    offsets = np.column_stack((y, z)) - spine[near]
    arc = np.r_[0, np.cumsum(np.linalg.norm(np.diff(spine, axis=0), axis=1))]
    along = arc[near] + (offsets * tangent).sum(axis=1)
    phase = along + .19 * x + .0009 * grain
    rings = np.zeros_like(x)
    for center, width in ((.033, .007), (.061, .006), (.095, .007), (.128, .007),
                          (.158, .007), (.186, .006), (.212, .006)):
        np.maximum(rings, ribbon(phase - center, width, .0024), out=rings)
    return np.maximum(rings, smooth(.227, .234, phase))


def markings(rest, normals, tail, grain):
    x, y, z = rest.T
    side = np.abs(x)
    bands = np.maximum.reduce([torso_stripes(x, y, z, grain), face_stripes(x, y, z, grain),
                               leg_bars(x, y, z, grain)])
    bands[tail] = tail_pattern(x[tail], y[tail], z[tail], grain[tail])
    chin = smooth(.205, .228, z) * (1 - smooth(.279, .294, y)) * (1 - smooth(.017, .028, side))
    medial = smooth(.35, .82, -normals[:, 0] * np.sign(x)) * smooth(.035, .064, y)
    medial *= (1 - smooth(.118, .153, y)) * smooth(-.232, -.216, z)
    wash = np.maximum(chin * .88, medial * .54)
    return bands, wash


def nose_pigment(points, fur_distance, leather, reference):
    x, y, _ = points.T
    side = np.abs(x)
    # Keep the photo's copper-red lobes and dark leather lip on the shared nose.
    # The tiny shape variation follows Pepper's rest geometry across the UV cut.
    lobe = smooth(.2974, .3026, y + .00035 * np.sin(690 * x))
    lobe *= 1 - .26 * smooth(.0042, .0063, side)
    warm = mix(color(reference['low']), leather, lobe)
    warm = mix(warm, color(reference['warm']), .45 * smooth(.3014, .3043, y) * smooth(.0015, .0046, side))
    core = smooth(.0002, .00145, fur_distance)
    # The jagged top and side edges are partly covered by muzzle fur.
    top = smooth(.3000, .3032, y)
    rim = (1 - core) * (.74 - .48 * top)
    pigment = mix(warm, color(reference['edge']), rim)
    nostril_radius = np.hypot((side - .00355) / .0016, (y - .29920 - .29 * (side - .00355)) / .00101)
    nostril = (1 - smooth(.29, 1.21, nostril_radius)) * .90
    philtrum = (1 - smooth(.00014, .00066, side)) * (1 - smooth(.2978, .3001, y))
    pigment = mix(pigment, color(reference['nostril']), np.maximum(nostril, .72 * philtrum))
    mottling = .50 * np.sin(x * 1190 + y * 1740) + .31 * np.sin(x * 2380 - y * 2260)
    return pigment + mottling[:, None] * np.array([3.2, 2.1, 1.5]) * core[:, None]


def leather_colors(pigment, rest, surface, occupied, fur, model, reference):
    nose = occupied & (surface == 1)
    muzzle = fur & (rest[..., 2] > .231)
    distance, nearby = cKDTree(rest[muzzle]).query(rest[nose])
    leather = rest[nose]
    dyed = nose_pigment(leather, distance, color(model['leather']['nose']), reference)
    y = leather[:, 1]
    side = np.abs(leather[:, 0])
    top = smooth(.2993, .3033, y)
    feather = (.28 + .61 * top) * (1 - smooth(.00016, .00149, distance))
    arch = .3026 + .0006 * np.exp(-((side - .0023) / .0016)**2) - .0012 * (side / .006)**2
    fur_overlap = .96 * smooth(arch - .0005, arch + .0010, y)
    pigment[nose] = mix(dyed, pigment[muzzle][nearby], np.maximum(feather, fur_overlap))
    pads = occupied & (surface == 2)
    pigment[pads] = color(model['leather']['pads'])
    ears = occupied & (surface == 3)
    x, y, z = rest[ears].T
    grain = .025 * np.sin(x * 2900 + y * 230) + .019 * np.sin(z * 4100 + y * 470)
    pigment[ears] = mix(np.array([96, 69, 60]), np.array([161, 120, 105]), smooth(.338, .377, y) + grain)
    soften_leather(pigment, rest, ears, fur & (rest[..., 1] > .326), .0045)
    pigment[occupied & (surface == 4)] = [62, 36, 32]


def body(out, atlas, model, rng, nose_reference):
    rest, chart = raster(atlas, surface=None)
    guide = np.asarray(Image.open(GUIDES / 'uv_surface.png').convert('RGBA'))
    surface, occupied = guide[..., 0], guide[..., 3] > 0
    if not np.array_equal(chart >= 0, occupied):
        raise ValueError('Pepper raster and surface guide disagree')
    fur = occupied & (surface == 0)
    p = rest[fur]
    x, y, z = p.T
    side = np.abs(x)
    tail = chart[fur] == atlas['charts'].index('tail')
    n = unit(np.asarray(Image.open(GUIDES / 'uv_normal.png'), dtype=np.float32)[fur, :3] / 127.5 - 1)
    flank = smooth(.023, .047, side) * (1 - smooth(.221, .286, y))
    upright = np.maximum.reduce([1 - smooth(.115, .190, y), flank * .72, smooth(.324, .363, y)])
    grain = fur_grain(x + z * .082, y + z * .16, z - y * .24, upright, rng)
    cloud = map_coordinates(rng.standard_normal((32, 32, 32), dtype=np.float32),
                            (x * 119, y * 102, z * 113), order=1, mode='grid-wrap')
    stripe, wash = markings(p, n, tail, grain)

    coat = model['coat']
    lengths = coat['furLengthMm']
    chest = smooth(.075, .142, z) * smooth(.20, .72, n[:, 2])
    chest *= smooth(.137, .181, y) * (1 - smooth(.225, .268, y))
    cheeks = smooth(.171, .213, z) * smooth(.261, .280, y) * (1 - smooth(.312, .340, y))
    cheeks *= np.maximum(smooth(.018, .026, side), wash)
    mm = lengths['body'] + (lengths['chest'] - lengths['body']) * chest
    mm += (lengths['cheeks'] - mm) * cheeks
    mm[tail] += (lengths['tail'] - mm[tail]) * smooth(.229, .250, -z[tail])

    base, ink, ticking, white = (color(coat['palette'][key]) for key in ('base', 'stripe', 'ticking', 'white'))
    pigment = np.broadcast_to(base, (*chart.shape, 3)).copy()
    agouti = .06 + .49 * smooth(-.82, .92, grain + .39 * cloud)
    pelt = mix(base, ticking, agouti)
    # Dark guard hairs on the saddle and the face, with fine ticks between stripes.
    saddle = smooth(.260, .306, y) * (1 - smooth(.15, .21, z)) * (1 - smooth(.015, .049, side))
    pelt = mix(pelt, ink, .25 * saddle + .07 * smooth(-.3, -1.4, cloud))
    muzzle = smooth(.224, .247, z) * (1 - smooth(.012, .022, side)) * smooth(.292, .31, y)
    pelt = mix(pelt, ink, .24 * muzzle)
    eye_rim = np.hypot((side - .018) / .012, (y - .321) / .0074)
    pelt = mix(pelt, ticking, .43 * ribbon(eye_rim - 1.06, .22, .31) * smooth(.222, .234, z))
    mottled_stripe = stripe * (.84 + .07 * grain + .045 * cloud) * (1 - .44 * wash)
    pelt = mix(pelt, ink, np.clip(mottled_stripe, 0, 1))
    pelt = mix(pelt, white, wash * (.70 + .08 * grain))
    inner_lip = np.isin(chart[fur], [atlas['charts'].index(name) for name in ('mouthUpper', 'mouthLower')])
    pelt = mix(pelt, np.array([81, 53, 44]), inner_lip * .74)
    pigment[fur] = pelt + grain[:, None] * np.array([5.7, 5.3, 4.8]) + cloud[:, None] * 4
    leather_colors(pigment, rest, surface, occupied, fur, model, nose_reference)

    mask = np.zeros((*chart.shape, 4), dtype=np.float32)
    mask[fur] = np.column_stack((wash, stripe, np.zeros_like(stripe), mm / 35)) * 255
    distance, (rows, cols) = distance_transform_edt(~occupied, return_indices=True)
    gutter = ~occupied & (distance <= 10)
    for label, pixels in (('body', pigment), ('coat', mask)):
        pixels[gutter] = pixels[rows[gutter], cols[gutter]]
        full = bitmap(pixels)
        if label == 'coat':
            phone = Image.merge('RGBA', tuple(channel.resize((1024, 1024), Image.Resampling.BOX)
                                             for channel in full.split()))
        else:
            phone = full.resize((1024, 1024), Image.Resampling.BOX)
        phone.save(out / f'{label}-1024.png')
        full.save(out / f'{label}-2048.png')


def eye(out, model, reference):
    source = json.loads((Path(__file__).parent / 'originals/eyes/pepper.json').read_text())
    raw = base64.b64decode(source['data'])
    if hashlib.sha256(raw).hexdigest() != source['sha256']:
        raise ValueError('Pepper iris source hash mismatch')
    template = register_iris(Image.open(BytesIO(raw)).convert('RGB'))
    detail = np.asarray(template.convert('L'), dtype=np.float32)
    # Blend nearby fibers into the source's dark pupil before drawing the
    # thinner daylight slit. Both eyes share the same pigmentation.
    columns = np.arange(detail.shape[1]) - detail.shape[1] // 2 + .5
    mirror = np.clip(np.where(columns < 0, -36 - columns, 36 - columns) + columns.size // 2,
                     0, columns.size - 1).astype(int)
    filled = np.maximum(detail, detail[:, mirror])
    detail = detail + (filled - detail) * (1 - smooth(7, 26, np.abs(columns)))
    y, x = (np.indices(detail.shape, dtype=np.float32) + .5) / detail.shape[0] - .5
    radial = np.hypot(x, y)
    angle = np.arctan2(y, x)
    mid = np.median(detail[(radial > .16) & (radial < .32)])
    fibers = np.clip((detail - mid) / 255, -.30, .30)
    rim = smooth(.298, .414, radial)
    iris = color(model['eyes']['iris'])
    amber = .37 * (1 - smooth(.085, .255, radial))
    amber *= .83 + .17 * np.cos(9 * angle + 1.9 * np.sin(3 * angle))
    pigment = mix(iris, color(reference['inner']), amber)
    pigment += fibers[..., None] * np.array([125, 118, 77]) * (1 - .51 * rim[..., None])
    pigment = mix(pigment, color(model['eyes']['limbal']), rim)
    pigment = mix(pigment, np.array([31, 34, 24]), smooth(.415, .429, radial))
    aperture = .0275 * np.clip(1 - (y / .228)**2, 0, 1)**.62
    opening = (1 - smooth(-.0015, .0024, np.abs(x) - aperture)) * (1 - smooth(.221, .228, np.abs(y)))
    bitmap(mix(pigment, np.array([8, 10, 5]), opening)).save(out / 'eye-512.png')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('output', type=Path)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    roster = json.loads((ROOT / 'data/cats.json').read_text())['cats']
    model = next(cat['model'] for cat in roster if cat['id'] == 'pepper')
    reference = json.loads(Path(__file__).with_name('pepper-reference.json').read_text())
    rng = np.random.default_rng(483902)
    body(args.output, read_atlas(GUIDES / 'atlas.json'), model, rng, reference['nose']['pigments'])
    eye(args.output, model, reference['iris']['pigments'])


if __name__ == '__main__':
    main()
