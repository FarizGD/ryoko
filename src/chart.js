const FNF_DIRECTIONS = ['left', 'down', 'up', 'right'];

export class Chart {
  constructor(data = {}) {
    this.version = 1;
    this.title = data.title || data.song?.title || 'Untitled';
    this.artist = data.artist || data.song?.artist || 'Unknown';
    this.bpm = data.bpm ?? data.song?.bpm ?? 120;
    this.offset = data.offset ?? data.song?.offset ?? 0;
    this.notes = (data.notes ?? []).map(note => ({ ...note }));
    this.bpmChanges = data.bpmChanges ?? [];
    this.scrollSpeed = data.scrollSpeed ?? data.song?.scrollSpeed ?? 1;
  }

  static isFNF(data) {
    return Array.isArray(data?.song?.notes) && data.song.notes.some(section => Array.isArray(section.sectionNotes));
  }

  static fromFNF(data, { includeOpponent = true } = {}) {
    if (!Chart.isFNF(data)) throw new Error('This is not a supported FNF chart.');
    const source = data.song;
    const notes = [];
    const bpmChanges = [];
    let sectionStart = 0;
    let activeBpm = Number(source.bpm) || 120;

    for (const section of source.notes) {
      if (section.changeBPM && Number(section.bpm) > 0 && Number(section.bpm) !== activeBpm) {
        activeBpm = Number(section.bpm);
        bpmChanges.push({ time: Math.round(sectionStart), bpm: activeBpm });
      }
      for (const raw of section.sectionNotes || []) {
        const laneData = Number(raw[1]) || 0;
        let playerNote = Boolean(section.mustHitSection);
        if (laneData > 3) playerNote = !playerNote;
        if (!playerNote && !includeOpponent) continue;
        const duration = Math.max(0, Math.round(Number(raw[2]) || 0));
        const note = {
          time: Math.max(0, Math.round(Number(raw[0]) || 0)),
          type: duration > 1 ? 'hold' : 'tap',
          direction: FNF_DIRECTIONS[((laneData % 4) + 4) % 4],
          ...(!playerNote ? { auto: true } : {})
        };
        if (duration > 1) note.duration = duration;
        notes.push(note);
      }
      const steps = Number(section.lengthInSteps) || 16;
      sectionStart += steps * (60000 / activeBpm / 4);
    }

    notes.sort((a, b) => a.time - b.time);
    return {
      version: 1,
      song: { title: source.song || 'FNF Chart', artist: source.artist || 'Unknown', bpm: Number(source.bpm) || 120, offset: 0, scrollSpeed: Number(source.speed) || 1 },
      notes,
      bpmChanges,
      source: { format: 'fnf', player1: source.player1, player2: source.player2, speed: source.speed }
    };
  }

  sort() { this.notes.sort((a, b) => a.time - b.time); }

  bpmAt(time) {
    let bpm = this.bpm;
    for (const change of this.bpmChanges) {
      if (change.time > time) break;
      bpm = change.bpm;
    }
    return bpm;
  }

  toJSON() {
    return JSON.stringify({
      version: this.version,
      song: { title: this.title, artist: this.artist, bpm: this.bpm, offset: this.offset, scrollSpeed: this.scrollSpeed },
      notes: this.notes.map(({ _hit, _expired, ...note }) => note),
      ...(this.bpmChanges.length ? { bpmChanges: this.bpmChanges } : {})
    }, null, 2);
  }

  load(data, options) {
    const normalized = Chart.isFNF(data) ? Chart.fromFNF(data, options) : data;
    this.version = normalized.version ?? 1;
    this.title = normalized.song?.title ?? normalized.title ?? 'Untitled';
    this.artist = normalized.song?.artist ?? normalized.artist ?? 'Unknown';
    this.bpm = normalized.song?.bpm ?? normalized.bpm ?? 120;
    this.offset = normalized.song?.offset ?? normalized.offset ?? 0;
    this.scrollSpeed = normalized.song?.scrollSpeed ?? normalized.scrollSpeed ?? normalized.source?.speed ?? 1;
    this.notes = (normalized.notes ?? []).map(note => ({ ...note }));
    this.bpmChanges = (normalized.bpmChanges ?? []).map(change => ({ ...change }));
    this.sort();
    return normalized;
  }
}
