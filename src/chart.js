export class Chart {
  constructor(data={}){this.version=1;this.bpm=data.bpm??120;this.offset=data.offset??0;this.notes=(data.notes??[]).map(n=>({...n}));}
  sort(){this.notes.sort((a,b)=>a.time-b.time);}
  toJSON(){return JSON.stringify({version:this.version,song:{title:'RYŌKO Prototype',bpm:this.bpm,offset:this.offset},notes:this.notes.map(({_hit,_expired,...n})=>n)},null,2);}
  load(data){this.bpm=data.song?.bpm??data.bpm??120;this.offset=data.song?.offset??data.offset??0;this.notes=(data.notes??[]).map(n=>({...n}));this.sort();}
}
