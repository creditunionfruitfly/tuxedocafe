"""Original cafe irradiance, UV1 and probe authoring. Not needed by CI/runtime.

Blender --background --python tools/art/bake-cafe.py -- input.json output.json
or python tools/art/bake-cafe.py input.json output.json (official bpy wheel).
"""
import base64
import gzip
import hashlib
import json
import math
import struct
import sys
import zlib
from pathlib import Path

import bpy
import numpy as np
from mathutils import Matrix, Vector

args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:]
source, destination = map(Path, args[:2])
resolution = int(args[2]) if len(args) > 2 else 2048
samples = int(args[3]) if len(args) > 3 else 96
data = json.loads(source.read_text())
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.render.engine = 'CYCLES'
scene.cycles.device = 'CPU'
scene.cycles.samples = samples
scene.cycles.seed = 2718
scene.cycles.use_adaptive_sampling = False
scene.cycles.use_denoising = False  # Portable CPU builds may omit OpenImageDenoise.
scene.cycles.max_bounces = 8
scene.cycles.diffuse_bounces = 6
scene.cycles.glossy_bounces = 0
scene.cycles.transmission_bounces = 0
scene.render.threads_mode = 'AUTO'
scene.view_settings.view_transform = 'Standard'
scene.view_settings.look = 'Medium High Contrast' if 'Medium High Contrast' in [i.name for i in scene.view_settings.bl_rna.properties['look'].enum_items] else 'None'
scene.view_settings.exposure = 0
scene.view_settings.gamma = 1
world = bpy.data.worlds.new('Original procedural daylight')
world.use_nodes = True
world.node_tree.nodes['Background'].inputs['Color'].default_value = (.65, .80, 1, 1)
world.node_tree.nodes['Background'].inputs['Strength'].default_value = .35
scene.world = world
image = bpy.data.images.new('Cafe diffuse irradiance', width=resolution, height=resolution, alpha=False, float_buffer=True)
image.colorspace_settings.name = 'Non-Color'
objects = []

for record in data['primitives']:
    positions = np.asarray(record['positions'], dtype=np.float64).reshape(-1, 3)
    indices = np.asarray(record['indices'], dtype=np.int64).reshape(-1, 3)
    mesh = bpy.data.meshes.new(record['key'])
    mesh.from_pydata(positions.tolist(), [], indices.tolist())
    mesh.update()
    # Preserve each original triangle corner through weld and UV unwrapping.
    original = mesh.attributes.new('source_corner', 'INT', 'CORNER')
    original.data.foreach_set('value', np.arange(len(mesh.loops), dtype=np.int32))
    obj = bpy.data.objects.new(record['key'], mesh)
    obj.matrix_world = Matrix(np.asarray(record['matrix']).reshape(4, 4).T.tolist())
    scene.collection.objects.link(obj)
    objects.append(obj)
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.mesh.remove_doubles(threshold=.000001)
    bpy.ops.object.mode_set(mode='OBJECT')
    corners = np.zeros(len(mesh.loops), dtype=np.int32)
    mesh.attributes['source_corner'].data.foreach_get('value', corners)
    normals = np.asarray(record['normals']).reshape(-1, 3)[np.asarray(record['indices'])[corners]]
    mesh.normals_split_custom_set(normals.tolist())
    for polygon in mesh.polygons:
        polygon.use_smooth = True
    material = bpy.data.materials.new(record['key'])
    material.use_nodes = True
    nodes = material.node_tree.nodes
    bsdf = nodes.get('Principled BSDF')
    # Receiver color is divided out by the Diffuse bake pass. Keeping source
    # albedos in the scene preserves physical colored secondary bounces.
    bsdf.inputs['Base Color'].default_value = tuple(record['color'])
    bsdf.inputs['Roughness'].default_value = .9
    if max(record['emission']) > 0:
        socket = bsdf.inputs.get('Emission Color') or bsdf.inputs.get('Emission')
        socket.default_value = (*record['emission'], 1)
        strength = bsdf.inputs.get('Emission Strength')
        if strength:
            strength.default_value = 2
    texture = nodes.new('ShaderNodeTexImage')
    texture.image = image
    nodes.active = texture
    mesh.materials.append(material)
    obj.select_set(False)

for obj in objects:
    obj.select_set(True)
bpy.context.view_layer.objects.active = objects[0]
bpy.ops.object.mode_set(mode='EDIT')
bpy.ops.mesh.select_all(action='SELECT')
bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=.002, area_weight=.5)
bpy.ops.uv.pack_islands(rotate=True, margin=.003)
bpy.ops.object.mode_set(mode='OBJECT')
uv_arrays = []
primitives = []
offset = 0
restored_corners = 0
for record, obj in zip(data['primitives'], objects):
    mesh = obj.data
    original = np.zeros(len(mesh.loops), dtype=np.int32)
    mesh.attributes['source_corner'].data.foreach_get('value', original)
    uv = np.zeros((len(mesh.loops), 2), dtype=np.float32)
    mesh.uv_layers.active.data.foreach_get('uv', uv.reshape(-1))
    source_count = len(record['indices'])
    ordered = np.zeros((source_count, 2), dtype=np.float32)
    ordered[original] = uv
    present = np.zeros(source_count, dtype=bool)
    present[original] = True
    corners = np.asarray(record['positions']).reshape(-1, 3)[record['indices']]
    corner_key = lambda i: tuple(np.round(corners[i], 5))
    face_key = lambda i: tuple(sorted(corner_key(j) for j in range(i, i+3)))
    retained = {face_key(i): {corner_key(j): ordered[j].copy() for j in range(i, i+3)}
                for i in range(0, source_count, 3) if present[i:i+3].all()}
    # Blender weld removes coincident duplicate faces and zero-area triangles.
    # Restore duplicate UVs exactly; zero-area corners never produce fragments.
    for i in range(0, source_count, 3):
        if present[i:i+3].all():
            continue
        match = retained.get(face_key(i))
        area = np.linalg.norm(np.cross(corners[i+1]-corners[i], corners[i+2]-corners[i])) / 2
        if not match and area > 1e-9:
            raise RuntimeError('Unwrap removed nonduplicate surface: ' + record['key'])
        for j in range(i, i+3):
            if not present[j]:
                ordered[j] = match[corner_key(j)] if match else (.5, .5)
                restored_corners += 1
    ordered[:, 1] = 1 - ordered[:, 1]  # glTF image UV origin is top-left.
    uv_arrays.append(ordered.reshape(-1))
    primitives.append(dict(key=record['key'], corners=source_count, offset=offset))
    offset += source_count * 2

# One receiver with all original material slots avoids rebuilding the entire
# Cycles scene once per primitive. UV1 was already exported before this join.
bpy.context.view_layer.objects.active = objects[0]
bpy.ops.object.join()

def light(name, kind, location, energy, color, size=1):
    lamp = bpy.data.lights.new(name, kind)
    lamp.energy, lamp.color = energy, color
    if kind == 'AREA':
        lamp.shape, lamp.size, lamp.size_y = 'RECTANGLE', size, 2
    if kind == 'SUN':
        lamp.angle = math.radians(12)
    obj = bpy.data.objects.new(name, lamp)
    scene.collection.objects.link(obj)
    obj.location = location
    obj.rotation_euler = (Vector((0, .7, -1)) - obj.location).to_track_quat('-Z', 'Y').to_euler()
    return obj

light('Broad window skylight', 'AREA', (2, 2.2, -5.7), 550, (.70, .84, 1), 4)
sun = light('Warm morning key', 'SUN', (-1, 6, -8), 2.2, (1, .91, .75))
for x, z in [(-2, -.6), (.5, -3.1), (-3.5, -3.6)]:
    light('Original pendant bounce', 'AREA', (x, 2.47, z), 8, (1, .72, .40), .5)
scene.render.bake.use_pass_direct = True
scene.render.bake.use_pass_indirect = True
scene.render.bake.use_pass_color = False
scene.render.bake.margin = 8
scene.render.bake.use_clear = True
bpy.ops.object.bake(type='DIFFUSE')
pixels = np.asarray(image.pixels[:], dtype=np.float32).reshape(resolution, resolution, 4)
# Cycles' color-free diffuse pass is outgoing Lambert radiance (E / PI).
# Three lightMap is irradiance and applies Lambert's 1 / PI itself.
irradiance = np.maximum(pixels[:, :, :3], 0) * math.pi
if not np.isfinite(irradiance).all():
    raise RuntimeError('Bake contains non-finite irradiance')
# RGBM stores an individual per-texel HDR scale in alpha, preserving dark-room
# precision despite bright local pendant hotspots. Runtime restores the range.
# Image pixels are bottom-up; PNG rows and exported glTF UV1 use top-left.
maximum = float(np.max(irradiance))
exposure = 2 ** math.ceil(math.log2(max(maximum, 1)))
multiplier = np.ceil(np.max(irradiance, axis=2, keepdims=True) / exposure * 255) / 255
normalized = irradiance / np.maximum(multiplier * exposure, 1e-12)
rgba = np.concatenate([np.round(np.clip(normalized, 0, 1) * 255), np.round(multiplier * 255)], axis=2).astype(np.uint8)
decoded = rgba[:, :, :3] / 255 * rgba[:, :, 3:4] / 255 * exposure
maximum_error = float(np.max(np.abs(decoded - irradiance)))
def chunk(name, payload):
    return struct.pack('>I', len(payload)) + name + payload + struct.pack('>I', zlib.crc32(name + payload) & 0xffffffff)
raw = b''.join(b'\x00' + row.tobytes() for row in rgba[::-1])
png = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', resolution, resolution, 8, 6, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(raw, 9)) + chunk(b'IEND', b'')
destination.with_suffix('.png').write_bytes(png)
provenance = "source: tools/art/bake-cafe.py\ntool: Blender Cycles CPU original offline lighting\ndate: '2026-10-16'\nlicense: original\nauthor_role: artist\n"
Path(str(destination.with_suffix('.png')) + '.prov.yaml').write_text(provenance)
uv_bytes = np.concatenate(uv_arrays).astype('<f4').tobytes()
checkpoint = destination.with_suffix('.hdr.npz')
temporary_checkpoint = destination.with_suffix('.hdr.npz.tmp')
with temporary_checkpoint.open('wb') as file:
    np.savez_compressed(file, irradiance=irradiance, uv=np.concatenate(uv_arrays),
                        primitives=json.dumps(primitives), signature=data['signature'])
temporary_checkpoint.replace(checkpoint)
# Dynamic objects use actual low-frequency room radiance captured with Cycles.
# A SUN lamp has no camera-visible disk, so its reflected room bounce belongs
# in the probes while the runtime key supplies direct illumination separately.
camera_data = bpy.data.cameras.new('Probe camera')
camera_data.type = 'PANO'
panorama = camera_data if hasattr(camera_data, 'panorama_type') else camera_data.cycles
panorama.panorama_type = 'EQUIRECTANGULAR'
camera = bpy.data.objects.new('Probe camera', camera_data)
scene.collection.objects.link(camera)
scene.camera = camera
scene.render.resolution_x, scene.render.resolution_y, scene.render.resolution_percentage = 64, 32, 100
scene.cycles.samples = 32
scene.render.image_settings.file_format = 'OPEN_EXR'
scene.render.image_settings.color_depth = '32'
scene.render.filepath = str(destination.with_suffix('.probe.exr'))
probes = []
for position in [(0, 1.3, 0), (2.8, 1.2, -2), (-2.4, 1.4, -2.8)]:
    camera.location = position
    bpy.ops.render.render(write_still=True)
    capture = bpy.data.images.load(scene.render.filepath, check_existing=False)
    radiance = np.asarray(capture.pixels[:], dtype=np.float64).reshape(32, 64, 4)
    bpy.data.images.remove(capture)
    coefficients = np.zeros((9, 3))
    for j in range(32):
        theta = math.pi * (1 - (j + .5) / 32)
        for i in range(64):
            phi = 2 * math.pi * ((i + .5) / 64 - .5)
            x, y, z = math.sin(phi) * math.sin(theta), math.cos(theta), -math.cos(phi) * math.sin(theta)
            basis = np.array([.282095, .488603*y, .488603*z, .488603*x, 1.092548*x*y, 1.092548*y*z,
                              .315392*(3*z*z-1), 1.092548*x*z, .546274*(x*x-y*y)])
            coefficients += basis[:, None] * radiance[j, i, :3] * math.sin(theta) * (2*math.pi/64) * (math.pi/32)
    probes.append(dict(position=position, sh=coefficients.tolist()))
Path(scene.render.filepath).unlink()
encoded_png = base64.b64encode(png).decode()
chunk_directory = destination.parent / 'sources'
chunk_directory.mkdir(exist_ok=True)
for old in chunk_directory.glob('lightmap-*.json*'):
    old.unlink()
chunk_paths = []
for index, start in enumerate(range(0, len(encoded_png), 990000)):
    path = chunk_directory / ('lightmap-%02d.json' % index)
    path.write_text(json.dumps(dict(data=encoded_png[start:start+990000]), separators=(',', ':')))
    Path(str(path) + '.prov.yaml').write_text(provenance)
    chunk_paths.append(path.relative_to(destination.parent).as_posix())
result = dict(signature=data['signature'], resolution=resolution, exposure=exposure,
              excluded=['water-bowl', 'food-bowl', 'scoop'], primitives=primitives,
              uvFloat32Gzip=base64.b64encode(gzip.compress(uv_bytes, mtime=0)).decode(),
              pngChunks=chunk_paths, pngSha256=hashlib.sha256(png).hexdigest(), probes=probes,
              metadata=dict(tool='Blender ' + bpy.app.version_string + ' Cycles CPU', samples=samples,
                            seed=2718, diffuseBounces=6, passType='DIFFUSE_DIRECT_INDIRECT', colorSpace='linear',
                            directIncluded=True, contactOcclusion='physical ray visibility; no extra AO multiplication',
                            normalization='Cycles color-free diffuse radiance multiplied by PI to linear irradiance',
                            encoding='rgbm', rgbmMaxAbsoluteError=maximum_error,
                            filtering='RGBM bilinear interpolation is approximate; atlas has 8px bake dilation and packed island margins',
                            probeBasis='Three SphericalHarmonics3 real SH9, +Y up; linear radiance coefficients',
                            solarDiskIncluded=False, sunBounceIncluded=True,
                            sunPosition=[-1, 6, -8], sunTarget=[0, .7, -1],
                            restoredDuplicateOrDegenerateCorners=restored_corners,
                            unclippedMax=maximum, clippedPixels=0,
                            nonzeroPixels=int(np.count_nonzero(np.max(rgba[:, :, :3], axis=2)))))
destination.write_text(json.dumps(result, separators=(',', ':')))
Path(str(destination) + '.prov.yaml').write_text(provenance)
destination.with_suffix('.png').write_bytes(png)
print(json.dumps({k: result[k] for k in ['signature', 'resolution', 'metadata']}))
