// Shared WebGL renderer, independent skeletons, lazy assets, DOM depth/input.
// Rebuild: node scripts/build-3d.cjs
import * as THREE from '../tmp/3d/node_modules/three/build/three.module.js';
import { GLTFLoader } from '../tmp/3d/node_modules/three/examples/jsm/loaders/GLTFLoader.js';
import { clone } from '../tmp/3d/node_modules/three/examples/jsm/utils/SkeletonUtils.js';
import manifest from '../assets/models/manifest.json';
import hashes from '../assets/models/hashes.json';
import {createModelStore} from './model-cache.js';
const modelStore=createModelStore(hashes);
const RENDER_SIZE=160;

const actors = new Map(), cache = new Map(), queue = [];
let renderer, failed = false, elapsed = 0, activeLoads = 0;
const loader = new GLTFLoader();
const camera = new THREE.OrthographicCamera(-2.1,2.1,2.1,-2.1,.1,30);
camera.position.set(0,3.8,6); camera.lookAt(0,.95,0);

function assetFor(config) {
  if (!config || failed) return null;
  let record = cache.get(config.path);
  if (!record) {
    record = {status:'queued', config, used:performance.now()};
    record.promise = new Promise(resolve => record.resolve = resolve);
    cache.set(config.path,record); queue.push(record); pump();
  }
  record.used = performance.now();
  return record;
}
function pump() {
  while (activeLoads < 3 && queue.length) {
    const record = queue.shift(); activeLoads++; record.status = 'loading';
    modelStore.read(record.config.path).then(bytes=>loader.parseAsync(bytes,new URL('.',location.href).href)).then(asset => {
      // Exported files may contain hidden cosmetic meshes (e.g. Kayle levels).
      asset.scene.traverse(o => {
        if (o.isMesh && o.material?.userData?.visible === false) o.visible = false;
        if (o.isSkinnedMesh) o.frustumCulled = false;
      });
      record.asset = asset; record.status = 'ready'; record.resolve(true);
      activeLoads--; pump();
    }).catch(error => {
      record.status = 'error'; record.resolve(false); activeLoads--; pump();
      console.warn('3D asset unavailable; retaining portrait:',record.config.path,error);
    });
  }
}
function release(a) {
  a.mixer?.stopAllAction(); if (a.root) a.mixer?.uncacheRoot(a.root);
  a.pet?.mixer.stopAllAction();
  const skeletons = new Set();
  a.scene?.traverse(o => { if (o.isSkinnedMesh) skeletons.add(o.skeleton); });
  skeletons.forEach(s => s.dispose());
  // Geometry and materials belong to the asset cache, not individual actors.
  a.canvas?.remove(); a.el.classList.remove('has-3d','garen-spinning');
  a.el.style.opacity = ''; delete a.el.dataset.animation;
  a.mixer = a.root = a.scene = a.action = a.canvas = a.pet = null;
  a.name = ''; a.dead = false; a.hold = 0;
}
function evict() {
  const used = new Set();
  for (const a of actors.values()) {
    used.add(a.config.path); if (a.assetPath) used.add(a.assetPath);
    if (a.config.form) used.add(a.config.form.path);
    if (a.config.companion) used.add(a.config.companion.path);
  }
  const unused = [...cache.values()].filter(r => r.status==='ready' && !r.pins && !used.has(r.config.path)).sort((a,b)=>b.used-a.used);
  // Keep only three unused assets warm between rounds; active models stay alive.
  for (const r of unused.slice(3)) {
    const geometries=new Set(), materials=new Set(), textures=new Set();
    r.asset.scene.traverse(o => {
      if (o.geometry) geometries.add(o.geometry);
      for (const m of (Array.isArray(o.material)?o.material:[o.material]).filter(Boolean)) {
        materials.add(m); for (const v of Object.values(m)) if (v?.isTexture) textures.add(v);
      }
    });
    geometries.forEach(g=>g.dispose()); materials.forEach(m=>m.dispose());
    textures.forEach(t=>{t.dispose();t.source?.data?.close?.();});
    cache.delete(r.config.path);
  }
}
function formConfig(a) {
  if (a.unit.transformed && a.config.form && !(a.unit.heroId==='Swain' && a.unit.alive===false)) return a.config.form;
  return a.config;
}
function clipsFor(a) {
  let clips=a.current.clips;
  const ranged = a.unit.heroId==='Jayce' ? a.unit.transformed : a.unit.heroId==='Jinx' && (a.unit.stacks?.jinx||0)>=2;
  if (ranged && a.config.ranged) clips={...clips,...a.config.ranged};
  return clips;
}
function play(a,name,once=false) {
  if (!name || (a.name===name && !once)) return false;
  const clip=THREE.AnimationClip.findByName(a.asset.animations,name);
  if (!clip) return false;
  const next=a.mixer.clipAction(clip);
  if (a.action!==next) a.action?.fadeOut(.1);
  next.reset().setEffectiveTimeScale(1).setEffectiveWeight(1);
  next.setLoop(once?THREE.LoopOnce:THREE.LoopRepeat,once?1:Infinity);
  next.clampWhenFinished=once; next.fadeIn(.1).play();
  a.action=next; a.name=name; a.dirty=true; return true;
}
function normalize(root,height=2,float=0) {
  root.updateMatrixWorld(true);
  let bounds=new THREE.Box3();
  root.traverse(o=>{ if(o.isMesh && o.visible) {o.computeBoundingBox(); bounds.union(o.boundingBox.clone().applyMatrix4(o.matrixWorld));} });
  const size=bounds.getSize(new THREE.Vector3()), center=bounds.getCenter(new THREE.Vector3());
  if (!Number.isFinite(size.y) || size.y<.00001) throw new Error('Empty model bounds');
  const s=Math.min(height/size.y,3.2/Math.max(size.x,size.z));
  root.scale.multiplyScalar(s);
  root.position.set(-center.x*s,-bounds.min.y*s+float,-center.z*s);
}
function initialize(a,config,record) {
  renderer.setScissorTest(false);renderer.setSize(256,256,false);renderer.setViewport(0,0,256,256);
  const previousAngle=a.root?.rotation.y;
  if (a.root) release(a);
  a.current=config; a.asset=record.asset; a.assetPath=config.path;
  a.scene=new THREE.Scene(); a.root=clone(a.asset.scene); a.scene.add(a.root);
  a.mixer=new THREE.AnimationMixer(a.root);
  play(a,clipsFor(a).idle);
  // Normalize the posed character, not the bind pose with expanded helper bones.
  a.action.stopFading().setEffectiveWeight(1); a.mixer.update(a.action.getClip().duration*.35);
  normalize(a.root, (config===a.config.form?2.3:(a.config.height||2))*(1+.07*((a.unit.star||1)-1)), a.config.float||0);
  a.root.rotation.y=previousAngle??(a.side?.3:Math.PI+.3);
  a.canvas=document.createElement('canvas'); a.canvas.width=a.canvas.height=256;
  a.canvas.className='character-3d'; a.canvas.setAttribute('aria-hidden','true');
  a.ctx=a.canvas.getContext('2d'); a.el.append(a.canvas); a.el.classList.add('has-3d');
  a.camera=camera.clone();
  // Some rigs contain invisible helper vertices spanning many metres. Frame the
  // visible silhouette as well as geometric bounds, keeping feet on the base.
  let crop=256,ox=0,oy=0;
  const desiredHeight=105*((config===a.config.form?2.3:(a.config.height||2))/2);
  for(let pass=0;pass<3;pass++) {
    renderer.render(a.scene,a.camera);a.ctx.clearRect(0,0,256,256);a.ctx.drawImage(renderer.domElement,0,0);
    const data=a.ctx.getImageData(0,0,256,256).data;
    let left=256,right=0,top=256,bottom=0,count=0;
    for(let i=3;i<data.length;i+=4)if(data[i]>24){const n=(i-3)/4,x=n%256,y=Math.floor(n/256);left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);count++;}
    if(!count)break;
    const next=crop*Math.max((bottom-top+1)/desiredHeight,(right-left+1)/175);
    ox+=crop*((left+right)/2/256)-next/2;
    oy+=crop*(bottom/256)-next*.80;
    crop=next;a.camera.setViewOffset(256,256,ox,oy,crop,crop);
  }
  a.canvas.width=a.canvas.height=RENDER_SIZE;
  a.el.dataset.model=a.assetPath; a.dirty=true;
  if (config===a.config.form && config.clips.cast && a.unit.alive!==false) {
    play(a,config.clips.cast,true); a.hold=Math.min(1,a.action.getClip().duration); a.lock='cast';
  }
}
function addCompanion(a) {
  if (!a.config.companion || a.pet) return;
  const record=assetFor(a.config.companion); if(record.status!=='ready')return;
  const root=clone(record.asset.scene), mixer=new THREE.AnimationMixer(root);
  const clip=THREE.AnimationClip.findByName(record.asset.animations,a.config.companion.clips.idle);
  if(clip)mixer.clipAction(clip).play(); mixer.update(0);
  normalize(root,a.unit.heroId==='Lulu'?.45:.65);
  root.position.x+=.85;root.position.y+=a.unit.heroId==='Lulu'?1.35:.65;
  a.scene.add(root);a.pet={root,mixer};a.dirty=true;
}

const api=window.Characters3D={
  actors,cache,manifest,modelStore,status:'ready', enabled:new URLSearchParams(location.search).get('models')!=='off',
  async ready(ids) {
    if(failed || !this.enabled)return false;
    const configs=ids.flatMap(id=>{const c=manifest[id];return c?[c,c.form,c.companion].filter(Boolean):[];});
    const records=configs.map(c=>assetFor(c));
    records.forEach(r=>r.pins=(r.pins||0)+1);
    try { return (await Promise.all(records.map(r=>r.promise))).every(Boolean); }
    finally { setTimeout(()=>records.forEach(r=>r.pins--),1000); }
  },
  attach(el,unit,side) {
    const config=manifest[unit.heroId||unit.creepId]; if(!config||failed||!this.enabled)return;
    actors.set(el,{el,unit,side,config,hold:0,x:unit.x,y:unit.y,dirty:true});
  },
  event(e) {
    const a=actors.get(UI.combatEls.get(e.unit?.fid)); if(!a?.mixer||a.dead)return;
    const clips=clipsFor(a);
    if(e.type==='cast') {
      let name=clips.cast;
      if(a.config.selfCast && a.unit.hp/a.unit.maxHp<.5)name=a.config.selfCast;
      if(a.config.thirdCast && a.unit.casts%3===0)name=a.config.thirdCast;
      if(play(a,name,true)){a.hold=Math.min(1.5,a.action.getClip().duration);a.lock='cast';}
    }
    if(e.type==='attack' && !Game.engine?.has(a.unit,'channel') && !(a.lock==='cast'&&a.hold>0)) {
      const name=a.unit.attacks%2?clips.attack:clips.attack2;
      if(play(a,name,true)) {
        const duration=a.action.getClip().duration;
        const attackInterval=1/Math.max(.2,a.unit.as*(1+(a.unit.asBonus||0)));
        a.hold=Math.min(duration,attackInterval*.9);
        a.action.setEffectiveTimeScale(duration/Math.max(.12,a.hold));a.lock='attack';
        a.follow=a.current===a.config?a.config.attackFollow?.[name]:null;
      }
    }
  },
  frame(dt) {
    elapsed+=dt; if(elapsed<1/30)return;
    const step=elapsed;elapsed=0;
    for(const [el,a]of actors)if(!el.isConnected){release(a);actors.delete(el);}
    if(failed||!this.enabled)return;
    const paused=G.paused||UI.blocking;
    let initialized=false;
    for(const [el,a]of actors) {
      try {
        if(a.broken)continue;
        const desired=formConfig(a), record=assetFor(desired);
        // Preload the alternate form while its normal form is visible.
        if(a.config.form)assetFor(a.config.form);
        if(record.status==='ready') {
          if(a.assetPath!==desired.path||!a.mixer){if(initialized)continue;initialize(a,desired,record);initialized=true;}
        } else if(!a.mixer) continue;
        addCompanion(a);
        const combat=!!a.unit.fid&&G.phase==='combat'&&!el.classList.contains('preview');
        const delta=paused?0:step*(combat?G.speed:1),u=a.unit,clips=clipsFor(a);
        if(combat&&!paused) {
          a.hold=Math.max(0,a.hold-delta);
          if(!u.alive) {
            el.classList.remove('garen-spinning');
            if(!a.dead){play(a,clips.death,true);a.dead=true;a.deathTime=0;}
            a.deathTime+=delta;
            const duration=clips.death?a.action.getClip().duration:1;
            el.style.opacity=String(Math.max(0,1-Math.max(0,a.deathTime-Math.min(1.2,duration))/.5));
          } else {
            const moving=u.x!==a.x||u.y!==a.y;
            if(moving)a.walkTime=.24;
            a.walkTime=Math.max(0,(a.walkTime||0)-delta);
            const target=moving?{x:u.x,y:u.y}:u.target;
            if(target&&(target.x!==a.x||target.y!==a.y))a.root.rotation.y=Math.atan2(target.x-a.x,target.y-a.y);
            const channel=Game.engine?.has(u,'channel')&&!Game.engine?.has(u,'stun');
            el.classList.toggle('garen-spinning',u.heroId==='Garen'&&!!channel);
            if(channel&&clips.channel)play(a,clips.channel);
            else if(!a.hold) {
              if(a.follow){play(a,a.follow,true);a.follow=null;a.hold=Math.min(.4,a.action.getClip().duration);}
              else if(a.config.guard&&Game.engine?.has(u,'reduction'))play(a,a.config.guard);
              else play(a,a.walkTime?clips.run:clips.idle);
            }
            a.x=u.x;a.y=u.y;
          }
        }
        if(a.dead&&a.el.style.opacity==='0')continue;
        const stunned=combat&&Game.engine?.has(u,'stun')&&!a.dead;
        if(paused&&!a.dirty)continue;
        a.mixer.update(stunned?0:delta);a.pet?.mixer.update(stunned?0:delta);
        if(renderer.domElement.width!==RENDER_SIZE)renderer.setSize(RENDER_SIZE,RENDER_SIZE,false);renderer.setViewport(0,0,RENDER_SIZE,RENDER_SIZE);
        renderer.render(a.scene,a.camera);
        a.ctx.clearRect(0,0,RENDER_SIZE,RENDER_SIZE);a.ctx.drawImage(renderer.domElement,0,0);
        el.dataset.animation=a.name;a.dirty=false;
      } catch(error) {
        release(a);a.broken=true;console.warn('3D actor fallback:',a.unit.heroId,error);
      }
    }
    evict();
  }
};
try {
  if(location.protocol==='file:')throw new Error('Use local HTTP server for 3D assets');
  renderer=new THREE.WebGLRenderer({alpha:true,antialias:true,preserveDrawingBuffer:true});
  renderer.setSize(256,256);renderer.setClearColor(0,0);
  renderer.domElement.addEventListener('webglcontextlost',()=>{
    failed=true;api.status='fallback';for(const a of actors.values())release(a);
  });
} catch(error){failed=true;api.status='fallback';console.warn('3D unavailable; retaining portraits:',error);}

window.addEventListener('DOMContentLoaded',()=>{
  const button=document.createElement('button');button.id='cacheModels';button.textContent='下载全部模型到本地';
  button.title='约 106 MB，下载后模型优先读取本机缓存；首次仍需联网下载。';
  document.querySelector('#saveStatus')?.before(button);
  button.onclick=async()=>{
    button.disabled=true;
    try {
      const result=await modelStore.downloadAll((done,total,failed)=>{button.textContent=`模型缓存 ${done}/${total}${failed?' · 失败 '+failed:''}`;});
      button.textContent=result.failed?'部分失败 · 点击重试':result.persistent?'全部模型已缓存':'浏览器未能保存缓存 · 点击重试';
      button.disabled=!result.failed&&result.persistent;
    }catch{button.textContent='缓存失败 · 点击重试';button.disabled=false;}
  };
});
