"""Inspect the viewer's declared additional models for shapeshifters/pets."""
from html.parser import HTMLParser
import concurrent.futures
import importlib.util
import json
from pathlib import Path
import urllib.request
import hashlib

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('models', Path(__file__).with_name('import-models.py'))
models = importlib.util.module_from_spec(spec); spec.loader.exec_module(models)

def unpack(v):
    if isinstance(v,list) and len(v)==2 and isinstance(v[0],int): return unpack(v[1])
    if isinstance(v,dict): return {k:unpack(x) for k,x in v.items()}
    if isinstance(v,list): return [unpack(x) for x in v]
    return v

class Parser(HTMLParser):
    config = None
    def handle_starttag(self,tag,attrs):
        a = dict(attrs)
        if tag == 'astro-island' and 'props' in a:
            obj = unpack(json.loads(a['props']))
            if 'additionalAliases' in obj: self.config = obj

def get(hero):
    catalog = json.loads((ROOT/'tmp/champion-catalog.json').read_text())['data']
    alias = 'MonkeyKing' if hero == 'Wukong' else hero
    number = int(catalog[alias]['key'])*1000
    path = ROOT/f'assets/models/{hero.lower()}/variations.json'
    for attempt in range(3):
        try:
            if path.exists(): return hero,json.loads(path.read_text(encoding='utf-8'))
            parser = Parser()
            parser.feed(urllib.request.urlopen(f'https://modelviewer.lol/model-viewer?id={number}',timeout=40).read().decode())
            assert parser.config
            path.write_text(json.dumps(parser.config,ensure_ascii=False,indent=2),encoding='utf-8')
            return hero,parser.config
        except Exception as e:
            if attempt == 2: return hero,{'error':str(e)}

if __name__ == '__main__':
    wanted = {'Nidalee':['nidaleecougar'], 'Elise':['elisespider','elisespiderling'],
              'Shyvana':['shyvanadragon'], 'Gnar':['gnarbig'], 'Swain':['swaindemonform'],
              'Kindred':['kindredwolf'], 'Lulu':['lulufaerie']}
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
        for hero, data in pool.map(get,['Nidalee','Elise','Shyvana','Gnar','Jayce','Swain','Jinx','Kayle','Kindred','Wukong','Lulu','Kennen','Khazix']):
            if 'error' in data: raise RuntimeError(f'{hero}: {data["error"]}')
            for alias in wanted.get(hero,[]):
                assert alias in [a['id'] for a in data['additionalAliases']]
                number=data['id']
                url=f'https://cdn.modelviewer.lol/lol/models/{alias}/{number}/model.glb'
                path=ROOT/f'assets/models/{hero.lower()}/{alias}.glb'
                original=ROOT/'tmp/models-original'/path.relative_to(ROOT)
                if not path.exists():
                    with urllib.request.urlopen(url,timeout=60) as response: raw=response.read()
                    temporary=path.with_suffix('.tmp');temporary.write_bytes(raw)
                    models.read_glb(temporary);temporary.replace(path)
                raw,doc=models.read_glb(original if original.exists() else path)
                source={'hero':hero,'alias':alias,'path':path.relative_to(ROOT).as_posix(),
                        'sourcePage':f'https://modelviewer.lol/model-viewer?id={number}',
                        'downloadUrl':url,'bytes':len(raw),'sha256':hashlib.sha256(raw).hexdigest(),
                        'animations':[a.get('name','') for a in doc['animations']],
                        'bones':sum(len(s['joints']) for s in doc['skins']),
                        'retrieved':'2026-09-13','owner':'Riot Games'}
                path.with_suffix('.json').write_text(json.dumps(source,indent=2),encoding='utf-8')
                print(alias,'ready',flush=True)
