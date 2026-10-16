import { readFileSync } from 'node:fs';
import { Document, TextureInfo } from '@gltf-transform/core';
import { BufferGeometry, Color, Float32BufferAttribute } from 'three';
import { validateSurfaceMaps } from './check-surfaces.ts';

type RGB = [number, number, number];
type EncodedMap = { mimeType: string; width: number; height: number; data: string };
type Family = { tileMeters: number; normalScale: number; meanLinear: RGB; maps: Record<'albedo' | 'normal' | 'orm', EncodedMap> };
type Surface = 'oak' | 'upholstery' | 'plaster' | 'stone' | 'sisal' | 'brass' | 'skin' | 'foliage';
const palette: Record<string, RGB> = {
  plaster: [.92, .875, .78], oak: [.54, .34, .19], oakLight: [.65, .45, .28],
  oakPale: [.72, .52, .34], oakDark: [.41, .25, .15], lagoon: [.055, .28, .26],
  teal: [.10, .43, .39], brass: [.63, .46, .22], cream: [.97, .94, .85],
  charcoal: [.075, .095, .09], terracotta: [.63, .26, .15], leaf: [.15, .34, .14],
  leafLight: [.34, .48, .19], sky: [.62, .79, .82], glass: [.35, .62, .61],
  coffee: [.16, .065, .03], pastry: [.7, .43, .17], light: [1, .86, .57], rug: [.68, .70, .54],
  sisal: [.78, .67, .46], stone: [.94, .91, .83], metal: [.36, .38, .38], upholstery: [.10, .43, .39],
  paintLagoon: [.055, .28, .26], paintTeal: [.10, .43, .39],
};
const manifest = JSON.parse(readFileSync('art/materials/pbr-sources.json', 'utf8')) as { families: Record<Surface, string> };
const source = { families: Object.fromEntries(Object.entries(manifest.families)
  .map(([name, path]) => [name, JSON.parse(readFileSync(`art/materials/${path}`, 'utf8'))])) as Record<Surface, Family> };
validateSurfaceMaps(source.families);
const familyFor = (name: string): Surface => name.startsWith('oak') ? 'oak'
  : name.startsWith('leaf') ? 'foliage'
  : ['lagoon', 'teal', 'rug', 'upholstery', 'sleeve'].includes(name) ? 'upholstery'
    : name === 'sisal' ? 'sisal' : ['brass', 'metal'].includes(name) ? 'brass'
      : name === 'skin' || name === 'nails' ? 'skin' : ['cream', 'stone', 'glass', 'coffee', 'light', 'sky'].includes(name) ? 'stone' : 'plaster';

/** Tile UV0 in physical meters before world transforms; bake supplies unique UV1 later. */
export function applySurfaceUV(geometry: BufferGeometry, name: string, tileMeters = source.families[familyFor(name)].tileMeters) {
  if (geometry.index) throw new Error('Surface UV projection requires expanded triangle corners');
  const position = geometry.getAttribute('position');
  const uv = new Float32Array(position.count * 2);
  for (let i = 0; i < position.count; i++) {
    const tri = Math.floor(i / 3) * 3;
    const ax = position.getX(tri + 1) - position.getX(tri), ay = position.getY(tri + 1) - position.getY(tri), az = position.getZ(tri + 1) - position.getZ(tri);
    const bx = position.getX(tri + 2) - position.getX(tri), by = position.getY(tri + 2) - position.getY(tri), bz = position.getZ(tri + 2) - position.getZ(tri);
    const nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
    const axis = Math.abs(nx) > Math.abs(ny) && Math.abs(nx) > Math.abs(nz) ? 0 : Math.abs(ny) > Math.abs(nz) ? 1 : 2;
    uv[i * 2] = (axis === 0 ? -position.getZ(i) * Math.sign(nx) : position.getX(i) * (axis === 2 ? Math.sign(nz) : 1)) / tileMeters;
    uv[i * 2 + 1] = (axis === 1 ? -position.getZ(i) : position.getY(i)) / tileMeters;
  }
  geometry.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  geometry.setAttribute('uv1', new Float32BufferAttribute(uv.slice(), 2));
  return geometry;
}

function makeMaterials(doc: Document, colors: Record<string, RGB>) {
  const textures = new Map<string, ReturnType<Document['createTexture']>>();
  const texture = (family: Surface, map: keyof Family['maps']) => {
    const key = `${family}-${map}`;
    if (!textures.has(key)) {
      const item = source.families[family].maps[map];
      textures.set(key, doc.createTexture(key).setMimeType(item.mimeType).setImage(Buffer.from(item.data, 'base64')));
    }
    return textures.get(key)!;
  };
  return Object.fromEntries(Object.entries(colors).map(([name, color]) => {
    const family = familyFor(name), detail = source.families[family];
    const linear = new Color(...color).convertSRGBToLinear().toArray();
    const factor = linear.map((value, i) => Math.min(1, value / detail.meanLinear[i]!)) as RGB;
    const material = doc.createMaterial(name).setBaseColorFactor([...factor, 1]).setMetallicFactor(1).setRoughnessFactor(1)
      .setBaseColorTexture(texture(family, 'albedo')).setNormalTexture(texture(family, 'normal'))
      .setNormalScale(detail.normalScale).setMetallicRoughnessTexture(texture(family, 'orm'))
      .setExtras({ materialFamily: family, uvTileMeters: detail.tileMeters, albedoColorSpace: 'srgb', dataColorSpace: 'linear',
        bakeAlbedo: factor.map((value, i) => value * detail.meanLinear[i]!) });
    // Finish is separate from microstructure: water, ceramic and paint are not fabric.
    if (name.startsWith('paint')) material.setRoughnessFactor(.48).setNormalScale(.18);
    if (name === 'glass' || name === 'coffee') material.setRoughnessFactor(.18).setNormalScale(.08);
    if (name === 'cream') material.setRoughnessFactor(.72).setNormalScale(.30);
    if (name === 'nails') material.setRoughnessFactor(.60).setNormalScale(.18);
    if (name === 'metal') material.setRoughnessFactor(.72).setNormalScale(.30);
    if (name === 'light' || name === 'sky') material.setNormalScale(0);
    for (const info of [material.getBaseColorTextureInfo(), material.getNormalTextureInfo(), material.getMetallicRoughnessTextureInfo()]) {
      info!.setWrapS(TextureInfo.WrapMode.REPEAT!).setWrapT(TextureInfo.WrapMode.REPEAT!)
        .setMinFilter(TextureInfo.MinFilter.LINEAR_MIPMAP_LINEAR!).setMagFilter(TextureInfo.MagFilter.LINEAR!);
    }
    if (name === 'light') material.setEmissiveFactor([1, .72, .36]);
    if (name === 'sky') material.setEmissiveFactor([.3, .4, .4]);
    return [name, material];
  }));
}

/** Embedded texture objects are shared by palette variants, never duplicated per tint. */
export async function createCafeMaterials(doc: Document) { return makeMaterials(doc, palette); }
export async function createHandMaterials(doc: Document) {
  return makeMaterials(doc, { skin: [.85, .61, .42], sleeve: [.10, .43, .39], nails: [.85, .70, .59] });
}
export async function createDiagnosticMaterial(doc: Document) {
  return makeMaterials(doc, { charcoal: [.13, .15, .16] }).charcoal!;
}
