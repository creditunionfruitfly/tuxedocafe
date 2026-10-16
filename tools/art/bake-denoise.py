"""Denoise actual Cycles HDR lightmaps with official Intel Open Image Denoise.

Requires NumPy and the official oidnDenoise binary; never used by normal CI.
python tools/art/bake-denoise.py art/lighting/cafe-daylight.json --oidn /path/to/oidnDenoise
"""
import argparse
import base64
import hashlib
import json
import math
from pathlib import Path
import struct
import subprocess
import tempfile
import zlib
import zipfile

import numpy as np

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('manifest', type=Path)
parser.add_argument('--oidn', type=Path, required=True)
args = parser.parse_args()
manifest = args.manifest
data = json.loads(manifest.read_text())
input_description = 'original Cycles HDR irradiance checkpoint'
try:
    cache = np.load(manifest.with_suffix('.hdr.npz'))
    if str(cache['signature']) != data['signature']:
        raise RuntimeError('HDR checkpoint signature does not match the UV1/source manifest')
    raw = np.ascontiguousarray(cache['irradiance'], dtype='<f4')
    if 'origin' in cache:
        input_description = str(cache['origin'])
except (FileNotFoundError, ValueError, OSError, zipfile.BadZipFile):
    # RGBM source retains HDR range and sub-.004 room irradiance precision.
    encoded = ''.join(json.loads((manifest.parent / path).read_text())['data'] for path in data['pngChunks'])
    png = base64.b64decode(encoded)
    if hashlib.sha256(png).hexdigest() != data['pngSha256']:
        raise RuntimeError('RGBM source checksum failed')
    width, height = struct.unpack('>II', png[16:24])
    offset, payload = 8, b''
    while offset < len(png):
        length = struct.unpack('>I', png[offset:offset+4])[0]
        if png[offset+4:offset+8] == b'IDAT':
            payload += png[offset+8:offset+8+length]
        offset += length + 12
    rows = np.frombuffer(zlib.decompress(payload), dtype=np.uint8).reshape(height, width*4+1)
    if np.any(rows[:, 0] != 0):
        raise RuntimeError('RGBM checkpoint recovery expects original unfiltered PNG rows')
    rgba = rows[:, 1:].reshape(height, width, 4).astype(np.float32) / 255
    raw = np.ascontiguousarray((rgba[:, :, :3] * rgba[:, :, 3:4] * data['exposure'])[::-1], dtype='<f4')
    input_description = 'original Cycles RGBM HDR source decoded to float32; original float checkpoint unavailable'
    checkpoint = manifest.with_suffix('.hdr.npz')
    temporary = manifest.with_suffix('.hdr.npz.tmp')
    with temporary.open('wb') as file:
        np.savez_compressed(file, irradiance=raw, signature=data['signature'], origin=input_description)
    temporary.replace(checkpoint)
height, width, channels = raw.shape
if channels != 3 or not np.isfinite(raw).all():
    raise RuntimeError('Expected finite RGB irradiance checkpoint')
with tempfile.TemporaryDirectory() as directory:
    source, output = Path(directory) / 'cycles.pfm', Path(directory) / 'denoised.pfm'
    source.write_bytes(('PF\n%d %d\n-1.0\n' % (width, height)).encode() + raw.tobytes())
    command = [str(args.oidn.resolve()), '-d', 'cpu', '-f', 'RTLightmap', '--hdr', str(source),
               '-o', str(output), '-q', 'high', '--threads', '8', '--maxmem', '1024']
    result = subprocess.run(command, check=True, capture_output=True, text=True)
    print(result.stdout)
    with output.open('rb') as file:
        if file.readline().strip() != b'PF' or tuple(map(int, file.readline().split())) != (width, height):
            raise RuntimeError('OIDN output dimensions/format changed')
        scale = float(file.readline())
        filtered = np.frombuffer(file.read(), dtype='<f4' if scale < 0 else '>f4').reshape(height, width, 3).copy()
filtered = np.maximum(filtered, 0)
filtered[np.max(raw, axis=2) == 0] = 0  # Preserve unoccupied atlas texels.
if not np.isfinite(filtered).all():
    raise RuntimeError('OIDN produced non-finite irradiance')
temporary = manifest.with_suffix('.denoised.hdr.npz.tmp')
with temporary.open('wb') as file:
    np.savez_compressed(file, irradiance=filtered, signature=data['signature'])
temporary.replace(manifest.with_suffix('.denoised.hdr.npz'))
exposure = max(data['exposure'], 2 ** math.ceil(math.log2(max(float(filtered.max()), 1))))
multiplier = np.ceil(np.max(filtered, axis=2, keepdims=True) / exposure * 255) / 255
normalized = filtered / np.maximum(multiplier * exposure, 1e-12)
rgba = np.concatenate([np.round(np.clip(normalized, 0, 1) * 255), np.round(multiplier * 255)], axis=2).astype(np.uint8)
decoded = rgba[:, :, :3] / 255 * rgba[:, :, 3:4] / 255 * exposure

def chunk(name, payload):
    return struct.pack('>I', len(payload)) + name + payload + struct.pack('>I', zlib.crc32(name + payload) & 0xffffffff)

rows = b''.join(b'\x00' + row.tobytes() for row in rgba[::-1])
png = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', width, height, 8, 6, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(rows, 9)) + chunk(b'IEND', b'')
manifest.with_suffix('.png').write_bytes(png)
encoded = base64.b64encode(png).decode()
directory = manifest.parent / 'sources'
for old in directory.glob('lightmap-*.json*'):
    old.unlink()
provenance = "source: tools/art/bake-cafe.py; tools/art/bake-denoise.py\ntool: Blender Cycles CPU; Intel Open Image Denoise 2.3.3 RTLightmap high\ndate: '2026-10-16'\nlicense: original\nauthor_role: artist\n"
paths = []
for index, start in enumerate(range(0, len(encoded), 990000)):
    path = directory / ('lightmap-%02d.json' % index)
    path.write_text(json.dumps(dict(data=encoded[start:start+990000]), separators=(',', ':')))
    Path(str(path) + '.prov.yaml').write_text(provenance)
    paths.append(path.relative_to(manifest.parent).as_posix())
data.update(exposure=exposure, pngChunks=paths, pngSha256=hashlib.sha256(png).hexdigest())
data['metadata'].update(unclippedMax=float(filtered.max()), clippedPixels=0,
    rgbmMaxAbsoluteError=float(np.max(np.abs(decoded-filtered))),
    denoiser=dict(tool='Intel Open Image Denoise 2.3.3', filter='RTLightmap', quality='high', device='CPU',
                  input=input_description, sourceSamples=data['metadata']['samples'],
                  source='https://github.com/RenderKit/oidn/releases/tag/v2.3.3'))
manifest.write_text(json.dumps(data, separators=(',', ':')))
for path in [manifest, manifest.with_suffix('.png')]:
    Path(str(path) + '.prov.yaml').write_text(provenance)
print(json.dumps(dict(pngBytes=len(png), sourceChunks=len(paths), metadata=data['metadata'])))
