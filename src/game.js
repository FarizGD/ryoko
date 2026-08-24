import { RhythmClock } from './rhythm.js';
import { InputManager } from './input.js';
import { Chart } from './chart.js';
import { ChartEditor } from './editor.js';
import Phaser from 'phaser';
import { GameplayScene } from './scenes/gameplay-scene.js';
import monochromeFNF from '../charts/monochrome/monochrome-hard.json';
import monochromeAudio from '../charts/monochrome/audio.ogg?url';
import { readRyokoPackage, createRyokoPackage } from './song-package.js';

const chart = new Chart();
chart.load(monochromeFNF);

const clock = new RhythmClock(chart.bpm);
const input = new InputManager();
try {
  const savedBindings=JSON.parse(localStorage.getItem('ryoko-keybinds'));
  if (savedBindings && ['left','down','up','right'].every(direction => Array.isArray(savedBindings[direction]))) {
    for (const direction of ['left','down','up','right']) {
      const allowed=savedBindings[direction].filter(code => code!=='KeyL'&&code!=='Backquote');
      if (allowed.length) input.bindings[direction]=allowed;
    }
  }
} catch (_) {}
const editor = new ChartEditor(chart, clock);
const audio = new Audio();
audio.preload = 'metadata';

const $ = id => document.getElementById(id);
const comboEl = $('combo'), scoreEl = $('score'), healthFill = $('healthFill'), feedbackEl = $('feedback'), timeEl = $('time');
let score = 0, combo = 0, maxCombo = 0, misses = 0, hits = 0, health = 100, lastJudged = -1, songUrl = null;
let inputLocked = false, endingRun = false, botplay = false;
let judgments={perfect:0,good:0,bad:0,miss:0};
let renderingChart=false, chartRecorder=null, recordingChunks=[], renderPreviousBotplay=false;
let recordingAudioContext=null, recordingAudioSource=null, recordingAudioDestination=null;
let activePackage = null, currentAudioBlob = null, selectedCover = null, selectedPauseArt = null;
const timing = { perfect: 70, great: 120, good: 180 };
let launchToken = 0;
let lastFeedbackAt=0, hudFrame=0;

const loadingScreen = document.createElement('div');
loadingScreen.id = 'gameLoading';
loadingScreen.className = 'game-loading hidden';
loadingScreen.innerHTML = '<div class="loading-content"><div class="loading-spinner"></div><strong id="loadingCount"></strong><p id="loadingMessage">LOADING CHART</p></div>';
$('gamePage').appendChild(loadingScreen);
const gameplayLegend = document.createElement('div');
gameplayLegend.className = 'gameplay-legend';
gameplayLegend.innerHTML = '<span><i class="player-note-key"></i> YOUR NOTES</span><span><i class="auto-note-key"></i> AUTO NOTES</span>';
$('arena').appendChild(gameplayLegend);
const botplayIndicator=document.createElement('div');
botplayIndicator.className='botplay-indicator hidden';
botplayIndicator.textContent='BOTPLAY';
$('arena').appendChild(botplayIndicator);
const pauseMenu = document.createElement('div');
pauseMenu.className = 'pause-menu hidden';
pauseMenu.innerHTML = '<div class="pause-card"><div class="pause-art"><img src="charts/monochrome/pause-art.png" alt="Pause character art"></div><div class="pause-content"><p class="eyebrow">GAME PAUSED</p><h2>Take a breath.</h2><button id="resumeGame" class="primary">Resume</button><button id="restartPaused">Restart</button><button id="quitPaused">Quit to Songs</button></div></div>';
pauseMenu.querySelector('img').onerror = event => { event.currentTarget.hidden = true; };
$('gamePage').appendChild(pauseMenu);

audio.src = monochromeAudio;
audio.load();
clock.attachAudio(audio);
$('selectedSongTitle').textContent = chart.title;
$('selectedSongMeta').textContent = `${chart.bpm} BPM · ${chart.notes.filter(note => !note.auto).length} player notes · ${chart.scrollSpeed}× speed`;
$('gameSongTitle').textContent = chart.title;
$('editorSongTitle').textContent = chart.title;
$('songStatus').textContent = 'Bundled example: Monochrome';
$('bpm').value = chart.bpm;

function formatTime(ms) {
  const s = Math.max(0, ms) / 1000;
  return `${Math.floor(s / 60)}:${(s % 60).toFixed(3).padStart(6, '0')}`;
}

function setFeedback(text) {
  feedbackEl.textContent = text;
  const now=performance.now();
  if (now-lastFeedbackAt<34) return;
  lastFeedbackAt=now;
  feedbackEl.classList.remove('feedback-show');
  void feedbackEl.offsetWidth;
  feedbackEl.classList.add('feedback-show');
}

function scheduleHudUpdate() {
  if (hudFrame) return;
  hudFrame=requestAnimationFrame(() => { hudFrame=0; updateHud(); });
}

function updateHud() {
  comboEl.textContent = combo;
  scoreEl.textContent = String(score).padStart(6, '0');
  healthFill.style.width = `${health}%`;
  healthFill.classList.toggle('danger', health <= 25);
  $('perfectCount').textContent=judgments.perfect;
  $('goodCount').textContent=judgments.good;
  $('badCount').textContent=judgments.bad;
  $('missCount').textContent=judgments.miss;
}

const gameplayScene = new GameplayScene(chart, clock, judge, registerMiss, pulseUiBeat, botHit);
let phaserGame = null;

function pulseUiBeat(bpm) {
  const duration = Math.min(180, (60000 / bpm) * .32);
  document.documentElement.style.setProperty('--beat-pulse-duration', `${duration}ms`);
  for (const element of [comboEl, scoreEl, healthFill.closest('.health-track'), $('gameSongTitle')]) {
    element.classList.remove('on-beat');
    void element.offsetWidth;
    element.classList.add('on-beat');
  }
}

function resizeGameplay() {
  if (!phaserGame || $('gamePage').classList.contains('hidden')) return;
  if (renderingChart) {
    phaserGame.scale.resize(854,480);
    if (gameplayScene.sys?.isActive()) gameplayScene.layout();
    return;
  }
  const arena = $('arena');
  const width = Math.max(1, arena.clientWidth);
  const height = Math.max(1, arena.clientHeight);
  phaserGame.scale.resize(width, height);
  if (gameplayScene.sys?.isActive()) gameplayScene.layout();
}

function ensureGameplay() {
  if (phaserGame) {
    resizeGameplay();
    return;
  }
  const arena = $('arena');
  phaserGame = new Phaser.Game({
    type: Phaser.AUTO,
    parent: arena,
    backgroundColor: '#0d0c18',
    width: Math.max(1, arena.clientWidth),
    height: Math.max(1, arena.clientHeight),
    scale: { mode: Phaser.Scale.RESIZE },
    render: { antialias: true, pixelArt: false },
    scene: gameplayScene
  });
  phaserGame.events.once(Phaser.Core.Events.READY, resizeGameplay);
}

function waitForGameplay() {
  ensureGameplay();
  if (gameplayScene.sys?.isActive()) return Promise.resolve();
  return new Promise(resolve => {
    let finished = false;
    const done = () => { if (finished) return; finished = true; resizeGameplay(); resolve(); };
    phaserGame.events.once(Phaser.Core.Events.READY, done);
    setTimeout(done, 3000);
  });
}

function waitForAudio() {
  if (!audio.src || audio.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) return Promise.resolve();
  return new Promise(resolve => {
    let finished = false;
    const done = () => {
      if (finished) return; finished = true;
      audio.removeEventListener('canplay', done); audio.removeEventListener('error', done); resolve();
    };
    audio.addEventListener('canplay', done); audio.addEventListener('error', done);
    setTimeout(done, 5000);
  });
}

function judge(dir) {
  if (inputLocked) return;
  const now = clock.current;
  let best = null, bestAbs = Infinity;
  chart.notes.forEach((n, i) => {
    if (n.auto || n.direction !== dir || n._hit) return;
    const d = Math.abs(n.time + chart.offset - now);
    if (d < bestAbs) { best = n; bestAbs = d; }
  });
  if (!best || bestAbs > timing.good) {
    if ($('ghostTap').checked) return;
    registerMiss();
    return;
  }
  hitNote(best,bestAbs);
}

function hitNote(best,bestAbs) {
  best._hit = true;
  lastJudged = Math.max(lastJudged, chart.notes.indexOf(best));
  combo++;
  hits++;
  maxCombo = Math.max(maxCombo, combo);
  health = Math.min(100, health + 1.2);
  const q = bestAbs <= timing.perfect ? 'PERFECT' : bestAbs <= timing.great ? 'GOOD' : 'BAD';
  judgments[q.toLowerCase()]++;
  score += q === 'PERFECT' ? 1000 : q === 'GOOD' ? 700 : 400;
  setFeedback(q);
  scheduleHudUpdate();
}

function botHit(note) {
  if (!botplay || note._hit || note._expired) return;
  hitNote(note,0);
}

function toggleBotplay() {
  botplay=!botplay;
  gameplayScene.botplay=botplay;
  botplayIndicator.classList.toggle('hidden',!botplay);
  setFeedback(botplay?'BOTPLAY ON':'BOTPLAY OFF');
}

function registerMiss() {
  if (inputLocked || !$('gamePage') || $('gamePage').classList.contains('hidden')) return;
  combo = 0;
  misses++;
  judgments.miss++;
  health = Math.max(0, health - 5);
  setFeedback('MISS');
  updateHud();
  if (health <= 0) beginFailureSequence();
}

function setGameplayLocked(locked) {
  inputLocked = locked;
  $('gamePage').classList.toggle('input-locked', locked);
  document.querySelectorAll('#gamePage .controls button, #start, #restart').forEach(button => { button.disabled = locked; });
  input.enabled = !locked && !$('gamePage').classList.contains('hidden') && pauseMenu.classList.contains('hidden') && loadingScreen.classList.contains('hidden');
}

function beginFailureSequence() {
  if (endingRun) return;
  endingRun = true;
  setGameplayLocked(true);
  setFeedback('FAILED');
  const started = performance.now();
  const duration = 1800;
  const initialRate = Math.max(.0625, audio.playbackRate || 1);
  const slowDown = now => {
    if (!endingRun) return;
    const progress = Math.min(1, (now - started) / duration);
    const eased = 1 - Math.pow(progress, 3);
    try { audio.playbackRate = Math.max(.0625, initialRate * eased); } catch (_) {}
    if (progress < 1) requestAnimationFrame(slowDown);
    else {
      clock.pause();
      audio.playbackRate = 1;
      showResults(true);
    }
  };
  requestAnimationFrame(slowDown);
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
  score = 0; combo = 0; maxCombo = 0; misses = 0; hits = 0; health = 100; lastJudged = -1;
  judgments={perfect:0,good:0,bad:0,miss:0};
  endingRun = false;
  setGameplayLocked(false);
  audio.playbackRate = 1;
  clock.pause();
  clock.seek(0);
  $('start').textContent = 'Start';
  $('editorPlay').textContent = '▶ Play';
  updateHud();
  timeEl.textContent = '0:00.000';
  editor.updatePlayhead(0);
  gameplayScene.resetNotes();
}

function loadSong(file) {
  if (!file) return;
  if (songUrl) URL.revokeObjectURL(songUrl);
  songUrl = URL.createObjectURL(file);
  currentAudioBlob = file;
  audio.src = songUrl;
  audio.load();
  clock.attachAudio(audio);
  reset();
  $('songStatus').textContent = `Loaded: ${file.name}`;
  $('selectedSongTitle').textContent = file.name;
  $('selectedSongMeta').textContent = `${chart.bpm} BPM · Local audio`;
  $('gameSongTitle').textContent = file.name;
  $('editorSongTitle').textContent = file.name;
}

function updateSongLabels() {
  $('selectedSongTitle').textContent = chart.title;
  $('selectedSongMeta').textContent = `${chart.bpm} BPM · ${chart.notes.filter(note => !note.auto).length} player notes · ${chart.scrollSpeed}× speed`;
  $('gameSongTitle').textContent = chart.title;
  $('editorSongTitle').textContent = chart.title;
  $('bpm').value = chart.bpm;
}

async function loadPackage(file) {
  if (!file) return;
  try {
    const loaded = await readRyokoPackage(file);
    activePackage?.revoke();
    activePackage = loaded;
    chart.load(loaded.chartData);
    clock.bpm = chart.bpm;
    audio.src = loaded.urls.audio;
    audio.load();
    clock.attachAudio(audio);
    currentAudioBlob = loaded.audioBlob;
    selectedCover = loaded.coverBlob;
    selectedPauseArt = loaded.pauseArtBlob;
    const coverImage = document.querySelector('.song-art img');
    const pauseImage = pauseMenu.querySelector('.pause-art img');
    if (loaded.urls.cover) { coverImage.src = loaded.urls.cover; coverImage.hidden = false; }
    if (loaded.urls.pauseArt) { pauseImage.src = loaded.urls.pauseArt; pauseImage.hidden = false; }
    updateSongLabels();
    reset();
    editor.render();
    $('songStatus').textContent = `Package loaded: ${file.name}`;
  } catch (error) {
    window.alert(`Could not load package: ${error.message}`);
  }
}

async function exportPackage() {
  try {
    const audioBlob = currentAudioBlob || await fetch(audio.src).then(response => {
      if (!response.ok) throw new Error('Could not read the current audio.');
      return response.blob();
    });
    const blob = await createRyokoPackage({ chart, audio:audioBlob, cover:selectedCover, pauseArt:selectedPauseArt, title:chart.title, artist:chart.artist });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `${chart.title.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'') || 'song'}.ryoko`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 0);
  } catch (error) {
    window.alert(`Could not export package: ${error.message}`);
  }
}

function createRecorder(stream) {
  const formats=['video/mp4;codecs=avc1.42E01E,mp4a.40.2','video/webm;codecs=vp9,opus','video/webm;codecs=vp8,opus','video/webm'];
  for (const mimeType of formats) {
    if (!MediaRecorder.isTypeSupported(mimeType)) continue;
    try { return new MediaRecorder(stream,{mimeType,videoBitsPerSecond:4_000_000,audioBitsPerSecond:160_000}); } catch (_) {}
  }
  return new MediaRecorder(stream,{videoBitsPerSecond:4_000_000,audioBitsPerSecond:160_000});
}

async function startChartRender() {
  if (renderingChart) return;
  if (!window.MediaRecorder || !HTMLCanvasElement.prototype.captureStream) {
    window.alert('This browser cannot record the gameplay canvas. Try a current Chromium or Firefox browser.');
    return;
  }
  renderingChart=true;
  document.body.classList.add('rendering-chart');
  renderPreviousBotplay=botplay;
  reset();
  botplay=true; gameplayScene.botplay=true; botplayIndicator.classList.remove('hidden');
  setGameplayLocked(true);
  showPage('game');
  $('renderStatus').classList.remove('hidden');
  await Promise.all([waitForGameplay(),waitForAudio()]);
  if (!renderingChart) return;
  phaserGame.scale.resize(854,480);
  gameplayScene.layout();
  gameplayScene.setRenderWatermark(true);
  try {
    if (!recordingAudioContext) {
      recordingAudioContext=new AudioContext();
      recordingAudioSource=recordingAudioContext.createMediaElementSource(audio);
      recordingAudioDestination=recordingAudioContext.createMediaStreamDestination();
      recordingAudioSource.connect(recordingAudioContext.destination);
      recordingAudioSource.connect(recordingAudioDestination);
    }
    await recordingAudioContext.resume();
    const stream=phaserGame.canvas.captureStream(30);
    for (const track of recordingAudioDestination.stream.getAudioTracks()) stream.addTrack(track);
    recordingChunks=[];
    chartRecorder=createRecorder(stream);
    chartRecorder.ondataavailable=event => { if (event.data.size) recordingChunks.push(event.data); };
    chartRecorder.onerror=event => { console.error(event.error); finishChartRender(false); };
    chartRecorder.onstop=() => finishChartRender(true);
    chartRecorder.start(1000);
    clock.seek(0);
    await clock.start();
  } catch (error) {
    console.error(error);
    window.alert(`Could not start chart render: ${error.message}`);
    finishChartRender(false);
  }
}

function stopChartRender() {
  if (chartRecorder?.state && chartRecorder.state!=='inactive') chartRecorder.stop();
  else finishChartRender(false);
}

function finishChartRender(save) {
  if (!renderingChart) return;
  const mimeType=chartRecorder?.mimeType||'video/webm';
  if (save && recordingChunks.length) {
    const blob=new Blob(recordingChunks,{type:mimeType});
    const link=document.createElement('a');
    link.href=URL.createObjectURL(blob);
    link.download=`${chart.title.toLowerCase().replace(/[^a-z0-9]+/g,'-')||'chart'}-render.${mimeType.includes('mp4')?'mp4':'webm'}`;
    link.click();
    setTimeout(()=>URL.revokeObjectURL(link.href),0);
  }
  chartRecorder=null; recordingChunks=[]; renderingChart=false;
  document.body.classList.remove('rendering-chart');
  gameplayScene.setRenderWatermark(false);
  $('renderStatus').classList.add('hidden');
  botplay=renderPreviousBotplay; gameplayScene.botplay=botplay; botplayIndicator.classList.toggle('hidden',!botplay);
  setGameplayLocked(false);
  requestAnimationFrame(resizeGameplay);
}

async function launchGame() {
  const token = ++launchToken;
  reset();
  setGameplayLocked(true);
  audio.muted = true;
  const unlock = audio.play()
    .then(() => { audio.pause(); audio.currentTime = 0; audio.muted = false; })
    .catch(() => { audio.muted = false; });
  showPage('game');
  loadingScreen.classList.remove('hidden', 'countdown');
  $('loadingCount').textContent = '';
  $('loadingMessage').textContent = 'LOADING CHART';
  await Promise.all([unlock, waitForGameplay(), waitForAudio()]);
  if (token !== launchToken) return;
  if (!await runCountdown(token)) return;
  await clock.start();
  setGameplayLocked(false);
  $('start').textContent = 'Pause';
}

async function runCountdown(token) {
  loadingScreen.classList.remove('hidden');
  loadingScreen.classList.add('countdown');
  for (const value of ['3', '2', '1', 'GO!']) {
    $('loadingCount').textContent = value;
    $('loadingMessage').textContent = value === 'GO!' ? chart.title.toUpperCase() : 'GET READY';
    await new Promise(resolve => setTimeout(resolve, value === 'GO!' ? 450 : 700));
    if (token !== launchToken) return false;
  }
  loadingScreen.classList.add('hidden');
  return true;
}

function openPause() {
  if (!clock.running || $('gamePage').classList.contains('hidden')) return;
  clock.pause();
  input.enabled = false;
  pauseMenu.classList.remove('hidden');
  $('start').textContent = 'Resume';
}

async function resumeGame() {
  const token=launchToken;
  pauseMenu.classList.add('hidden');
  setGameplayLocked(true);
  if (!await runCountdown(token)) return;
  await clock.start();
  setGameplayLocked(false);
  $('start').textContent = 'Pause';
}

function showResults(failed = false) {
  if ($('resultsPage') && !$('resultsPage').classList.contains('hidden')) return;
  clock.pause();
  pauseMenu.classList.add('hidden');
  const accuracy = hits + misses ? hits / (hits + misses) * 100 : 0;
  const grade = failed ? 'F' : accuracy >= 98 ? 'S' : accuracy >= 90 ? 'A' : accuracy >= 80 ? 'B' : accuracy >= 70 ? 'C' : 'D';
  $('resultLabel').textContent = failed ? 'RUN FAILED' : 'SONG COMPLETE';
  $('resultTitle').textContent = chart.title;
  $('resultGrade').textContent = grade;
  $('finalScore').textContent = String(score).padStart(6, '0');
  $('finalAccuracy').textContent = `${accuracy.toFixed(2)}%`;
  $('finalMaxCombo').textContent = maxCombo;
  $('finalMisses').textContent = misses;
  showPage('results');
}

$('songInput').onchange = e => loadSong(e.target.files[0]);
$('editorSongInput').onchange = e => loadSong(e.target.files[0]);
$('packageInput').onchange = e => { loadPackage(e.target.files[0]); e.target.value=''; };
$('coverInput').onchange = e => {
  selectedCover = e.target.files[0] || null;
  if (selectedCover) { const image=document.querySelector('.song-art img'); image.src=URL.createObjectURL(selectedCover); image.hidden=false; }
};
$('pauseArtInput').onchange = e => {
  selectedPauseArt = e.target.files[0] || null;
  if (selectedPauseArt) { const image=pauseMenu.querySelector('.pause-art img'); image.src=URL.createObjectURL(selectedPauseArt); image.hidden=false; }
};
$('exportPackage').onclick = exportPackage;
$('start').onclick = () => clock.running ? openPause() : togglePlayback($('start'));
$('restart').onclick = launchGame;
$('resumeGame').onclick = resumeGame;
$('restartPaused').onclick = launchGame;
$('quitPaused').onclick = () => showPage('songs');
$('retrySong').onclick = launchGame;

let capturingBinding=null;
const keybindSection=document.createElement('section');
keybindSection.className='keybind-settings';
keybindSection.innerHTML='<div class="setting-title"><strong>Gameplay keybinds</strong><small>Select a control, then press a key</small></div><div class="keybind-grid"></div><button id="resetKeybinds">Reset keybinds</button>';
document.querySelector('.settings-panel').insertBefore(keybindSection,$('resetSettings'));

function readableKey(code) {
  return code.replace(/^Key/,'').replace(/^Digit/,'').replace('Arrow','').replace('Space','Spacebar');
}

function renderKeybinds() {
  const grid=keybindSection.querySelector('.keybind-grid');
  grid.innerHTML='';
  for (const direction of ['left','down','up','right']) {
    const button=document.createElement('button');
    button.dataset.bind=direction;
    button.innerHTML=`<span>${direction.toUpperCase()}</span><kbd>${capturingBinding===direction?'PRESS A KEY':input.bindings[direction].map(readableKey).join(' / ')}</kbd>`;
    button.onclick=() => { capturingBinding=direction; input.enabled=false; renderKeybinds(); };
    grid.appendChild(button);
  }
}

function saveBindings() { localStorage.setItem('ryoko-keybinds',JSON.stringify(input.bindings)); }
keybindSection.querySelector('#resetKeybinds').onclick=() => { input.resetBindings(); saveBindings(); capturingBinding=null; renderKeybinds(); };
renderKeybinds();

const defaultAppearance={shape:'◆',playerColor:'#ffffff',noteColor:'#8f7cff',trail:true,customImage:null,customImageName:''};
let playerAppearance={...defaultAppearance};
try { playerAppearance={...playerAppearance,...JSON.parse(localStorage.getItem('ryoko-appearance'))}; } catch (_) {}
const appearanceSection=document.createElement('section');
appearanceSection.className='appearance-settings';
appearanceSection.innerHTML='<div class="setting-title"><strong>Player appearance</strong><small>Applied immediately</small></div><div class="shape-picker" aria-label="Player shape"></div><div class="custom-player-row"><label class="file-button">Upload PNG or SVG <input id="customPlayerInput" type="file" accept="image/png,image/svg+xml,.png,.svg" hidden></label><span id="customPlayerName">Built-in shape</span><button id="clearCustomPlayer" type="button">Use built-in</button></div><div class="color-settings"><label>Player color <input id="playerColor" type="color"></label><label>Note color <input id="noteColor" type="color"></label></div><label class="toggle-row"><span>Player trail</span><input id="playerTrail" type="checkbox"></label>';
document.querySelector('.settings-panel').insertBefore(appearanceSection,keybindSection);
const shapes=['◆','●','■','★','✦'];
function applyAppearance() {
  gameplayScene.setAppearance(playerAppearance);
  try { localStorage.setItem('ryoko-appearance',JSON.stringify(playerAppearance)); } catch (_) {}
  appearanceSection.querySelectorAll('[data-shape]').forEach(button => button.classList.toggle('selected',button.dataset.shape===playerAppearance.shape));
  $('customPlayerName').textContent=playerAppearance.customImageName||'Built-in shape';
  $('clearCustomPlayer').disabled=!playerAppearance.customImage;
}
for (const shape of shapes) {
  const button=document.createElement('button'); button.dataset.shape=shape; button.textContent=shape; button.setAttribute('aria-label',`Use ${shape} player`);
  button.onclick=() => { playerAppearance.shape=shape; playerAppearance.customImage=null; playerAppearance.customImageName=''; applyAppearance(); };
  appearanceSection.querySelector('.shape-picker').appendChild(button);
}
$('playerColor').value=playerAppearance.playerColor;
$('noteColor').value=playerAppearance.noteColor;
$('playerTrail').checked=playerAppearance.trail;
$('playerColor').oninput=event => { playerAppearance.playerColor=event.target.value; applyAppearance(); };
$('noteColor').oninput=event => { playerAppearance.noteColor=event.target.value; applyAppearance(); };
$('playerTrail').oninput=event => { playerAppearance.trail=event.target.checked; applyAppearance(); };
$('customPlayerInput').onchange=event => {
  const file=event.target.files[0]; event.target.value='';
  if (!file) return;
  const validType=['image/png','image/svg+xml'].includes(file.type)||/\.(png|svg)$/i.test(file.name);
  if (!validType) { window.alert('Choose a PNG or SVG image.'); return; }
  if (file.size>2*1024*1024) { window.alert('Custom player images must be 2 MB or smaller.'); return; }
  const reader=new FileReader();
  reader.onload=() => { playerAppearance.customImage=reader.result; playerAppearance.customImageName=file.name; applyAppearance(); };
  reader.onerror=() => window.alert('Could not read that image.');
  reader.readAsDataURL(file);
};
$('clearCustomPlayer').onclick=() => { playerAppearance.customImage=null; playerAppearance.customImageName=''; applyAppearance(); };
applyAppearance();

const pages = { title:'titlePage', songs:'songsPage', game:'gamePage', editor:'editorPage', settings:'settingsPage', credits:'creditsPage', results:'resultsPage' };
const titles = { title:'TITLE', songs:'SONG SELECT', game:'GAMEPLAY', editor:'CHART EDITOR', settings:'SETTINGS', credits:'CREDITS', results:'RESULTS' };
const backTargets = { songs:'title', editor:'title', settings:'title', credits:'title', results:'songs' };
let currentPage='title';
function showPage(name) {
  if (!pages[name]) return;
  document.querySelectorAll('.page').forEach(page => page.classList.add('hidden'));
  $(pages[name]).classList.remove('hidden');
  currentPage=name;
  $('pageTitle').textContent = titles[name];
  if (name !== 'game') { launchToken++; loadingScreen.classList.add('hidden'); }
  if (name !== 'game') pauseMenu.classList.add('hidden');
  if (name !== 'game' && name !== 'results' && endingRun) {
    endingRun = false;
    audio.playbackRate = 1;
    setGameplayLocked(false);
  }
  if (name !== 'game' && name !== 'editor' && clock.running) clock.pause();
  if (!clock.running) { $('start').textContent = clock.current > 0 ? 'Resume' : 'Start'; $('editorPlay').textContent = '▶ Play'; }
  if (name === 'editor') requestAnimationFrame(() => { editor.render(); editor.updatePlayhead(clock.current); });
  if (name === 'game') requestAnimationFrame(ensureGameplay);
  input.enabled=name==='game'&&!inputLocked&&pauseMenu.classList.contains('hidden')&&loadingScreen.classList.contains('hidden');
  requestAnimationFrame(() => focusFirstControl(name));
}

document.querySelectorAll('[data-page]').forEach(button => button.onclick = () => showPage(button.dataset.page));
$('playSelected').onclick = launchGame;
$('testChart').onclick = launchGame;

let resizeFrame=0;
window.addEventListener('resize', () => {
  cancelAnimationFrame(resizeFrame);
  resizeFrame=requestAnimationFrame(() => {
    if (!$('editorPage').classList.contains('hidden')) editor.render();
    resizeGameplay();
  });
});
new ResizeObserver(resizeGameplay).observe($('arena'));

document.querySelectorAll('.file-button').forEach(label => { label.tabIndex=0; label.setAttribute('role','button'); });
function focusableControls() {
  const page=$(pages[currentPage]);
  return [...page.querySelectorAll('button:not(:disabled),.file-button,input:not([type="file"]):not(:disabled),select:not(:disabled)')]
    .filter(element => element.getClientRects().length && !element.hidden);
}
function focusFirstControl(pageName) {
  if (pageName==='game') return;
  focusableControls()[0]?.focus({preventScroll:true});
}
function moveUiFocus(code) {
  const controls=focusableControls();
  if (!controls.length) return;
  const active=document.activeElement;
  if (!controls.includes(active)) { controls[0].focus(); return; }
  const origin=active.getBoundingClientRect(),ox=origin.left+origin.width/2,oy=origin.top+origin.height/2;
  const direction={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]}[code];
  let best=null,bestScore=Infinity;
  for (const candidate of controls) {
    if (candidate===active) continue;
    const rect=candidate.getBoundingClientRect(),dx=rect.left+rect.width/2-ox,dy=rect.top+rect.height/2-oy;
    const forward=dx*direction[0]+dy*direction[1];
    if (forward<=4) continue;
    const sideways=Math.abs(dx*direction[1]-dy*direction[0]);
    const score=forward+sideways*2.5;
    if (score<bestScore) { best=candidate; bestScore=score; }
  }
  best?.focus({preventScroll:false});
}

input.onDirection = direction => { if (!inputLocked && !$('gamePage').classList.contains('hidden')) gameplayScene.pulse(direction); };
window.addEventListener('keydown', e => {
  if (capturingBinding) {
    e.preventDefault();
    if (e.code==='Escape') capturingBinding=null;
    else if (e.code==='KeyL'||e.code==='Backquote') window.alert('That key is reserved by RYŌKO.');
    else { input.setBinding(capturingBinding,e.code); capturingBinding=null; saveBindings(); }
    renderKeybinds();
    return;
  }
  if (e.code==='Backquote') { e.preventDefault(); startChartRender(); return; }
  if (renderingChart) { e.preventDefault(); return; }
  if (endingRun && !$('gamePage').classList.contains('hidden')) { e.preventDefault(); return; }
  if (e.code==='KeyL' && !$('gamePage').classList.contains('hidden')) {
    e.preventDefault(); toggleBotplay(); return;
  }
  if (e.code === 'Escape' && !$('gamePage').classList.contains('hidden')) {
    e.preventDefault();
    if (pauseMenu.classList.contains('hidden')) openPause(); else resumeGame();
    return;
  }
  if (e.code === 'Escape' && currentPage!=='title') {
    e.preventDefault();
    showPage(backTargets[currentPage]||'title');
    return;
  }
  if (['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.code) && currentPage!=='game' && !document.activeElement.matches?.('input[type="range"],select')) {
    e.preventDefault(); moveUiFocus(e.code); return;
  }
  if ((e.code==='Enter'||e.code==='Space') && document.activeElement.classList?.contains('file-button')) {
    e.preventDefault(); document.activeElement.click(); return;
  }
  if (e.code === 'Space' && document.activeElement===document.body) {
    const editorVisible = !$('editorPage').classList.contains('hidden');
    const gameVisible = !$('gamePage').classList.contains('hidden');
    if (editorVisible || gameVisible) {
      e.preventDefault();
      if (editorVisible) $('editorPlay').click();
      else if (!pauseMenu.classList.contains('hidden')) resumeGame();
      else $('start').click();
    }
  }
});

audio.addEventListener('ended', () => {
  clock.pause();
  if (endingRun) return;
  if (renderingChart) stopChartRender();
  $('start').textContent = 'Start';
  $('editorPlay').textContent = '▶ Play';
  if (!$('gamePage').classList.contains('hidden')) showResults(false);
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
const volume = $('masterVolume'), approach = $('approachTime'), reducedMotion = $('reducedMotion'), ghostTap = $('ghostTap');
function applySettings() {
  audio.volume = Number(volume.value) / 100;
  gameplayScene.approachMs = Number(approach.value);
  $('volumeValue').textContent = `${volume.value}%`;
  const effectiveApproach = Number(approach.value) / Math.max(.1, chart.scrollSpeed || 1);
  $('approachValue').textContent = `${(effectiveApproach/1000).toFixed(2)}s (${chart.scrollSpeed}× chart)`;
  document.body.classList.toggle('reduced-motion', reducedMotion.checked);
}
[volume, approach, reducedMotion, ghostTap].forEach(control => control.oninput = applySettings);
$('resetSettings').onclick = () => {
  volume.value=100; approach.value=1800; ghostTap.checked=true; reducedMotion.checked=false;
  playerAppearance={...defaultAppearance};
  $('playerColor').value=playerAppearance.playerColor; $('noteColor').value=playerAppearance.noteColor; $('playerTrail').checked=playerAppearance.trail;
  applyAppearance(); applySettings();
};
applySettings();
updateHud();
loop();
requestAnimationFrame(() => focusFirstControl('title'));
