import { RhythmClock } from './rhythm.js';
import { InputManager } from './input.js';
import { Chart } from './chart.js';
import { ChartEditor } from './editor.js';

const chart = new Chart({ bpm: 150, offset: 0, notes: [
  { time: 1000, type: 'swipe', direction: 'up' }, { time: 1500, type: 'swipe', direction: 'right' },
  { time: 2000, type: 'swipe', direction: 'right' }, { time: 2500, type: 'swipe', direction: 'down' },
  { time: 3000, type: 'swipe', direction: 'left' }, { time: 4000, type: 'tap', direction: 'up' },
  { time: 4500, type: 'tap', direction: 'left' }, { time: 5000, type: 'tap', direction: 'down' },
  { time: 5500, type: 'tap', direction: 'right' }
] });

const clock = new RhythmClock(chart.bpm);
const input = new InputManager();
const editor = new ChartEditor(chart, clock);
const audio = new Audio();
audio.preload = 'metadata';

const $ = id => document.getElementById(id);
const comboEl = $('combo'), scoreEl = $('score'), healthEl = $('health'), feedbackEl = $('feedback'), timeEl = $('time'), player = $('player');
let score = 0, combo = 0, health = 5, lastJudged = -1, songUrl = null;
const timing = { perfect: 70, great: 120, good: 180 };

function formatTime(ms) {
  const s = Math.max(0, ms) / 1000;
  return `${Math.floor(s / 60)}:${(s % 60).toFixed(3).padStart(6, '0')}`;
}

function setFeedback(text) {
  feedbackEl.textContent = text;
  feedbackEl.classList.remove('feedback-show');
  void feedbackEl.offsetWidth;
  feedbackEl.classList.add('feedback-show');
}

function updateHud() {
  comboEl.textContent = combo;
  scoreEl.textContent = String(score).padStart(6, '0');
  healthEl.textContent = '♥'.repeat(health) + '♡'.repeat(5 - health);
}

function move(dir) {
  const v = { up:[0,-1], right:[1,0], down:[0,1], left:[-1,0] };
  const [x, y] = v[dir];
  player.style.transform = `translate(calc(-50% + ${x * 55}px),calc(-50% + ${y * 55}px))`;
  setTimeout(() => player.style.transform = 'translate(-50%,-50%)', 100);
  judge(dir);
}

function judge(dir) {
  const now = clock.current;
  let best = null, bestAbs = Infinity;
  chart.notes.forEach((n, i) => {
    if (i <= lastJudged || n.direction !== dir || n._hit) return;
    const d = Math.abs(n.time - now);
    if (d < bestAbs) { best = n; bestAbs = d; }
  });
  if (!best || bestAbs > timing.good) {
    combo = 0;
    health = Math.max(0, health - 1);
    setFeedback('MISS');
    updateHud();
    return;
  }
  best._hit = true;
  lastJudged = Math.max(lastJudged, chart.notes.indexOf(best));
  combo++;
  const q = bestAbs <= timing.perfect ? 'PERFECT' : bestAbs <= timing.great ? 'GREAT' : 'GOOD';
  score += q === 'PERFECT' ? 1000 : q === 'GREAT' ? 700 : 400;
  setFeedback(q);
  updateHud();
}

async function togglePlayback(button = $('start')) {
  if (clock.running) {
    clock.pause();
    button.textContent = 'Resume';
    $('editorPlay').textContent = '▶ Play';
  } else {
    await clock.start();
    button.textContent = 'Pause';
    $('editorPlay').textContent = 'Ⅱ Pause';
  }
}

function reset() {
  chart.notes.forEach(n => { delete n._hit; delete n._expired; });
  score = 0; combo = 0; health = 5; lastJudged = -1;
  clock.pause();
  clock.seek(0);
  $('start').textContent = 'Start';
  $('editorPlay').textContent = '▶ Play';
  updateHud();
  timeEl.textContent = '0:00.000';
  editor.updatePlayhead(0);
}

function loadSong(file) {
  if (!file) return;
  if (songUrl) URL.revokeObjectURL(songUrl);
  songUrl = URL.createObjectURL(file);
  audio.src = songUrl;
  audio.load();
  clock.attachAudio(audio);
  reset();
  $('songStatus').textContent = `Loaded: ${file.name}`;
}

$('songInput').onchange = e => loadSong(e.target.files[0]);
$('editorSongInput').onchange = e => loadSong(e.target.files[0]);
$('start').onclick = () => togglePlayback($('start'));
$('restart').onclick = reset;
$('editorToggle').onclick = () => {
  $('game').classList.toggle('hidden');
  $('editor').classList.toggle('hidden');
};

input.onDirection = move;
window.addEventListener('keydown', e => {
  if (e.code === 'Space' && !['INPUT','SELECT'].includes(document.activeElement.tagName)) {
    e.preventDefault();
    const editorVisible = !$('editor').classList.contains('hidden');
    if (editorVisible) $('editorPlay').click(); else $('start').click();
  }
});

audio.addEventListener('ended', () => {
  clock.pause();
  $('start').textContent = 'Start';
  $('editorPlay').textContent = '▶ Play';
});

function loop() {
  const now = clock.current;
  if (clock.running) {
    timeEl.textContent = formatTime(now);
    editor.updatePlayhead(now);
  }
  requestAnimationFrame(loop);
}

editor.bindUI();
updateHud();
loop();
