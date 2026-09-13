// Browser integration audit. Load only on ?demo=heroes via a script element.
// Exercises real GLBs, skinning, runtime rendering, forms, and cleanup.
(async () => {
  if (!window.HeroDemo) throw new Error('Open the isolated heroes demo first');
  const audit = window.modelAudit = {done:false, heroes:[], failures:[], forms:[], progress:'starting'};
  const wait = ms => new Promise(resolve=>setTimeout(resolve,ms));
  const sheet=document.createElement('canvas');sheet.width=1280;sheet.height=840;
  sheet.id='model-audit-sheet';sheet.style='position:fixed;inset:0;width:100vw;height:auto;z-index:9999;background:#142d33';
  const ctx=sheet.getContext('2d');ctx.fillStyle='#142d33';ctx.fillRect(0,0,1280,840);
  let index=0;
  try {
    const ids=HeroDemo.heroes;
    for(let offset=0;offset<ids.length;offset+=10){
      const batch=ids.slice(offset,offset+10);audit.progress=batch.join(', ');
      await HeroDemo.start(batch,'gallery');
      for(let attempt=0;attempt<80;attempt++){
        if(batch.every(id=>[...Characters3D.actors.values()].some(a=>a.unit.heroId===id&&a.el.isConnected&&a.mixer)))break;
        await wait(100);
      }
      G.paused=true;
      for(const id of batch){
        const a=[...Characters3D.actors.values()].find(a=>a.unit.heroId===id&&a.el.isConnected);
        if(!a?.mixer){audit.failures.push({id,error:'Model failed to initialize'});continue;}
        const item={id,samples:[],bones:0};
        a.root.traverse(o=>{if(o.isBone)item.bones++;});
        for(const kind of ['idle','run','attack','attack2','cast','death']){
          const name=a.current.clips[kind];if(!name)continue;
          const clip=a.asset.animations.find(c=>c.name===name);
          for(const ratio of [0.15,0.5,0.8]){
            a.mixer.stopAllAction();a.mixer.clipAction(clip).reset().play();a.mixer.setTime(clip.duration*ratio);
            a.dirty=true;Characters3D.frame(.04);
            const pixels=a.ctx.getImageData(0,0,256,256).data;
            let count=0,left=256,top=256,right=0,bottom=0;
            for(let i=3;i<pixels.length;i+=4)if(pixels[i]>16){count++;const n=(i-3)/4,x=n%256,y=Math.floor(n/256);left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);}
            const sample={kind,name,ratio,count,bounds:[left,top,right,bottom]};item.samples.push(sample);
            if(count<15 && kind!=='death')audit.failures.push({id,...sample,error:'Blank pose'});
            if(kind==='idle'&&ratio===.5){
              const x=(index%10)*128,y=Math.floor(index/10)*140;
              ctx.drawImage(a.canvas,x,y,128,128);ctx.fillStyle='#f4dfaa';ctx.textAlign='center';ctx.font='12px sans-serif';ctx.fillText(id,x+64,y+134);
            }
          }
        }
        index++;audit.heroes.push(item);
      }
    }
    // Real combat units let transformation selection and weapon switches run.
    const shapeIds=['Nidalee','Elise','Shyvana','Gnar','Swain','Jayce','Jinx'];
    await HeroDemo.start(shapeIds);G.paused=true;await wait(200);
    for(const u of Game.engine.units){u.transformed=true;if(u.heroId==='Jinx')u.stacks.jinx=2;}
    Characters3D.frame(.04);await wait(200);
    for(const a of Characters3D.actors.values()){
      if(!a.el.isConnected)continue;
      audit.forms.push({id:a.unit.heroId,path:a.assetPath,broken:!!a.broken});
      if(a.config.form && a.assetPath!==a.config.form.path)audit.failures.push({id:a.unit.heroId,error:'Form did not change'});
    }
    const before=[...Characters3D.actors.values()].map(a=>a.mixer?.time);
    await wait(150);
    audit.pause=[...Characters3D.actors.values()].every((a,i)=>a.mixer?.time===before[i]);
    if(!audit.pause)audit.failures.push({error:'Paused animation advanced'});
    audit.done=true;audit.progress='complete';document.body.append(sheet);
  }catch(error){audit.failures.push({error:String(error),stack:error.stack});audit.done=true;}
})();
