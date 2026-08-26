import { RhythmClock } from './rhythm.js';
import { InputManager } from './input.js';
import { Chart } from './chart.js';
import { ChartEditor } from './editor.js';
import Phaser from 'phaser';
import { GameplayScene } from './scenes/gameplay-scene.js';
import { readRyokoPackage, createRyokoPackage } from './song-package.js';
import { ModchartRuntime } from './modchart.js';

const chart = new Chart();
chart.load({version:1,song:{title:'Select a Song',artist:'Unknown',bpm:120,offset:0,scrollSpeed:1},notes:[]});

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
let activeModchartSource=null;
let currentSongTitle=chart.title;
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

clock.attachAudio(audio);
$('selectedSongTitle').textContent = chart.title;
$('selectedSongMeta').textContent = `${chart.bpm} BPM · ${chart.notes.filter(note => !note.auto).length} player notes · ${chart.scrollSpeed}× speed`;
$('gameSongTitle').textContent = chart.title;
$('editorSongTitle').textContent = chart.title;
$('songStatus').textContent = 'Scanning ./charts for .ryoko packages…';
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
const modchart=new ModchartRuntime(command=>gameplayScene.applyModchartCommand(command),error=>console.error(error));
gameplayScene.modchart=modchart;
gameplayScene.modchartState=()=>({time:clock.current,beat:gameplayScene.lastBeat,bpm:chart.bpmAt(clock.current),combo,health,botplay});
modchart.load(activeModchartSource,gameplayScene.modchartState());
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
  gameplayScene?.showHit(best,q,false);
  modchart.hook('onHit',gameplayScene.modchartState(),{direction:best.direction,type:best.type,judgment:q,error:bestAbs,time:best.time});
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

function registerMiss(note) {
  if (inputLocked || !$('gamePage') || $('gamePage').classList.contains('hidden')) return;
  combo = 0;
  misses++;
  judgments.miss++;
  health = Math.max(0, health - 5);
  setFeedback('MISS');
  modchart.hook('onMiss',gameplayScene.modchartState(),note?{direction:note.direction,type:note.type,time:note.time}:null);
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
  currentSongTitle=file.name.replace(/\.[^.]+$/,'');
  audio.src = songUrl;
  audio.load();
  clock.attachAudio(audio);
  reset();
  $('songStatus').textContent = `Loaded: ${file.name}`;
  $('selectedSongTitle').textContent = currentSongTitle;
  $('selectedSongMeta').textContent = `${chart.bpm} BPM · Local audio`;
  $('gameSongTitle').textContent = currentSongTitle;
  $('editorSongTitle').textContent = currentSongTitle;
}

function updateSongLabels() {
  $('selectedSongTitle').textContent = currentSongTitle;
  $('selectedSongMeta').textContent = `${chart.bpm} BPM · ${chart.notes.filter(note => !note.auto).length} player notes · ${chart.scrollSpeed}× speed`;
  $('gameSongTitle').textContent = currentSongTitle;
  $('editorSongTitle').textContent = currentSongTitle;
  $('bpm').value = chart.bpm;
}

async function loadPackage(file,displayName=file?.name||'package.ryoko',{trustedModchart=false,chartId}={}) {
  if (!file) return;
  try {
    const loaded = await readRyokoPackage(file,{chartId});
    activePackage?.revoke();
    activePackage = loaded;
    chart.load(loaded.chartData);
    currentSongTitle=loaded.manifest.song?.title||chart.title;
    clock.bpm = chart.bpm;
    audio.src = loaded.urls.audio;
    audio.load();
    clock.attachAudio(audio);
    currentAudioBlob = loaded.audioBlob;
    selectedCover = loaded.coverBlob;
    selectedPauseArt = loaded.pauseArtBlob;
    activeModchartSource=null;
    if (loaded.modchartSource && (trustedModchart||window.confirm(`This package contains JavaScript modchart code. Run it?\n\nOnly allow modcharts from authors you trust.`))) activeModchartSource=loaded.modchartSource;
    modchart.load(activeModchartSource,gameplayScene.modchartState());
    const coverImage = document.querySelector('.song-art img');
    const pauseImage = pauseMenu.querySelector('.pause-art img');
    if (loaded.urls.cover) { coverImage.src = loaded.urls.cover; coverImage.hidden = false; }
    if (loaded.urls.pauseArt) { pauseImage.src = loaded.urls.pauseArt; pauseImage.hidden = false; }
    updateSongLabels();
    reset();
    editor.render();
    $('songStatus').textContent = `Package loaded: ${displayName}`;
    return true;
  } catch (error) {
    window.alert(`Could not load package: ${error.message}`);
    return false;
  }
}

async function scanChartPackages() {
  const browser=document.querySelector('.song-browser');
  const localSong=browser?.querySelector('.local-song');
  if (!browser||!localSong) return;
  try {
    const catalogUrl=new URL('charts/catalog.json',document.baseURI);
    const response=await fetch(catalogUrl,{cache:'no-store'});
    if (!response.ok) return;
    const catalog=await response.json();
    let discovered=0;
    for (const entry of catalog.packages||[]) {
      if (!entry.path||entry.size>300*1024*1024) continue;
      const card=document.createElement('article');
      card.className='song-card package-song ui-spawn';
      const art=document.createElement('div');
      art.className='song-art'; art.textContent='凌';
      const details=document.createElement('div');
      const title=document.createElement('strong'); title.textContent=entry.title||entry.path;
      const meta=document.createElement('p');
      const difficulties=entry.difficulties?.length?entry.difficulties:[{id:entry.defaultChart||'default',name:entry.difficulty||'Default',modchart:entry.modchart}];
      const difficultySelect=document.createElement('select');
      difficultySelect.className='difficulty-select';
      difficultySelect.setAttribute('aria-label',`Difficulty for ${entry.title||entry.path}`);
      for (const difficulty of difficulties) {
        const option=document.createElement('option');
        option.value=difficulty.id; option.textContent=difficulty.name;
        option.selected=difficulty.id===entry.defaultChart;
        difficultySelect.appendChild(option);
      }
      const updateMeta=() => {
        const difficulty=difficulties.find(item=>item.id===difficultySelect.value)||difficulties[0];
        meta.textContent=`${entry.artist||'Unknown'} · ${entry.bpm||120} BPM · ${difficulty.name}${difficulty.modchart?' · MODCHART':''}`;
      };
      difficultySelect.onchange=updateMeta;
      updateMeta();
      details.append(title,meta);
      const button=document.createElement('button');
      button.className='primary'; button.textContent='Play';
      button.onclick=async () => {
        button.disabled=true; button.textContent='Loading…';
        $('songStatus').textContent=`Loading: ${entry.title||entry.path}`;
        try {
          const packageUrl=new URL(entry.path,catalogUrl);
          const packageResponse=await fetch(packageUrl);
          if (!packageResponse.ok) throw new Error(`HTTP ${packageResponse.status}`);
          const blob=await packageResponse.blob();
          if (await loadPackage(blob,entry.path,{trustedModchart:true,chartId:difficultySelect.value})) await launchGame();
        } catch (error) { window.alert(`Could not load ${entry.path}: ${error.message}`); }
        finally { button.disabled=false; button.textContent='Play'; }
      };
      const actions=document.createElement('div');
      actions.className='song-actions'; actions.append(difficultySelect,button);
      card.append(art,details,actions);
      browser.insertBefore(card,localSong);
      discovered++;
    }
    $('songStatus').textContent=discovered?`${discovered} package${discovered===1?'':'s'} found in ./charts`:'No .ryoko packages found in ./charts';
  } catch (error) { console.warn('Could not scan ./charts packages.',error); }
}

async function exportPackage() {
  try {
    const audioBlob = currentAudioBlob || await fetch(audio.src).then(response => {
      if (!response.ok) throw new Error('Could not read the current audio.');
      return response.blob();
    });
    const blob = await createRyokoPackage({ chart, audio:audioBlob, cover:selectedCover, pauseArt:selectedPauseArt, modchartSource:activeModchartSource, title:chart.title, artist:chart.artist });
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
  modchart.hook('onStart',gameplayScene.modchartState());
  await clock.start();
  setGameplayLocked(false);
  $('start').textContent = 'Pause';
}

async function runCountdown(token) {
  loadingScreen.classList.remove('hidden');
  loadingScreen.classList.add('countdown');
  for (const value of ['3', '2', '1', 'GO!']) {
    $('loadingCount').textContent = value;
    $('loadingMessage').textContent = value === 'GO!' ? currentSongTitle.toUpperCase() : 'GET READY';
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
  $('resultTitle').textContent = currentSongTitle;
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
scanChartPackages();
document.addEventListener('ryoko:chart-loaded',event => { currentSongTitle=event.detail?.title||chart.title; updateSongLabels(); });
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

const defaultNoteColors={left:'#ff68ae',down:'#55c8ff',up:'#55e38e',right:'#ffd45c'};
const defaultAppearance={shape:'◆',playerColor:'#ffffff',noteColors:{...defaultNoteColors},trail:true,customImage:null,customImageName:''};
let playerAppearance={...defaultAppearance,noteColors:{...defaultNoteColors}};
try {
  const savedAppearance=JSON.parse(localStorage.getItem('ryoko-appearance'));
  if (savedAppearance) {
    const legacyColor=savedAppearance.noteColor;
    playerAppearance={...playerAppearance,...savedAppearance,noteColors:{...defaultNoteColors,...(legacyColor?Object.fromEntries(['left','down','up','right'].map(direction=>[direction,legacyColor])):{}),...(savedAppearance.noteColors||{})}};
    delete playerAppearance.noteColor;
  }
} catch (_) {}
const appearanceSection=document.createElement('section');
appearanceSection.className='appearance-settings';
appearanceSection.innerHTML='<div class="setting-title"><strong>Player appearance</strong><small>Applied immediately</small></div><div class="shape-picker" aria-label="Player shape"></div><div class="custom-player-row"><label class="file-button">Upload PNG or SVG <input id="customPlayerInput" type="file" accept="image/png,image/svg+xml,.png,.svg" hidden></label><span id="customPlayerName">Built-in shape</span><button id="clearCustomPlayer" type="button">Use built-in</button></div><div class="color-settings"><label>Player <input id="playerColor" type="color"></label><label>Left note <input id="leftNoteColor" type="color"></label><label>Down note <input id="downNoteColor" type="color"></label><label>Up note <input id="upNoteColor" type="color"></label><label>Right note <input id="rightNoteColor" type="color"></label></div><label class="toggle-row"><span>Player trail</span><input id="playerTrail" type="checkbox"></label>';
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
for (const direction of ['left','down','up','right']) $(''+direction+'NoteColor').value=playerAppearance.noteColors[direction];
$('playerTrail').checked=playerAppearance.trail;
$('playerColor').oninput=event => { playerAppearance.playerColor=event.target.value; applyAppearance(); };
for (const direction of ['left','down','up','right']) $(''+direction+'NoteColor').oninput=event => { playerAppearance.noteColors[direction]=event.target.value; applyAppearance(); };
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
const pageAnimations=new WeakMap();
function animatePage(page) {
  if (document.body.classList.contains('reduced-motion')||typeof page.animate!=='function') return;
  for (const animation of pageAnimations.get(page)||[]) animation.cancel();
  const animations=[];
  animations.push(page.animate([
    {opacity:0,filter:'blur(4px)'},
    {opacity:1,filter:'blur(0)'}
  ],{duration:260,easing:'cubic-bezier(.16,.84,.32,1)'}));
  const items=page.querySelectorAll('.page-head,.hero>* ,.song-card:not(.hidden),.local-song,.settings-panel>* ,.credits-panel>* ,.editor-head,.section-nav,.fnf-timeline,.editor-actions>* ,.results-card>*:not(.result-grade)');
  items.forEach((element,index)=>animations.push(element.animate([
    {opacity:0,transform:'translateY(18px) scale(.985)'},
    {opacity:1,transform:'none'}
  ],{duration:360,delay:Math.min(index,10)*32,easing:'cubic-bezier(.16,.84,.32,1)',fill:'backwards'})));
  pageAnimations.set(page,animations);
}
function showPage(name) {
  if (!pages[name]) return;
  document.querySelectorAll('.page').forEach(page => page.classList.add('hidden'));
  const incoming=$(pages[name]);
  incoming.classList.remove('hidden');
  animatePage(incoming);
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
document.addEventListener('pointerdown',event=>{
  const control=event.target.closest('button,.file-button,.song-card');
  if (!control||document.body.classList.contains('reduced-motion')) return;
  control.classList.remove('ui-press'); void control.offsetWidth; control.classList.add('ui-press');
  setTimeout(()=>control.classList.remove('ui-press'),280);
},{passive:true});
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
audio.addEventListener('error',() => {
  if (!currentAudioBlob && !activePackage) {
    clock.attachAudio(null);
    $('songStatus').textContent='Example audio excluded — using silent clock';
  }
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
  playerAppearance={...defaultAppearance,noteColors:{...defaultNoteColors}};
  $('playerColor').value=playerAppearance.playerColor;
  for (const direction of ['left','down','up','right']) $(''+direction+'NoteColor').value=playerAppearance.noteColors[direction];
  $('playerTrail').checked=playerAppearance.trail;
  applyAppearance(); applySettings();
};
applySettings();
updateHud();
loop();
requestAnimationFrame(() => focusFirstControl('title'));
