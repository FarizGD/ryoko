import Phaser from 'phaser';

const VECTORS = { up:[0,-1], right:[1,0], down:[0,1], left:[-1,0] };
const ARROWS = { up:'↑', right:'→', down:'↓', left:'←' };
const COLORS = { up:'#55e38e', right:'#ffd45c', down:'#55c8ff', left:'#ff68ae' };

export class GameplayScene extends Phaser.Scene {
  constructor(chart, clock, onDirection, onMiss, onBeat, onBotHit) {
    super('gameplay');
    this.chart = chart;
    this.clock = clock;
    this.onDirection = onDirection;
    this.onMiss = onMiss;
    this.onBeat = onBeat;
    this.onBotHit = onBotHit;
    this.botplay=false;
    this.lastBeat = -1;
    this.noteViews = new Map();
    this.approachMs = 1800;
    this.appearance={shape:'◆',playerColor:'#ffffff',noteColors:{left:'#ff68ae',down:'#55c8ff',up:'#55e38e',right:'#ffd45c'},trail:true,customImage:null};
    this.customTextureKey=null;
    this.motionUntil=0;
    this.lastTrailAt=0;
    this.lastCameraKickAt=0;
    this.scanStart=0;
    this.beatZoom=0;
    this.modchartZoom=0;
    this.eventIndex=0;
    this.runtimeScrollSpeed=Number(chart.scrollSpeed)||1;
    this.scrollTransition=null;
    this.lastBurstAt=new Map();
    this.modchart=null;
    this.postFx=null;
    this.shaderBeat=0;
    this.modchartState=()=>({time:this.clock.current,bpm:this.chart.bpmAt(this.clock.current),beat:this.lastBeat});
  }

  create() {
    this.cameras.main.setBackgroundColor('#0d0c18');
    this.ambientBackground=this.add.graphics().setDepth(-100).setScrollFactor(0);
    this.guide = this.add.graphics();
    this.receptors = new Map();
    for (const direction of Object.keys(VECTORS)) {
      const receptor=this.add.text(0,0,ARROWS[direction],{
        fontFamily:'system-ui',fontSize:'28px',fontStyle:'bold',color:COLORS[direction],
        backgroundColor:'#211e35',padding:{x:11,y:6},stroke:'#ffffff',strokeThickness:1
      }).setOrigin(.5).setAlpha(.9).setDepth(1);
      this.receptors.set(direction,receptor);
    }
    this.player = this.add.text(0,0,this.appearance.shape,{fontFamily:'system-ui',fontSize:'42px',color:this.appearance.playerColor}).setOrigin(.5).setDepth(3);
    this.eventText=this.add.text(this.scale.width/2,34,'',{
      fontFamily:'system-ui',fontSize:'22px',fontStyle:'bold',color:'#ffffff',align:'center',
      backgroundColor:'#171326',padding:{x:16,y:9},stroke:'#080611',strokeThickness:4,
      wordWrap:{width:Math.max(220,this.scale.width-80)}
    }).setOrigin(.5,0).setAlpha(0).setDepth(90).setScrollFactor(0);
    if (this.appearance.customImage) this.loadCustomPlayer(this.appearance.customImage);
    // Phaser resizes an existing post pipeline with the renderer. Replacing a
    // live camera pipeline here can leave its framebuffer black on replay.
    this.scale.on('resize', () => this.layout());
    this.layout();
    this.postFx={pulse:()=>{ this.shaderBeat=1; }};
  }

  drawBackground() {
    if (!this.ambientBackground || !this.scale) return;
    const {width,height}=this.scale,cx=width/2,cy=height/2;
    const pulse=this.shaderBeat;
    this.ambientBackground.clear().fillStyle(0x090817,1).fillRect(0,0,width,height);
    for (let i=5;i>=1;i--) {
      const radius=Math.min(width,height)*(.12+i*.09+pulse*.012);
      this.ambientBackground.fillStyle(i%2?0x39246f:0x241b55,.035+i*.012+pulse*.018).fillCircle(cx,cy,radius);
    }
    this.ambientBackground.lineStyle(2,0x9b7cff,.08+pulse*.24).strokeCircle(cx,cy,Math.min(width,height)*(.22+pulse*.025));
  }

  layout() {
    if (!this.scale) return;
    const { width, height } = this.scale;
    this.drawBackground();
    this.player?.setPosition(width/2, height/2);
    const cx=width/2,cy=height/2,targetDistance=Math.min(78,width*.14,height*.14);
    this.guide?.clear().lineStyle(2,0x8f7cff,.16)
      .lineBetween(0,cy,cx-targetDistance,cy).lineBetween(cx+targetDistance,cy,width,cy)
      .lineBetween(cx,0,cx,cy-targetDistance).lineBetween(cx,cy+targetDistance,cx,height)
      .lineStyle(2,0xffffff,.22).strokeCircle(cx,cy,targetDistance+26);
    for (const [direction,receptor] of this.receptors || []) {
      const [vx,vy]=VECTORS[direction];
      receptor.setPosition(cx+vx*targetDistance,cy+vy*targetDistance);
    }
    this.watermark?.setPosition(width-18,height-16);
    this.eventText?.setPosition(width/2,34).setWordWrapWidth(Math.max(220,width-80));
  }

  setRenderWatermark(enabled) {
    if (enabled && !this.watermark) {
      this.watermark=this.add.text(this.scale.width-18,this.scale.height-16,'RYŌKO / 凌鼓 · by FarizDev',{
        fontFamily:'system-ui',fontSize:'15px',fontStyle:'bold',color:'#ffffff',stroke:'#080812',strokeThickness:4
      }).setOrigin(1,1).setAlpha(.72).setScrollFactor(0).setDepth(100);
    }
    this.watermark?.setVisible(enabled);
  }

  pulse(direction, judgeInput=true) {
    if (!this.player) return;
    const [vx,vy] = VECTORS[direction];
    const x=this.scale.width/2, y=this.scale.height/2;
    this.player.setPosition(x+vx*48,y+vy*48);
    this.motionUntil=this.time.now+72;
    if (this.time.now-this.lastTrailAt>24) { this.lastTrailAt=this.time.now; this.spawnTrail(); }
    if (this.time.now-this.lastCameraKickAt>28) { this.lastCameraKickAt=this.time.now; this.kickCamera(vx,vy); }
    if (judgeInput) this.onDirection(direction);
  }

  showHit(note, judgment='PERFECT', auto=false) {
    if (!note || document.body.classList.contains('reduced-motion')) return;
    const direction=note.direction;
    const receptor=this.receptors?.get(direction);
    if (!receptor) return;
    const now=this.time.now;
    const last=this.lastBurstAt.get(direction)||0;
    const color=Phaser.Display.Color.HexStringToColor(auto?'#aaa6c4':(this.appearance.noteColors?.[direction]||COLORS[direction]||'#8f7cff')).color;
    const alpha=auto?.32:.9;
    const ring=this.add.circle(receptor.x,receptor.y,18,color,0).setStrokeStyle(auto?2:3,color,alpha).setDepth(7);
    this.tweens.add({targets:ring,scale:auto?1.6:2.15,alpha:0,duration:auto?150:230,ease:'Quad.Out',onComplete:()=>ring.destroy()});
    if (now-last<24) return;
    this.lastBurstAt.set(direction,now);
    const count=auto?3:(judgment==='PERFECT'?9:6);
    for (let i=0;i<count;i++) {
      const angle=(Math.PI*2*i/count)+Math.random()*.35;
      const particle=this.add.circle(receptor.x,receptor.y,auto?2:3,color,alpha).setDepth(6);
      const distance=(auto?18:28)+Math.random()*(auto?12:28);
      this.tweens.add({targets:particle,x:receptor.x+Math.cos(angle)*distance,y:receptor.y+Math.sin(angle)*distance,scale:0,alpha:0,duration:140+Math.random()*130,ease:'Cubic.Out',onComplete:()=>particle.destroy()});
    }
    receptor.setScale(1.22);
    this.tweens.add({targets:receptor,scale:1,duration:110,ease:'Back.Out'});
  }

  processEvents(now) {
    const events=this.chart.events||[];
    while (this.eventIndex<events.length && events[this.eventIndex].time+this.chart.offset<=now) {
      this.fireChartEvent(events[this.eventIndex++],now);
    }
    if (this.scrollTransition) {
      const progress=Phaser.Math.Clamp((now-this.scrollTransition.start)/this.scrollTransition.duration,0,1);
      this.runtimeScrollSpeed=Phaser.Math.Linear(this.scrollTransition.from,this.scrollTransition.to,progress);
      if (progress>=1) this.scrollTransition=null;
    }
  }

  fireChartEvent(event, now=this.clock.current) {
    this.modchart?.hook('onEvent',this.modchartState(),{name:event.name||event.type||'',value1:event.value1??'',value2:event.value2??'',time:event.time});
    const name=String(event.name||event.type||'').trim().toLowerCase();
    if (name==='change scroll speed' || name==='scroll speed') {
      const requested=Number(event.value1??event.value);
      const target=Math.max(.1,name==='change scroll speed'
        ? (Number(this.chart.scrollSpeed)||1)*(requested||1)
        : (requested||Number(this.chart.scrollSpeed)||1));
      const duration=Math.max(0,Number(event.value2??event.duration)||0)*1000;
      if (duration) this.scrollTransition={from:this.runtimeScrollSpeed,to:target,start:now,duration};
      else { this.runtimeScrollSpeed=target; this.scrollTransition=null; }
    } else if (name==='camera shake') {
      const values=String(event.value1||'0.25,0.01').split(',').map(Number);
      this.cameras.main.shake(Math.max(0,values[0]||.25)*1000,Math.max(0,values[1]||.01));
    } else if (name==='add camera zoom' || name==='camera zoom') {
      const raw=Math.abs(Number(event.value1)||.08);
      this.beatZoom=Math.max(this.beatZoom,Phaser.Math.Clamp(raw >= 10 ? .22 : raw,.025,.35));
      this.postFx?.pulse();
    } else if (name==='change character') {
      const character=String(event.value2||event.value1||'Character');
      this.flashEvent(0xffffff,.18);
      this.showEventMessage(character.replace(/[-_]+/g,' ').toUpperCase(),900);
    } else if (name.includes('text change')) {
      this.showEventMessage(String(event.value1||event.value2||''),2200);
    } else if (name.includes('popup')) {
      const title=String(event.value1||'EVENT');
      const message=String(event.value2||'');
      this.flashEvent(0xff4f9a,.28);
      this.cameras.main.shake(220,.012);
      this.showEventMessage(message?`${title}\n${message}`:title,2600,true);
    }
  }

  flashEvent(color=0xffffff,alpha=.2,duration=260) {
    if (document.body.classList.contains('reduced-motion')) return;
    const flash=this.add.rectangle(this.scale.width/2,this.scale.height/2,this.scale.width,this.scale.height,color,alpha).setDepth(80).setScrollFactor(0);
    this.tweens.add({targets:flash,alpha:0,duration,ease:'Quad.Out',onComplete:()=>flash.destroy()});
  }

  showEventMessage(message,duration=1600,popup=false) {
    if (!this.eventText || !message) return;
    this.tweens.killTweensOf(this.eventText);
    this.eventText.setText(message).setFontSize(popup?'28px':'22px').setBackgroundColor(popup?'#6d1648':'#171326').setAlpha(1).setScale(popup ? .82 : 1);
    this.tweens.add({targets:this.eventText,scale:1,duration:140,ease:'Back.Out'});
    this.tweens.add({targets:this.eventText,alpha:0,delay:duration,duration:260,ease:'Quad.In'});
  }

  applyModchartCommand(command) {
    if (!command || command.type==='invalid' || !this.sys?.isActive()) return;
    const duration=command.duration||0;
    const tween=(targets,properties) => {
      this.tweens.killTweensOf(targets);
      if (!duration) { Object.assign(targets,properties); return; }
      this.tweens.add({targets,...properties,duration,yoyo:true,ease:'Sine.Out'});
    };
    if (command.type==='camera.zoom') tween(this,{modchartZoom:command.amount});
    else if (command.type==='camera.rotate') tween(this.cameras.main,{rotation:Phaser.Math.DegToRad(command.degrees)});
    else if (command.type==='camera.shake') this.cameras.main.shake(command.duration,command.intensity);
    else if (command.type==='player.scale') tween(this.player,{scale:command.amount});
    else if (command.type==='player.alpha') tween(this.player,{alpha:command.amount});
    else if (command.type==='receptors.rotate') for (const receptor of this.receptors.values()) tween(receptor,{rotation:Phaser.Math.DegToRad(command.degrees)});
    else if (command.type==='receptors.scale') for (const receptor of this.receptors.values()) tween(receptor,{scale:command.amount});
    else if (command.type==='scene.flash') this.flashEvent(Phaser.Display.Color.HexStringToColor(command.color).color,command.alpha,command.duration);
    else if (command.type==='scene.background') this.cameras.main.setBackgroundColor(command.color);
    else if (command.type==='scene.message') this.showEventMessage(command.text,command.duration);
  }

  spawnTrail() {
    if (!this.appearance.trail || document.body.classList.contains('reduced-motion')) return;
    const ghost=this.customTextureKey
      ? this.add.image(this.player.x,this.player.y,this.customTextureKey).setDisplaySize(46,46).setOrigin(.5).setTint(Phaser.Display.Color.HexStringToColor(this.appearance.playerColor).color).setAlpha(.34).setDepth(2)
      : this.add.text(this.player.x,this.player.y,this.appearance.shape,{fontFamily:'system-ui',fontSize:'42px',color:this.appearance.playerColor}).setOrigin(.5).setAlpha(.34).setDepth(2);
    this.tweens.add({targets:ghost,alpha:0,scale:.55,duration:230,ease:'Quad.Out',onComplete:()=>ghost.destroy()});
  }

  setAppearance(appearance) {
    this.appearance={...this.appearance,...appearance};
    if (this.player) {
      if (this.appearance.customImage) this.loadCustomPlayer(this.appearance.customImage);
      else this.useShapePlayer();
    }
    for (const [note,view] of this.noteViews) if (!note.auto) view.setBackgroundColor(this.appearance.noteColors?.[note.direction]||'#8f7cff');
  }

  useShapePlayer() {
    const x=this.player?.x??this.scale.width/2,y=this.player?.y??this.scale.height/2;
    if (this.player?.type==='Text') this.player.setText(this.appearance.shape).setColor(this.appearance.playerColor);
    else { this.player?.destroy(); this.player=this.add.text(x,y,this.appearance.shape,{fontFamily:'system-ui',fontSize:'42px',color:this.appearance.playerColor}).setOrigin(.5).setDepth(3); }
    this.customTextureKey=null;
  }

  loadCustomPlayer(source) {
    if (!source || !this.textures) return;
    if (this._loadedCustomSource===source && this.customTextureKey) {
      this.player?.setTint(Phaser.Display.Color.HexStringToColor(this.appearance.playerColor).color);
      return;
    }
    if (this._loadingCustomSource===source) return;
    this._loadingCustomSource=source;
    const key=`custom-player-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const image=new Image();
    image.decoding='async';
    image.onload=() => {
      this._loadingCustomSource=null;
      if (this.appearance.customImage!==source || !image.naturalWidth || !image.naturalHeight) return;
      this.textures.addImage(key,image);
      const x=this.player?.x??this.scale.width/2,y=this.player?.y??this.scale.height/2;
      this.player?.destroy();
      this.player=this.add.image(x,y,key).setDisplaySize(46,46).setOrigin(.5).setTint(Phaser.Display.Color.HexStringToColor(this.appearance.playerColor).color).setDepth(3);
      this.customTextureKey=key;
      this._loadedCustomSource=source;
    };
    image.onerror=() => {
      this._loadingCustomSource=null;
      if (this.appearance.customImage===source) {
        this.appearance.customImage=null;
        this.useShapePlayer();
        window.alert('Phaser could not decode that player image. Try another PNG or SVG.');
      }
    };
    image.src=source;
  }

  kickCamera(vx,vy) {
    const camera=this.cameras.main;
    this.tweens.killTweensOf(camera);
    camera.setScroll(0,0).setRotation(0);
    if (document.body.classList.contains('reduced-motion')) return;
    this.tweens.add({
      targets:camera,
      scrollX:vx*14,
      scrollY:vy*14,
      rotation:vx*.012,
      duration:75,
      yoyo:true,
      hold:15,
      ease:'Sine.Out',
      onComplete:() => camera.setScroll(0,0).setRotation(0),
      onStop:() => camera.setScroll(0,0).setRotation(0)
    });
  }

  update() {
    const now=this.clock.current, cx=this.scale.width/2, cy=this.scale.height/2;
    this.shaderBeat=Math.max(0,this.shaderBeat-this.game.loop.delta/260);
    if (this.shaderBeat>0) this.drawBackground();
    this.modchart?.update(this.modchartState());
    this.processEvents(now);
    const zoomDecay=1-Math.exp(-this.game.loop.delta/90);
    this.beatZoom=Phaser.Math.Linear(this.beatZoom,0,zoomDecay);
    if (this.beatZoom<.0002) this.beatZoom=0;
    this.cameras.main.setZoom(Math.max(.5,1+this.beatZoom+this.modchartZoom));
    if (this.player && this.time.now>this.motionUntil) {
      this.player.x=Phaser.Math.Linear(this.player.x,cx,.28);
      this.player.y=Phaser.Math.Linear(this.player.y,cy,.28);
      if (Math.abs(this.player.x-cx)<.3&&Math.abs(this.player.y-cy)<.3) this.player.setPosition(cx,cy);
    }
    if (this.clock.running) {
      const bpm=this.chart.bpmAt(now);
      const beat=Math.floor(now/(60000/bpm));
      if (beat !== this.lastBeat) {
        this.lastBeat=beat;
        this.pulseBeat(bpm);
        this.modchart?.hook('onBeat',this.modchartState());
      }
    }
    const approachMs=this.approachMs/Math.max(.1,this.runtimeScrollSpeed);
    const visible=new Set();
    for (let index=this.scanStart;index<this.chart.notes.length;index++) {
      const note=this.chart.notes[index];
      const delta=note.time+this.chart.offset-now;
      if (delta>approachMs) break;
      if (this.clock.running && note.auto && delta <= 0) { note._hit=true; this.showHit(note,'AUTO',true); continue; }
      if (this.clock.running && this.botplay && !note.auto && !note._hit && !note._expired && delta <= 0) {
        this.pulse(note.direction,false);
        this.onBotHit?.(note);
        continue;
      }
      if (this.clock.running && !note.auto && !note._hit && !note._expired && delta < -180) {
        note._expired=true;
        this.onMiss?.(note);
      }
      if (note._hit || delta < -180 || delta > approachMs) continue;
      visible.add(note);
      let view=this.noteViews.get(note);
      if (!view) {
        const color=note.auto?'#4d4964':(this.appearance.noteColors?.[note.direction]||'#8f7cff');
        view=this.add.text(cx,cy,ARROWS[note.direction]||'◆',{
          fontFamily:'system-ui',fontSize:note.auto?'28px':'34px',fontStyle:'bold',color:'#ffffff',
          backgroundColor:color,padding:{x:note.auto?7:9,y:note.auto?3:5},stroke:'#090812',strokeThickness:3
        }).setOrigin(.5).setDepth(note.auto?1:2);
        this.noteViews.set(note,view);
      }
      const progress=Phaser.Math.Clamp(delta/approachMs,0,1);
      const [vx,vy]=VECTORS[note.direction]||[0,0];
      const targetDistance=Math.min(78,this.scale.width*.14,this.scale.height*.14)+(note.auto?34:0);
      const travel=(vx?this.scale.width:this.scale.height)/2+50-targetDistance;
      const distance=targetDistance+progress*travel;
      const missFade=delta<0?Phaser.Math.Clamp(1+delta/180,0,1):1;
      view.setPosition(cx+vx*distance,cy+vy*distance).setAlpha((note.auto?.5:1)*missFade);
    }
    while (this.scanStart<this.chart.notes.length) {
      const note=this.chart.notes[this.scanStart];
      if (note.time+this.chart.offset-now>=-180) break;
      if (!note.auto&&!note._hit&&!note._expired&&this.clock.running) { note._expired=true; this.onMiss?.(note); }
      this.scanStart++;
    }
    for (const [note,view] of this.noteViews) if (!visible.has(note)) { view.destroy(); this.noteViews.delete(note); }
  }

  pulseBeat(bpm) {
    if (document.body.classList.contains('reduced-motion')) return;
    this.beatZoom=Math.max(this.beatZoom,.045);
    this.postFx?.pulse();
    const duration=Math.min(170,(60000/bpm)*.3);
    for (const receptor of this.receptors.values()) {
      this.tweens.killTweensOf(receptor);
      receptor.setScale(1);
      this.tweens.add({targets:receptor,scale:1.13,duration,yoyo:true,ease:'Sine.Out'});
    }
    this.tweens.killTweensOf(this.guide);
    this.guide.setAlpha(1);
    this.tweens.add({targets:this.guide,alpha:.5,duration,yoyo:true,ease:'Sine.Out'});
    this.onBeat?.(bpm);
  }

  resetNotes() {
    // A run reuses this scene. Clear every visual mutation that chart events,
    // modcharts, hit effects, or camera movement may have left behind.
    this.tweens?.killAll();
    for (const view of this.noteViews.values()) view.destroy();
    this.noteViews.clear();
    this.lastBeat=-1;
    this.scanStart=0;
    this.beatZoom=0;
    this.modchartZoom=0;
    this.eventIndex=0;
    this.runtimeScrollSpeed=Number(this.chart.scrollSpeed)||1;
    this.scrollTransition=null;
    this.lastBurstAt.clear();
    this.modchart?.reset(this.modchartState());
    // Packages can be selected before Phaser creates this scene. The chart
    // state above still needs resetting, but visual objects do not exist yet.
    if (!this.scale || !this.cameras?.main) return;
    if (this.eventText) this.eventText.setAlpha(0).setScale(1).setText('').setVisible(true);
    if (this.player) this.player.setAlpha(1).setScale(1).setRotation(0).setVisible(true);
    for (const receptor of this.receptors?.values() || []) receptor.setAlpha(.9).setScale(1).setRotation(0).setVisible(true);
    this.guide?.setAlpha(1).setScale(1).setRotation(0).setVisible(true);
    const camera=this.cameras?.main;
    if (camera) {
      camera.resetFX();
      camera.setScroll(0,0).setRotation(0).setZoom(1).setAlpha(1).setVisible(true);
      camera.setBackgroundColor('#0d0c18');
    }
    this.layout();
  }
}
