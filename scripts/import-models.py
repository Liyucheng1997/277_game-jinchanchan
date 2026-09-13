"""Download and validate the project's LoL base-model candidates (not JCC VFX).
Run with Python 3. No dependencies. Existing valid files are reused.
"""
import concurrent.futures
import hashlib
import json
from pathlib import Path
import struct
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
MODELS = ROOT / 'assets/models'

def read_glb(path):
    data = path.read_bytes()
    magic, version, length = struct.unpack_from('<III', data)
    assert magic == 0x46546c67 and version == 2 and length == len(data), 'Invalid GLB'
    size, kind = struct.unpack_from('<II', data, 12)
    assert kind == 0x4e4f534a
    doc = json.loads(data[20:20+size])
    assert doc.get('skins') and doc.get('animations'), 'Missing skeleton or animation'
    return data, doc

def main():
    catalog_path = ROOT / 'tmp/champion-catalog.json'
    if not catalog_path.exists():
        versions = json.load(urllib.request.urlopen('https://ddragon.leagueoflegends.com/api/versions.json'))
        catalog = json.load(urllib.request.urlopen(f'https://ddragon.leagueoflegends.com/cdn/{versions[0]}/data/en_US/champion.json'))
        catalog_path.parent.mkdir(exist_ok=True)
        catalog_path.write_text(json.dumps(catalog), encoding='utf-8')
    catalog = json.loads(catalog_path.read_text(encoding='utf-8'))['data']
    heroes = json.loads((ROOT / 'js/official-data.js').read_text(encoding='utf-8').split('const OFFICIAL = ',1)[1].rstrip(';\n'))['heroes']
    aliases = {'Camile':'Camille', 'Wukong':'MonkeyKing'}

    def download(hero):
        wanted = aliases.get(hero, hero)
        alias = next(k for k in catalog if k.lower() == wanted.lower())
        number = int(catalog[alias]['key']) * 1000
        directory = MODELS / hero.lower()
        directory.mkdir(parents=True, exist_ok=True)
        path = directory / f'{hero.lower()}.glb'
        original = ROOT / 'tmp/models-original' / path.relative_to(ROOT)
        url = f'https://cdn.modelviewer.lol/lol/models/{alias.lower()}/{number}/model.glb'
        try:
            if not path.exists():
                with urllib.request.urlopen(url, timeout=60) as response:
                    data = response.read()
                temporary = path.with_suffix('.tmp')
                temporary.write_bytes(data)
                read_glb(temporary)
                temporary.replace(path)
            data, doc = read_glb(original if original.exists() else path)
            source = dict(hero=hero, name=heroes[hero]['name'], sourcePage=f'https://modelviewer.lol/model-viewer?id={number}',
                          downloadUrl=url, retrieved='2026-09-13', bytes=len(data),
                          sha256=hashlib.sha256(data).hexdigest(),
                          bones=sum(len(s['joints']) for s in doc['skins']),
                          animations=[a.get('name','') for a in doc['animations']],
                          meshes=[m.get('name','') for m in doc.get('meshes',[])],
                          extensions=doc.get('extensionsRequired',[]), owner='Riot Games',
                          scope='LoL base candidate; JCC version match and original VFX not verified')
            (directory / 'source.json').write_text(json.dumps(source,ensure_ascii=False,indent=2),encoding='utf-8')
            print(f'{hero}: {len(data)//1024} KiB, {len(doc["animations"])} clips',flush=True)
            return hero, {'path':path.relative_to(ROOT).as_posix(), **source}
        except Exception as error:
            print(f'{hero}: FAILED {error}',flush=True)
            return hero, {'error':str(error)}

    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        results = dict(pool.map(download, heroes))
    (MODELS / 'catalog.json').write_text(json.dumps(results,ensure_ascii=False,indent=2),encoding='utf-8')
    print('Ready:',sum('path' in v for v in results.values()),'/',len(heroes))

if __name__ == '__main__':
    main()
