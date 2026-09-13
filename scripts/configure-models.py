"""Resolve explicit animation intent against downloaded clip names.
Produces the runtime manifest and a reviewable per-hero coverage report.
"""
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
catalog = json.loads((ROOT/'assets/models/catalog.json').read_text(encoding='utf-8'))

def select(names, choices):
    for choice in choices:
        for name in names:
            if name.lower().removesuffix('.anm') == choice.lower(): return name
    return None

def automatic(names, kind):
    choices = {
        'idle':['Idle1_Base','Idle1','Idle_Base','IdleBase','Idle_Loop','Idle_01_Loop','Idle1_Raw','Idle'],
        'run':['Run_Base','Run','Run1','RunNormal','Run1_Raw','Run1A','RunWalk','Walk','Run2_Base'],
        'attack':['Attack1','Attack1_0','AutoAttack1','Attack1_A','Attack1_Start'],
        'attack2':['Attack2','Attack2_0','Attack2_A','Attack2_Start'],
        'death':['Death','Death_Base']
    }[kind]
    found = select(names,choices)
    if found: return found
    patterns = {'idle':r'idle1(?:\.anm)?$', 'run':r'run(?:1)?(?:\.anm)?$',
                'attack':r'attack1(?:\.anm)?$', 'attack2':r'attack2(?:\.anm)?$',
                'death':r'death(?:\.anm)?$'}
    candidates = [n for n in names if re.search(patterns[kind],n,re.I) and not re.search('ranged|rlauncher|passive|spell|recall',n,re.I)]
    return min(candidates,key=len) if candidates else None

spells = {
 'Garen':['Spell3_0'], 'Mordekaiser':['Spell1'], 'Fiora':['Spell2'],
 'Nidalee':['Spell4'], 'Tristana':['Spell3'], 'Darius':['Spell1'], 'Khazix':['Spell1'],
 'Elise':[], 'Camile':['Spell4'], 'Nami':['Nami_spell2'], 'Varus':['Spell1_Fire'],
 'Ahri':['Spell1'], 'Lulu':['Spell4'], 'Zed':['Zed_spell1'], 'Lissandra':['Spell4'],
 'Braum':['Spell3_Idle0'], 'Shen':['Spell2'], 'Pyke':['Spell3'], 'Blitzcrank':['Spell1'],
 'TwistedFate':['Spell2'], 'Jayce':['Spell3'], 'Lux':['Spell2'], 'Kogmaw':['kogmaw_spell2'],
 'Poppy':['Spell1'], 'Aatrox':['Q3','Spell1_C','Aatrox_ground_Q3'], 'Katarina':['Spell4'],
 'Ashe':['Spell1'], 'Kennen':['Spell4'], 'Rengar':['Spell1'], 'Morgana':['Spell4'],
 'Volibear':['Spell1'], 'Evelynn':['Spell4'], 'Veigar':['Spell4'], 'Gangplank':['Gangplank_spell3','Spell3_Upper'],
 'Shyvana':[], 'Vi':['Spell4'], 'Sejuani':['Spell4'], 'Leona':['Spell4'],
 'Akali':['Spell1_0'], 'Chogath':['Spell1'], 'AurelionSol':['Spell4'], 'Brand':['Spell4'],
 'Draven':['draven_spell1_spin_left_right'], 'Kindred':['Spell4'], 'Gnar':['Spell3'],
 'Wukong':['Spell4'], 'Kayle':['Spell4'], 'Karthus':['Spell4'], 'Anivia':['Spell4'],
 'Yasuo':['Spell1A'], 'Swain':['DemonWindup'], 'MissFortune':['Spell4_Windup'], 'Pantheon':['Spell4'], 'Kaisa':['Spell4'],
 'Vayne':[], 'Kassadin':[], 'Graves':[], 'Jinx':[]
}
forms = {'Nidalee':'nidaleecougar','Elise':'elisespider','Shyvana':'shyvanadragon','Gnar':'gnarbig','Swain':'swaindemonform'}
channel = {'Garen':'Spell3_0','Katarina':'Spell4','Wukong':'Spell4','MissFortune':'Spell4_Loop','Karthus':'Spell4_Loop'}
manifest = {}

def entry(info, cast=None):
    names = info['animations']
    result = {'path':info['path'], 'clips':{kind:automatic(names,kind) for kind in ['idle','run','attack','attack2','death']}}
    result['clips']['attack2'] = result['clips']['attack2'] or result['clips']['attack']
    result['clips']['cast'] = select(names,cast or [])
    return result

for hero,info in catalog.items():
    if 'path' not in info: continue
    conf = entry(info,spells[hero])
    if hero in channel: conf['clips']['channel'] = select(info['animations'],[channel[hero]])
    if hero in forms:
        source = json.loads((ROOT/f'assets/models/{hero.lower()}/{forms[hero]}.json').read_text())
        conf['form'] = entry(source, ['DemonTrigger'] if hero=='Swain' else ['Spell4_Base','Spell4'])
    if hero in ['Lulu','Kindred']:
        alias = 'lulufaerie' if hero=='Lulu' else 'kindredwolf'
        conf['companion'] = entry(json.loads((ROOT/f'assets/models/{hero.lower()}/{alias}.json').read_text()))
    if hero == 'Jayce':
        conf['ranged'] = {'idle':select(info['animations'],['jayce_ranged_idle1']), 'run':'Ranged_Run', 'attack':'Ranged_Attack1','attack2':'Ranged_Attack2'}
    if hero == 'Jinx':
        conf['ranged'] = {k:select(info['animations'],[f'Jinx_Rlauncher_{v}']) for k,v in [('idle','idle1'),('run','run'),('attack','attack1'),('attack2','attack2'),('death','death')]}
    if hero == 'Lissandra': conf['selfCast'] = 'Spell4_Self'
    if hero == 'Yasuo': conf['thirdCast'] = 'Spell1_Wind'
    if hero == 'Braum': conf['guard'] = 'Spell3_Idle0'
    if hero == 'Shyvana': conf['attackFollow'] = {'Attack1_Start':'Attack1_Hit','Attack2_Start':'Attack2_Hit'}
    conf['height'] = 1.65 if hero in ['Tristana','Lulu','Kennen','Veigar','Poppy','Gnar','Amumu'] else 2
    if hero in ['Chogath','Sejuani','Volibear','Aatrox','Mordekaiser']: conf['height'] = 2.2
    if hero in ['Anivia','AurelionSol']: conf['float'] = .25
    conf['name'] = info['name']
    manifest[hero] = conf

spider = json.loads((ROOT/'assets/models/elise/elisespiderling.json').read_text())
manifest['spider'] = {**entry(spider), 'height':.65, 'name':'小蜘蛛'}
(ROOT/'assets/models/manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf-8')
for hero,c in manifest.items():
    missing=[k for k in ['idle','run','attack','death'] if not c['clips'].get(k)]
    if hero not in ['spider','Elise'] and spells.get(hero) and not c['clips']['cast']: missing.append('cast')
    if missing: print(hero,'MISSING',missing)
print('Configured',len(manifest),'entries')
