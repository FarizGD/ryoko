import Phaser from 'phaser';

const VECTORS = { up:[0,-1], right:[1,0], down:[0,1], left:[-1,0] };
const ARROWS = { up:'↑', right:'→', down:'↓', left:'←' };
const COLORS = { up:'#55e38e', right:'#ffd45c', down:'#55c8ff', left:'#ff68ae' };

const RHYTHM_FRAGMENT_SHADER = `
#define SHADER_NAME RYOKO_RHYTHM_FX
precision mediump float;
uniform sampler2D uMainSampler;
uniform float uTime;
uniform float uBeat;
uniform vec2 uResolution;
varying vec2 outTexCoord;

void main() {
  vec2 uv = outTexCoord;
  vec2 center = uv - 0.5;
  float radius = dot(center, center);
  uv += center * radius * (0.018 + uBeat * 0.018);
  float split = 0.0012 + uBeat * 0.0035;
  vec2 chroma = vec2(split * (0.6 + radius), 0.0);
  float red = texture2D(uMainSampler, uv + chroma).r;
  float green = texture2D(uMainSampler, uv).g;
  float blue = texture2D(uMainSampler, uv - chroma).b;
  float alpha = texture2D(uMainSampler, uv).a;
  vec3 color = vec3(red, green, blue);
  float scanline = sin(uv.y * uResolution.y * 1.15 + uTime * 22.0) * 0.022;
  float vignette = smoothstep(0.82, 0.22, length(center));
  float ring = exp(-abs(length(center) - (0.12 + uBeat * 0.025)) * 32.0) * uBeat;
  color = color * (0.96 + scanline) * mix(0.68, 1.0, vignette);
  color += vec3(0.30, 0.20, 0.65) * ring * 0.22;
  gl_FragColor = vec4(color, alpha);
}`;

class RhythmPostFX extends Phaser.Renderer.WebGL.Pipelines.PostFXPipeline {
  constructor(game) {
    super({ game, name:'RhythmPostFX', renderTarget:true, fragShader:RHYTHM_FRAGMENT_SHADER });
    this.elapsed=0;
    this.beat=0;
  }

  pulse() { this.beat=1; }

  onPreRender() {
    const delta=this.game.loop.delta/1000;
    this.elapsed+=delta;
    this.beat=Math.max(0,this.beat-delta*3.8);
    this.set1f('uTime',this.elapsed);
    this.set1f('uBeat',this.beat);
    this.set2f('uResolution',this.renderer.width,this.renderer.height);
  }
}

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
    this.appearance={shape:'◆',playerColor:'#ffffff',noteColor:'#8f7cff',trail:true,customImage:null};
    this.customTextureKey=null;
    this.motionUntil=0;
    this.lastTrailAt=0;
    this.lastCameraKickAt=0;
    this.scanStart=0;
    this.beatZoom=0;
  }

  create() {
    this.cameras.main.setBackgroundColor('#0d0c18');
    if (this.game.renderer.type === Phaser.WEBGL) {
      this.game.renderer.pipelines.addPostPipeline('RhythmPostFX',RhythmPostFX);
      this.cameras.main.setPostPipeline(RhythmPostFX);
      const pipeline=this.cameras.main.getPostPipeline(RhythmPostFX);
      this.postFx=Array.isArray(pipeline)?pipeline[0]:pipeline;
    }
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
    if (this.appearance.customImage) this.loadCustomPlayer(this.appearance.customImage);
    this.scale.on('resize', () => this.layout());
    this.layout();
  }

  layout() {
    const { width, height } = this.scale;
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
    for (const [note,view] of this.noteViews) if (!note.auto) view.setBackgroundColor(this.appearance.noteColor);
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
    const zoomDecay=1-Math.exp(-this.game.loop.delta/90);
    this.beatZoom=Phaser.Math.Linear(this.beatZoom,0,zoomDecay);
    if (this.beatZoom<.0002) this.beatZoom=0;
    this.cameras.main.setZoom(1+this.beatZoom);
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
      }
    }
    const approachMs=this.approachMs/Math.max(.1,Number(this.chart.scrollSpeed)||1);
    const visible=new Set();
    for (let index=this.scanStart;index<this.chart.notes.length;index++) {
      const note=this.chart.notes[index];
      const delta=note.time+this.chart.offset-now;
      if (delta>approachMs) break;
      if (this.clock.running && note.auto && delta <= 0) { note._hit=true; continue; }
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
        const color=note.auto?'#4d4964':this.appearance.noteColor;
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
    for (const view of this.noteViews.values()) view.destroy();
    this.noteViews.clear();
    this.lastBeat=-1;
    this.scanStart=0;
    this.beatZoom=0;
    this.cameras?.main?.setZoom(1);
  }
}
