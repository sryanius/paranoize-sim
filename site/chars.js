const EL={Fire:'암',Water:'광',Earth:'지'}; // 게임 표기: Fire=암(보라) Water=광(노랑) Earth=지(초록) · 상성 암>지>광>암
const TG={'1Enemy':'적 1','2Enemy':'적 2','AllEnemy':'적 전체','Self':'자신','1Ally':'아군 1','1AllyNotMe':'다른 아군 1','All':'전체','AllAlly':'아군 전체','PoisonedEnemies':'독 걸린 적','1RandomEnemy':'무작위 적 1'};
const state={q:'',rar:new Set(),ele:new Set(),role:new Set()};
let D={};
const esc=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
function role(c){ // 데이터에서 읽는 역할 태그
  const t=new Set();
  const f=c.actives.flatMap(a=>a.flags||[]);
  if(f.includes('Phys'))t.add('물리'); if(f.includes('Mag'))t.add('특수');
  const pu=c.passives.concat(c.uniques);
  if(c.actives.some(a=>(a.flags||[]).includes('Healer')||a.components.some(x=>x.type==='HealAbilityComponent')))t.add('회복');
  if(c.actives.some(a=>a.components.some(x=>(x.Buffs||[]).some(b=>/Sleep/.test(b)))))t.add('수면');
  if(c.actives.some(a=>a.components.some(x=>(x.Buffs||[]).some(b=>/Stun/.test(b)))))t.add('스턴');
  if(c.actives.some(a=>a.components.some(x=>(x.Buffs||[]).some(b=>/Poison/.test(b))))||pu.some(u=>/Poison/.test(u.key)))t.add('독');
  if(pu.some(u=>(u.tags||[]).includes('Revenge')))t.add('복수');
  if(pu.some(u=>(u.tags||[]).includes('Entry')))t.add('입장');
  if(pu.some(u=>/Guard|Protect/.test(u.key)||u.stack==='Protector'))t.add('가드');
  if(pu.some(u=>/Counter/.test(u.key)))t.add('반격');
  if(pu.some(u=>/Guts|Survive|Tenacity/.test(u.key)))t.add('근성');
  return [...t];
}
function compText(x){
  if(x.type==='DamageAbilityComponent') return (x.BaseDamageScalar!=null?`×${x.BaseDamageScalar}`:'')+(x.CritChance?` 치명 ${Math.round(x.CritChance*100)}%`:'');
  if(x.type==='HealAbilityComponent') return `회복 ${x.HealPercent!=null?Math.round(x.HealPercent*100)+'%':x.key}`;
  if(x.type==='ApplyBuffAbilityComponent') return (x.Buffs||[]).join('·');
  return x.key;
}
function skillLine(a){
  const comps=a.components.map(compText).join(' · ');
  const cond=a.condition?` · 조건 ${a.condition}`:''; const sp=a.spirit?` · MP ${a.spirit}`:''; const lim=a.useLimit?` · ${a.useLimit}회`:'';
  return `<li><b>${esc(a.name||a.key)}</b> <span class="m">TU ${a.tu}${sp}${lim} · ${TG[a.targeting]||a.targeting}${cond}${a.unlockLevel>1?` · Lv${a.unlockLevel} 해방`:''}</span><span class="d">${esc(a.desc||a.short||'')}</span><span class="m">${esc(comps)}</span></li>`;
}
function uniq(us){
  if(!us.length) return '';
  const top=us[us.length-1];
  const steps=us.map((u,i)=>`<div><span class="m">Lv${i+1}</span> ${esc((u.desc||'').replace(/\n/g,' '))}</div>`).join('');
  return `<li><b>★ ${esc(top.name||top.key)}</b> <span class="m">고유 · Lv5</span><span class="d">${esc(top.desc||'')}</span><details><summary>단계별</summary>${steps}</details></li>`;
}
function detail(c){
  const rs=role(c);
  return `<div><span class="chip ${c.rarity}">${c.rarity}</span><span class="chip ${c.element}">${EL[c.element]||c.element}</span>${rs.map(r=>`<span class="chip">${r}</span>`).join('')}</div>
    <div class="nm">${esc(c.name)} <span class="tag">${esc(c.key)}</span></div>
    <div class="tt">${esc(c.title||'')}</div>
    <div class="kv"><span>근력 <b>${c.str}</b></span><span>체력 <b>${c.vit}</b></span><span>기력 <b>${c.wil}</b></span><span>지력 <b>${c.int}</b></span></div>
    <ul class="sk">${c.actives.map(skillLine).join('')}${c.passives.map(p=>`<li><b>${esc(p.name||p.key)}</b> <span class="m">패시브${p.unlockLevel>1?` · Lv${p.unlockLevel} 해방`:''}</span><span class="d">${esc(p.desc||'')}</span></li>`).join('')}${uniq(c.uniques)}</ul>`;
}
function brief(c){ // 목록 카드의 한 줄 요약: A 액티브 · P 패시브 · U 고유
  const top=c.uniques[c.uniques.length-1];
  const rows=[...c.actives.map(a=>['A',`${a.name||a.key} <span class="m">TU ${a.tu}${a.spirit?` · MP ${a.spirit}`:''}</span>`]),
              ...c.passives.map(p=>['P',p.name||p.key]),
              ...(top?[['U',top.name||top.key]]:[])];
  return rows.map(([k,t])=>`<li><span class="pa ${k}">${k}</span><span class="t">${t}</span></li>`).join('');
}
function card(c){
  const rs=role(c);
  return `<div class="ch" data-k="${c.key}">
    <img class="pt" src="${PARA_IMG}${c.key}.jpg" alt="" loading="lazy" onerror="this.style.display='none'">
    <div class="bd"><div><span class="chip ${c.rarity}">${c.rarity}</span><span class="chip ${c.element}">${EL[c.element]||c.element}</span>${rs.map(r=>`<span class="chip">${r}</span>`).join('')}</div>
    <div class="nm">${esc(c.name)}</div>
    <div class="tt">${esc(c.title||'')}</div>
    <ul class="sum">${brief(c)}</ul>
    <button class="more" type="button">+ 더보기</button></div>
  </div>`;
}
function tog(id,vals,set,label){
  const el=document.getElementById(id);
  el.innerHTML=vals.map(v=>`<button class="tog" data-v="${v}">${label?label[v]||v:v}</button>`).join('');
  el.onclick=e=>{const b=e.target.closest('.tog'); if(!b)return; const v=b.dataset.v; set.has(v)?set.delete(v):set.add(v); b.classList.toggle('on'); render();};
}
function render(){
  const q=state.q.trim().toLowerCase();
  const list=Object.values(D).filter(c=>{
    if(state.rar.size&&!state.rar.has(c.rarity))return false;
    if(state.ele.size&&!state.ele.has(c.element))return false;
    const rs=role(c); if(state.role.size&&![...state.role].every(r=>rs.includes(r)))return false;
    if(q){const hay=[c.name,c.title,c.key,...rs,...c.actives.map(a=>a.name+' '+a.desc),...c.uniques.map(u=>u.name+' '+u.desc),...c.passives.map(p=>p.name+' '+p.desc)].join(' ').toLowerCase(); if(!hay.includes(q))return false;}
    return true;});
  const ord={SSR:0,SR:1,R:2};
  list.sort((a,b)=>ord[a.rarity]-ord[b.rarity]||a.name.localeCompare(b.name,'ko'));
  document.getElementById('grid').innerHTML=list.map(card).join('');
  document.getElementById('cnt').textContent=`${list.length} / ${Object.keys(D).length}`;
}
fetch(PARA_DATA+'characters.json').then(r=>r.json()).then(d=>{
  D=d;
  tog('rar',['SSR','SR','R'],state.rar);
  tog('ele',['Fire','Earth','Water'],state.ele,EL);
  tog('role',['물리','특수','독','수면','스턴','회복','복수','입장','가드','반격','근성'],state.role);
  document.getElementById('q').oninput=e=>{state.q=e.target.value;render();};
  document.getElementById('grid').onclick=e=>{const el=e.target.closest('.ch'); if(!el||!e.target.closest('.more,.pt,.nm'))return; const c=D[el.dataset.k]; if(c)openModal(`${PARA_IMG}${c.key}.jpg`,detail(c));};
  render();
});
