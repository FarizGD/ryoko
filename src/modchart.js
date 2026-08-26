const WORKER_SOURCE = `
let hooks = {};
const emit = (type, payload = {}) => postMessage({ kind: 'command', command: { type, ...payload } });
const api = Object.freeze({
  camera: Object.freeze({
    zoom: (amount, duration = 180) => emit('camera.zoom', { amount, duration }),
    rotate: (degrees, duration = 180) => emit('camera.rotate', { degrees, duration }),
    shake: (duration = 200, intensity = 0.01) => emit('camera.shake', { duration, intensity })
  }),
  player: Object.freeze({
    scale: (amount, duration = 180) => emit('player.scale', { amount, duration }),
    alpha: (amount, duration = 180) => emit('player.alpha', { amount, duration })
  }),
  scene: Object.freeze({
    flash: (color = '#ffffff', alpha = 0.2, duration = 260) => emit('scene.flash', { color, alpha, duration }),
    background: (color, duration = 0) => emit('scene.background', { color, duration }),
    message: (text, duration = 1600) => emit('scene.message', { text, duration })
  }),
  receptors: Object.freeze({
    rotate: (degrees, duration = 180) => emit('receptors.rotate', { degrees, duration }),
    scale: (amount, duration = 180) => emit('receptors.scale', { amount, duration })
  })
});
function invoke(name, state, detail) {
  try { if (typeof hooks[name] === 'function') hooks[name](api, Object.freeze(state || {}), detail); }
  catch (error) { postMessage({ kind: 'error', message: String(error && (error.stack || error.message) || error) }); }
}
onmessage = event => {
  const message = event.data || {};
  if (message.kind === 'load') {
    hooks = {};
    try {
      const compile = new Function('modchart', 'api', '"use strict";\\n' + message.source + '\\n');
      compile(hooks, api);
      invoke('onLoad', message.state);
      postMessage({ kind: 'ready' });
    } catch (error) { postMessage({ kind: 'error', message: String(error && (error.stack || error.message) || error) }); }
  } else if (message.kind === 'hook') invoke(message.name, message.state, message.detail);
};`;

const finite = (value, fallback, min, max) => Math.min(max, Math.max(min, Number.isFinite(Number(value)) ? Number(value) : fallback));

export class ModchartRuntime {
  constructor(applyCommand, reportError = console.error) {
    this.applyCommand=applyCommand;
    this.reportError=reportError;
    this.worker=null;
    this.ready=false;
    this.lastUpdate=-Infinity;
    this.commandWindowStart=0;
    this.commandCount=0;
  }

  load(source, state={}) {
    this.destroy();
    if (!source?.trim()) return;
    const url=URL.createObjectURL(new Blob([WORKER_SOURCE],{type:'text/javascript'}));
    this.worker=new Worker(url);
    URL.revokeObjectURL(url);
    this.worker.onmessage=event => {
      const message=event.data||{};
      if (message.kind==='ready') this.ready=true;
      else if (message.kind==='error') this.reportError(new Error(`Modchart: ${message.message}`));
      else if (message.kind==='command') {
        const now=performance.now();
        if (now-this.commandWindowStart>1000) { this.commandWindowStart=now; this.commandCount=0; }
        if (++this.commandCount<=240) this.applyCommand(this.sanitize(message.command));
        else { this.reportError(new Error('Modchart stopped: command rate exceeded 240 per second.')); this.destroy(); }
      }
    };
    this.worker.onerror=event => this.reportError(new Error(`Modchart worker: ${event.message}`));
    this.worker.postMessage({kind:'load',source,state});
  }

  sanitize(command={}) {
    const type=String(command.type||'');
    const duration=finite(command.duration,180,0,10000);
    if (type==='camera.zoom') return {type,amount:finite(command.amount,.08,-.35,.5),duration};
    if (type==='camera.rotate'||type==='receptors.rotate') return {type,degrees:finite(command.degrees,0,-45,45),duration};
    if (type==='camera.shake') return {type,duration,intensity:finite(command.intensity,.01,0,.08)};
    if (type==='player.scale'||type==='receptors.scale') return {type,amount:finite(command.amount,1,.25,3),duration};
    if (type==='player.alpha') return {type,amount:finite(command.amount,1,0,1),duration};
    if (type==='scene.flash') return {type,color:String(command.color||'#ffffff').slice(0,32),alpha:finite(command.alpha,.2,0,.8),duration};
    if (type==='scene.background') return {type,color:String(command.color||'#0d0c18').slice(0,32),duration};
    if (type==='scene.message') return {type,text:String(command.text||'').slice(0,240),duration};
    return {type:'invalid'};
  }

  hook(name,state={},detail) { if (this.worker&&this.ready) this.worker.postMessage({kind:'hook',name,state,detail}); }
  waitUntilReady(timeout=2000) {
    if (this.ready) return Promise.resolve(true);
    if (!this.worker) return Promise.resolve(false);
    const started=performance.now();
    return new Promise(resolve => {
      const check=() => {
        if (this.ready) resolve(true);
        else if (!this.worker || performance.now()-started>=timeout) resolve(false);
        else setTimeout(check,16);
      };
      check();
    });
  }
  update(state) {
    if (state.time-this.lastUpdate<33) return;
    this.lastUpdate=state.time;
    this.hook('onUpdate',state);
  }
  reset(state={}) { this.lastUpdate=-Infinity; this.hook('onReset',state); }
  destroy() { this.worker?.terminate(); this.worker=null; this.ready=false; }
}
