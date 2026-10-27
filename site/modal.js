// 레이어 팝업 — 왼쪽에 전신 그림 전체(잘리지 않게 contain), 오른쪽에 상세. 좁은 화면은 위아래.
(function(){
  const ov=document.createElement('div'); ov.className='ov'; ov.hidden=true;
  ov.innerHTML='<div class="md" role="dialog" aria-modal="true"><button class="x" aria-label="닫기">×</button><div class="mimg"><img alt=""></div><div class="mbd"></div></div>';
  document.addEventListener('DOMContentLoaded',()=>document.body.appendChild(ov));
  const close=()=>{ov.hidden=true;document.body.style.overflow='';};
  ov.addEventListener('click',e=>{if(e.target===ov||e.target.classList.contains('x'))close();});
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!ov.hidden)close();});
  window.openModal=function(imgSrc,html){
    const im=ov.querySelector('.mimg img'); im.src=imgSrc||''; im.style.display=imgSrc?'':'none';
    im.onerror=()=>{im.style.display='none';};
    const bd=ov.querySelector('.mbd'); bd.innerHTML=html; bd.scrollTop=0;
    ov.hidden=false; document.body.style.overflow='hidden';
  };
})();
