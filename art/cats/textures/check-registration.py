"""Authoring regression: exact identity registration and skinny-face bounds."""
import argparse
from pathlib import Path

import numpy as np
from scipy.spatial import cKDTree

from reproject import nearest, read_atlas, transfer


def main():
    # Twelve centroids are closer than the true nearest thin triangle's
    # centroid. A fixed kNN approximation missed this class of production face.
    thin = np.array([[0, 0, 0], [1, 0, 0], [0, .001, 0]], dtype=float)
    distractors = [np.array([[0, .01+i*.001, .01], [.001, .01+i*.001, .01], [0, .011+i*.001, .01]]) for i in range(20)]
    triangles = np.array([thin, *distractors])
    centres = triangles.mean(1)
    radii = np.linalg.norm(triangles-centres[:, None], axis=2).max(1)
    chosen, _, distance = nearest(np.array([[.0001, .0001, 0]]), triangles, cKDTree(centres), radii)
    assert chosen[0] == 0 and distance[0] < 1e-10, 'Thin nearest triangle was omitted'
    parser = argparse.ArgumentParser()
    parser.add_argument('atlas', type=Path)
    parser.add_argument('output', type=Path)
    args = parser.parse_args()
    atlas = read_atlas(args.atlas)
    transfer(atlas, atlas, args.output)
    result = np.load(args.output)
    yy, xx = np.where(result['valid'])
    expected = np.stack((xx+.5, yy+.5), axis=1)/atlas['size']
    error = np.linalg.norm(result['uv'][yy, xx]-expected, axis=1)*atlas['size']
    assert error.max() < .01, f'Identity transfer moved a texel by {error.max():.4f}px'
    print(f'Registration passed: {len(error)} fur texels, max {error.max():.6f}px identity error')


if __name__ == '__main__':
    main()
