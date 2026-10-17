"""Transfer painted albedo between anatomical UV atlases through the rest surface.

Nearest-triangle projection is restricted by anatomical chart and fur surface,
so packed islands never bleed through an unrelated body part or mouth cavity.
This changes registration, not the generated markings or their provenance.
"""
import argparse
import base64
import gzip
import hashlib
import json
from pathlib import Path

import numpy as np
from scipy.spatial import cKDTree


def read_atlas(path):
    data = json.loads(path.read_text())
    if data.get('codec') == 'gzip-json':
        encoded = ''.join(json.loads((path.parent / p).read_text())['data'] for p in data['chunks'])
        raw = gzip.decompress(base64.b64decode(encoded))
        if hashlib.sha256(raw).hexdigest() != data['sha256']:
            raise ValueError('Corrupt registered source atlas')
        data = json.loads(raw)
    return data


def archive(path, folder):
    raw = path.read_bytes()
    encoded = base64.b64encode(gzip.compress(raw, mtime=0)).decode('ascii')
    folder.mkdir(parents=True, exist_ok=True)
    chunks = []
    for offset in range(0, len(encoded), 60000):
        name = f'{offset//60000:03d}.json'
        (folder/name).write_text(json.dumps({'data':encoded[offset:offset+60000]}, separators=(',', ':'))+'\n')
        chunks.append(name)
    (folder/'atlas.json').write_text(json.dumps({'codec':'gzip-json','sha256':hashlib.sha256(raw).hexdigest(),'chunks':chunks},indent=2)+'\n')


def raster(atlas):
    size = atlas['size']
    positions = np.asarray(atlas['positions']).reshape(-1,3)
    triangles = np.asarray(atlas['indices']).reshape(-1,3)
    uv = np.asarray(atlas['uv']).reshape(-1,2)*size
    point = np.zeros((size,size,3),dtype=np.float32)
    chart = np.full((size,size),-1,dtype=np.int16)
    for face, ids in enumerate(triangles):
        a,b,c = uv[ids]
        lo = np.maximum(np.floor(np.minimum.reduce((a,b,c))).astype(int),0)
        hi = np.minimum(np.ceil(np.maximum.reduce((a,b,c))).astype(int)+1,size)
        yy,xx = np.mgrid[lo[1]:hi[1],lo[0]:hi[0]]
        denominator = (b[1]-c[1])*(a[0]-c[0])+(c[0]-b[0])*(a[1]-c[1])
        if abs(denominator)<1e-10 or atlas['faceSurface'][face] != 0:
            continue
        u = ((b[1]-c[1])*(xx+.5-c[0])+(c[0]-b[0])*(yy+.5-c[1]))/denominator
        v = ((c[1]-a[1])*(xx+.5-c[0])+(a[0]-c[0])*(yy+.5-c[1]))/denominator
        w = 1-u-v
        inside = np.minimum.reduce((u,v,w)) >= -1e-7
        px,py = xx[inside],yy[inside]
        point[py,px] = np.stack((u[inside],v[inside],w[inside]),1)@positions[ids]
        chart[py,px] = atlas['faceChart'][face]
    return point,chart


def closest(points, triangles):
    a,b,c = (triangles[:,:,i,:] for i in range(3))
    ab,ac,ap = b-a,c-a,points[:,None,:]-a
    dot = lambda x,y: np.einsum('...i,...i->...',x,y)
    d00,d01,d11 = dot(ab,ab),dot(ab,ac),dot(ac,ac)
    denominator = np.maximum(d00*d11-d01*d01,1e-24)
    v = (d11*dot(ap,ab)-d01*dot(ap,ac))/denominator
    w = (d00*dot(ap,ac)-d01*dot(ap,ab))/denominator
    bary = np.stack((1-v-w,v,w),2)
    projected = a+v[...,None]*ab+w[...,None]*ac
    cost = dot(points[:,None,:]-projected,points[:,None,:]-projected)
    cost[(bary<0).any(2)] = np.inf
    for i,j in ((0,1),(1,2),(2,0)):
        start,end = triangles[:,:,i,:],triangles[:,:,j,:]
        edge = end-start
        t = np.clip(dot(points[:,None,:]-start,edge)/np.maximum(dot(edge,edge),1e-24),0,1)
        delta = points[:,None,:]-(start+t[...,None]*edge)
        new_cost = dot(delta,delta)
        use = new_cost<cost
        eb = np.zeros_like(bary);eb[:,:,i]=1-t;eb[:,:,j]=t
        bary[use],cost[use] = eb[use],new_cost[use]
    selected = cost.argmin(1)
    return selected,bary[np.arange(len(points)),selected],np.sqrt(cost[np.arange(len(points)),selected])


def nearest(points, triangles, tree, radii):
    """Exact nearest face, with centroid spheres bounding every omitted face."""
    centre_distance, indices = tree.query(points,k=min(12,len(triangles)),workers=-1)
    if indices.ndim==1:indices=indices[:,None];centre_distance=centre_distance[:,None]
    selected,bary,distance = closest(points,triangles[indices])
    picked = indices[np.arange(len(points)),selected]
    # A centroid-only kNN is insufficient for thin triangles. Any closer face
    # must lie within best-distance + its circumscribed centroid-sphere radius.
    unresolved = centre_distance[:,-1]-radii.max() <= distance+1e-10
    rows = np.flatnonzero(unresolved)
    neighbours = tree.query_ball_point(points[rows],distance[rows]+radii.max()+1e-10,workers=-1)
    lengths = np.fromiter((len(n) for n in neighbours),int,count=len(rows))
    if lengths.size:
        owner = np.repeat(rows,lengths)
        face = np.concatenate(neighbours).astype(int)
        centres = tree.data[face]
        possible = np.linalg.norm(points[owner]-centres,axis=1)-radii[face] <= distance[owner]+1e-10
        owner,face = owner[possible],face[possible]
        _,candidate_bary,candidate_distance = closest(points[owner],triangles[face,None])
        best = np.full(len(points),np.inf)
        np.minimum.at(best,owner,candidate_distance)
        take = candidate_distance <= best[owner]+1e-12
        chosen = np.flatnonzero(take)
        # Stable tie resolution at shared edges preserves the same UV chart.
        unique = np.unique(owner[chosen],return_index=True)[1]
        chosen = chosen[unique]
        ids = owner[chosen]
        picked[ids],bary[ids],distance[ids] = face[chosen],candidate_bary[chosen],candidate_distance[chosen]
    return picked,bary,distance


def transfer(old,new,output):
    source_p = np.asarray(old['positions']).reshape(-1,3)
    source_i = np.asarray(old['indices']).reshape(-1,3)
    source_uv = np.asarray(old['uv']).reshape(-1,2)
    source_chart,source_surface = np.asarray(old['faceChart']),np.asarray(old['faceSurface'])
    points,charts = raster(new)
    uv_map = np.zeros((*charts.shape,2),dtype=np.float32)
    errors = []
    for ident in np.unique(charts[charts>=0]):
        faces = np.flatnonzero((source_chart==ident)&(source_surface==0))
        if not len(faces):raise ValueError(f'No old fur chart {ident}')
        triangles = source_p[source_i[faces]]
        centres = triangles.mean(1)
        radii = np.linalg.norm(triangles-centres[:,None,:],axis=2).max(1)
        tree = cKDTree(centres)
        yy,xx = np.where(charts==ident)
        for start in range(0,len(xx),8192):
            ys,xs = yy[start:start+8192],xx[start:start+8192]
            target = points[ys,xs]
            chosen,bary,distance = nearest(target,triangles,tree,radii)
            picked = faces[chosen]
            uv_map[ys,xs] = np.einsum('ni,nij->nj',bary,source_uv[source_i[picked]])
            errors.append(distance)
        print('Transferred',new['charts'][ident],len(xx),'texels',flush=True)
    distances = np.concatenate(errors)
    report = {'sourceTexels':int((charts>=0).sum()),'sourceAtlasSha256':hashlib.sha256(json.dumps(old,separators=(',',':')).encode()).hexdigest(),'targetAtlasSha256':hashlib.sha256(json.dumps(new,separators=(',',':')).encode()).hexdigest(),'meanDistanceMeters':float(distances.mean()),'p99DistanceMeters':float(np.quantile(distances,.99)),'maxDistanceMeters':float(distances.max())}
    output.parent.mkdir(parents=True,exist_ok=True)
    temporary = output.with_name('.'+output.name+'.tmp')
    with temporary.open('wb') as f:np.savez_compressed(f,uv=uv_map,valid=charts>=0)
    temporary.replace(output)
    output.with_suffix('.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps(report))


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('old',type=Path);parser.add_argument('new',type=Path,nargs='?');parser.add_argument('output',type=Path,nargs='?');parser.add_argument('--archive',type=Path)
    args=parser.parse_args()
    if args.archive:archive(args.old,args.archive)
    else:transfer(read_atlas(args.old),read_atlas(args.new),args.output)
