"""Rest-space painting helpers for resident cat textures."""
import numpy as np
from PIL import Image
from scipy.ndimage import map_coordinates
from scipy.spatial import cKDTree


def color(value):
    return np.array(list(bytes.fromhex(value[1:])), dtype=np.float32)


def smooth(a, b, value):
    t = np.clip((value - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


def mix(a, b, weight):
    return a + (b - a) * weight[..., None]


def unit(vector):
    return vector / np.maximum(np.linalg.norm(vector, axis=-1, keepdims=True), 1e-6)


def bitmap(pixels):
    return Image.fromarray(np.uint8(np.clip(np.rint(pixels), 0, 255)))


def ribbon(distance, width, feather):
    return 1 - smooth(width - feather, width + feather, np.abs(distance))


def stroke(points, controls, width):
    """A tapered brush stroke sampled from a cubic in metres."""
    t = np.linspace(0, 1, 128)[:, None]
    a, b, c, d = np.asarray(controls)
    line = (1 - t)**3 * a + 3 * (1 - t)**2 * t * b + 3 * (1 - t) * t**2 * c + t**3 * d
    distance, index = cKDTree(line).query(points)
    pressure = np.sin(np.pi * t[index, 0])**.58
    return ribbon(distance, width * (.12 + .88 * pressure), .0018) * pressure


def fur_grain(x, y, z, upright, rng):
    # Noise is evaluated in rest space so a UV cut never moves the strands.
    lattice = rng.standard_normal((48, 48, 48), dtype=np.float32)
    along = np.stack((x * 1100 + .7 * np.sin(z * 71), y * 1040, z * 306))
    down = np.stack((x * 1040, y * 287, z * 1120 + .9 * np.sin(y * 92)))
    long = map_coordinates(lattice, along, order=1, mode='grid-wrap')
    short = map_coordinates(lattice, down, order=1, mode='grid-wrap')
    fine = map_coordinates(lattice, along * 1.72 + 13.2, order=1, mode='grid-wrap')
    return np.clip((1 - upright) * long + upright * short + fine * .26, -2.5, 2.5)


def soften_leather(pigment, rest, leather, adjacent_fur, feather):
    """Fade the pigment across the shared 3D edge between UV islands."""
    distance, index = cKDTree(rest[adjacent_fur]).query(rest[leather])
    pigment[leather] = mix(pigment[adjacent_fur][index], pigment[leather], smooth(.0007, feather, distance))
