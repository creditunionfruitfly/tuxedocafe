"""Offline authoring only: convert generated albedo into packed, portable PBR sources.

Requires Pillow, numpy and scipy. CI decodes pbr-sources.json with Node only.
Normal/roughness are plausible material estimates, not measured scan data.
"""
import base64
from io import BytesIO
import json
from pathlib import Path
import numpy as np
from PIL import Image
from scipy.ndimage import gaussian_filter, zoom

ROOT = Path(__file__).parent
SETTINGS = {
    'oak': (.48, .11, .60), 'upholstery': (.87, .30, .18),
    'plaster': (.90, .08, 1.0), 'stone': (.46, .045, .70),
    'sisal': (.95, .35, .18), 'brass': (.32, .035, .50),
    'skin': (.57, .06, .14),
    'foliage': (.48, .07, .22),
}


def tile(image):
    """Periodic-plus-smooth decomposition removes edge lighting discontinuities."""
    height, width, _ = image.shape
    boundary = np.zeros_like(image)
    boundary[0] += image[-1] - image[0]
    boundary[-1] -= image[-1] - image[0]
    boundary[:, 0] += image[:, -1] - image[:, 0]
    boundary[:, -1] -= image[:, -1] - image[:, 0]
    divisor = 2 * np.cos(2 * np.pi * np.arange(height) / height)[:, None]
    divisor = divisor + 2 * np.cos(2 * np.pi * np.arange(width) / width)[None, :] - 4
    divisor[0, 0] = 1
    smooth = np.fft.fft2(boundary, axes=(0, 1)) / divisor[:, :, None]
    smooth[0, 0] = 0
    return np.clip(image - np.fft.ifft2(smooth, axes=(0, 1)).real, 0, 1)


def encode(image, kind):
    output = BytesIO()
    image.save(output, format=kind, **({'quality': 89, 'subsampling': 0, 'optimize': True} if kind == 'JPEG' else {'optimize': True}))
    return base64.b64encode(output.getvalue()).decode('ascii')


def provenance(path, name, operation):
    prompt = json.loads((ROOT / 'prompts.json').read_text())[name]
    (Path(str(path) + '.prov.yaml')).write_text(
        f'source: art/materials/prompts.json#{name}\ntool: OpenAI built-in imagegen; {operation}\n'
        "date: '2026-10-16'\nlicense: original\nauthor_role: artist\n"
        f'prompt: {json.dumps(prompt)}\nnotes: original generated albedo; derived data maps are estimated microheight and roughness, not measured scans\n')


def main():
    output = {'version': 1, 'families': {}}
    for name, (roughness, relief, tile_meters) in SETTINGS.items():
        source = ROOT / 'generated' / f'{name}-source.png'
        provenance(source, name, 'original generated image')
        image = np.asarray(Image.open(source).convert('RGB').resize((1024, 1024), Image.Resampling.LANCZOS), dtype=float) / 255
        image = tile(image)
        gray = image @ [.2126, .7152, .0722]
        # Preserve material variation, neutralize the large color tint for skin/sleeve customization.
        if name in ('skin', 'upholstery'):
            image = np.repeat((.88 + (gray - gray.mean()) * .46)[:, :, None], 3, axis=2)
        elif name in ('plaster', 'stone'):
            image = np.clip(image + (.87 - image.mean()), 0, 1)
        albedo = Image.fromarray(np.uint8(np.clip(image, 0, 1) * 255))
        gray = np.asarray(albedo.resize((512, 512)), dtype=float).mean(axis=2) / 255
        # Band-limited detail excludes the broad albedo variation from microheight.
        detail = gaussian_filter(gray, .65, mode='wrap') - gaussian_filter(gray, 9, mode='wrap')
        detail /= max(float(detail.std()), .002)
        dx = (np.roll(detail, -1, 1) - np.roll(detail, 1, 1)) * relief
        dy = (np.roll(detail, -1, 0) - np.roll(detail, 1, 0)) * relief
        normal = np.stack((-dx, dy, np.ones_like(dx)), axis=2)
        normal /= np.linalg.norm(normal, axis=2)[:, :, None]
        normal = Image.fromarray(np.uint8(np.clip(normal * .5 + .5, 0, 1) * 255))
        micro = zoom(np.abs(detail), .5, order=1)
        orm = np.empty((256, 256, 3), dtype=float)
        orm[:, :, 0] = 1  # AO belongs exclusively to the separately baked scene lightmap.
        orm[:, :, 1] = np.clip(roughness + (micro - micro.mean()) * .018, .08, .98)
        orm[:, :, 2] = 1 if name == 'brass' else 0
        orm = Image.fromarray(np.uint8(orm * 255))
        family = {'tileMeters': tile_meters, 'normalScale': 1, 'colorSpace': 'srgb-albedo; linear-normal-orm', 'maps': {}}
        # Pixel mean in linear space lets palette factors preserve their intended appearance.
        pixels = np.asarray(albedo, dtype=float) / 255
        family['meanLinear'] = np.where(pixels <= .04045, pixels / 12.92, ((pixels + .055) / 1.055) ** 2.4).mean(axis=(0, 1)).tolist()
        for suffix, pixels, codec in [('albedo', albedo, 'JPEG'), ('normal', normal, 'PNG'), ('orm', orm, 'PNG')]:
            extension = 'jpg' if codec == 'JPEG' else 'png'
            data = encode(pixels, codec)
            family['maps'][suffix] = {'mimeType': 'image/jpeg' if codec == 'JPEG' else 'image/png', 'width': pixels.width, 'height': pixels.height, 'data': data}
            path = ROOT / 'generated' / f'{name}-{suffix}.{extension}'
            path.write_bytes(base64.b64decode(data))
            provenance(path, name, 'periodic texture preparation; estimated PBR data derivation')
        output['families'][name] = family
    directory = ROOT / 'sources'
    directory.mkdir(exist_ok=True)
    manifest = {'version': 1, 'families': {}}
    for name, family in output['families'].items():
        path = directory / f'{name}.json'
        path.write_text(json.dumps(family, separators=(',', ':')) + '\n')
        provenance(path, name, 'packed generated albedo and estimated normal/ORM derivatives')
        manifest['families'][name] = f'sources/{name}.json'
    (ROOT / 'pbr-sources.json').write_text(json.dumps(manifest, indent=2) + '\n')


if __name__ == '__main__':
    main()
