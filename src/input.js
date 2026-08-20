export class InputManager {
  constructor(){
    this.onDirection=()=>{};
    this.keys={ArrowUp:'up',ArrowRight:'right',ArrowDown:'down',ArrowLeft:'left',w:'up',d:'right',s:'down',a:'left'};
    window.addEventListener('keydown',e=>{const d=this.keys[e.key];if(d&&!e.repeat){e.preventDefault();this.onDirection(d);}});
    let start=null;
    const begin=e=>{const p=e.touches?.[0]||e;start={x:p.clientX,y:p.clientY};};
    const end=e=>{if(!start)return;const p=e.changedTouches?.[0]||e;const dx=p.clientX-start.x,dy=p.clientY-start.y;if(Math.max(Math.abs(dx),Math.abs(dy))<24){start=null;return;}this.onDirection(Math.abs(dx)>Math.abs(dy)?(dx>0?'right':'left'):(dy>0?'down':'up'));start=null;};
    window.addEventListener('touchstart',begin,{passive:true});window.addEventListener('touchend',end,{passive:true});
    window.addEventListener('mousedown',begin);window.addEventListener('mouseup',end);
    document.querySelectorAll('.controls button').forEach(b=>{b.addEventListener('pointerdown',e=>{e.preventDefault();this.onDirection(b.dataset.dir);});});
  }
}
