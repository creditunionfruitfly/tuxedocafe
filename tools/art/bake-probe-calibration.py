"""Validate Blender panoramic axes against the SH exporter with RGB emitters."""
import json
import math
import tempfile
from pathlib import Path
import bpy
import numpy as np

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.render.engine = 'CYCLES'
scene.cycles.samples = 1
scene.cycles.use_denoising = False
scene.render.resolution_x, scene.render.resolution_y, scene.render.resolution_percentage = 128, 64, 100
world = bpy.data.worlds.new('Black calibration world')
world.use_nodes = True
world.node_tree.nodes['Background'].inputs['Strength'].default_value = 0
scene.world = world
camera_data = bpy.data.cameras.new('Panoramic axis fixture')
camera_data.type = 'PANO'
panorama = camera_data if hasattr(camera_data, 'panorama_type') else camera_data.cycles
panorama.panorama_type = 'EQUIRECTANGULAR'
camera = bpy.data.objects.new('Panoramic axis fixture', camera_data)
scene.collection.objects.link(camera)
scene.camera = camera
axes = [(3, 0, 0), (0, 3, 0), (0, 0, -3)]
for index, position in enumerate(axes):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=24, ring_count=12, radius=.35, location=position)
    material = bpy.data.materials.new('RGB axis ' + str(index))
    material.use_nodes = True
    nodes = material.node_tree.nodes
    nodes.clear()
    emission = nodes.new('ShaderNodeEmission')
    emission.inputs['Color'].default_value = tuple(1 if i == index else 0 for i in range(3)) + (1,)
    emission.inputs['Strength'].default_value = 4
    output = nodes.new('ShaderNodeOutputMaterial')
    material.node_tree.links.new(emission.outputs[0], output.inputs[0])
    bpy.context.object.data.materials.append(material)
with tempfile.TemporaryDirectory() as directory:
    scene.render.image_settings.file_format = 'OPEN_EXR'
    scene.render.image_settings.color_depth = '32'
    scene.render.filepath = str(Path(directory) / 'axes.exr')
    bpy.ops.render.render(write_still=True)
    capture = bpy.data.images.load(scene.render.filepath, check_existing=False)
    pixels = np.asarray(capture.pixels[:], dtype=np.float64).reshape(64, 128, 4)
centroids = np.zeros((3, 3))
for j in range(64):
    theta = math.pi * (1 - (j + .5) / 64)
    for i in range(128):
        phi = 2 * math.pi * ((i + .5) / 128 - .5)
        direction = np.array([math.sin(phi)*math.sin(theta), math.cos(theta), -math.cos(phi)*math.sin(theta)])
        centroids += pixels[j, i, :3, None] * direction[None, :] * math.sin(theta)
centroids /= np.linalg.norm(centroids, axis=1)[:, None]
expected = np.asarray(axes) / 3
similarity = np.sum(centroids * expected, axis=1)
print('PANORAMA_AXIS_CALIBRATION ' + json.dumps(dict(directions=centroids.tolist(), dot=similarity.tolist())))
if not np.all(similarity > .99):
    raise RuntimeError('Panorama directions do not match Three +Y up, -Z forward')

# A Lambert-white plane in unit isotropic radiance receives E=PI and emits 1.
# This verifies the bake pass normalization used by Three's lightMap contract.
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
world.node_tree.nodes['Background'].inputs['Color'].default_value = (1, 1, 1, 1)
world.node_tree.nodes['Background'].inputs['Strength'].default_value = 1
scene.cycles.samples = 128
bpy.ops.mesh.primitive_plane_add(size=2)
material = bpy.data.materials.new('Unit Lambert calibration')
material.use_nodes = True
nodes = material.node_tree.nodes
nodes.clear()
diffuse = nodes.new('ShaderNodeBsdfDiffuse')
diffuse.inputs['Color'].default_value = (1, 1, 1, 1)
output = nodes.new('ShaderNodeOutputMaterial')
material.node_tree.links.new(diffuse.outputs[0], output.inputs[0])
target = bpy.data.images.new('Unit Lambert output', width=16, height=16, float_buffer=True)
target.colorspace_settings.name = 'Non-Color'
texture = nodes.new('ShaderNodeTexImage')
texture.image = target
nodes.active = texture
bpy.context.object.data.materials.append(material)
scene.render.bake.use_pass_direct = True
scene.render.bake.use_pass_indirect = False
scene.render.bake.use_pass_color = False
bpy.ops.object.bake(type='DIFFUSE')
value = float(np.asarray(target.pixels[:]).reshape(16, 16, 4)[2:-2, 2:-2, :3].mean())
print('LAMBERT_NORMALIZATION_CALIBRATION ' + json.dumps(dict(bakedOutgoingRadiance=value, expected=1, irradiance=value*math.pi)))
if abs(value - 1) > .05:
    raise RuntimeError('Unexpected Cycles diffuse bake normalization')
