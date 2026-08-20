import { RhythmClock } from './rhythm.js';
import { InputManager } from './input.js';
import { Chart } from './chart.js';
import { ChartEditor } from './editor.js';

const chart = new Chart({ bpm: 150, offset: 0, notes: [
  { time: 1000, type: 'swipe', direction: 'up' },
  { time: 1500, type: 'swipe', direction: 'right' },
  { time: 2000, type: 'swipe', direction: 'right' },
  { time: 2500, type: 'swipe', direction: 'down' },
  { time: 3000, type: 'swipe', direction: 'left' },
  { time: 4000, type: 'tap', direction: 'up' },
  { time: 4500, type: 'tap', direction: 'left' },
  { time: 5000, type: 'tap', direction: 'down' },
  { time: 5500, type: 'tap', direction: 'right' }
] });
const clock = new RhythmClock(chart.bpm);
const input = new InputManager();
const editor = new ChartEditor(chart, clock);

const $ = (id) => document.getElementById(id);
const comboEl = $('combo'), scoreEl = $('score'), healthEl = $('health'), feedbackEl = $('feedback'), timeEl = $('time'), player = $('player');
let score = 0, combo = 0, health = 5, running = false, lastJudged = -1;
const timing = { perfect: 70, great: 120, good: 180 };

function formatTime(ms){ const s=Math.max(0,ms)/1000; return `${Math.floor(s/60)}:${(s%60).toFixed(3).padStart(6,'0')}`; }
function setFeedback(text){ feedbackEl.textContent=text; feedbackEl.classList.remove('feedback-show'); void feedbackEl.offsetWidth; feedbackEl.classList.add('feedback-show'); }
function updateHud(){ comboEl.textContent=combo; scoreEl.textContent=String(score).padStart(6,'0'); healthEl.textContent='♥'.repeat(health)+'♡'.repeat(5-health); }
function move(dir){ const vectors={up:[0,-1],right:[1,0],down:[0,1],left:[-1,0]}; const [x,y]=vectors[dir]; player.style.transform=`translate(calc(-50% + ${x*55}px),calc(-50% + ${y*55}px))`; setTimeout(()=>player.style.transform='translate(-50%,-50%)',100); judge(dir); }
function judge(dir){ const now=clock.position; let best=null,bestAbs=Infinity; chart.notes.forEach((n,i)=>{ if(i<=lastJudged || n.direction!==dir || n._hit) return; const d=Math.abs(n.time-now); if(d<bestAbs){best=n;bestAbs=d;} }); if(!best || bestAbs>timing.good){ combo=0; health=Math.max(0,health-1); setFeedback('MISS'); updateHud(); healthEl.classList.add('hit'); setTimeout(()=>healthEl.classList.remove('hit'),200); return; } best._hit=true; lastJudged=Math.max(lastJudged,chart.notes.indexOf(best)); combo++; const quality=bestAbs<=timing.perfect?'PERFECT':bestAbs<=timing.great?'GREAT':'GOOD'; score += quality==='PERFECT'?1000:quality==='GREAT'?700:400; setFeedback(quality); updateHud(); }
function loop(){ if(running){ const now=clock.position; timeEl.textContent=formatTime(now); const beat=(now/1000)*(chart.bpm/60); document.body.style.setProperty('--beat',Math.sin(beat*Math.PI*2)); chart.notes.forEach(n=>{if(!n._hit && n.time<now-timing.good)n._expired=true;}); editor.updatePlayhead(now); } requestAnimationFrame(loop); }
$('start').onclick=()=>{ if(!running){running=true;clock.start();$('start').textContent='Pause';}else{running=false;clock.pause();$('start').textContent='Resume';} };
$('restart').onclick=()=>{ chart.notes.forEach(n=>{delete n._hit;delete n._expired;});score=0;combo=0;health=5;lastJudged=-1;clock.seek(0);running=false;$('start').textContent='Start';updateHud();timeEl.textContent='0:00.000'; };
$('editorToggle').onclick=()=>{ $('game').classList.toggle('hidden'); $('editor').classList.toggle('hidden'); };
input.onDirection=move;
window.addEventListener('keydown',e=>{if(e.code==='Space'){e.preventDefault();$('start').click();}});
editor.bindUI(); updateHud(); loop();
