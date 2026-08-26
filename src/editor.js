const DIRECTIONS=['left','down','up','right'];
const ARROWS={left:'←',down:'↓',up:'↑',right:'→'};

export class ChartEditor {
  constructor(chart,clock) {
    this.chart=chart; this.clock=clock; this.selected=null;
    this.timeline=document.getElementById('timeline'); this.grid=document.getElementById('grid'); this.playhead=document.getElementById('playhead');
    this.pxPerMs=.12; this.renderQueued=false; this.suppressClick=false;
  }
  snapMsAt(time=this.clock.current) { return (60000/this.chart.bpmAt(time))/Number(document.getElementById('snap')?.value||4); }
  quantize(ms) { const snap=this.snapMsAt(ms); return Math.max(0,Math.round(ms/snap)*snap); }
  laneWidth() { return this.grid.clientWidth/8; }
  laneFor(note) { return (note.auto?0:4)+Math.max(0,DIRECTIONS.indexOf(note.direction)); }
  laneX(lane) { return (lane+.5)*this.laneWidth(); }
  laneAt(clientX) { const rect=this.grid.getBoundingClientRect(); return Math.max(0,Math.min(7,Math.floor((clientX-rect.left)/this.laneWidth()))); }
  timeAt(clientY) { const rect=this.grid.getBoundingClientRect(); return Math.max(0,(clientY-rect.top)/this.pxPerMs); }
  maxTime() {
    const duration=this.clock.audio?.duration*1000; let max=Number.isFinite(duration)?duration:10000;
    for (const note of this.chart.notes) max=Math.max(max,(Number(note.time)||0)+(Number(note.duration)||0)+2000);
    return Math.max(10000,max);
  }
  render() {
    const height=Math.max(this.timeline.clientHeight,this.maxTime()*this.pxPerMs+240);
    this.grid.style.height=`${height}px`; this.grid.style.setProperty('--editor-row',`${Math.max(6,this.snapMsAt()*this.pxPerMs)}px`);
    this.renderSections(height); this.renderVisible(); this.updateSectionLabel();
  }
  renderSections(height) {
    this.grid.querySelectorAll('.section-line').forEach(element=>element.remove());
    const sectionMs=60000/this.chart.bpm*4, count=Math.min(2500,Math.ceil(height/(sectionMs*this.pxPerMs)));
    for (let section=0;section<=count;section++) {
      const line=document.createElement('div'); line.className='section-line'; line.style.top=`${section*sectionMs*this.pxPerMs}px`; line.innerHTML=`<span>SECTION ${section}</span>`; this.grid.appendChild(line);
    }
  }
  renderVisible() {
    this.grid.querySelectorAll('.note').forEach(element=>element.remove());
    const start=Math.max(0,this.timeline.scrollTop/this.pxPerMs-1000), end=(this.timeline.scrollTop+this.timeline.clientHeight)/this.pxPerMs+1000;
    let low=0,high=this.chart.notes.length;
    while(low<high){const middle=(low+high)>>1;if(this.chart.notes[middle].time<start)low=middle+1;else high=middle;}
    for (let index=low;index<this.chart.notes.length;index++) {
      const note=this.chart.notes[index]; if (note.time>end) break;
      const element=document.createElement('div');
      element.className=`note ${note.auto?'opponent':'player'}${note===this.selected?' selected':''}`; element.dataset.type=note.type; element.textContent=ARROWS[note.direction]||'◆';
      element.style.left=`${this.laneX(this.laneFor(note))}px`; element.style.top=`${note.time*this.pxPerMs}px`;
      if (note.type==='hold'&&note.duration>0) { const tail=document.createElement('i'); tail.className='hold-tail'; tail.style.height=`${Math.max(8,note.duration*this.pxPerMs)}px`; element.appendChild(tail); }
      element.onpointerdown=event=>this.startDrag(event,note,element); element.oncontextmenu=event=>{event.preventDefault();this.deleteNote(note);}; this.grid.appendChild(element);
    }
  }
  queueVisibleRender() { if (this.renderQueued) return; this.renderQueued=true; requestAnimationFrame(()=>{this.renderQueued=false;this.renderVisible();this.updateSectionLabel();}); }
  select(note,rerender=true) {
    this.selected=note;
    if (note) { document.getElementById('noteType').value=note.type||'tap'; document.getElementById('direction').value=note.direction||'left'; document.getElementById('noteSide').value=note.auto?'opponent':'player'; }
    if (rerender) this.renderVisible();
  }
  startDrag(event,note,element) {
    event.preventDefault(); event.stopPropagation(); this.select(note,false); element.classList.add('selected'); element.setPointerCapture(event.pointerId);
    let moved=false;
    const move=pointer=>{moved=true;const lane=this.laneAt(pointer.clientX);note.time=Math.round(this.quantize(this.timeAt(pointer.clientY)));note.auto=lane<4;note.direction=DIRECTIONS[lane%4];element.style.left=`${this.laneX(lane)}px`;element.style.top=`${note.time*this.pxPerMs}px`;element.firstChild.nodeValue=ARROWS[note.direction];};
    const finish=()=>{element.removeEventListener('pointermove',move);this.chart.sort();this.render();if(moved){this.suppressClick=true;setTimeout(()=>{this.suppressClick=false;},0);}};
    element.addEventListener('pointermove',move); element.addEventListener('pointerup',finish,{once:true}); element.addEventListener('pointercancel',finish,{once:true});
  }
  addAt(ms,direction=document.getElementById('direction').value,auto=document.getElementById('noteSide').value==='opponent') {
    const type=document.getElementById('noteType').value, note={time:Math.round(this.quantize(ms)),type,direction,...(auto?{auto:true}:{})};
    if (type==='hold') note.duration=Math.round(this.snapMsAt(note.time)*2);
    this.chart.notes.push(note); this.chart.sort(); this.selected=note; this.render();
  }
  addFromPointer(event) { const lane=this.laneAt(event.clientX); this.addAt(this.timeAt(event.clientY),DIRECTIONS[lane%4],lane<4); }
  updatePlayhead(ms) {
    this.playhead.style.top=`${ms*this.pxPerMs}px`; document.getElementById('editorTime').textContent=`${Math.floor(ms/60000)}:${((ms%60000)/1000).toFixed(3).padStart(6,'0')}`;
    if (this.clock.running) { const target=ms*this.pxPerMs-this.timeline.clientHeight*.42; if (Math.abs(target-this.timeline.scrollTop)>this.timeline.clientHeight*.35) this.timeline.scrollTop=Math.max(0,target); }
    this.updateSectionLabel();
  }
  updateSectionLabel() { const sectionMs=60000/this.chart.bpmAt(this.clock.current)*4, section=Math.max(0,Math.floor(this.clock.current/sectionMs)), label=document.getElementById('editorSection'); if (label) label.textContent=`SECTION ${section}`; }
  seekSection(direction) { const duration=60000/this.chart.bpmAt(this.clock.current)*4; this.clock.seek(Math.max(0,this.clock.current+direction*duration)); this.updatePlayhead(this.clock.current); this.timeline.scrollTop=Math.max(0,this.clock.current*this.pxPerMs-this.timeline.clientHeight*.25); this.queueVisibleRender(); }
  bindUI() {
    document.getElementById('bpm').onchange=event=>{this.chart.bpm=Number(event.target.value)||120;this.clock.bpm=this.chart.bpm;this.render();};
    document.getElementById('snap').onchange=()=>this.render();
    document.getElementById('zoom').oninput=event=>{const center=(this.timeline.scrollTop+this.timeline.clientHeight/2)/this.pxPerMs;this.pxPerMs=Number(event.target.value)/1000;this.render();this.timeline.scrollTop=center*this.pxPerMs-this.timeline.clientHeight/2;this.updatePlayhead(this.clock.current);};
    document.getElementById('addNote').onclick=()=>this.addAt(this.clock.current); document.getElementById('deleteNote').onclick=()=>this.deleteSelected();
    document.getElementById('prevSection').onclick=()=>this.seekSection(-1); document.getElementById('nextSection').onclick=()=>this.seekSection(1);
    this.timeline.onclick=event=>{if(this.suppressClick||event.target.closest('.note')||event.target.closest('.fnf-lane-head'))return;if(event.shiftKey){this.clock.seek(this.quantize(this.timeAt(event.clientY)));this.updatePlayhead(this.clock.current);}else this.addFromPointer(event);};
    this.timeline.oncontextmenu=event=>event.preventDefault(); this.timeline.onscroll=()=>this.queueVisibleRender();
    document.getElementById('editorPlay').onclick=async()=>{if(this.clock.running){this.clock.pause();document.getElementById('editorPlay').textContent='▶ Play';}else{await this.clock.start();document.getElementById('editorPlay').textContent='Ⅱ Pause';}};
    document.getElementById('exportChart').onclick=()=>{const link=document.createElement('a');link.href=URL.createObjectURL(new Blob([this.chart.toJSON()],{type:'application/json'}));link.download='ryoko-chart.json';link.click();setTimeout(()=>URL.revokeObjectURL(link.href),0);};
    document.getElementById('importChart').onclick=()=>document.getElementById('fileInput').click();
    document.getElementById('fileInput').onchange=async event=>{const file=event.target.files[0];if(!file)return;try{this.chart.load(JSON.parse(await file.text()));document.dispatchEvent(new CustomEvent('ryoko:chart-loaded',{detail:{title:this.chart.title}}));document.getElementById('bpm').value=this.chart.bpm;this.clock.bpm=this.chart.bpm;this.render();}catch(error){window.alert(`Could not import chart: ${error.message}`);}event.target.value='';};
    window.addEventListener('keydown',event=>{if(['INPUT','SELECT','TEXTAREA'].includes(document.activeElement.tagName))return;if(event.key==='Delete'||event.key==='Backspace')this.deleteSelected();if(/^[1-8]$/.test(event.key)&&!document.getElementById('editorPage').classList.contains('hidden')){const lane=Number(event.key)-1;this.addAt(this.clock.current,DIRECTIONS[lane%4],lane<4);}});
    new ResizeObserver(()=>this.render()).observe(this.timeline); this.render();
  }
  deleteNote(note) { this.chart.notes=this.chart.notes.filter(item=>item!==note); if(this.selected===note)this.selected=null; this.render(); }
  deleteSelected() { if(this.selected)this.deleteNote(this.selected); }
}
