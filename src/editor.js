export class ChartEditor {
  constructor(chart, clock) {
    this.chart = chart;
    this.clock = clock;
    this.selected = null;
    this.timeline = document.getElementById('timeline');
    this.grid = document.getElementById('grid');
    this.playhead = document.getElementById('playhead');
    this.pxPerMs = 0.1;
  }

  get snapMs() {
    const divisor = Number(document.getElementById('snap')?.value || 4);
    return (60000 / this.chart.bpm) / divisor;
  }

  quantize(ms) {
    const step = this.snapMs;
    return Math.max(0, Math.round(ms / step) * step);
  }

  laneY(direction) {
    const map = { up: 0.2, right: 0.4, down: 0.6, left: 0.8 };
    return (map[direction] || 0.5) * this.timeline.clientHeight;
  }

  render() {
    this.timeline.querySelectorAll('.note').forEach(n => n.remove());
    const maxTime = Math.max(10000, ...this.chart.notes.map(n => n.time + 2000));
    const contentWidth = Math.max(this.timeline.clientWidth, maxTime * this.pxPerMs);
    this.grid.style.width = `${contentWidth}px`;

    for (const note of this.chart.notes) {
      const el = document.createElement('div');
      el.className = 'note';
      el.dataset.type = note.type;
      el.textContent = note.direction === 'up' ? '↑' : note.direction === 'right' ? '→' : note.direction === 'down' ? '↓' : '←';
      el.style.left = `${note.time * this.pxPerMs}px`;
      el.style.top = `${this.laneY(note.direction)}px`;
      el.onclick = e => { e.stopPropagation(); this.select(note, el); };
      this.timeline.appendChild(el);
    }
  }

  select(note, el) {
    this.selected = note;
    this.timeline.querySelectorAll('.note').forEach(x => x.classList.remove('selected'));
    el.classList.add('selected');
  }

  updatePlayhead(ms) {
    if (this.playhead) this.playhead.style.left = `${ms * this.pxPerMs}px`;
    const t = document.getElementById('editorTime');
    if (t) t.textContent = `${Math.floor(ms / 60000)}:${((ms % 60000) / 1000).toFixed(3).padStart(6, '0')}`;
    const target = ms * this.pxPerMs - this.timeline.clientWidth * 0.35;
    if (this.clock.running && target > this.timeline.scrollLeft) this.timeline.scrollLeft = target;
  }

  addAtClientX(clientX) {
    const rect = this.timeline.getBoundingClientRect();
    const rawTime = (clientX - rect.left + this.timeline.scrollLeft) / this.pxPerMs;
    const time = this.quantize(rawTime);
    const direction = document.getElementById('direction').value;
    const type = document.getElementById('noteType').value;
    const note = { time: Math.round(time), type, direction };
    if (type === 'hold') note.duration = Math.round(this.snapMs * 2);
    this.chart.notes.push(note);
    this.chart.sort();
    this.render();
  }

  bindUI() {
    document.getElementById('bpm').onchange = e => {
      this.chart.bpm = Number(e.target.value) || 120;
      this.clock.bpm = this.chart.bpm;
      this.render();
    };

    document.getElementById('snap').onchange = () => this.render();
    document.getElementById('addNote').onclick = () => {
      const center = this.timeline.getBoundingClientRect().left + this.timeline.clientWidth / 2;
      this.addAtClientX(center);
    };

    document.getElementById('deleteNote').onclick = () => this.deleteSelected();
    document.getElementById('timeline').onclick = e => {
      if (e.target === this.timeline || e.target === this.grid) this.addAtClientX(e.clientX);
    };

    document.getElementById('editorPlay').onclick = async () => {
      if (this.clock.running) {
        this.clock.pause();
        document.getElementById('editorPlay').textContent = '▶ Play';
      } else {
        await this.clock.start();
        document.getElementById('editorPlay').textContent = 'Ⅱ Pause';
      }
    };

    document.getElementById('exportChart').onclick = () => {
      const blob = new Blob([this.chart.toJSON()], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'ryoko-chart.json';
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 0);
    };

    document.getElementById('importChart').onclick = () => document.getElementById('fileInput').click();
    document.getElementById('fileInput').onchange = async e => {
      const f = e.target.files[0];
      if (!f) return;
      this.chart.load(JSON.parse(await f.text()));
      document.getElementById('bpm').value = this.chart.bpm;
      this.clock.bpm = this.chart.bpm;
      this.render();
    };

    window.addEventListener('keydown', e => {
      if ((e.key === 'Delete' || e.key === 'Backspace') && !['INPUT', 'SELECT'].includes(document.activeElement.tagName)) {
        this.deleteSelected();
      }
    });

    this.render();
  }

  deleteSelected() {
    if (!this.selected) return;
    this.chart.notes = this.chart.notes.filter(n => n !== this.selected);
    this.selected = null;
    this.render();
  }
}
