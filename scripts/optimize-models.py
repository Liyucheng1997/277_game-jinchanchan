"""Keep only mapped gameplay clips and repack their referenced GLB buffers.
Unmodified downloads are preserved under tmp/models-original (not shipped).
"""
import copy
import hashlib
import json
from pathlib import Path
import shutil
import struct

ROOT = Path(__file__).resolve().parents[1]
manifest = json.loads((ROOT/'assets/models/manifest.json').read_text(encoding='utf-8'))
requests = {}

def collect(conf):
    requests.setdefault(conf['path'],set())
    def strings(value):
        if isinstance(value,str): requests[conf['path']].add(value)
        elif isinstance(value,dict):
            for k,v in value.items():
                if k not in ['form','companion','path','name']: strings(v)
        elif isinstance(value,list):
            for v in value: strings(v)
    strings(conf)
    for key in ['form','companion']:
        if key in conf: collect(conf[key])

for conf in manifest.values(): collect(conf)
total_before=total_after=0
for relative,names in requests.items():
    target=ROOT/relative
    original=ROOT/'tmp/models-original'/relative
    if not original.exists():
        original.parent.mkdir(parents=True,exist_ok=True)
        shutil.copyfile(target,original)
    raw=original.read_bytes()
    json_size=struct.unpack_from('<I',raw,12)[0]
    doc=json.loads(raw[20:20+json_size]); binary=raw[28+json_size:]
    doc['animations']=[a for a in doc['animations'] if a.get('name') in names]
    accessors=set()
    for mesh in doc['meshes']:
        for p in mesh['primitives']:
            accessors.update(p['attributes'].values())
            if 'indices' in p: accessors.add(p['indices'])
            for t in p.get('targets',[]): accessors.update(t.values())
    for skin in doc['skins']:
        if 'inverseBindMatrices' in skin: accessors.add(skin['inverseBindMatrices'])
    for anim in doc['animations']:
        for sampler in anim['samplers']: accessors.update([sampler['input'],sampler['output']])
    remap={old:new for new,old in enumerate(sorted(accessors))}
    doc['accessors']=[doc['accessors'][old] for old in sorted(accessors)]
    for mesh in doc['meshes']:
        for p in mesh['primitives']:
            p['attributes']={k:remap[v] for k,v in p['attributes'].items()}
            if 'indices' in p: p['indices']=remap[p['indices']]
            for t in p.get('targets',[]):
                for k,v in t.items(): t[k]=remap[v]
    for skin in doc['skins']:
        if 'inverseBindMatrices' in skin: skin['inverseBindMatrices']=remap[skin['inverseBindMatrices']]
    for anim in doc['animations']:
        for sampler in anim['samplers']:
            sampler['input']=remap[sampler['input']];sampler['output']=remap[sampler['output']]
    # Copy the exact bytes addressed by each accessor, not the whole source
    # view: many exports put every animation into a single shared buffer view.
    oldviews=doc['bufferViews'];chunks=bytearray();newviews=[];dedup={}
    def append_view(data,target=None):
        key=(data,target)
        if key in dedup:return dedup[key]
        chunks.extend(b'\0'*((-len(chunks))%4))
        v={'buffer':0,'byteOffset':len(chunks),'byteLength':len(data)}
        if target is not None:v['target']=target
        newviews.append(v);chunks.extend(data);index=len(newviews)-1;dedup[key]=index;return index
    widths={5120:1,5121:1,5122:2,5123:2,5125:4,5126:4}
    components={'SCALAR':1,'VEC2':2,'VEC3':3,'VEC4':4,'MAT2':4,'MAT3':9,'MAT4':16}
    for accessor in doc['accessors']:
        assert 'sparse' not in accessor, 'Sparse accessors require a separate repacker'
        view=oldviews[accessor['bufferView']]
        assert view.get('buffer',0)==0
        width=widths[accessor['componentType']]*components[accessor['type']]
        assert not(accessor['type'] in ['MAT2','MAT3'] and accessor['componentType']!=5126)
        stride=view.get('byteStride',width)
        offset=view.get('byteOffset',0)+accessor.get('byteOffset',0)
        count=accessor['count']
        if stride==width: data=binary[offset:offset+count*width]
        else: data=b''.join(binary[offset+i*stride:offset+i*stride+width] for i in range(count))
        assert len(data)==count*width
        accessor['bufferView']=append_view(data,view.get('target'));accessor.pop('byteOffset',None)
    for image in doc.get('images',[]):
        if 'bufferView' in image:
            view=oldviews[image['bufferView']];offset=view.get('byteOffset',0)
            image['bufferView']=append_view(binary[offset:offset+view['byteLength']])
    doc['bufferViews']=newviews;doc['buffers']=[{'byteLength':len(chunks)}]
    encoded=json.dumps(doc,separators=(',',':'),ensure_ascii=False).encode();encoded+=b' '*((-len(encoded))%4)
    chunks.extend(b'\0'*((-len(chunks))%4))
    output=struct.pack('<III',0x46546c67,2,28+len(encoded)+len(chunks))+struct.pack('<II',len(encoded),0x4e4f534a)+encoded+struct.pack('<II',len(chunks),0x004e4942)+chunks
    temporary=target.with_suffix('.runtime-tmp')
    temporary.write_bytes(output)
    temporary.replace(target)
    report={'sourceSha256':hashlib.sha256(raw).hexdigest(),'runtimeSha256':hashlib.sha256(output).hexdigest(),
            'sourceBytes':len(raw),'runtimeBytes':len(output),'clips':[a['name'] for a in doc['animations']],
            'processing':'Retain gameplay animations; repack referenced buffer views. Geometry, bones, textures unchanged.'}
    target.with_suffix('.runtime.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
    total_before+=len(raw);total_after+=len(output)
print(f'{len(requests)} models: {total_before/1024**2:.1f} MiB -> {total_after/1024**2:.1f} MiB')
