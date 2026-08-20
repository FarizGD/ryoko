export class RhythmClock {
  constructor(bpm=120){this.bpm=bpm;this.position=0;this.startedAt=0;this.pausedAt=0;this.running=false;}
  start(){if(!this.running){this.startedAt=performance.now()-this.position;this.running=true;}}
  pause(){if(this.running){this.position=performance.now()-this.startedAt;this.running=false;}}
  seek(ms){this.position=ms;if(this.running)this.startedAt=performance.now()-ms;}
  get beatMs(){return 60000/this.bpm;}
}
