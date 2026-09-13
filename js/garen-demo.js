// Standalone visual test modes; never load or overwrite the normal game save.
(() => {
  const query=new URLSearchParams(location.search), demo=query.get('demo');
  if(!['garen','heroes'].includes(demo))return;
  Game.save=()=>{}; Game.load=()=>Game.newGame();
  window.addEventListener('DOMContentLoaded',()=>{
    const heroes=Object.keys(HEROES), bar=document.createElement('div');
    bar.className='garen-demo-bar';
    bar.innerHTML='<b>英雄 3D 试战</b><select aria-label="选择试战英雄"><option value="mixed">混合阵容</option>'+heroes.map(id=>'<option value="'+id+'">'+HEROES[id].name+' · '+id+'</option>').join('')+'</select><button data-action="battle">重新试战</button><button data-action="gallery">待机展示</button><button data-action="next">换一组</button><span class="model-status" role="status"></span><a href="index.html">返回对局</a>';
    document.body.append(bar);
    const select=bar.querySelector('select'), status=bar.querySelector('.model-status');
    select.value=demo==='garen'?'Garen':'mixed';
    let group=0, token=0;
    Game.finishBattle=()=>{G.paused=true;UI.renderPanels();status.textContent='战斗结束 · 可重播';};
    Game.preview=()=>[];
    const reset=()=>{
      UI.closeDialog();UI.blocking=false;UI.selected=null;UI.cancelDrag();
      G.paused=true;G.phase='prep';G.board={};G.bench=Array(9).fill(null);
      G.level=9;G.xp=0;G.gold=30;G.items=[];G.rewards=[];G.carousel=[];G.round=1;G.opponent=null;G.loot=null;
      G.prepLeft=99999;Game.acc=0;Game.finishing=0;Game.engine=null;
      UI.render();
      document.querySelector('#saveStatus').textContent='独立试战 · 不保存';
    };
    async function start(ids,mode='battle') {
      const run=++token; reset(); status.textContent='正在加载模型…';
      const ok=await Characters3D.ready(ids); if(run!==token)return;
      if(mode==='gallery'){
        ids.forEach((id,i)=>{G.board[(i%7)+','+(2+Math.floor(i/7)*2)]=Game.unit(id);});
        G.phase='prep';G.paused=false;UI.render();
      }else{
        const team=ids.map((id,i)=>({...Game.unit(id),x:i%7,y:5+Math.floor(i/7)}));
        const enemy=(ids.length===1?[ids[0],ids[0]]:ids.slice().reverse()).map((id,i)=>({...Game.unit(id),x:i%7,y:2-Math.floor(i/7)}));
        G.board=Object.fromEntries(team.map(u=>[u.x+','+u.y,u]));
        Game.engine=new CombatEngine(team,enemy);G.phase='combat';G.paused=false;
        UI.render();UI.beginCombat(Game.engine);
      }
      status.textContent=ok?'原技能特效待还原':'部分模型加载失败，显示头像';
      document.querySelector('#saveStatus').textContent='独立试战 · 不保存';
      document.querySelector('#opponentLabel')?.replaceChildren(document.createTextNode('英雄 3D 展示'));
      return ok;
    }
    function current(mode){
      if(select.value!=='mixed')return [select.value];
      const count=mode==='gallery'?14:7;
      return Array.from({length:Math.min(count,heroes.length-group)},(_,i)=>heroes[group+i]);
    }
    bar.querySelector('[data-action="battle"]').onclick=()=>start(current('battle'));
    bar.querySelector('[data-action="gallery"]').onclick=()=>start(current('gallery'),'gallery');
    bar.querySelector('[data-action="next"]').onclick=()=>{select.value='mixed';group=(group+7)%heroes.length;start(current('battle'));};
    select.onchange=()=>start(current('battle'));
    window.HeroDemo={start,heroes};
    start(current('battle'));
  });
})();
