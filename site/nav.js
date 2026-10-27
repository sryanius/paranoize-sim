// 상단 메뉴 — 모든 페이지가 같은 메뉴를 쓴다
(function(){
  const pages=[['index.html','표지'],['chars.html','캐릭터'],['enemies.html','유적의 적'],['guide.html','공략'],['ruins.html','유적 시뮬'],['arena.html','투기장 덱'],['pvp.html','PvP 편성']];
  const here=location.pathname.split('/').pop()||'index.html';
  const nav=document.createElement('nav'); nav.className='topnav';
  nav.innerHTML=pages.map(([h,t])=>`<a href="${h}" class="${h===here?'here':''}">${t}</a>`).join('');
  const w=document.querySelector('.wrap'); (w||document.body).prepend(nav);
})();
