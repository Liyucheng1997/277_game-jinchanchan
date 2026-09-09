"""Build an offline snapshot from the public official JCC data. No client bundles needed."""
import concurrent.futures
import json
import pathlib
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[1]
def raw(kind):
    return json.loads((ROOT / 'assets/data' / (kind + '.json')).read_text(encoding='utf-8'))['data']

jobs = []
def asset(url, dest):
    jobs.append((url, dest))
    return dest

asset('https://cdn.sanity.io/images/ccckgjf9/production/fa8e527d2dc4bc38d8222f60a51c5f581c563c3a-1250x740.png', 'assets/arena.png')

heroes = {}
all_heroes = raw('hero')
for h in all_heroes.values():
    if not h['id'].startswith('1') or h['showHeroTag'] != '1':
        continue
    key = h['heroPaint']
    vals = h['skillBriefValue'].split('|') if h['skillBriefValue'] else []
    heroes[key] = dict(id=key, name=h['name'], cost=int(h['price']),
        traits=['r'+x for x in h['species'].split('|')] + ['j'+x for x in h['class'].split('|')],
        hp=[float(all_heroes.get(str(s)+h['id'][1:], h)['initHP']) for s in [1,2,3]],
        atk=[float(all_heroes.get(str(s)+h['id'][1:], h)['initAttackDamage']) for s in [1,2,3]],
        armor=float(h['armor']), mr=float(h['magicResist']), aspeed=float(h['attackSpeed']),
        range=int(h['attackRange']), mana=int(h['maxMP']), startMana=int(h['initMP']),
        skill=dict(name=h['skillName'], desc=h['skillDesc'], values=vals),
        portrait=asset(h['picture'], f'assets/official/heroes/{key}.png'),
        splash=asset('https://game.gtimg.cn/images/jk/jkimg/champion/1624x750/'+key.lower()+'.jpg',f'assets/official/splash/{key}.jpg'))
    if h['skillIcon']:
        heroes[key]['skill']['icon'] = asset(h['skillIcon'], f'assets/official/skills/{key}.png')

traits = {}
for kind,prefix in [('race','r'),('job','j')]:
    for t in raw(kind).values():
        k=prefix+t['id']
        traits[k]=dict(id=k,name=t['name'], thresholds=list(map(int,t['numList'].split('|'))),desc=t['prefix'], effects=t['desc2'].split('|'),icon=asset(t['picture'],f'assets/official/traits/{k}.png'))

items = {}
for t in raw('equip').values():
    if t['type'] != '基础装备' and not (t['synthesis1']!='0' and t['synthesis2']!='0'):
        continue
    items[t['id']]=dict(id=t['id'],name=t['name'],basic=t['basicDesc'],desc=t['desc'],recipe=[t['synthesis1'],t['synthesis2']] if t['synthesis1']!='0' else [],icon=asset(t['picture'],f'assets/official/items/{t["id"]}.png'))

tiny=list(raw('config')['tinyhero'].values())
mascots=[]
for t in tiny:
    if t['level']=='1' and (len(mascots)<1 or '企鹅' in (t.get('series','')+t.get('item_name',''))):
        mascots.append(asset(t['picture'],f'assets/official/mascots/{t["id"]}.png'))
        if len(mascots)>=8: break

manifest=[]
def download(task):
    url,dest=task
    p=ROOT/dest;p.parent.mkdir(parents=True,exist_ok=True)
    if p.exists(): return dict(url=url,path=dest,status='cached')
    for attempt in range(2):
        try:
            b=urllib.request.urlopen(url,timeout=25).read()
            p.write_bytes(b)
            return dict(url=url,path=dest,status='ok',bytes=len(b))
        except Exception as e:
            err=str(e)
    return dict(url=url,path=dest,status='failed',error=err)

with concurrent.futures.ThreadPoolExecutor(12) as pool:
    manifest=list(pool.map(download,jobs))
for h in heroes.values():
    if not (ROOT/h['splash']).exists(): h['splash']=h['portrait']
snapshot=dict(source='https://jcc.qq.com/#/hero', version='时空裂痕 · 官网 1.0.0-S1 数据快照（2026-09-09）',heroes=heroes,traits=traits,items=items,mascots=mascots)
(ROOT/'js/official-data.js').write_text('"use strict";\nconst OFFICIAL = '+json.dumps(snapshot,ensure_ascii=False,separators=(',',':'))+';\n',encoding='utf-8')
(ROOT/'assets/data/manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(dict(heroes=len(heroes),traits=len(traits),items=len(items),assets=len(manifest),failed=[x for x in manifest if x['status']=='failed']),ensure_ascii=False))
