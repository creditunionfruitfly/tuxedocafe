"""Authoring-only bitmap preparation. Runtime decodes the checked-in source chunks.

Generated albedo is original imagegen output; normal/roughness are estimates,
not measured scans. UV registration, resampling, mip padding and data packing
are deterministic technical preparation, preserving the generated art.
"""
import base64
import hashlib
import json
import os
from io import BytesIO
from pathlib import Path

import numpy as np
from PIL import Image
from scipy.ndimage import distance_transform_edt, gaussian_filter, map_coordinates

ROOT = Path(__file__).parent
OUT = ROOT / 'generated' / 'runtime'
MANIFEST = {'version': 1, 'maps': {}}
GUIDES = Path(os.environ.get('CAT_UV_GUIDES', ROOT.parent / 'master' / 'notes'))
TRANSFER = Path(os.environ['CAT_UV_TRANSFER']) if 'CAT_UV_TRANSFER' in os.environ else None
UV_MAP = np.load(TRANSFER) if TRANSFER else None


def atomic(path, data):
    temporary = path.with_name('.'+path.name+'.tmp')
    temporary.write_bytes(data if isinstance(data, bytes) else data.encode('utf8'))
    temporary.replace(path)


def prov(path, source, notes):
    atomic(Path(str(path) + '.prov.yaml'),
        f'source: {source}\ntool: OpenAI built-in imagegen; deterministic UV and bitmap preparation\n'
        "date: '2026-10-17'\nlicense: original\nauthor_role: artist\n"
        f'notes: {notes}\n')


def pack(path, image, kind='PNG', notes=''):
    target = OUT / path
    target.parent.mkdir(parents=True, exist_ok=True)
    stream = BytesIO()
    image.save(stream, kind, **({'quality': 91, 'subsampling': 0, 'optimize': True}
                               if kind == 'JPEG' else {'optimize': True}))
    raw = stream.getvalue()
    atomic(target, raw)
    encoded = base64.b64encode(raw).decode('ascii')
    chunks = []
    for start in range(0, len(encoded), 60000):
        rel = Path('sources') / path.replace('/', '__') / f'{start // 60000:03d}.json'
        source = ROOT / rel
        source.parent.mkdir(parents=True, exist_ok=True)
        atomic(source, json.dumps({'data': encoded[start:start + 60000]}, separators=(',', ':')) + '\n')
        prov(source, 'art/cats/textures/prepare.py', notes)
        chunks.append(rel.as_posix())
    for stale in source.parent.glob('*.json'):
        if stale.relative_to(ROOT).as_posix() not in chunks:
            stale.unlink()
            Path(str(stale)+'.prov.yaml').unlink(missing_ok=True)
    MANIFEST['maps'][path] = {
        'chunks': chunks, 'bytes': len(raw), 'sha256': hashlib.sha256(raw).hexdigest(),
        'width': image.width, 'height': image.height,
        'mimeType': 'image/jpeg' if kind == 'JPEG' else 'image/png',
        'colorSpace': 'linear' if '/shared/' in '/' + path or path.endswith('/coat.png') else 'srgb',
    }
    prov(target, 'art/cats/textures/sources.json', notes)
    print(path, len(raw), f'{image.width}x{image.height}')


def eye(cat):
    source = ROOT / 'generated' / 'eyes' / f'{cat}.png'
    prov(source, f'art/cats/textures/eye-prompts.json#cats/{cat}', 'Original built-in imagegen output, retained without creative editing; runtime copy is UV-registered and resampled.')
    image = Image.open(source).convert('RGB')
    rgb = np.asarray(image, dtype=np.float32)
    y, x = np.indices(rgb.shape[:2])
    centre = np.array([(image.width - 1) / 2, (image.height - 1) / 2])
    radius = np.hypot(x - centre[0], y - centre[1])
    pigment = (rgb.max(2) - rgb.min(2) > 15) & (rgb.max(2) > 48)
    measured = float(np.quantile(radius[pigment], .9995))
    # Register the generated round limbus to the radial-cap UV convention.
    scale = measured / (.42 * 512)
    registered = image.transform((512, 512), Image.Transform.AFFINE,
        (scale, 0, centre[0] - scale * 255.5, 0, scale, centre[1] - scale * 255.5),
        Image.Resampling.BICUBIC)
    registered = registered.quantize(colors=256, method=Image.Quantize.MEDIANCUT,
                                     dither=Image.Dither.NONE)
    pack(f'{cat}/eye.png', registered, notes=f'Original generated {cat} iris; radial-cap UV registration to radius 0.42 and 512px resampling; highlights come from the cornea geometry.')


def micro():
    source_path = ROOT / 'generated' / 'shared' / 'fur-micro.png'
    prov(source_path, 'art/cats/textures/fur-micro-prompt.json', 'Original generated short-fur microstructure albedo; derived normals and roughness are estimates.')
    source = Image.open(source_path).convert('L')
    gray = np.asarray(source.resize((512, 512), Image.Resampling.LANCZOS), dtype=float) / 255
    # Periodic high-pass detail prevents broad generated illumination entering data maps.
    detail = gaussian_filter(gray, .6, mode='wrap') - gaussian_filter(gray, 6, mode='wrap')
    detail /= max(float(detail.std()), .003)
    dx = (np.roll(detail, -1, 1) - np.roll(detail, 1, 1)) * .11
    dy = (np.roll(detail, -1, 0) - np.roll(detail, 1, 0)) * .11
    normal = np.stack((-dx, dy, np.ones_like(dx)), axis=2)
    normal /= np.linalg.norm(normal, axis=2)[:, :, None]
    if (GUIDES / 'uv_surface.png').exists():
        semantic = np.asarray(Image.open(GUIDES / 'uv_surface.png').convert('RGBA'))
        fur = Image.fromarray(np.uint8((semantic[..., 0] == 0) & (semantic[..., 3] > 0)) * 255)
        coverage = np.asarray(fur.resize((512, 512), Image.Resampling.LANCZOS), dtype=float) / 255
        normal = normal * coverage[..., None] + np.array([0, 0, 1]) * (1-coverage[..., None])
        normal /= np.linalg.norm(normal, axis=2)[:, :, None]
    normal = Image.fromarray(np.uint8(np.clip(normal * .5 + .5, 0, 1) * 255))
    pack('shared/fur-normal.png', normal, notes='Estimated OpenGL tangent-space microheight normals from generated fur; linear data, not a measured scan or a replacement for geometric normals.')
    roughness = Image.fromarray(np.uint8(np.clip(.84 + np.abs(detail) * .025, .72, .96) * 255))
    pack('shared/fur-roughness.png', roughness.resize((256, 256), Image.Resampling.LANCZOS),
         notes='Estimated linear fur roughness; resident sheen remains a runtime material parameter.')
    strand = gaussian_filter(gray, .45, mode='wrap') - gaussian_filter(gray, 4, mode='wrap')
    strand = np.clip(.5 + strand / max(float(strand.std()), .003) * .14, 0, 1)
    pack('shared/strand.png', Image.fromarray(np.uint8(strand * 255)).resize((256, 256), Image.Resampling.LANCZOS),
         notes='Band-limited strand density reference derived from generated fur; M3 shell shading is a separate implementation.')


def body(cat):
    source = ROOT / 'generated' / 'coats' / f'{cat}.png'
    if not source.exists():
        return
    image = Image.open(source).convert('RGB')
    native = image.size
    prov(source, f'art/cats/textures/body-prompts.json#cats/{cat}', 'Original generated coat albedo painted against the exact anatomical UV guide.')
    pixels = np.asarray(image.resize((2048, 2048), Image.Resampling.LANCZOS), dtype=float) / 255
    semantic = np.asarray(Image.open(GUIDES / 'uv_surface.png').convert('RGBA'))
    valid, fur = semantic[..., 3] > 0, (semantic[..., 0] == 0) & (semantic[..., 3] > 0)
    reference = np.asarray(Image.open(ROOT / 'generated' / 'references' / f'{cat}.png').convert('RGB'), dtype=float) / 255
    if UV_MAP is not None:
        folder = ROOT / 'painted-v1'
        original = json.loads((folder/'sources.json').read_text())['maps'][cat]
        raw = base64.b64decode(''.join(json.loads((folder/p).read_text())['data'] for p in original['chunks']))
        if hashlib.sha256(raw).hexdigest() != original['sha256']:
            raise ValueError(f'Corrupt registered painted coat {cat}')
        painted = np.asarray(Image.open(BytesIO(raw)).convert('RGB'),dtype=float)/255
        coordinates = np.stack((UV_MAP['uv'][...,1]*painted.shape[0]-.5,UV_MAP['uv'][...,0]*painted.shape[1]-.5))
        pixels = np.stack([map_coordinates(painted[...,channel],coordinates,order=1,mode='nearest') for channel in range(3)],axis=2)
        if not np.array_equal(UV_MAP['valid'],fur):
            raise ValueError('Transfer coverage differs from final mesh UV guide')
    else:
        # Preserve reference pigment where imagegen's white background leaked
        # onto a dark fur chart edge during original technical registration.
        blank = fur & (pixels.min(2) > .985) & (reference.mean(2) < .70)
        pixels[blank] = reference[blank]
    pixels[~fur] = 1  # Anatomical materials use their own tints on merged LODs.
    distance, nearest = distance_transform_edt(~valid, return_indices=True)
    padded = (~valid) & (distance <= 3)
    pixels[padded] = pixels[nearest[0][padded], nearest[1][padded]]
    result = Image.fromarray(np.uint8(np.clip(pixels, 0, 1)*255))
    notes = f'Original generated {cat} coat; native {native[0]}x{native[1]}; registered anatomical atlas, white non-fur surfaces, three-pixel mip bleed; technical resampling to runtime sizes.'
    if TRANSFER:
        notes += ' Exact chart-restricted rest-surface reprojection from retained painted-v1 source to final mesh UVs.'
    pack(f'{cat}/body-2048.jpg', result, 'JPEG', notes)
    pack(f'{cat}/body-1024.jpg', result.resize((1024, 1024), Image.Resampling.LANCZOS), 'JPEG', notes)
    mask = Image.open(ROOT / 'generated' / 'references' / f'{cat}-coat.png').convert('RGBA')
    pack(f'{cat}/coat.png', mask.resize((1024, 1024), Image.Resampling.LANCZOS), notes='Original anatomical RGBA coat mask; R white, G tabby or rosettes, B orange-black split, A fur length divided by 35mm; linear data, same verified body UV atlas.')


def main():
    cats = json.loads((ROOT / 'eye-prompts.json').read_text())['cats']
    for cat in cats:
        eye(cat)
        body(cat)
    micro()
    if TRANSFER:
        MANIFEST['registration'] = json.loads(TRANSFER.with_suffix('.json').read_text())
    atomic(ROOT / 'sources.json', json.dumps(MANIFEST, indent=2) + '\n')
    prov(ROOT / 'sources.json', 'art/cats/textures/prepare.py', 'Manifest of encoded, verified runtime texture bitmaps; original image-generation prompts are stored alongside it.')


if __name__ == '__main__':
    main()
