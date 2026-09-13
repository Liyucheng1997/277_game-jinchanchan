"""Validate runtime assets and, when present, lossless repacking against originals.
python tests/models.test.py
"""
import hashlib
import json
from pathlib import Path
import struct
import unittest

ROOT=Path(__file__).resolve().parents[1]
manifest=json.loads((ROOT/'assets/models/manifest.json').read_text(encoding='utf-8'))

def read(path):
    raw=path.read_bytes();magic,version,length=struct.unpack_from('<III',raw)
    assert (magic,version,length)==(0x46546c67,2,len(raw))
    n=struct.unpack_from('<I',raw,12)[0]
    return json.loads(raw[20:20+n]),raw[28+n:]

def stream(doc,binary,index):
    a=doc['accessors'][index];v=doc['bufferViews'][a['bufferView']]
    width={5120:1,5121:1,5122:2,5123:2,5125:4,5126:4}[a['componentType']]*{'SCALAR':1,'VEC2':2,'VEC3':3,'VEC4':4,'MAT2':4,'MAT3':9,'MAT4':16}[a['type']]
    offset=v.get('byteOffset',0)+a.get('byteOffset',0);stride=v.get('byteStride',width)
    return b''.join(binary[offset+i*stride:offset+i*stride+width] for i in range(a['count']))

def configs():
    for c in manifest.values():
        yield c
        for key in ['form','companion']:
            if key in c:yield c[key]

class Models(unittest.TestCase):
    def test_roster_and_clips(self):
        heroes=json.loads((ROOT/'js/official-data.js').read_text(encoding='utf-8').split('const OFFICIAL = ',1)[1].rstrip(';\n'))['heroes']
        self.assertEqual(set(manifest)-{'spider'},set(heroes))
        for c in configs():
            with self.subTest(path=c['path']):
                d,b=read(ROOT/c['path']);self.assertTrue(d['skins'])
                available={a['name'] for a in d['animations']}
                for key in ['idle','run','attack']:self.assertIn(c['clips'][key],available)
                for name in c['clips'].values():
                    if name:self.assertIn(name,available)
                for table in ['ranged','attackFollow']:
                    for name in c.get(table,{}).values():self.assertIn(name,available)
                for key in ['guard','thirdCast','selfCast']:
                    if key in c:self.assertIn(c[key],available)
                for image in d.get('images',[]):self.assertIn('bufferView',image)
                for v in d['bufferViews']:
                    self.assertLessEqual(v.get('byteOffset',0)+v['byteLength'],len(b))
                report=json.loads((ROOT/c['path']).with_suffix('.runtime.json').read_text())
                self.assertEqual(hashlib.sha256((ROOT/c['path']).read_bytes()).hexdigest(),report['runtimeSha256'])

    def test_repacking_preserves_geometry_skeleton_textures_and_animation(self):
        count=0
        for c in configs():
            original=ROOT/'tmp/models-original'/c['path']
            if not original.exists():continue
            count+=1
            with self.subTest(path=c['path']):
                old,ob=read(original);new,nb=read(ROOT/c['path'])
                self.assertEqual(old['nodes'],new['nodes'])
                def equal_accessors(a,b):
                    self.assertEqual(stream(old,ob,a),stream(new,nb,b))
                for om,nm in zip(old['meshes'],new['meshes']):
                    for op,np in zip(om['primitives'],nm['primitives']):
                        for key in op['attributes']:equal_accessors(op['attributes'][key],np['attributes'][key])
                        if 'indices' in op:equal_accessors(op['indices'],np['indices'])
                for os,ns in zip(old['skins'],new['skins']):
                    self.assertEqual(os['joints'],ns['joints']);equal_accessors(os['inverseBindMatrices'],ns['inverseBindMatrices'])
                for image,ni in zip(old['images'],new['images']):
                    ov=old['bufferViews'][image['bufferView']];nv=new['bufferViews'][ni['bufferView']]
                    self.assertEqual(ob[ov.get('byteOffset',0):ov.get('byteOffset',0)+ov['byteLength']],nb[nv.get('byteOffset',0):nv.get('byteOffset',0)+nv['byteLength']])
                for anim in new['animations']:
                    oa=next(a for a in old['animations'] if a['name']==anim['name']);self.assertEqual(oa['channels'],anim['channels'])
                    for os,ns in zip(oa['samplers'],anim['samplers']):
                        equal_accessors(os['input'],ns['input']);equal_accessors(os['output'],ns['output'])
        if not count:self.skipTest('Unmodified local downloads not present')

if __name__=='__main__':unittest.main()
