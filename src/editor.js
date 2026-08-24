export class ChartEditor {
  constructor(chart, clock) {
    this.chart = chart; this.clock = clock; this.selected = null;
    this.timeline = document.getElementById('timeline');
    this.grid = document.getElementById('grid');
    this.playhead = document.getElementById('playhead');
    this.pxPerMs = 0.1;
    this.dragged = false;
  }

  get snapMs() { return (60000 / this.chart.bpm) / Number(document.getElementById('snap')?.value || 4); }
  quantize(ms) { return Math.max(0, Math.round(ms / this.snapMs) * this.snapMs); }
  laneY(direction) { return ({ up:.125, right:.375, down:.625, left:.875 }[direction] || .5) * this.timeline.clientHeight; }
  directionAt(clientY) {
    const y = clientY - this.timeline.getBoundingClientRect().top + this.timeline.scrollTop;
    return ['up','right','down','left'][Math.max(0, Math.min(3, Math.floor(y / (this.timeline.clientHeight / 4))))];
  }
  timeAt(clientX) {
    const rect = this.timeline.getBoundingClientRect();
    return Math.max(0, (clientX - rect.left + this.timeline.scrollLeft) / this.pxPerMs);
  }

  render() {
    this.timeline.querySelectorAll('.note').forEach(n => n.remove());
    const audioDuration = this.clock.audio?.duration * 1000;
    let maxTime = Number.isFinite(audioDuration) ? Math.max(10000, audioDuration) : 10000;
    for (const note of this.chart.notes) {
      const noteEnd = Number(note.time) + Math.max(2000, Number(note.duration) || 0);
      if (Number.isFinite(noteEnd) && noteEnd > maxTime) maxTime = noteEnd;
    }
    const contentWidth = Math.max(this.timeline.clientWidth, maxTime * this.pxPerMs);
    this.grid.style.width = `${contentWidth}px`;
    this.grid.style.backgroundSize = `${this.snapMs * this.pxPerMs}px 100%, 100% 100%`;
    for (const note of this.chart.notes) {
      const el = document.createElement('div');
      el.className = `note${note.auto ? ' auto' : ''}${note === this.selected ? ' selected' : ''}`;
      el.dataset.type = note.type;
      el.textContent = ({up:'↑',right:'→',down:'↓',left:'←'})[note.direction] || '◆';
      el.style.left = `${note.time * this.pxPerMs}px`;
      el.style.top = `${this.laneY(note.direction)}px`;
      el.addEventListener('pointerdown', e => this.startDrag(e, note, el));
      this.timeline.appendChild(el);
    }
  }

  select(note) { this.selected = note; this.render(); }

  startDrag(event, note, el) {
    event.preventDefault(); event.stopPropagation();
    this.selected = note; this.dragged = false; el.classList.add('selected'); el.setPointerCapture(event.pointerId);
    const move = e => {
      this.dragged = true;
      note.time = Math.round(this.quantize(this.timeAt(e.clientX)));
      note.direction = this.directionAt(e.clientY);
      el.style.left = `${note.time * this.pxPerMs}px`; el.style.top = `${this.laneY(note.direction)}px`; el.textContent = ({up:'↑',right:'→',down:'↓',left:'←'})[note.direction];
    };
    const up = () => { el.removeEventListener('pointermove', move); this.chart.sort(); this.render(); };
    el.addEventListener('pointermove', move); el.addEventListener('pointerup', up, { once:true }); el.addEventListener('pointercancel', up, { once:true });
  }

  updatePlayhead(ms) {
    this.playhead.style.left = `${ms * this.pxPerMs}px`;
    document.getElementById('editorTime').textContent = `${Math.floor(ms/60000)}:${((ms%60000)/1000).toFixed(3).padStart(6,'0')}`;
    const target = ms * this.pxPerMs - this.timeline.clientWidth * .35;
    if (this.clock.running && (target < this.timeline.scrollLeft || target > this.timeline.scrollLeft + this.timeline.clientWidth * .6)) this.timeline.scrollLeft = Math.max(0, target);
  }

  addAt(ms, direction = document.getElementById('direction').value) {
    const type = document.getElementById('noteType').value;
    const note = { time:Math.round(this.quantize(ms)), type, direction };
    if (type === 'hold') note.duration = Math.round(this.snapMs * 2);
    this.chart.notes.push(note); this.chart.sort(); this.selected = note; this.render();
  }

  bindUI() {
    document.getElementById('bpm').onchange = e => { this.chart.bpm = Number(e.target.value) || 120; this.clock.bpm = this.chart.bpm; this.render(); };
    document.getElementById('snap').onchange = () => this.render();
    document.getElementById('zoom').oninput = e => { const center = (this.timeline.scrollLeft + this.timeline.clientWidth/2) / this.pxPerMs; this.pxPerMs = Number(e.target.value)/1000; this.render(); this.timeline.scrollLeft = center*this.pxPerMs-this.timeline.clientWidth/2; this.updatePlayhead(this.clock.current); };
    document.getElementById('addNote').onclick = () => this.addAt(this.clock.current);
    document.getElementById('deleteNote').onclick = () => this.deleteSelected();
    this.timeline.onclick = e => { if (!e.target.closest('.note')) { this.clock.seek(this.timeAt(e.clientX)); this.updatePlayhead(this.clock.current); } };
    this.timeline.ondblclick = e => { if (!e.target.closest('.note')) this.addAt(this.timeAt(e.clientX), this.directionAt(e.clientY)); };
    document.getElementById('editorPlay').onclick = async () => { if (this.clock.running) { this.clock.pause(); document.getElementById('editorPlay').textContent='▶ Play'; } else { await this.clock.start(); document.getElementById('editorPlay').textContent='Ⅱ Pause'; } };
    document.getElementById('exportChart').onclick = () => { const a=document.createElement('a'); a.href=URL.createObjectURL(new Blob([this.chart.toJSON()],{type:'application/json'})); a.download='ryoko-chart.json'; a.click(); setTimeout(()=>URL.revokeObjectURL(a.href),0); };
    document.getElementById('importChart').onclick = () => document.getElementById('fileInput').click();
    document.getElementById('fileInput').onchange = async e => {
      const f=e.target.files[0]; if(!f)return;
      try {
        this.chart.load(JSON.parse(await f.text()));
        document.getElementById('bpm').value=this.chart.bpm;
        document.getElementById('editorSongTitle').textContent=this.chart.title;
        document.getElementById('gameSongTitle').textContent=this.chart.title;
        document.getElementById('selectedSongTitle').textContent=this.chart.title;
        document.getElementById('selectedSongMeta').textContent=`${this.chart.bpm} BPM · ${this.chart.notes.filter(note=>!note.auto).length} player notes · ${this.chart.scrollSpeed}× speed`;
        this.clock.bpm=this.chart.bpm; this.render();
      } catch (error) {
        window.alert(`Could not import chart: ${error.message}`);
      }
      e.target.value='';
    };
    window.addEventListener('keydown', e => { if ((e.key==='Delete'||e.key==='Backspace') && !['INPUT','SELECT'].includes(document.activeElement.tagName)) this.deleteSelected(); });
    this.render();
  }

  deleteSelected() { if (!this.selected) return; this.chart.notes=this.chart.notes.filter(n=>n!==this.selected); this.selected=null; this.render(); }
}
