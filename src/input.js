export const DEFAULT_BINDINGS = {
  left:['ArrowLeft','KeyA'],
  down:['ArrowDown','KeyS'],
  up:['ArrowUp','KeyW'],
  right:['ArrowRight','KeyD']
};

export class InputManager {
  constructor(bindings = DEFAULT_BINDINGS) {
    this.onDirection=()=>{};
    this.enabled=false;
    this.bindings=structuredClone(bindings);
    window.addEventListener('keydown',event => {
      if (!this.enabled || event.repeat) return;
      const direction=Object.keys(this.bindings).find(dir => this.bindings[dir].includes(event.code));
      if (!direction) return;
      event.preventDefault();
      this.onDirection(direction);
    });
    let start=null;
    const begin=event => { if (!this.enabled) return; const point=event.touches?.[0]||event; start={x:point.clientX,y:point.clientY}; };
    const end=event => {
      if (!this.enabled || !start) return;
      const point=event.changedTouches?.[0]||event,dx=point.clientX-start.x,dy=point.clientY-start.y;
      if (Math.max(Math.abs(dx),Math.abs(dy))>=24) this.onDirection(Math.abs(dx)>Math.abs(dy)?(dx>0?'right':'left'):(dy>0?'down':'up'));
      start=null;
    };
    window.addEventListener('touchstart',begin,{passive:true}); window.addEventListener('touchend',end,{passive:true});
    window.addEventListener('mousedown',begin); window.addEventListener('mouseup',end);
  }

  setBinding(direction,code) { if (this.bindings[direction]) this.bindings[direction]=[code]; }
  resetBindings() { this.bindings=structuredClone(DEFAULT_BINDINGS); }
}
