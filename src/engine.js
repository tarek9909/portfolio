import {
  AdditiveBlending, BackSide, BoxGeometry, BufferAttribute, BufferGeometry, CanvasTexture, ClampToEdgeWrapping, Clock, Color, ConeGeometry, CylinderGeometry, DirectionalLight, DoubleSide, ExtrudeGeometry, Float32BufferAttribute, FogExp2, Group, HalfFloatType, HemisphereLight, IcosahedronGeometry, InstancedMesh, LineBasicMaterial, LineSegments, LinearEncoding, Matrix4, Mesh, MeshBasicMaterial, MeshPhysicalMaterial, MeshStandardMaterial, MultiplyBlending, NoToneMapping, Object3D, PMREMGenerator, PerspectiveCamera, PlaneGeometry, PointLight, Points, PointsMaterial, Raycaster, RepeatWrapping, Scene, ShaderMaterial, Shape, SphereGeometry, SpotLight, Sprite, SpriteMaterial, TextureLoader, TorusGeometry, Vector2, Vector3, WebGLRenderTarget, WebGLRenderer, sRGBEncoding,
} from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import * as BufferGeometryUtils from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";
import { DATA, KIND, N, pad } from "./data.js";
import { SECTIONS, COURSE, TURNS, GANTRIES, CROSSINGS, STOPS, END_S as END, ROAD_S0, ROAD_S1, nearestStop, stopAtOrBefore, stopAtOrAfter } from "./course.js";

// named imports (not `import * as`) so the unused parts of three.js are tree-shaken out of the bundle
const THREE = { AdditiveBlending, BackSide, BoxGeometry, BufferAttribute, BufferGeometry, CanvasTexture, ClampToEdgeWrapping, Clock, Color, ConeGeometry, CylinderGeometry, DirectionalLight, DoubleSide, ExtrudeGeometry, Float32BufferAttribute, FogExp2, Group, HalfFloatType, HemisphereLight, IcosahedronGeometry, InstancedMesh, LineBasicMaterial, LineSegments, LinearEncoding, Matrix4, Mesh, MeshBasicMaterial, MeshPhysicalMaterial, MeshStandardMaterial, MultiplyBlending, NoToneMapping, Object3D, PMREMGenerator, PerspectiveCamera, PlaneGeometry, PointLight, Points, PointsMaterial, Raycaster, RepeatWrapping, Scene, ShaderMaterial, Shape, SphereGeometry, SpotLight, Sprite, SpriteMaterial, TextureLoader, TorusGeometry, Vector2, Vector3, WebGLRenderTarget, WebGLRenderer, sRGBEncoding, EffectComposer, RenderPass, ShaderPass, UnrealBloomPass, BufferGeometryUtils };

export function createEngine(host, onState, onProgress, onReady, opts={}){
  const T = THREE;
  const Lc = hex => new T.Color(hex).convertSRGBToLinear();
  const W0 = () => host.clientWidth || innerWidth, H0 = () => host.clientHeight || innerHeight;
  const small = Math.min(innerWidth, innerHeight) < 700;
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  if(opts.tier==="none") throw new Error("no hardware WebGL");
  // LOW (integrated / mobile GPUs): no bloom, no real lamp or headlight lights, no clearcoat,
  // lighter rain and fireworks, lower resolution. The look leans on the additive fakes that are already there.
  const LOW = opts.tier==="low";

  const renderer = new T.WebGLRenderer({antialias:false, powerPreference:LOW?"default":"high-performance", stencil:false});
  // render resolution adapts to the frame rate (see "Adaptive resolution" in the loop)
  // start sharp (native pixels, up to 2x on high) and only step down if frames are slow: blur is the
  // most visible cost, so the low tier sheds effects first and keeps resolution near native
  const DPR = window.devicePixelRatio || 1, QMAX = Math.min(DPR, LOW ? 1 : 2), QMIN = Math.min(QMAX, 0.75);
  let PR = QMAX;
  renderer.setPixelRatio(PR);
  renderer.setSize(W0(), H0());
  renderer.outputEncoding = T.LinearEncoding;
  renderer.toneMapping = T.NoToneMapping;
  host.appendChild(renderer.domElement);
  const maxAniso = Math.min(LOW ? 4 : 8, renderer.capabilities.getMaxAnisotropy());

  const scene = new T.Scene();
  const FOG = Lc("#141c33"), FOG_D = 0.0058;
  // catalogue billboards: overhead, this far past their stop, bottom edge high enough to clear traffic
  const BB_W=12, BB_H=6.75, BB_AHEAD=14, BB_Y=5.8;
  scene.fog = new T.FogExp2(FOG, FOG_D);
  const camera = new T.PerspectiveCamera(40, W0()/H0(), 0.1, 3200);

  /* Environment reflections: dark dome with sodium and moon softboxes */
  const pmrem = new T.PMREMGenerator(renderer);
  const es = new T.Scene();
  es.add(new T.Mesh(new T.SphereGeometry(60,32,16), new T.MeshBasicMaterial({color:Lc("#0a1124"), side:T.BackSide})));
  const strip = (w,h,c,x,y,z,rx,ry) => { const m = new T.Mesh(new T.PlaneGeometry(w,h), new T.MeshBasicMaterial({color:c, side:T.DoubleSide})); m.position.set(x,y,z); m.rotation.set(rx||0, ry||0, 0); es.add(m); };
  strip(1.4,90,new T.Color().setRGB(6,2.8,0.9), 7,22,0, Math.PI/2);
  strip(1.4,90,new T.Color().setRGB(6,2.8,0.9),-7,22,0, Math.PI/2);
  strip(22,7,new T.Color().setRGB(1.6,1.9,2.7), 0,30,-6, Math.PI/2);
  strip(110,9,new T.Color().setRGB(0.55,0.26,0.08), 52,5,0, 0,-Math.PI/2);
  strip(110,7,new T.Color().setRGB(0.12,0.17,0.32),-52,7,0, 0, Math.PI/2);
  const envTex = pmrem.fromScene(es, 0.02).texture;
  scene.environment = envTex;

  scene.add(new T.HemisphereLight(Lc("#4a64a8"), Lc("#0c0c12"), 0.6));
  const moonDir = new T.Vector3(-0.62,0.2,-0.76).normalize();
  const dl = new T.DirectionalLight(Lc("#a8bbff"), 0.55); dl.position.copy(moonDir).multiplyScalar(100); scene.add(dl);

  /* Sky, stars, moon (follow the camera) */
  const skyGroup = new T.Group(); skyGroup.userData.dyn=true; scene.add(skyGroup);
  const skyMat = new T.ShaderMaterial({
    side:T.BackSide, depthWrite:false, fog:false,
    uniforms:{uTop:{value:new T.Color().setRGB(0.0015,0.0028,0.009)}, uHor:{value:FOG.clone()}, uGlow:{value:new T.Color().setRGB(0.10,0.045,0.014)}, uMoon:{value:moonDir}},
    vertexShader:"varying vec3 vP; void main(){ vP=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }",
    fragmentShader:`uniform vec3 uTop,uHor,uGlow,uMoon; varying vec3 vP;
      void main(){ vec3 d=normalize(vP); float h=d.y;
        vec3 c=mix(uHor,uTop,smoothstep(-0.02,0.42,h));
        float city=pow(max(d.x,0.0),2.0)*exp(-max(h,0.0)*8.0); c+=uGlow*city;
        float halo=pow(max(dot(d,uMoon),0.0),40.0); c+=vec3(0.05,0.06,0.09)*halo;
        if(h<0.0) c=uHor;
        gl_FragColor=vec4(c,1.0); }`
  });
  const sky = new T.Mesh(new T.SphereGeometry(1500,48,24), skyMat); sky.renderOrder=-10; skyGroup.add(sky);
  {
    const n=1600, pos=new Float32Array(n*3), col=new Float32Array(n*3);
    for(let i=0;i<n;i++){ const u=Math.random()*Math.PI*2, v=Math.acos(1-Math.random()*0.92); const r=1400;
      pos[i*3]=r*Math.sin(v)*Math.cos(u); pos[i*3+1]=r*Math.cos(v)+40; pos[i*3+2]=r*Math.sin(v)*Math.sin(u);
      const b=0.25+Math.pow(Math.random(),3)*1.6; col[i*3]=b*0.9; col[i*3+1]=b*0.95; col[i*3+2]=b; }
    const g=new T.BufferGeometry(); g.setAttribute("position",new T.BufferAttribute(pos,3)); g.setAttribute("color",new T.BufferAttribute(col,3));
    skyGroup.add(new T.Points(g, new T.PointsMaterial({size:1.5, sizeAttenuation:false, vertexColors:true, fog:false, depthWrite:false, transparent:true})));
  }
  const radialTex = (stops, size=256) => { const c=document.createElement("canvas"); c.width=c.height=size; const g=c.getContext("2d"); const gr=g.createRadialGradient(size/2,size/2,0,size/2,size/2,size/2); stops.forEach(s=>gr.addColorStop(s[0],s[1])); g.fillStyle=gr; g.fillRect(0,0,size,size); const t=new T.CanvasTexture(c); return t; };
  {
    const mt = radialTex([[0,"rgba(255,255,255,1)"],[0.09,"rgba(255,255,255,1)"],[0.11,"rgba(220,230,255,.35)"],[0.3,"rgba(160,180,255,.08)"],[1,"rgba(0,0,0,0)"]]);
    const moon = new T.Sprite(new T.SpriteMaterial({map:mt, color:new T.Color().setRGB(3.2,3.3,3.6), fog:false, depthWrite:false, transparent:true}));
    moon.position.copy(moonDir).multiplyScalar(1300); moon.scale.setScalar(260); skyGroup.add(moon);
  }

  /* Mountains of Mount Lebanon with village lights (follow camera) */
  const farGroup = new T.Group(); farGroup.userData.dyn=true; scene.add(farGroup);
  const ridgeH = (t,s) => 60 + s*(Math.sin(t*0.0042+s)*0.5 + Math.sin(t*0.0113+1.3*s)*0.28 + Math.sin(t*0.029+2.1)*0.14 + Math.sin(t*0.071+s)*0.06)*110;
  const ridge = (x, s, color, order) => {
    const seg=260, pos=[], idx=[];
    for(let i=0;i<=seg;i++){ const z=-2200+i*(4400/seg); const h=ridgeH(z,s); pos.push(x,-40,z, x,h,z); if(i<seg){ const a=i*2; idx.push(a,a+2,a+1, a+1,a+2,a+3); } }
    const g=new T.BufferGeometry(); g.setAttribute("position",new T.Float32BufferAttribute(pos,3)); g.setIndex(idx);
    const m=new T.Mesh(g,new T.MeshBasicMaterial({color, fog:false, side:T.DoubleSide})); m.renderOrder=order; farGroup.add(m);
  };
  ridge(820, 1.7, Lc("#121b35"), -8);
  ridge(560, 1.0, Lc("#0b1123"), -7);
  {
    const n=900, pos=new Float32Array(n*3);
    for(let i=0;i<n;i++){ const z=-1800+Math.random()*3600; const top=ridgeH(z,1.0); const y=-30+Math.pow(Math.random(),1.6)*(top+20)*0.92; pos[i*3]=556; pos[i*3+1]=y; pos[i*3+2]=z; }
    const g=new T.BufferGeometry(); g.setAttribute("position",new T.BufferAttribute(pos,3));
    const p=new T.Points(g,new T.PointsMaterial({size:2, sizeAttenuation:false, color:new T.Color().setRGB(1.5,0.7,0.25), fog:false, depthWrite:false, transparent:true})); p.renderOrder=-6; farGroup.add(p);
  }

  /* Road path: everything is authored in straight "road space" (x = across, z = -distance)
     and bent onto the course below; curvature is integrated into yaw and position lookup tables. */
  const S0=-700, S1=Math.ceil(END)+1600, SN_=S1-S0;
  /* The course itself (sections, U-turns, highway) is laid out from the CV data in course.js */
  const pathX=new Float32Array(SN_+1), pathZ=new Float32Array(SN_+1), pathH=new Float32Array(SN_+1), pathK=new Float32Array(SN_+1);
  {
    const raw=new Float32Array(SN_+1); let s=0;
    COURSE.forEach(([type,a,R])=>{ if(type==="S"){ s+=a; return; } const len=Math.abs(a)*Math.PI/180*R;
      for(let i=Math.ceil(s); i<s+len && i<=S1; i++) raw[i-S0]=Math.sign(a)/R; s+=len; });
    // soften each corner's entry and exit so the steering eases in (box blur keeps the total angle)
    const B=14; for(let i=0;i<=SN_;i++){ let acc=0; for(let k=-B;k<=B;k++){ const j=i+k; if(j>=0&&j<=SN_) acc+=raw[j]; } pathK[i]=acc/(2*B+1); }
    // integrate outward from s=0 so the start of the drive stays at the origin, heading -z
    const i0=-S0;
    for(let i=i0+1;i<=SN_;i++){ pathH[i]=pathH[i-1]+pathK[i-1]; const h=(pathH[i]+pathH[i-1])/2; pathX[i]=pathX[i-1]+Math.sin(h); pathZ[i]=pathZ[i-1]-Math.cos(h); }
    for(let i=i0-1;i>=0;i--){ pathH[i]=pathH[i+1]-pathK[i]; const h=(pathH[i]+pathH[i+1])/2; pathX[i]=pathX[i+1]-Math.sin(h); pathZ[i]=pathZ[i+1]+Math.cos(h); }
  }
  const sample=(arr,s)=>{ const f=Math.min(SN_-1e-4,Math.max(0,s-S0)), i=f|0, t=f-i; return arr[i]+(arr[i+1]-arr[i])*t; };
  /** Yaw of the road at distance s (radians, positive turns right toward +x). */
  const yawAt = s => sample(pathH,s);
  /** Curvature (dYaw/ds) at distance s. */
  const curveAt = s => sample(pathK,s);
  /** True when a road-space point would land on, or too near, another stretch of road
      (e.g. folded through the inside of a hairpin). margin = how much clear space it needs. */
  const crowded = (x,z,margin) => {
    const s=-z, px=sample(pathX,s)+Math.cos(yawAt(s))*x, pz=sample(pathZ,s)+Math.sin(yawAt(s))*x;
    const skip=Math.abs(x)*1.6+12, need=Math.abs(x)+margin;
    for(let q=-260;q<=S1-200;q+=3){ if(Math.abs(q-s)<skip) continue;
      const dx=pathX[q-S0]-px, dz=pathZ[q-S0]-pz; if(dx*dx+dz*dz<need*need) return true; }
    return false;
  };
  /** Map a road-space point (x across, y up, z = -distance) into world space. */
  const bend = (x,y,z,out=new T.Vector3()) => { const s=-z, h=sample(pathH,s); return out.set(sample(pathX,s)+Math.cos(h)*x, y, sample(pathZ,s)+Math.sin(h)*x); };
  /** Bend every vertex (and normal) of a geometry authored in road space. */
  const bendGeo = g => {
    const p=g.attributes.position, n=g.attributes.normal, v=new T.Vector3();
    for(let i=0;i<p.count;i++){
      const s=-p.getZ(i), h=yawAt(s);
      bend(p.getX(i),p.getY(i),p.getZ(i),v); p.setXYZ(i,v.x,v.y,v.z);
      if(n){ const nx=n.getX(i), nz=n.getZ(i), c=Math.cos(h), sn=Math.sin(h); n.setXYZ(i, nx*c-nz*sn, n.getY(i), nx*sn+nz*c); }
    }
    p.needsUpdate=true; if(n) n.needsUpdate=true; g.computeBoundingSphere(); g.computeBoundingBox(); return g;
  };
  /** Place an Object3D (used to build instance matrices) at a road-space point, turned with the road. */
  const placeOnRoad = (o,x,y,z,extraYaw=0) => { bend(x,y,z,o.position); o.rotation.y=extraYaw-yawAt(-z); return o; };
  /* The U-turns each get their own set piece, built around the centre of the hairpin */
  const UT=TURNS;
  const turnFor=key=>TURNS.find(t=>SECTIONS[t.section].scene===key);
  // every bend gets its set piece; scenes repeat when there are more bends than scenes (see sceneFor in server/rules.js)
  const turnsFor=key=>TURNS.filter(t=>SECTIONS[t.section].scene===key);
  const turnCentre=t=>bend(t.side*t.R,0,-t.s0);
  const CLEARING_R={grid:42, neon:30};
  const CLEARINGS=UT.map(t=>({c:turnCentre(t), r:CLEARING_R[SECTIONS[t.section].scene]||20}));
  // room for the section billboard that stands beside each U-turn entrance
  const BOARD_X=22, BOARD_LEAD=20;
  TURNS.forEach(t=>CLEARINGS.push({c:bend(t.side*(BOARD_X+3),0,-(t.s0-BOARD_LEAD)), r:15}));
  const inClearing=(x,z)=>{ const p=bend(x,0,z); return CLEARINGS.some(k=>p.distanceTo(k.c)<k.r); };

  /* Cross roads (laid out in course.js): straight streets and bridges between neighbouring legs.
     Each one needs a gap in the kerbs, walls, rails, lamps and palms on the side where it joins. */
  const LINK_W=12;
  const LINKS=CROSSINGS.map(c=>{ const a=bend(0,0,-c.sA), b=bend(0,0,-c.sB), dir=b.clone().sub(a);
    const len=dir.length(); dir.normalize(); return {...c, a, b, len, dir, perp:new T.Vector3(-dir.z,0,dir.x)}; });
  const GAPS=[]; LINKS.forEach(l=>{ GAPS.push({s:l.sA, side:l.side}); GAPS.push({s:l.sB, side:l.side}); });
  /** Is road distance s on the given side inside a junction gap? */
  const inGap=(s,side,half=LINK_W/2+1.5)=>GAPS.some(g=>g.side===side&&Math.abs(g.s-s)<half);
  const segDist=(px,pz,a,b)=>{ const dx=b.x-a.x, dz=b.z-a.z, t=Math.max(0,Math.min(1,((px-a.x)*dx+(pz-a.z)*dz)/(dx*dx+dz*dz))); return Math.hypot(px-a.x-dx*t, pz-a.z-dz*t); };
  /** Is a world point within margin of a cross road's carriageway? */
  const nearLink=(p,margin)=>LINKS.some(l=>segDist(p.x,p.z,l.a,l.b)<LINK_W/2+margin);

  /* Where the car may drive: a coarse occupancy map of every carriageway (main road, streets, bridges).
     Anything else (buildings, kerbs, the sea) blocks the car. */
  const DRIVE_RES=0.5, LAT_DRIVE=5.9;
  const drive=(()=>{
    let x0=1e9,z0=1e9,x1=-1e9,z1=-1e9;
    for(let s=ROAD_S0;s<=ROAD_S1;s+=4){ const x=sample(pathX,s), z=sample(pathZ,s); x0=Math.min(x0,x); x1=Math.max(x1,x); z0=Math.min(z0,z); z1=Math.max(z1,z); }
    x0-=20; z0-=20; x1+=20; z1+=20;
    const W=Math.ceil((x1-x0)/DRIVE_RES), H=Math.ceil((z1-z0)/DRIVE_RES), cells=new Uint8Array(W*H);
    const mark=(x,z)=>{ const i=((x-x0)/DRIVE_RES)|0, j=((z-z0)/DRIVE_RES)|0; if(i>=0&&j>=0&&i<W&&j<H) cells[j*W+i]=1; };
    for(let s=ROAD_S0+4;s<=ROAD_S1-4;s+=0.3){ const h=yawAt(s), cx=sample(pathX,s), cz=sample(pathZ,s), c=Math.cos(h), sn=Math.sin(h);
      for(let l=-LAT_DRIVE;l<=LAT_DRIVE;l+=0.3) mark(cx+c*l, cz+sn*l); }
    LINKS.forEach(l=>{ for(let t=0;t<=l.len;t+=0.3) for(let w=-(LINK_W/2-1.1); w<=LINK_W/2-1.1; w+=0.3) mark(l.a.x+l.dir.x*t+l.perp.x*w, l.a.z+l.dir.z*t+l.perp.z*w); });
    return {x0,z0,W,H,cells, ok:(x,z)=>{ const i=((x-x0)/DRIVE_RES)|0, j=((z-z0)/DRIVE_RES)|0; return i>=0&&j>=0&&i<W&&j<H&&cells[j*W+i]===1; }};
  })();
  /** Does a car centred at (x,z) and facing th fit on a carriageway (centre, nose and tail)? */
  const fits=(x,z,th)=>{ const fx=Math.sin(th)*2.1, fz=-Math.cos(th)*2.1; return drive.ok(x,z)&&drive.ok(x+fx,z+fz)&&drive.ok(x-fx,z-fz); };
  /** Nearest point on the main road to a world point: road distance s and signed lateral offset. */
  const project=(x,z,out)=>{
    let best=1e18, bs=0;
    for(let s=ROAD_S0;s<=ROAD_S1;s+=4){ const dx=sample(pathX,s)-x, dz=sample(pathZ,s)-z, d=dx*dx+dz*dz; if(d<best){ best=d; bs=s; } }
    out.s=bs;
    for(let s=bs-4;s<=bs+4;s+=0.25){ const dx=sample(pathX,s)-x, dz=sample(pathZ,s)-z, d=dx*dx+dz*dz; if(d<best){ best=d; out.s=s; } }
    const h=yawAt(out.s); out.lat=(x-sample(pathX,out.s))*Math.cos(h)+(z-sample(pathZ,out.s))*Math.sin(h); return out;
  };

  /* Sea with moon path */
  const seaMat = new T.ShaderMaterial({
    uniforms:{uTime:{value:0}, uMoon:{value:moonDir}, uFog:{value:FOG}, uFogD:{value:FOG_D}},
    vertexShader:"varying vec3 vW; void main(){ vec4 w=modelMatrix*vec4(position,1.0); vW=w.xyz; gl_Position=projectionMatrix*viewMatrix*w; }",
    fragmentShader:`uniform float uTime,uFogD; uniform vec3 uMoon,uFog; varying vec3 vW;
      float hash(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
      float noise(vec2 p){ vec2 i=floor(p),f=fract(p); f=f*f*(3.0-2.0*f); return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y); }
      void main(){
        vec2 p=vW.xz*0.12;
        float n=noise(p+vec2(uTime*0.05,uTime*0.08))*0.6+noise(p*2.7-vec2(uTime*0.12,0.0))*0.3+noise(p*7.0+uTime*0.25)*0.1;
        vec3 col=vec3(0.004,0.011,0.022)+vec3(0.006,0.012,0.022)*n;
        vec3 V=normalize(cameraPosition-vW);
        vec2 toF=normalize(vW.xz-cameraPosition.xz); vec2 md=normalize(uMoon.xz);
        float al=max(dot(toF,md),0.0);
        float sp=smoothstep(0.6,0.96,noise(vW.xz*vec2(1.4,0.55)+uTime*vec2(0.35,0.9)));
        col+=vec3(0.78,0.85,1.0)*(pow(al,260.0)*sp*4.0+pow(al,26.0)*0.035);
        float fr=pow(1.0-max(V.y,0.0),5.0); col+=vec3(0.03,0.045,0.09)*fr;
        float d=length(vW-cameraPosition); float f=1.0-exp(-d*d*uFogD*uFogD); col=mix(col,uFog,clamp(f,0.0,1.0));
        gl_FragColor=vec4(col,1.0); }`
  });
  const sea = new T.Mesh(new T.PlaneGeometry(4000,4000), seaMat);
  sea.rotation.x=-Math.PI/2; sea.position.set(0,-1.4,0); sea.userData.dyn=true; scene.add(sea);

  /* Road */
  const ROAD_L = END + 900, ROAD_Z = -END/2 - 250;
  const asphalt = () => {
    const c=document.createElement("canvas"); c.width=512; c.height=1024; const g=c.getContext("2d");
    g.fillStyle="#25262b"; g.fillRect(0,0,512,1024);
    const im=g.getImageData(0,0,512,1024), d=im.data;
    for(let i=0;i<d.length;i+=4){ const n=(Math.random()*24-12)|0; d[i]+=n; d[i+1]+=n; d[i+2]+=n+1; }
    g.putImageData(im,0,0);
    for(let i=0;i<46;i++){ g.fillStyle=`rgba(0,0,0,${Math.random()*0.22})`; g.beginPath(); g.ellipse(Math.random()*512,Math.random()*1024,20+Math.random()*90,50+Math.random()*180,0,0,7); g.fill(); }
    const px=m=>256+m*36.57;
    g.fillStyle="#cfccc4";
    g.fillRect(px(-6.6)-4,0,7,1024); g.fillRect(px(6.6)-3,0,7,1024);
    g.fillStyle="#e2c46a"; g.fillRect(px(-0.18)-3,0,5,1024); g.fillRect(px(0.18)-2,0,5,1024);
    g.fillStyle="#cfccc4";
    for(const m of [-3.4,3.4]) for(let y=0;y<1024;y+=1024/3) g.fillRect(px(m)-3,y+20,6,1024/3*0.38);
    const t=new T.CanvasTexture(c); t.encoding=T.sRGBEncoding; t.wrapS=T.ClampToEdgeWrapping; t.wrapT=T.RepeatWrapping; t.anisotropy=maxAniso; t.repeat.set(1,ROAD_L/28); return t;
  };
  const rough = () => {
    const c=document.createElement("canvas"); c.width=256; c.height=512; const g=c.getContext("2d");
    g.fillStyle="#8c8c8c"; g.fillRect(0,0,256,512);
    g.filter="blur(10px)";
    for(let i=0;i<34;i++){ const v=30+Math.random()*60|0; g.fillStyle=`rgb(${v},${v},${v})`; g.beginPath(); g.ellipse(Math.random()*256,Math.random()*512,12+Math.random()*50,30+Math.random()*90,0,0,7); g.fill(); }
    const t=new T.CanvasTexture(c); t.wrapT=T.RepeatWrapping; t.anisotropy=maxAniso; t.repeat.set(1,ROAD_L/28); return t;
  };
  const roadMat = new T.MeshStandardMaterial({map:asphalt(), roughnessMap:rough(), roughness:0.62, metalness:0, envMapIntensity:0.85});   // wet asphalt
  const SEGS=Math.ceil(ROAD_L/3);
  const onRoad = (geo,x,y) => bendGeo(geo.translate(x,y,ROAD_Z));
  scene.add(new T.Mesh(onRoad(new T.PlaneGeometry(14, ROAD_L, 1, SEGS).rotateX(-Math.PI/2),0,0), roadMat));

  const concrete = new T.MeshStandardMaterial({color:Lc("#3a3c44"), roughness:0.85, metalness:0, envMapIntensity:0.3});
  const curbM = new T.MeshStandardMaterial({color:Lc("#6f717a"), roughness:0.7, envMapIntensity:0.3});
  const metal = new T.MeshStandardMaterial({color:Lc("#9aa0ab"), roughness:0.35, metalness:0.9, envMapIntensity:0.8});
  const darkMetal = new T.MeshStandardMaterial({color:Lc("#1b1d23"), roughness:0.45, metalness:0.7, envMapIntensity:0.6});
  // kerbs, walls and rails run the length of the road in pieces, leaving gaps where cross roads join
  const box = (w,h,m,x,y) => {
    const side=Math.sign(x), cuts=GAPS.filter(g=>g.side===side).map(g=>[g.s-LINK_W/2-0.8, g.s+LINK_W/2+0.8]).sort((p,q)=>p[0]-q[0]);
    let from=ROAD_S0; const pieces=[];
    cuts.forEach(([a,b])=>{ if(a>from) pieces.push([from,a]); from=Math.max(from,b); }); pieces.push([from,ROAD_S1]);
    pieces.forEach(([a,b])=>{ const L=b-a; if(L<0.5) return;
      scene.add(new T.Mesh(bendGeo(new T.BoxGeometry(w,h,L,1,1,Math.max(1,Math.ceil(L/3))).translate(x,y,-(a+b)/2)),m)); });
  };
  box(4.4,0.18,concrete, 9.2,0.09);
  box(6,0.18,concrete,-10,0.09);
  box(0.25,0.22,curbM, 7.1,0.11);
  box(0.25,0.22,curbM,-7.1,0.11);
  box(0.5,1.6,concrete,-13.2,-0.7);
  box(0.06,0.06,metal,-12.9,1.05);
  box(0.04,0.04,metal,-12.9,0.6);
  /* City-side ground, so the sea stays on the corniche side through the bends */
  scene.add(new T.Mesh(onRoad(new T.PlaneGeometry(100, ROAD_L+300, 1, SEGS).rotateX(-Math.PI/2),61.4,-0.05),new T.MeshStandardMaterial({color:Lc("#14161c"), roughness:1, envMapIntensity:0.2})));
  {
    const n=Math.floor(ROAD_L/2.5), im=new T.InstancedMesh(new T.BoxGeometry(0.06,1.05,0.06), metal, n), d=new T.Object3D();
    for(let i=0;i<n;i++){ const z=ROAD_Z+ROAD_L/2-i*2.5; placeOnRoad(d,-12.9,0.6,z); d.scale.setScalar(inGap(-z,-1)?0:1); d.updateMatrix(); im.setMatrixAt(i,d.matrix); }
    scene.add(im);
  }

  /* Cross streets through the city and bridges over the sea channels */
  {
    const base=asphalt(), lampHead=new T.MeshBasicMaterial({color:new T.Color().setRGB(9,4.6,1.5)});
    const poolM=new T.MeshBasicMaterial({map:radialTex([[0,"rgba(255,255,255,1)"],[0.35,"rgba(255,255,255,.45)"],[1,"rgba(0,0,0,0)"]]), color:new T.Color().setRGB(0.3,0.15,0.05), transparent:true, blending:T.AdditiveBlending, depthWrite:false});
    const poleG=new T.CylinderGeometry(0.07,0.12,7.4,8).translate(0,3.7,0), headG=new T.BoxGeometry(0.8,0.12,0.32), poolG=new T.PlaneGeometry(12,12).rotateX(-Math.PI/2);
    LINKS.forEach(l=>{
      const g=new T.Group(); g.position.copy(l.a).lerp(l.b,0.5); g.rotation.y=Math.atan2(l.dir.x,l.dir.z); scene.add(g);
      const tex=base.clone(); tex.needsUpdate=true; tex.repeat.set(1,l.len/28);
      const road=new T.Mesh(new T.PlaneGeometry(LINK_W,l.len).rotateX(-Math.PI/2), new T.MeshStandardMaterial({map:tex, roughness:0.95, envMapIntensity:0.5}));
      road.position.y=-0.012; g.add(road);
      const span=l.len-2*13.6;   // between the two main roads' outer edges
      if(l.kind==="bridge"){
        const deck=new T.Mesh(new T.BoxGeometry(LINK_W+1.2,0.8,span),concrete); deck.position.y=-0.43; g.add(deck);
        [-1,1].forEach(sd=>{
          const wall=new T.Mesh(new T.BoxGeometry(0.35,0.9,span),concrete); wall.position.set(sd*(LINK_W/2+0.35),0.42,0); g.add(wall);
          const rail=new T.Mesh(new T.BoxGeometry(0.07,0.07,span),metal); rail.position.set(sd*(LINK_W/2+0.35),1.15,0); g.add(rail);
        });
        for(let z=-span/2+6; z<span/2-4; z+=18){ [-1,1].forEach(sd=>{ const p=new T.Mesh(new T.CylinderGeometry(0.7,0.9,7,10),concrete); p.position.set(sd*(LINK_W/2-1),-4.3,z); g.add(p); }); }
      } else {
        [-1,1].forEach(sd=>{ const kerb=new T.Mesh(new T.BoxGeometry(0.25,0.22,span),curbM); kerb.position.set(sd*(LINK_W/2+0.1),0.11,0); g.add(kerb);
          const walk=new T.Mesh(new T.BoxGeometry(3,0.16,span),concrete); walk.position.set(sd*(LINK_W/2+1.7),0.08,0); g.add(walk); });
      }
      // street lights along the link, alternating sides
      let k=0;
      for(let z=-span/2+8; z<span/2-6; z+=24, k++){ const sd=k%2?1:-1, x=sd*(LINK_W/2+0.9);
        const pole=new T.Mesh(poleG,darkMetal); pole.position.set(x,0,z); g.add(pole);
        const head=new T.Mesh(headG,lampHead); head.position.set(x-sd*1.1,7.3,z); g.add(head);
        const pool=new T.Mesh(poolG,poolM); pool.position.set(x-sd*3.2,0.03,z); g.add(pool); }
    });
  }

  /* Street lights: sodium heads, light pools, recycled dynamic lights */
  const LAMP_GAP=34, lamps=[];
  // lamp arms reach over the road at the billboards' height, so lamps beside a billboard are left out
  const atBoard=s=>STOPS.some(b=>Math.abs(s-b-BB_AHEAD)<7);
  for(let z=60; z>-(END+690); z-=LAMP_GAP){ lamps.push([1,z,inGap(-z,1,LINK_W/2+2)||atBoard(-z)]); lamps.push([-1,z-LAMP_GAP/2,inGap(LAMP_GAP/2-z,-1,LINK_W/2+2)||atBoard(LAMP_GAP/2-z)]); }
  {
    const n=lamps.length, d=new T.Object3D();
    const poles=new T.InstancedMesh(new T.CylinderGeometry(0.08,0.14,8.6,8).translate(0,4.3,0), darkMetal, n);
    const arms=new T.InstancedMesh(new T.BoxGeometry(3.4,0.1,0.12), darkMetal, n);
    const headMat=new T.MeshBasicMaterial({color:new T.Color().setRGB(9,4.6,1.5)});
    const heads=new T.InstancedMesh(new T.BoxGeometry(0.95,0.12,0.36), headMat, n);
    const poolMat=new T.MeshBasicMaterial({map:radialTex([[0,"rgba(255,255,255,1)"],[0.35,"rgba(255,255,255,.45)"],[1,"rgba(0,0,0,0)"]]), color:new T.Color().setRGB(0.34,0.17,0.05), transparent:true, blending:T.AdditiveBlending, depthWrite:false});
    const pools=new T.InstancedMesh(new T.PlaneGeometry(15,15).rotateX(-Math.PI/2), poolMat, n);
    lamps.forEach(([s,z,gone],i)=>{
      d.scale.setScalar(gone?0:1);   // lamps standing in a junction are left out
      placeOnRoad(d,s*8.6,0,z); d.updateMatrix(); poles.setMatrixAt(i,d.matrix);
      placeOnRoad(d,s*(8.6-1.7),8.5,z); d.updateMatrix(); arms.setMatrixAt(i,d.matrix);
      placeOnRoad(d,s*5.2,8.4,z); d.updateMatrix(); heads.setMatrixAt(i,d.matrix);
      placeOnRoad(d,s*5.0,0.035,z); d.updateMatrix(); pools.setMatrixAt(i,d.matrix);
    });
    scene.add(poles,arms,heads,pools);
  }
  const dyn=[]; for(let i=0;i<(LOW?0:2);i++){ const p=new T.PointLight(Lc("#ffae5a"), 4.2, 26, 2); scene.add(p); dyn.push(p); }

  /* Palms along the corniche */
  {
    const trunkG=new T.CylinderGeometry(0.11,0.2,7,7).translate(0,3.5,0);
    const fr=[];
    for(let k=0;k<10;k++){
      const g=new T.PlaneGeometry(0.6,3.6,1,10), p=g.attributes.position;
      for(let i=0;i<p.count;i++){ const x=p.getX(i), y=p.getY(i)+1.8, t=y/3.6; p.setXYZ(i, y*0.95, t*1.1-t*t*2.2, x*(1-t*0.75)); }
      g.rotateY(k*Math.PI*2/10+Math.random()*0.3); g.rotateZ(0); fr.push(g);
    }
    const frondG=T.BufferGeometryUtils.mergeBufferGeometries(fr); frondG.computeVertexNormals();
    // no palms in junctions, under the billboards, or in front of section boards on the sea side
    const blocksBoard=s=>STOPS.some(b=>Math.abs(s-b-BB_AHEAD)<10)||TURNS.some(t=>t.side<0&&Math.abs(s-t.s0+BOARD_LEAD)<14);
    const zs=[]; for(let z=40; z>-(END+690); z-=15) if(!inGap(-z,-1,LINK_W/2+3)&&!blocksBoard(-z)) zs.push(z);
    const trunks=new T.InstancedMesh(trunkG,new T.MeshStandardMaterial({color:Lc("#2d241b"),roughness:0.95}),zs.length);
    const fronds=new T.InstancedMesh(frondG,new T.MeshStandardMaterial({color:Lc("#1d3324"),roughness:0.8,side:T.DoubleSide}),zs.length);
    const d=new T.Object3D(), top=new T.Vector3();
    zs.forEach((z,i)=>{ placeOnRoad(d,-10.6+Math.random()*0.6,0.18,z+Math.random()*3); d.rotation.x=(Math.random()-0.5)*0.12; d.rotation.z=(Math.random()-0.3)*0.16; d.scale.setScalar(0.85+Math.random()*0.35); d.updateMatrix(); trunks.setMatrixAt(i,d.matrix);
      top.set(0,7,0).applyMatrix4(d.matrix); d.position.copy(top); d.rotation.set(0,Math.random()*6.28,0); d.updateMatrix(); fronds.setMatrixAt(i,d.matrix); });
    scene.add(trunks,fronds);
  }

  /* Beirut skyline: instanced towers with procedural windows */
  const bMat = new T.ShaderMaterial({
    uniforms:{uFog:{value:FOG}, uFogD:{value:FOG_D}},
    vertexShader:`varying vec3 vW; varying vec3 vN; varying vec3 vL; varying float vS;
      void main(){ mat4 m=modelMatrix*instanceMatrix; vec4 w=m*vec4(position,1.0); vW=w.xyz; vN=normal;
        vL=position*vec3(length(instanceMatrix[0].xyz),length(instanceMatrix[1].xyz),length(instanceMatrix[2].xyz));
        vS=instanceMatrix[3].x*0.137+instanceMatrix[3].z*0.711; gl_Position=projectionMatrix*viewMatrix*w; }`,
    fragmentShader:`uniform vec3 uFog; uniform float uFogD; varying vec3 vW; varying vec3 vN; varying vec3 vL; varying float vS;
      float hash(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
      void main(){
        vec3 col=vec3(0.006,0.007,0.011);
        if(abs(vN.y)<0.5){
          float a=abs(vN.x)>0.5?vL.z:vL.x;
          vec2 cell=vec2(floor(a/1.7),floor(vL.y/2.3)); vec2 f=vec2(fract(a/1.7),fract(vL.y/2.3));
          float win=step(0.16,f.x)*step(f.x,0.84)*step(0.22,f.y)*step(f.y,0.8);
          float h=hash(cell+vS); float lit=step(0.64,h);
          vec3 wc=mix(vec3(1.0,0.56,0.22),vec3(0.7,0.82,1.0),step(0.86,hash(cell*1.7+vS)));
          col+=win*(lit*wc*(0.35+1.4*hash(cell+3.1))+(1.0-lit)*vec3(0.012,0.015,0.024));
          if(vN.x<-0.5) col*=1.0; else col*=0.75;
        } else col*=0.6;
        float d=length(vW-cameraPosition); float fg=1.0-exp(-d*d*uFogD*uFogD); col=mix(col,uFog,clamp(fg,0.0,1.0));
        gl_FragColor=vec4(col,1.0); }`
  });
  {
    const items=[];
    for(let row=0; row<(small?4:6); row++){
      for(let z=120; z>-(END+690);){ const w=8+Math.random()*9, dpt=8+Math.random()*9; const h=row===0?10+Math.random()*22:16+Math.random()*(24+row*12);
        const bx=26+row*19+Math.random()*5;
        if(Math.random()>0.12 && !crowded(bx,z-dpt/2,17) && !inClearing(bx,z-dpt/2) && !nearLink(bend(bx,0,z-dpt/2),11)) items.push([bx, z-dpt/2, w, h, dpt]); z-=dpt+2+Math.random()*5; }
    }
    const im=new T.InstancedMesh(new T.BoxGeometry(1,1,1).translate(0,0.5,0), bMat, items.length), d=new T.Object3D();
    items.forEach((b,i)=>{ placeOnRoad(d,b[0],0,b[1]); d.scale.set(b[2],b[3],b[4]); d.updateMatrix(); im.setMatrixAt(i,d.matrix); });
    scene.add(im);
  }

  /* The car: procedural coupé */
  const car = new T.Group(); car.userData.dyn=true; scene.add(car);
  const body = new T.Group(); car.add(body);
  // clearcoat roughly doubles the shading cost, so the low tier gets plain standard paint and glass
  const Coat = LOW ? T.MeshStandardMaterial : T.MeshPhysicalMaterial, coat = o => { if(LOW){ delete o.clearcoat; delete o.clearcoatRoughness; } return new Coat(o); };
  const paint = coat({color:Lc("#c3c7cf"), metalness:0.82, roughness:LOW?0.22:0.27, clearcoat:1, clearcoatRoughness:0.03, envMapIntensity:1.6});
  const glass = coat({color:Lc("#050608"), metalness:0.9, roughness:0.04, clearcoat:1, envMapIntensity:1.8});
  const blackTrim = new T.MeshStandardMaterial({color:Lc("#0b0c0f"), roughness:0.5, metalness:0.3});
  const hlM=new T.MeshBasicMaterial({color:new T.Color(0,0,0)});
  const tlM=new T.MeshBasicMaterial({color:new T.Color().setRGB(9,0.35,0.25)});
  const revM=new T.MeshBasicMaterial({color:new T.Color().setRGB(0.04,0.04,0.045)});
  let spot, red, coneMat;
  {
    const s=new T.Shape();
    s.moveTo(2.30,0.30); s.lineTo(1.93,0.30);
    s.absarc(1.45,0.37,0.48,0,Math.PI,false);
    s.lineTo(0.97,0.30); s.lineTo(-0.97,0.30);
    s.absarc(-1.45,0.37,0.48,0,Math.PI,false);
    s.lineTo(-2.30,0.32); s.lineTo(-2.36,0.70);
    s.quadraticCurveTo(-2.37,0.93,-2.05,0.97);
    s.lineTo(-0.9,1.0); s.lineTo(0.9,0.98);
    s.quadraticCurveTo(1.65,0.93,2.12,0.77);
    s.quadraticCurveTo(2.40,0.66,2.37,0.46);
    s.lineTo(2.30,0.30);
    const g=new T.ExtrudeGeometry(s,{depth:1.68, bevelEnabled:true, bevelThickness:0.16, bevelSize:0.06, bevelSegments:8, curveSegments:28});
    g.translate(0,0,-0.84); body.add(new T.Mesh(g,paint));
    const c=new T.Shape();
    c.moveTo(-1.75,0.96); c.bezierCurveTo(-1.25,1.06,-0.95,1.31,-0.32,1.34);
    c.lineTo(0.18,1.33); c.quadraticCurveTo(0.72,1.26,1.18,0.96); c.lineTo(-1.75,0.96);
    const cg=new T.ExtrudeGeometry(c,{depth:1.22, bevelEnabled:true, bevelThickness:0.12, bevelSize:0.05, bevelSegments:6, curveSegments:24});
    cg.translate(0,0,-0.61); body.add(new T.Mesh(cg,glass));
    const sk=new T.Mesh(new T.BoxGeometry(1.9,0.1,2.02),blackTrim); sk.position.set(0,0.31,0); body.add(sk);
    const dif=new T.Mesh(new T.BoxGeometry(0.12,0.16,1.6),blackTrim); dif.position.set(-2.33,0.36,0); body.add(dif);
    const grille=new T.Mesh(new T.BoxGeometry(0.06,0.12,1.1),blackTrim); grille.position.set(2.36,0.42,0); body.add(grille);
    [-1,1].forEach(sd=>{ const hl=new T.Mesh(new T.BoxGeometry(0.08,0.045,0.46),hlM); hl.position.set(2.31,0.64,sd*0.62); hl.rotation.y=sd*0.18; body.add(hl);
      const mir=new T.Mesh(new T.BoxGeometry(0.22,0.1,0.14),paint); mir.position.set(0.95,1.04,sd*1.0); body.add(mir); });
    const tl=new T.Mesh(new T.BoxGeometry(0.05,0.05,1.78),tlM); tl.position.set(-2.37,0.80,0); body.add(tl);
    [-1,1].forEach(sd=>{ const rv=new T.Mesh(new T.BoxGeometry(0.04,0.07,0.22),revM); rv.position.set(-2.37,0.56,sd*0.58); body.add(rv); });
  }
  const wheels=[];
  {
    const tireM=new T.MeshStandardMaterial({color:Lc("#0d0d0f"), roughness:0.9});
    const rimM=new T.MeshStandardMaterial({color:Lc("#b9bec7"), roughness:0.22, metalness:1, envMapIntensity:1.4});
    const calM=new T.MeshStandardMaterial({color:Lc("#c8401d"), roughness:0.4});
    [[1.45,1],[1.45,-1],[-1.45,1],[-1.45,-1]].forEach(([x,sd])=>{
      const w=new T.Group(); w.position.set(x,0.37,sd*0.86);
      const inner=new T.Group(); inner.rotation.x=Math.PI/2; w.add(inner);
      inner.add(new T.Mesh(new T.CylinderGeometry(0.37,0.37,0.27,36),tireM));
      inner.add(new T.Mesh(new T.CylinderGeometry(0.26,0.26,0.28,36),rimM));
      for(let k=0;k<5;k++){ const sp=new T.Mesh(new T.BoxGeometry(0.06,0.3,0.42),rimM); sp.rotation.y=k*Math.PI*2/5; sp.position.y=0; inner.add(sp); }
      const cal=new T.Mesh(new T.BoxGeometry(0.16,0.12,0.06),calM); cal.position.set(0.1,0.12,sd*-0.05); w.add(cal);
      car.add(w); wheels.push(w);
    });
  }
  {
    const sh=new T.Mesh(new T.PlaneGeometry(5.8,2.8).rotateX(-Math.PI/2), new T.MeshBasicMaterial({map:radialTex([[0,"rgba(0,0,0,.85)"],[0.55,"rgba(0,0,0,.45)"],[1,"rgba(0,0,0,0)"]]), transparent:true, depthWrite:false}));
    sh.position.y=0.02; sh.name="procShadow"; car.add(sh);
    spot=new T.SpotLight(Lc("#eaf1ff"), 0, 70, 0.42, 0.55, 1.1); spot.position.set(2.2,0.66,0); if(!LOW) car.add(spot);   // low tier: the light cones carry the headlights
    const tgt=new T.Object3D(); tgt.position.set(26,-1.2,0); car.add(tgt); spot.target=tgt;
    // tail-light glow on the road: an additive decal rather than a real light
    red=new T.Mesh(new T.PlaneGeometry(3.4,3).rotateX(-Math.PI/2), new T.MeshBasicMaterial({map:radialTex([[0,"rgba(255,255,255,1)"],[1,"rgba(0,0,0,0)"]],64), color:new T.Color().setRGB(0.5,0.05,0.03), transparent:true, blending:T.AdditiveBlending, depthWrite:false}));
    red.position.set(-3.2,0.04,0); car.add(red);
    coneMat=new T.ShaderMaterial({transparent:true, depthWrite:false, blending:T.AdditiveBlending, side:T.DoubleSide, uniforms:{uI:{value:0}},
      vertexShader:"varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }",
      fragmentShader:"uniform float uI; varying vec2 vUv; void main(){ float a=pow(vUv.y,2.2)*0.07*uI; gl_FragColor=vec4(vec3(0.8,0.86,1.0)*a,1.0); }"});
    [-1,1].forEach(sd=>{ const h=16, th=Math.PI/2-0.06; const cone=new T.Mesh(new T.ConeGeometry(2.6,h,28,1,true),coneMat); cone.rotation.z=th; cone.position.set(2.32+Math.sin(th)*h/2,0.64-Math.cos(th)*h/2,sd*0.62); car.add(cone); });
  }
  car.rotation.y=Math.PI/2;

  /* High-detail car: Ferrari 458 Italia by vicent091036 (CC BY 4.0, via the three.js examples).
     It takes over the coupé's lamp materials so ignition, brake and reverse effects still work;
     if it can't load, the procedural coupé above stays. */
  const BASE=import.meta.env.BASE_URL;
  let modelWheels=null;
  const carReady=new Promise(res=>{
    const timer=setTimeout(res,12000);
    const finish=()=>{ clearTimeout(timer); res(); };
    const draco=new DRACOLoader(); draco.setDecoderPath(BASE+"draco/");
    const loader=new GLTFLoader(); loader.setDRACOLoader(draco);
    loader.load(BASE+"models/ferrari-lite.glb", gltf=>{
      const m=gltf.scene.children[0];
      const detail=new T.MeshStandardMaterial({color:0xffffff, metalness:1, roughness:0.4, envMapIntensity:1.4});
      const glassM=coat({color:0x1b2029, metalness:0.2, roughness:0, clearcoat:1, transparent:true, opacity:0.38, envMapIntensity:2});
      const set=(name,mat)=>{ const o=m.getObjectByName(name); if(o) o.material=mat; };
      set("body",paint); set("glass",glassM); set("lights",hlM); set("leds",hlM); set("lights_red",tlM);
      ["rim_fl","rim_fr","rim_rr","rim_rl","trim"].forEach(n=>set(n,detail));
      // at night, from outside, the cabin reads as one dark material and the brightwork as one metal;
      // sharing them lets those parts merge into a few draw calls
      const cabin=new T.MeshStandardMaterial({color:Lc("#1a1416"), roughness:0.75, metalness:0.1});
      m.traverse(o=>{ if(!o.isMesh||!o.material||o.material===paint||o.material===glassM||o.material===hlM||o.material===tlM) return;
        const n=(o.material.name||"").toLowerCase();
        if(/leather|interior|carbon|carpet|plastic/.test(n)) o.material=cabin;
        else if(/metal|chrome/.test(n)) o.material=detail; });
      modelWheels=["wheel_fl","wheel_fr","wheel_rl","wheel_rr"].map(n=>m.getObjectByName(n)).filter(Boolean);
      // merge the model's parts by material: the body as one set, each wheel as its own (wheels still spin/steer)
      const mergeParts=(root,skip)=>{ root.updateMatrixWorld(true); const inv=new T.Matrix4().copy(root.matrixWorld).invert(), by=new Map();
        root.traverse(o=>{ if(!o.isMesh||Array.isArray(o.material)) return; for(let p=o; p&&p!==root; p=p.parent) if(skip.includes(p)) return;
          const k=o.material.uuid+"|"+Object.keys(o.geometry.attributes).sort().join(",")+"|"+(o.geometry.index?"i":"n"); if(!by.has(k)) by.set(k,[]); by.get(k).push(o); });
        by.forEach(list=>{ if(list.length<2) return;
          const geo=T.BufferGeometryUtils.mergeBufferGeometries(list.map(o=>o.geometry.clone().applyMatrix4(new T.Matrix4().multiplyMatrices(inv,o.matrixWorld))),false);
          if(!geo) return; const mm=new T.Mesh(geo,list[0].material); root.add(mm); list.forEach(o=>o.parent.remove(o)); }); };
      mergeParts(m,modelWheels); modelWheels.forEach(w=>mergeParts(w,[]));
      modelWheels.forEach(w=>{ w.rotation.order="YXZ"; });
      m.rotation.y=-Math.PI/2;   // the model faces -z; the car group drives along +x
      const ao=new T.TextureLoader().load(BASE+"models/ferrari_ao.png");
      const shadow=new T.Mesh(new T.PlaneGeometry(0.655*4,1.3*4).rotateX(-Math.PI/2), new T.MeshBasicMaterial({map:ao, blending:T.MultiplyBlending, transparent:true, depthWrite:false}));
      shadow.position.y=0.01; shadow.renderOrder=2; m.add(shadow);
      body.children.forEach(o=>{ if(o.material===revM) o.position.x=-2.2; else o.visible=false; });
      wheels.forEach(w=>{ w.visible=false; });
      const ps=car.getObjectByName("procShadow"); if(ps) ps.visible=false;
      body.add(m);
      draco.dispose();
      finish();
    }, undefined, err=>{ console.warn("Car model failed to load; keeping the built-in coupé.", err); finish(); });
  });

  const dotTex = radialTex([[0,"rgba(255,255,255,1)"],[0.25,"rgba(255,255,255,.8)"],[1,"rgba(0,0,0,0)"]], 64);
  const additive = (color, extra) => Object.assign({color, transparent:true, blending:T.AdditiveBlending, depthWrite:false}, extra);

  /* Traffic: oncoming headlights and overtaking tail-lights, recycled around the camera */
  const TRAFFIC=[];
  [[-1.9,1,24,small?3:4]].forEach(([x,dir,sp,n])=>{
    for(let k=0;k<n;k++) TRAFFIC.push({x, dir, sp, z:-k*(620/n)-Math.random()*60});
  });
  const TN=TRAFFIC.length, TR_SPAN=620, TR_BACK=160;
  const sedan=(pts,depth)=>{ const s=new T.Shape(); s.moveTo(pts[0],pts[1]); for(let k=2;k<pts.length;k+=2) s.lineTo(pts[k],pts[k+1]);
    return new T.ExtrudeGeometry(s,{depth, bevelEnabled:true, bevelThickness:0.08, bevelSize:0.05, bevelSegments:3}).translate(0,0,-depth/2).rotateY(-Math.PI/2); };
  const tBody=new T.InstancedMesh(sedan([-2.2,0.28, 2.2,0.28, 2.27,0.62, 2.1,0.82, 0.9,0.92, 0.32,1.34, -1.0,1.36, -1.8,0.96, -2.22,0.9, -2.26,0.5],1.66), new T.MeshStandardMaterial({color:0xffffff, metalness:0.8, roughness:0.3, envMapIntensity:1.2}), TN);
  const tCab=new T.InstancedMesh(sedan([0.86,0.93, 0.31,1.31, -0.98,1.32, -1.7,0.97],1.72), glass, TN);
  const tWheel=new T.InstancedMesh(new T.CylinderGeometry(0.33,0.33,0.26,18).rotateZ(Math.PI/2), new T.MeshStandardMaterial({color:Lc("#0d0d0f"), roughness:0.9}), TN*4);
  scene.add(tWheel);
  const tHead=new T.InstancedMesh(new T.BoxGeometry(0.42,0.12,0.05), new T.MeshBasicMaterial({color:new T.Color().setRGB(7,7,7.8)}), TN*2);
  const tTail=new T.InstancedMesh(new T.BoxGeometry(0.42,0.1,0.05), new T.MeshBasicMaterial({color:new T.Color().setRGB(8,0.3,0.2)}), TN*2);
  const tPool=new T.InstancedMesh(new T.PlaneGeometry(4,11).rotateX(-Math.PI/2), new T.MeshBasicMaterial(additive(new T.Color().setRGB(0.22,0.24,0.3), {map:dotTex})), TN);
  const paints=["#1a1d24","#5a0f12","#e8e8ea","#0e2a4a","#2c2f36","#6b6e75"];
  for(let q=0;q<TN;q++) tBody.setColorAt(q, Lc(paints[q%paints.length]));
  scene.add(tBody,tCab,tHead,tTail,tPool);
  const tM=new T.Matrix4(), tO=new T.Matrix4(), tD=new T.Object3D();
  const placeAt=(im,idx,base,x,y,z)=>{ tO.makeTranslation(x,y,z); im.setMatrixAt(idx, tM.multiplyMatrices(base,tO)); };
  /** Moves the traffic; returns the oncoming car the player has just hit, if any. */
  function updateTraffic(dt, carZ, carX){
    let hit=null;
    TRAFFIC.forEach((c,q)=>{
      c.z+=c.dir*c.sp*dt;
      const rel=c.z-carZ; if(rel>TR_BACK) c.z-=TR_SPAN; else if(rel<TR_BACK-TR_SPAN) c.z+=TR_SPAN;
      if(c.cool>0) c.cool-=dt; else if(Math.abs(c.x-carX)<1.95 && Math.abs(rel)<4.6){ hit=c; c.cool=1.2; }
      placeOnRoad(tD,c.x,0,c.z,c.dir>0?0:Math.PI); tD.updateMatrix();
      const B=tD.matrix;
      tBody.setMatrixAt(q,B); tCab.setMatrixAt(q,B);
      placeAt(tHead,q*2,B,-0.6,0.66,2.3); placeAt(tHead,q*2+1,B,0.6,0.66,2.3);
      placeAt(tTail,q*2,B,-0.62,0.78,-2.3); placeAt(tTail,q*2+1,B,0.62,0.78,-2.3);
      placeAt(tPool,q,B,0,0.045,7.5);
      [[-0.8,1.4],[0.8,1.4],[-0.8,-1.4],[0.8,-1.4]].forEach(([wx,wz],w)=>placeAt(tWheel,q*4+w,B,wx,0.33,wz));
    });
    [tBody,tCab,tWheel,tHead,tTail,tPool].forEach(m=>{ m.instanceMatrix.needsUpdate=true; });
    return hit;
  }

  /* Lighthouse out on the point, sweeping two beams across the night */
  // out in the sea channel between the two legs of the first U-turn
  const LH=(t=>t?bend(t.side*t.R,0,-(t.s0-24)):bend(-60,0,-400))(turnFor("marina"));
  const lhBeams=new T.Group();
  let lhFlare;
  {
    const lh=new T.Group(); lh.position.copy(LH); scene.add(lh);
    const white=new T.MeshStandardMaterial({color:Lc("#d9d6cf"), roughness:0.8});
    const redBand=new T.MeshStandardMaterial({color:Lc("#8d1d1d"), roughness:0.7});
    const rock=new T.Mesh(new T.CylinderGeometry(9,13,3,9), concrete); rock.position.y=-0.6; lh.add(rock);
    for(let k=0;k<4;k++){ const seg=new T.Mesh(new T.CylinderGeometry(2.3-k*0.22-0.22,2.3-k*0.22,6,16), k%2?redBand:white); seg.position.y=1+k*6+3; lh.add(seg); }
    const room=new T.Mesh(new T.CylinderGeometry(1.5,1.5,2.2,12), new T.MeshBasicMaterial({color:new T.Color().setRGB(4,3.2,1.6)})); room.position.y=26.1; lh.add(room);
    const cap=new T.Mesh(new T.ConeGeometry(1.9,1.8,12), darkMetal); cap.position.y=28.1; lh.add(cap);
    lhBeams.position.y=26.1; lhBeams.userData.dyn=true; lh.add(lhBeams);
    const beamMat=new T.ShaderMaterial({transparent:true, depthWrite:false, blending:T.AdditiveBlending, side:T.DoubleSide, fog:false,
      vertexShader:"varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }",
      fragmentShader:"varying vec2 vUv; void main(){ float a=pow(vUv.y,2.4)*0.085; gl_FragColor=vec4(vec3(1.0,0.9,0.7)*a,1.0); }"});
    [0,Math.PI].forEach(r=>{ const g=new T.ConeGeometry(16,300,24,1,true).translate(0,-150,0).rotateZ(Math.PI/2-0.03); const m=new T.Mesh(g,beamMat); m.rotation.y=r; lhBeams.add(m); });
    lhFlare=new T.Sprite(new T.SpriteMaterial(additive(new T.Color().setRGB(4,3.4,2.2), {map:dotTex, fog:false})));
    lhFlare.position.y=26.1; lhFlare.scale.setScalar(10); lh.add(lhFlare);
  }

  /* Fishing boats bobbing on the sea */
  const BOATS=small?10:18, boatPos=new Float32Array(BOATS*3), boatSeed=[];
  for(let q=0, tries=0;q<BOATS&&tries<400;tries++){ const bx=-24-Math.random()*60, bz=80-Math.random()*(END+500); if(crowded(bx,bz,12)||inClearing(bx,bz)) continue;
    const p=bend(bx,0,bz); boatSeed.push({x:p.x, z:p.z, ph:Math.random()*6.28, v:(Math.random()-0.5)*0.6}); q++; }
  const boatGeo=new T.BufferGeometry(); boatGeo.setAttribute("position",new T.BufferAttribute(boatPos,3));
  const boatCol=new Float32Array(BOATS*3); for(let q=0;q<BOATS;q++){ const w=Math.random()<0.25; boatCol.set(w?[2.4,0.5,0.3]:[2.6,2.0,1.2],q*3); }
  boatGeo.setAttribute("color",new T.BufferAttribute(boatCol,3));
  const boats=new T.Points(boatGeo,new T.PointsMaterial({size:3, sizeAttenuation:false, vertexColors:true, map:dotTex, fog:false, transparent:true, depthWrite:false, blending:T.AdditiveBlending}));
  boats.frustumCulled=false; scene.add(boats);

  /* Shooting stars */
  const meteorMat=new T.ShaderMaterial({transparent:true, depthWrite:false, blending:T.AdditiveBlending, fog:false, side:T.DoubleSide, uniforms:{uA:{value:0}},
    vertexShader:"varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }",
    fragmentShader:"uniform float uA; varying vec2 vUv; void main(){ float t=pow(vUv.x,4.0); float w=1.0-abs(vUv.y-0.5)*2.0; gl_FragColor=vec4(vec3(1.6,1.7,2.1)*t*w*w*uA,1.0); }"});
  const meteor=new T.Mesh(new T.PlaneGeometry(160,1.8),meteorMat); meteor.visible=false; meteor.renderOrder=-5; skyGroup.add(meteor);
  const mP=new T.Vector3(), mDir=new T.Vector3(), mZ=new T.Vector3(), mY=new T.Vector3(), mBasis=new T.Matrix4();
  let mLife=-1, mNext=2.5;
  function spawnMeteor(){
    camera.getWorldDirection(mP); mP.y=0; mP.normalize().applyAxisAngle(new T.Vector3(0,1,0),(Math.random()-0.5)*1.6);
    const el=0.25+Math.random()*0.45; mP.multiplyScalar(Math.cos(el)); mP.y=Math.sin(el); mP.normalize().multiplyScalar(1100);
    mDir.set(Math.random()-0.5,-0.55-Math.random()*0.3,Math.random()-0.5); const rn=mP.clone().normalize(); mDir.addScaledVector(rn,-mDir.dot(rn)).normalize();
    mLife=0;
  }
  function updateMeteor(dt){
    if(mLife<0){ mNext-=dt; if(mNext<=0) spawnMeteor(); meteor.visible=false; return; }
    mLife+=dt; const D=0.9; if(mLife>D){ mLife=-1; mNext=3+Math.random()*7; meteor.visible=false; return; }
    const pos=tmpM.copy(mP).addScaledVector(mDir,mLife*700);
    mZ.copy(pos).negate().normalize(); mY.crossVectors(mZ,mDir).normalize();
    mBasis.makeBasis(mDir,mY,mZ); meteor.quaternion.setFromRotationMatrix(mBasis); meteor.position.copy(pos);
    meteorMat.uniforms.uA.value=Math.sin(Math.PI*mLife/D); meteor.visible=true;
  }
  const tmpM=new T.Vector3();

  /* A plane on approach to Beirut airport, blinking */
  const plane=new T.Group(); skyGroup.add(plane);
  const beaconR=new T.Sprite(new T.SpriteMaterial(additive(new T.Color().setRGB(6,0.4,0.3), {map:dotTex, fog:false})));
  const beaconW=new T.Sprite(new T.SpriteMaterial(additive(new T.Color().setRGB(6,6,7), {map:dotTex, fog:false})));
  beaconR.scale.setScalar(9); beaconW.scale.setScalar(12); beaconW.position.x=6; plane.add(beaconR,beaconW);

  /* Rain: drops fall from the sky in a box that travels with the camera. They're drawn as short
     streaks along their motion relative to the camera, so they slant when the car is moving,
     and they burst into small splashes when they hit the ground. */
  const RN=LOW?(small?260:450):small?500:1100, RBOX=38, RTOP=22, WIND_X=2.4, WIND_Z=0.9, SPLASH=LOW?60:small?100:200;
  const rPos=new Float32Array(RN*6), drops=[];
  const rGeo=new T.BufferGeometry(); rGeo.setAttribute("position",new T.BufferAttribute(rPos,3));
  const rain=new T.LineSegments(rGeo,new T.LineBasicMaterial({color:new T.Color().setRGB(0.5,0.58,0.75), transparent:true, opacity:0.34, depthWrite:false}));
  rain.frustumCulled=false; scene.add(rain);
  const spPos=new Float32Array(SPLASH*3), spCol=new Float32Array(SPLASH*3), spLife=new Float32Array(SPLASH); let spHead=0;
  const spGeo=new T.BufferGeometry(); spGeo.setAttribute("position",new T.BufferAttribute(spPos,3)); spGeo.setAttribute("color",new T.BufferAttribute(spCol,3));
  const splashes=new T.Points(spGeo,new T.PointsMaterial({size:0.32, map:dotTex, vertexColors:true, transparent:true, blending:T.AdditiveBlending, depthWrite:false}));
  splashes.frustumCulled=false; scene.add(splashes);
  const sA=new T.Vector3(), sB=new T.Vector3(), rainCam=new T.Vector3(), rainCamPrev=new T.Vector3();
  const reseed=(d,cx,cz,top)=>{ d.x=cx+(Math.random()-0.5)*2*RBOX; d.z=cz+(Math.random()-0.5)*2*RBOX; d.y=top?RTOP+Math.random()*6:Math.random()*RTOP; d.v=22+Math.random()*9; return d; };
  for(let q=0;q<RN;q++) drops.push(reseed({},0,0,false));
  let rainReady=false, rainN=RN;
  function updateRain(dt,cam){
    if(!rainReady){ drops.forEach(d=>reseed(d,cam.x,cam.z,false)); rainCamPrev.copy(cam); rainReady=true; }
    // the camera's own velocity, so streaks slant the way rain does from a moving car
    rainCam.copy(cam).sub(rainCamPrev).divideScalar(Math.max(dt,1e-4)); rainCamPrev.copy(cam);
    const k=0.026, cvx=Math.max(-22,Math.min(22,rainCam.x)), cvz=Math.max(-22,Math.min(22,rainCam.z));   // capped, so it always reads as falling
    for(let q=0;q<rainN;q++){ const d=drops[q];
      d.x+=WIND_X*dt; d.z+=WIND_Z*dt; d.y-=d.v*dt;
      if(d.y<0){
        const i=spHead; spHead=(spHead+1)%SPLASH; spPos[i*3]=d.x; spPos[i*3+1]=0.06; spPos[i*3+2]=d.z; spLife[i]=0.22;
        reseed(d,cam.x,cam.z,true);
      }
      // keep the box centred on the camera
      if(d.x-cam.x>RBOX) d.x-=2*RBOX; else if(d.x-cam.x<-RBOX) d.x+=2*RBOX;
      if(d.z-cam.z>RBOX) d.z-=2*RBOX; else if(d.z-cam.z<-RBOX) d.z+=2*RBOX;
      const o=q*6; rPos[o]=d.x; rPos[o+1]=d.y; rPos[o+2]=d.z;
      rPos[o+3]=d.x-(WIND_X-cvx)*k; rPos[o+4]=d.y+d.v*k; rPos[o+5]=d.z-(WIND_Z-cvz)*k;
    }
    rGeo.attributes.position.needsUpdate=true;
    for(let i=0;i<SPLASH;i++){ if(spLife[i]>0){ spLife[i]-=dt; const f=Math.max(0,spLife[i]/0.22)*0.7; spCol[i*3]=f*0.8; spCol[i*3+1]=f*0.88; spCol[i*3+2]=f; } else spCol[i*3]=spCol[i*3+1]=spCol[i*3+2]=0; }
    spGeo.attributes.color.needsUpdate=true; spGeo.attributes.position.needsUpdate=true;
  }

  /* Fireworks over the city when you reach the last stop */
  const FW=LOW?(small?600:900):small?1200:2400, fwPos=new Float32Array(FW*3), fwVel=new Float32Array(FW*3), fwCol=new Float32Array(FW*3), fwBase=new Float32Array(FW*3), fwLife=new Float32Array(FW);
  let fwHead=0, fwNext=0.4;
  const fwGeo=new T.BufferGeometry(); fwGeo.setAttribute("position",new T.BufferAttribute(fwPos,3)); fwGeo.setAttribute("color",new T.BufferAttribute(fwCol,3));
  const fireworks=new T.Points(fwGeo,new T.PointsMaterial({size:2.8, map:dotTex, vertexColors:true, transparent:true, blending:T.AdditiveBlending, depthWrite:false, fog:false}));
  fireworks.frustumCulled=false; scene.add(fireworks);
  const fwPalette=["#ffb15e","#a9c6ff","#8fd6c0","#ff6b8b","#fff1c9"];
  function burst(x,y,z){
    const c=new T.Color(fwPalette[Math.random()*fwPalette.length|0]).multiplyScalar(9);
    const n=small?110:190, sp=14+Math.random()*10, ring=Math.random()<0.3;
    for(let q=0;q<n;q++){
      const k=fwHead; fwHead=(fwHead+1)%FW;
      let dx,dy,dz;
      if(ring){ const a=q/n*Math.PI*2; dx=Math.cos(a); dy=Math.sin(a); dz=(Math.random()-0.5)*0.15; }
      else { const u=Math.random()*2-1, a=Math.random()*Math.PI*2, r=Math.sqrt(1-u*u); dx=r*Math.cos(a); dy=u; dz=r*Math.sin(a); }
      const s=sp*(0.8+Math.random()*0.25);
      fwPos.set([x,y,z],k*3); fwVel.set([dx*s,dy*s,dz*s],k*3); fwBase.set([c.r,c.g,c.b],k*3); fwLife[k]=1.6+Math.random()*0.9;
    }
  }
  let fwHot=0;
  function updateFireworks(dt,t,cz,on){
    if(!on && fwHot<=0) return;
    fwHot-=dt;
    if(on){ fwNext-=dt; if(fwNext<=0){ fwNext=0.35+Math.random()*0.8; fwHot=3.5; const p=bend(-40+Math.random()*70, 20+Math.random()*18, cz-100-Math.random()*90, sA); burst(p.x,p.y,p.z); } }
    const drag=Math.exp(-dt*1.1);
    for(let k=0;k<FW;k++){
      if(fwLife[k]<=0){ if(fwCol[k*3]!==0){ fwCol[k*3]=fwCol[k*3+1]=fwCol[k*3+2]=0; } continue; }
      fwLife[k]-=dt; const i3=k*3;
      fwVel[i3]*=drag; fwVel[i3+1]=fwVel[i3+1]*drag-7*dt; fwVel[i3+2]*=drag;
      fwPos[i3]+=fwVel[i3]*dt; fwPos[i3+1]+=fwVel[i3+1]*dt; fwPos[i3+2]+=fwVel[i3+2]*dt;
      const f=Math.pow(Math.max(0,Math.min(1,fwLife[k])),1.5)*(fwLife[k]<0.6?(0.5+0.5*Math.sin(t*40+k)):1);
      fwCol[i3]=fwBase[i3]*f; fwCol[i3+1]=fwBase[i3+1]*f; fwCol[i3+2]=fwBase[i3+2]*f;
    }
    fwGeo.attributes.position.needsUpdate=true; fwGeo.attributes.color.needsUpdate=true;
  }

  /* ---------- U-turn set pieces ---------- */
  // Each piece is built in a "hairpin frame": origin at the turn centre, -z pointing into the
  // bend, +z back down the channel between the two legs (which sit at x = ±R).
  const ZONES=[], sceneUpdates=[];
  let pieceAt=null;
  const addUpdate=fn=>sceneUpdates.push({fn, at:pieceAt});
  const hairpinFrame=t=>{ const g=new T.Group(); pieceAt=g.position; g.position.copy(turnCentre(t)); g.rotation.y=-yawAt(t.s0); scene.add(g); g.updateMatrixWorld(); return g; };
  const glowPoints=(n,size,extra)=>{ const pos=new Float32Array(n*3), col=new Float32Array(n*3), geo=new T.BufferGeometry();
    geo.setAttribute("position",new T.BufferAttribute(pos,3)); geo.setAttribute("color",new T.BufferAttribute(col,3));
    const p=new T.Points(geo,new T.PointsMaterial(Object.assign({size, map:dotTex, vertexColors:true, transparent:true, blending:T.AdditiveBlending, depthWrite:false},extra)));
    p.frustumCulled=false; return {p,pos,col,geo}; };

  /* 1. The Marina: moored yachts strung with lights, a jetty, and lanterns rising off the water */
  turnsFor("marina").forEach(t=>{
    const F=hairpinFrame(t);
    ZONES.push({name:SECTIONS[t.section].title, scene:"The Marina", no:t.no, from:t.s0-40, to:t.s0+t.len+40, fog:Lc("#0d2c38"), centre:F.position.clone(), focus:F.localToWorld(new T.Vector3(0,5,45)), pull:0.75});
    const wood=new T.MeshStandardMaterial({color:Lc("#3b2a1e"), roughness:0.9});
    const jetty=new T.Mesh(new T.BoxGeometry(3.2,0.35,78),wood); jetty.position.set(0,-0.55,84); F.add(jetty);
    const jettyLights=glowPoints(16,2.4,{fog:true});
    for(let k=0;k<16;k++){ const side=k%2?1:-1; jettyLights.pos.set([side*1.6,0.1,47+Math.floor(k/2)*10],k*3); jettyLights.col.set([2.6,1.7,0.8],k*3); }
    F.add(jettyLights.p);
    const hullShape=new T.Shape(); hullShape.moveTo(-4.5,0); hullShape.lineTo(3.8,0); hullShape.quadraticCurveTo(4.9,0.4,5.1,1.5); hullShape.lineTo(-4.6,1.5); hullShape.lineTo(-4.5,0);
    const hullG=new T.ExtrudeGeometry(hullShape,{depth:2.6, bevelEnabled:true, bevelThickness:0.2, bevelSize:0.15, bevelSegments:2}).translate(0,-0.6,-1.3);
    const hullM=new T.MeshStandardMaterial({color:Lc("#d8dade"), roughness:0.4, metalness:0.1, envMapIntensity:0.8});
    const YN=14, yachts=[], yLights=glowPoints(YN*27,1.3,{fog:true});
    const yHull=new T.InstancedMesh(hullG,hullM,YN), yCab=new T.InstancedMesh(new T.BoxGeometry(3.4,1,2).translate(-0.6,1.4,0),glass,YN), yMast=new T.InstancedMesh(new T.CylinderGeometry(0.06,0.09,9,6).translate(0.6,5.4,0),darkMetal,YN);
    [yHull,yCab,yMast].forEach(im=>{ im.userData.dyn=true; F.add(im); });
    for(let k=0;k<YN;k++){
      const side=k%2?1:-1, y=new T.Object3D(); y.position.set(side*(7+Math.random()*1.5),-1.4,50+Math.floor(k/2)*10+Math.random()*2);
      y.rotation.y=Math.PI/2+(side>0?Math.PI:0);
      yachts.push({y, ph:Math.random()*6.28});
    }
    // string lights: bow -> masthead -> stern, sampled in yacht space and refreshed as the boats bob
    const bulbs=[]; for(let q=0;q<26;q++){ const u=q/25; bulbs.push(u<0.5? [5.0+(0.6-5.0)*u*2, 1.5+(10-1.5)*u*2] : [0.6+(-4.6-0.6)*(u-0.5)*2, 10+(1.5-10)*(u-0.5)*2]); }
    const lp=new T.Vector3();
    /* sky lanterns drifting up out of the bend */
    const LN=small?40:80, lan=glowPoints(LN,1.6,{fog:true}), lanSeed=[];
    const spawn=o=>{ o.x=(Math.random()-0.5)*70; o.z=-40+Math.random()*150; o.y=-1-Math.random()*30; o.v=0.9+Math.random()*1.3; o.ph=Math.random()*6.28; return o; };
    for(let k=0;k<LN;k++){ const o=spawn({}); o.y=Math.random()*55; lanSeed.push(o); }
    F.add(yLights.p, lan.p);
    addUpdate((tt,dt)=>{
      yachts.forEach((Y,k)=>{ Y.y.position.y=-1.4+Math.sin(tt*1.1+Y.ph)*0.12; Y.y.rotation.x=Math.sin(tt*0.9+Y.ph)*0.04; Y.y.updateMatrix();
        yHull.setMatrixAt(k,Y.y.matrix); yCab.setMatrixAt(k,Y.y.matrix); yMast.setMatrixAt(k,Y.y.matrix);
        lp.set(0.6,10,0).applyMatrix4(Y.y.matrix); const mi=(YN*26+k)*3, on=(tt+Y.ph)%2<0.3?1:0.25;   // blinking masthead light
        yLights.pos[mi]=lp.x; yLights.pos[mi+1]=lp.y; yLights.pos[mi+2]=lp.z; yLights.col[mi]=5*on; yLights.col[mi+1]=0.5*on; yLights.col[mi+2]=0.4*on;
        bulbs.forEach(([bx,by],q)=>{ lp.set(bx,by,0).applyMatrix4(Y.y.matrix); const i=(k*26+q)*3; yLights.pos[i]=lp.x; yLights.pos[i+1]=lp.y; yLights.pos[i+2]=lp.z;
          const tw=0.7+0.3*Math.sin(tt*3+q*1.7+k); yLights.col[i]=2.4*tw; yLights.col[i+1]=1.9*tw; yLights.col[i+2]=1.2*tw; });
      });
      yHull.instanceMatrix.needsUpdate=yCab.instanceMatrix.needsUpdate=yMast.instanceMatrix.needsUpdate=true;
      yLights.geo.attributes.position.needsUpdate=true; yLights.geo.attributes.color.needsUpdate=true;
      lanSeed.forEach((o,k)=>{ o.y+=o.v*dt; if(o.y>60) spawn(o);
        const i=k*3, fl=0.75+0.25*Math.sin(tt*9+o.ph*3), fade=Math.min(1,Math.max(0,(o.y+1)/3))*Math.min(1,(60-o.y)/15);
        lan.pos[i]=o.x+Math.sin(tt*0.4+o.ph)*2; lan.pos[i+1]=o.y; lan.pos[i+2]=o.z+Math.cos(tt*0.3+o.ph)*2;
        lan.col[i]=3.2*fl*fade; lan.col[i+1]=1.4*fl*fade; lan.col[i+2]=0.35*fl*fade; });
      lan.geo.attributes.position.needsUpdate=true; lan.geo.attributes.color.needsUpdate=true;
    });
  });

  /* 2. Neon Quarter: a tunnel of neon arches that chase the car, a hologram over the plaza, searchlights */
  turnsFor("neon").forEach(t=>{
    const F=hairpinFrame(t);
    ZONES.push({name:SECTIONS[t.section].title, scene:"Neon Quarter", no:t.no, from:t.s0-40, to:t.s0+t.len+40, fog:Lc("#2a1036"), centre:F.position.clone(), focus:F.localToWorld(new T.Vector3(0,26,0)), pull:0.4});
    const arcS=[]; for(let s=t.s0-35; s<=t.s0+t.len+35; s+=6) arcS.push(s);
    const arches=new T.InstancedMesh(new T.TorusGeometry(13,0.16,6,56,Math.PI), new T.MeshBasicMaterial({color:0xffffff}), arcS.length);
    const ad=new T.Object3D(), ac=new T.Color(), hueOf=k=>0.86-0.36*k/(arcS.length-1);
    arcS.forEach((s,k)=>{ placeOnRoad(ad,0,0,-s); ad.updateMatrix(); arches.setMatrixAt(k,ad.matrix); arches.setColorAt(k,ac.setHSL(hueOf(k),1,0.5)); });
    scene.add(arches);
    const holo=new T.Group(); holo.userData.dyn=true; holo.position.set(0,34,0); F.add(holo);
    const cyan=new T.MeshBasicMaterial({color:new T.Color().setRGB(0.6,3,3.4), wireframe:true});
    const pink=new T.MeshBasicMaterial({color:new T.Color().setRGB(3.4,0.5,2.6), wireframe:true});
    const outer=new T.Mesh(new T.IcosahedronGeometry(8,1),cyan), inner=new T.Mesh(new T.IcosahedronGeometry(4,0),pink); holo.add(outer,inner);
    const rings=[0,1,2].map(k=>{ const r=new T.Mesh(new T.TorusGeometry(12+k*2.2,0.12,6,80), k%2?pink:cyan); holo.add(r); return r; });
    const pillarMat=new T.ShaderMaterial({transparent:true, depthWrite:false, blending:T.AdditiveBlending, side:T.DoubleSide, fog:false, uniforms:{uT:{value:0}},
      vertexShader:"varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }",
      fragmentShader:"uniform float uT; varying vec2 vUv; void main(){ float band=0.6+0.4*sin(vUv.y*40.0-uT*6.0); float a=(1.0-vUv.y)*0.22*band; gl_FragColor=vec4(vec3(0.5,0.9,1.0)*a,1.0); }"});
    const pillar=new T.Mesh(new T.CylinderGeometry(3,5,34,24,1,true).translate(0,17,0),pillarMat); F.add(pillar);
    const pad=new T.Mesh(new T.CylinderGeometry(9,10,0.6,32), new T.MeshBasicMaterial({color:new T.Color().setRGB(0.25,0.9,1.1)})); pad.position.y=0.1; F.add(pad);
    const beamMat=new T.ShaderMaterial({transparent:true, depthWrite:false, blending:T.AdditiveBlending, side:T.DoubleSide, fog:false,
      vertexShader:"varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }",
      fragmentShader:"varying vec2 vUv; void main(){ float a=pow(vUv.y,2.0)*0.09; gl_FragColor=vec4(vec3(0.75,0.85,1.0)*a,1.0); }"});
    const beams=[0,1,2,3].map(k=>{ const piv=new T.Group(); piv.userData.dyn=true; piv.position.set(Math.cos(k*1.57)*7,0.5,Math.sin(k*1.57)*7);
      const cone=new T.Mesh(new T.ConeGeometry(7,220,20,1,true).translate(0,-110,0).rotateX(Math.PI),beamMat); piv.add(cone); F.add(piv); return piv; });
    addUpdate((tt,dt,car)=>{
      outer.rotation.set(tt*0.3,tt*0.45,0); inner.rotation.set(-tt*0.8,tt*0.6,tt*0.2);
      rings.forEach((r,k)=>{ r.rotation.set(tt*(0.4+k*0.17)+k,tt*(0.25-k*0.1),k*0.7); });
      holo.position.y=34+Math.sin(tt*0.8)*1.5; const pulse=1+0.06*Math.sin(tt*3); holo.scale.setScalar(pulse);
      pillarMat.uniforms.uT.value=tt;
      beams.forEach((b,k)=>{ b.rotation.set(0.35+0.2*Math.sin(tt*0.5+k),tt*0.4+k*1.57,0.3*Math.sin(tt*0.7+k*2)); });
      arcS.forEach((s,k)=>{ const chase=Math.pow(0.5+0.5*Math.sin(s*0.22-tt*7),8), near=Math.exp(-Math.pow((s-car)/14,2));
        ac.setHSL(hueOf(k),1,0.5).multiplyScalar(0.7+chase*2.4+near*3.5); arches.setColorAt(k,ac); });
      arches.instanceColor.needsUpdate=true;
    });
  });

  /* The Grid: a plaza of light columns that rise and fall like a live equaliser, ringed by orbiting cubes */
  turnsFor("grid").forEach(t=>{
    const F=hairpinFrame(t);
    ZONES.push({name:SECTIONS[t.section].title, scene:"The Grid", no:t.no, from:t.s0-40, to:t.s0+t.len+40, fog:Lc("#0b2a22"), centre:F.position.clone(), focus:F.localToWorld(new T.Vector3(0,9,0)), pull:0.6});
    const cells=[]; for(let gx=-9;gx<=9;gx++) for(let gz=-9;gz<=9;gz++){ const r=Math.hypot(gx,gz); if(r<=9.2) cells.push([gx*2.5,gz*2.5,r]); }
    const cols=new T.InstancedMesh(new T.BoxGeometry(1.8,1,1.8).translate(0,0.5,0), new T.MeshBasicMaterial({color:0xffffff}), cells.length);
    const deck=new T.Mesh(new T.CylinderGeometry(25,25.5,0.4,56), new T.MeshStandardMaterial({color:Lc("#0b0e14"), roughness:0.6, metalness:0.4})); deck.position.y=0.1; F.add(deck, cols);
    const ringPts=glowPoints(48,2.2,{fog:true}); for(let k=0;k<48;k++){ const a=k/48*Math.PI*2; ringPts.pos.set([Math.cos(a)*25.6,0.45,Math.sin(a)*25.6],k*3); } F.add(ringPts.p);
    const orbit=new T.Group(); orbit.userData.dyn=true; orbit.position.y=16; F.add(orbit);
    const cubeM=new T.MeshBasicMaterial({color:new T.Color().setRGB(2.4,1.3,0.45), wireframe:true});
    const cubes=[]; for(let k=0;k<12;k++){ const c=new T.Mesh(new T.BoxGeometry(1.6,1.6,1.6),cubeM); orbit.add(c); cubes.push(c); }
    const gd=new T.Object3D(), gc=new T.Color();
    addUpdate((tt)=>{
      cells.forEach(([x,z,r],k)=>{
        const h=0.8+9*Math.pow(0.5+0.5*Math.sin(r*0.9-tt*2.6),2)+2.5*(0.5+0.5*Math.sin(x*0.5+tt*1.7)*Math.cos(z*0.45-tt*1.3));
        gd.position.set(x,0.3,z); gd.scale.set(1,h,1); gd.updateMatrix(); cols.setMatrixAt(k,gd.matrix);
        const u=Math.min(1,h/13); gc.setHSL(0.52-u*0.44,0.95,0.5).multiplyScalar(0.18+u*u*1.3); cols.setColorAt(k,gc);
      });
      cols.instanceMatrix.needsUpdate=true; cols.instanceColor.needsUpdate=true;
      for(let k=0;k<48;k++){ const on=0.5+0.5*Math.sin(k*0.8-tt*5); ringPts.col.set([0.4+on*2.2,1.4+on*1.2,1.1+on*0.6],k*3); }
      ringPts.geo.attributes.color.needsUpdate=true;
      orbit.rotation.y=tt*0.35;
      cubes.forEach((c,k)=>{ const a=k/12*Math.PI*2; c.position.set(Math.cos(a)*18,Math.sin(tt*1.2+k)*2.6,Math.sin(a)*18); c.rotation.set(tt+k,tt*0.7+k,0); });
    });
  });

  /* 3. Luna Park: a lit Ferris wheel turning over the water, a nod to the one on Beirut's corniche */
  turnsFor("luna").forEach(t=>{
    const F=hairpinFrame(t);
    ZONES.push({name:SECTIONS[t.section].title, scene:"Luna Park", no:t.no, from:t.s0-40, to:t.s0+t.len+40, fog:Lc("#2c1b14"), centre:F.position.clone(), focus:F.localToWorld(new T.Vector3(0,30,14)), pull:0.85});
    const island=new T.Mesh(new T.CylinderGeometry(20,23,2.4,40),concrete); island.position.set(0,-0.8,14); F.add(island);
    const wheel=new T.Group(); wheel.userData.dyn=true; wheel.position.set(0,32,14); F.add(wheel);
    const Rw=26;
    { const parts=[-1.2,1.2].map(z=>new T.TorusGeometry(Rw,0.32,8,120).translate(0,0,z).toNonIndexed());
      for(let k=0;k<16;k++){ const a=k*Math.PI/8; parts.push(new T.BoxGeometry(0.18,Rw,0.18).translate(0,Rw/2,0).rotateZ(a).toNonIndexed()); }
      parts.forEach(p=>p.deleteAttribute("uv"));
      wheel.add(new T.Mesh(T.BufferGeometryUtils.mergeBufferGeometries(parts),metal)); }
    wheel.add(new T.Mesh(new T.CylinderGeometry(1.6,1.6,3.4,20).rotateX(Math.PI/2),darkMetal));
    [-1,1].forEach(sx=>[-1,1].forEach(sz=>{ const leg=new T.Mesh(new T.BoxGeometry(0.6,36,0.6),darkMetal); leg.position.set(sx*9,32-18+0.6,14+sz*3); leg.rotation.z=sx*0.27; leg.rotation.x=-sz*0.08; F.add(leg); }));
    const gond=new T.InstancedMesh(new T.BoxGeometry(2,1.8,2.2), new T.MeshBasicMaterial({color:0xffffff}), 16), gd=new T.Object3D();
    ["#ffb15e","#a9c6ff","#8fd6c0","#ff6b8b"].forEach((c,k)=>{ for(let q=k;q<16;q+=4) gond.setColorAt(q,Lc(c).multiplyScalar(0.9)); });
    gond.userData.dyn=true; F.add(gond);
    const RB=128, SB=16*6, wl=glowPoints(RB+SB,2.2,{fog:false});
    const local=[]; for(let k=0;k<RB;k++){ const a=k/RB*Math.PI*2; local.push([Math.cos(a)*Rw,Math.sin(a)*Rw]); }
    for(let k=0;k<16;k++) for(let q=1;q<=6;q++){ const a=k*Math.PI/8+Math.PI/2, r=q/6*Rw*0.94; local.push([Math.cos(a)*r,Math.sin(a)*r]); }
    wheel.add(wl.p); wl.p.position.z=1.4;
    const wc=new T.Color();
    addUpdate((tt)=>{
      const rot=tt*0.09; wheel.rotation.z=rot;
      local.forEach(([x,y],k)=>{ wl.pos[k*3]=x; wl.pos[k*3+1]=y; wl.pos[k*3+2]=0;
        const chase=k<RB?0.5+0.5*Math.sin(k*0.35-tt*5):0.5+0.5*Math.sin((k-RB)%6*1.2-tt*4);
        wc.setHSL(((k<RB?k/RB:0.08)+tt*0.03)%1,0.9,0.55).multiplyScalar(1.2+chase*3); wl.col[k*3]=wc.r; wl.col[k*3+1]=wc.g; wl.col[k*3+2]=wc.b; });
      wl.geo.attributes.position.needsUpdate=true; wl.geo.attributes.color.needsUpdate=true;
      for(let k=0;k<16;k++){ const a=k*Math.PI/8+rot; gd.position.set(Math.cos(a)*Rw,32+Math.sin(a)*Rw-1.6,14); gd.rotation.z=Math.sin(tt*1.3+k)*0.06; gd.updateMatrix(); gond.setMatrixAt(k,gd.matrix); }
      gond.instanceMatrix.needsUpdate=true;
    });
  });

  /* Billboards (the catalogue): overhead signs spanning the road a little past each stop,
     facing the approaching car, built like the section gantries. Click one to open it. */
  const panels=[], panelMeshes=[];
  const bbGroup=new T.Group(); scene.add(bbGroup);
  {
    const PY=BB_Y+BB_H/2, top=BB_Y+BB_H+0.6;
    const postG=new T.BoxGeometry(0.35,top,0.35).translate(0,top/2,0);
    DATA.forEach((it,i)=>{
      const g=new T.Group(); placeOnRoad(g,0,0,-STOPS[i]-BB_AHEAD); bbGroup.add(g);
      [-12.7,12.3].forEach(x=>{ const p=new T.Mesh(postG,darkMetal); p.position.x=x; g.add(p); });
      const beam=new T.Mesh(new T.BoxGeometry(25.4,0.5,0.5),darkMetal); beam.position.set(-0.2,top-0.25,-0.2); g.add(beam);
      const fr=new T.Mesh(new T.BoxGeometry(BB_W+0.5,BB_H+0.5,0.4),darkMetal); fr.position.set(0,PY,-0.2); g.add(fr);
      const mat=new T.MeshBasicMaterial({color:new T.Color().setScalar(0.7)});
      const sweep={value:-1};
      mat.onBeforeCompile=sh=>{ sh.uniforms.uSweep=sweep;
        sh.fragmentShader="uniform float uSweep;\n"+sh.fragmentShader.replace("#include <map_fragment>",
          "#include <map_fragment>\n float sw=smoothstep(0.07,0.0,abs(vUv.x+vUv.y*0.3-uSweep)); diffuseColor.rgb+=diffuseColor.rgb*sw*1.8+vec3(0.06,0.065,0.08)*sw;"); };
      const pnl=new T.Mesh(new T.PlaneGeometry(BB_W,BB_H),mat); pnl.position.set(0,PY,0.01); pnl.userData.stop=i; g.add(pnl); panelMeshes.push(pnl);
      const lip=new T.Mesh(new T.BoxGeometry(BB_W,0.06,0.08),new T.MeshBasicMaterial({color:new T.Color().setRGB(2.6,2.4,2.2)})); lip.position.set(0,BB_Y-0.15,0.1); g.add(lip);
      panels.push({mat, glow:0, flick:0, sweep, lip:lip.material});
    });
  }

  function wrapText(g,text,maxW){ const out=[]; let line=""; text.split(" ").forEach(w=>{ const t=line?line+" "+w:w; if(g.measureText(t).width>maxW && line){ out.push(line); line=w; } else line=t; }); if(line) out.push(line); return out; }
  function hexA(hex,a){ const n=parseInt(hex.slice(1),16); return `rgba(${n>>16},${(n>>8)&255},${n&255},${a})`; }
  function drawPanel(it,i){
    const W=1280,H=720,c=document.createElement("canvas"); c.width=W; c.height=H; const g=c.getContext("2d"); const acc=KIND[it.kind];
    g.fillStyle="#05070d"; g.fillRect(0,0,W,H);
    const gr=g.createRadialGradient(160,0,0,160,0,1000); gr.addColorStop(0,hexA(acc,0.2)); gr.addColorStop(1,"rgba(0,0,0,0)"); g.fillStyle=gr; g.fillRect(0,0,W,H);
    g.fillStyle="rgba(255,255,255,0.022)"; for(let y=0;y<H;y+=6) g.fillRect(0,y,W,2);
    const M=72;
    g.fillStyle=acc; g.fillRect(M,M,140,4);
    try{ g.letterSpacing="5px"; }catch(e){}
    g.font='400 24px "JetBrains Mono", monospace'; g.fillStyle="rgba(225,232,250,.6)"; g.textAlign="left"; g.fillText(`NO. ${pad(i+1)} / ${pad(N)}`,M,M+52);
    g.textAlign="right"; g.fillStyle=acc; g.fillText(it.kind.toUpperCase(),W-M,M+52);
    if(it.period){ g.fillStyle="rgba(225,232,250,.6)"; g.fillText(it.period.toUpperCase(),W-M,M+90); }
    try{ g.letterSpacing="0px"; }catch(e){}
    g.textAlign="left";
    let size=it.kind==="Driver"?112:92; g.font=`700 ${size}px Unbounded, sans-serif`;
    while(g.measureText(it.title).width>W-2*M && size>44){ size-=4; g.font=`700 ${size}px Unbounded, sans-serif`; }
    g.fillStyle="#f5f7fc"; g.fillText(it.title,M,262);
    g.font='500 40px "Hanken Grotesk", sans-serif'; g.fillStyle=acc; g.fillText(it.subtitle,M,326);
    let y=410;
    if(it.groups){
      const cw=(W-2*M)/3;
      it.groups.forEach(([h,list],k)=>{ const x=M+k*cw; try{g.letterSpacing="4px";}catch(e){} g.font='400 22px "JetBrains Mono", monospace'; g.fillStyle=acc; g.fillText(h.toUpperCase(),x,y); try{g.letterSpacing="0px";}catch(e){}
        g.font='400 29px "Hanken Grotesk", sans-serif'; g.fillStyle="rgba(228,233,244,.9)"; list.forEach((s,j)=>g.fillText(s,x,y+46+j*36)); });
    } else if(it.list){
      g.font='400 30px "Hanken Grotesk", sans-serif';
      it.list.forEach((s,j)=>{ g.fillStyle=acc; g.font='400 22px "JetBrains Mono", monospace'; g.fillText(pad(j+1),M,y+j*46); g.font='400 30px "Hanken Grotesk", sans-serif'; g.fillStyle="rgba(228,233,244,.9)"; g.fillText(s,M+56,y+j*46); });
    } else if(it.contact){
      g.font='500 54px Unbounded, sans-serif'; g.fillStyle="#f5f7fc"; g.fillText(it.contact.email,M,y+20);
      g.font='400 34px "JetBrains Mono", monospace'; g.fillStyle="rgba(228,233,244,.85)"; g.fillText(it.contact.phone,M,y+90);
      g.font='400 28px "Hanken Grotesk", sans-serif'; g.fillStyle="rgba(228,233,244,.6)"; g.fillText(it.body,M,y+150);
    } else {
      g.font='400 32px "Hanken Grotesk", sans-serif'; g.fillStyle="rgba(222,228,242,.86)";
      wrapText(g,it.body,W-2*M-80).slice(0,4).forEach((l,j)=>g.fillText(l,M,y+j*46));
    }
    const chips=it.tags||it.links;
    if(chips){ let x=M; const cy=H-M-44; g.font='500 24px "Hanken Grotesk", sans-serif';
      chips.forEach(t=>{ const w=g.measureText(t).width+36; if(x+w>W-M) return; g.strokeStyle=hexA(acc,0.55); g.lineWidth=2; g.strokeRect(x,cy,w,44); g.fillStyle="rgba(235,239,248,.9)"; g.fillText(t,x+18,cy+30); x+=w+12; }); }
    const t=new T.CanvasTexture(c); t.encoding=T.sRGBEncoding; t.anisotropy=maxAniso; return t;
  }

  /* Section gantries: an overhead sign on the highway before each U-turn, naming the section,
     how many stops it holds, and which way the road hairpins */
  const gantries=[];
  {
    const SW=15, SH=4.4, Y=11.4;
    const postG=new T.BoxGeometry(0.35,Y+SH/2+0.6,0.35).translate(0,(Y+SH/2+0.6)/2,0);
    GANTRIES.forEach(gt=>{
      const g=new T.Group(); placeOnRoad(g,0,0,-gt.s); scene.add(g);
      [-12.7,12.3].forEach(x=>{ const p=new T.Mesh(postG,darkMetal); p.position.x=x; g.add(p); });
      const beam=new T.Mesh(new T.BoxGeometry(25.4,0.5,0.5),darkMetal); beam.position.set(-0.2,Y+SH/2+0.35,0); g.add(beam);
      const frame=new T.Mesh(new T.BoxGeometry(SW+0.4,SH+0.4,0.25),darkMetal); frame.position.set(0,Y,-0.15); g.add(frame);
      const mat=new T.MeshBasicMaterial({color:new T.Color().setScalar(0.9)});
      const panel=new T.Mesh(new T.PlaneGeometry(SW,SH),mat); panel.position.set(0,Y,0.01); g.add(panel);
      const lampM=new T.MeshBasicMaterial({color:new T.Color().setRGB(5,4.6,4)});
      [-5,0,5].forEach(x=>{ const l=new T.Mesh(new T.BoxGeometry(0.9,0.12,0.5),lampM); l.position.set(x,Y+SH/2+0.12,0.45); g.add(l); });
      gantries.push({gt, mat, glow:0});
    });
  }
  function drawGantry({gt}){
    const sec=SECTIONS[gt.section], W=1600, H=470, c=document.createElement("canvas"); c.width=W; c.height=H; const g=c.getContext("2d");
    const acc=KIND[DATA[sec.items[0]].kind];
    g.fillStyle="#06080e"; g.fillRect(0,0,W,H);
    g.strokeStyle=hexA(acc,0.9); g.lineWidth=6; g.strokeRect(18,18,W-36,H-36);
    const M=70;
    try{ g.letterSpacing="6px"; }catch(e){}
    g.font='500 30px "JetBrains Mono", monospace'; g.fillStyle=acc; g.textAlign="left"; g.fillText(`SECTION ${pad(gt.no)}  ·  ${sec.sceneName.toUpperCase()}`,M,M+46);
    try{ g.letterSpacing="0px"; }catch(e){}
    let size=150; g.font=`700 ${size}px Unbounded, sans-serif`;
    while(g.measureText(sec.title.toUpperCase()).width>W-2*M-380 && size>70){ size-=6; g.font=`700 ${size}px Unbounded, sans-serif`; }
    g.fillStyle="#f5f7fc"; g.fillText(sec.title.toUpperCase(),M,M+50+size*0.98);
    const n=sec.items.length;
    g.font='400 36px "Hanken Grotesk", sans-serif'; g.fillStyle="rgba(228,233,244,.75)";
    g.fillText(`${n} ${n>1?"stops":"stop"} in the bend  ·  ${sec.items.map(i=>DATA[i].title).join(" · ")}`.slice(0,64),M,H-M+6);
    // U-turn arrow: up the right edge, hooks over and points back down, mirrored for left turns
    const ax=W-M-150, ay=H/2+70, r=78, dir=gt.side;
    g.save(); g.translate(ax,ay); if(dir<0) g.scale(-1,1);
    g.strokeStyle=acc; g.lineWidth=26; g.lineCap="round"; g.lineJoin="round";
    g.beginPath(); g.moveTo(-r,120); g.lineTo(-r,0); g.arc(0,0,r,Math.PI,0,false); g.lineTo(r,70); g.stroke();
    g.fillStyle=acc; g.beginPath(); g.moveTo(r-46,62); g.lineTo(r+46,62); g.lineTo(r,128); g.closePath(); g.fill();
    g.restore();
    const t=new T.CanvasTexture(c); t.encoding=T.sRGBEncoding; t.anisotropy=maxAniso; return t;
  }

  /* Section billboards: a big board beside each U-turn entrance, between the buildings,
     explaining what waits inside the bend */
  const sectionBoards=[];
  {
    const SW=21, SH=11.8, LIFT=4.2;
    TURNS.forEach(t=>{
      const g=new T.Group(); placeOnRoad(g,t.side*BOARD_X,0,-(t.s0-BOARD_LEAD),t.side*Math.atan2(-1,0.5)); scene.add(g);
      const postG=new T.CylinderGeometry(0.28,0.34,LIFT+2.2,12).translate(0,(LIFT+2.2)/2-1.8,0);
      [-6.5,6.5].forEach(x=>{ const p=new T.Mesh(postG,darkMetal); p.position.set(x,0,-0.2); g.add(p); });
      const fr=new T.Mesh(new T.BoxGeometry(SW+0.7,SH+0.7,0.5),darkMetal); fr.position.set(0,LIFT+SH/2,-0.3); g.add(fr);
      const mat=new T.MeshBasicMaterial({color:new T.Color().setScalar(0.85)});
      const pnl=new T.Mesh(new T.PlaneGeometry(SW,SH),mat); pnl.position.set(0,LIFT+SH/2,0.01); g.add(pnl);
      const lip=new T.Mesh(new T.BoxGeometry(SW,0.1,0.12),new T.MeshBasicMaterial({color:new T.Color().setRGB(3,2.7,2.3)})); lip.position.set(0,LIFT-0.1,0.25); g.add(lip);
      sectionBoards.push({t, mat});
    });
  }
  function drawSectionBoard({t}){
    const sec=SECTIONS[t.section], W=1600, H=900, c=document.createElement("canvas"); c.width=W; c.height=H; const g=c.getContext("2d");
    const acc=KIND[DATA[sec.items[0]].kind], M=80;
    g.fillStyle="#05070d"; g.fillRect(0,0,W,H);
    const gr=g.createRadialGradient(W*0.15,0,0,W*0.15,0,1300); gr.addColorStop(0,hexA(acc,0.24)); gr.addColorStop(1,"rgba(0,0,0,0)"); g.fillStyle=gr; g.fillRect(0,0,W,H);
    g.fillStyle="rgba(255,255,255,0.02)"; for(let y=0;y<H;y+=6) g.fillRect(0,y,W,2);
    g.fillStyle=acc; g.fillRect(M,M,180,6);
    try{ g.letterSpacing="6px"; }catch(e){}
    g.font='400 30px "JetBrains Mono", monospace'; g.fillStyle="rgba(225,232,250,.65)"; g.textAlign="left";
    g.fillText(`SECTION ${pad(t.no)} / ${pad(TURNS.length)}`,M,M+66);
    g.textAlign="right"; g.fillStyle=acc; g.fillText(`${t.side>0?"RIGHT":"LEFT"} U-TURN AHEAD`,W-M,M+66);
    try{ g.letterSpacing="0px"; }catch(e){}
    g.textAlign="left";
    let size=150; g.font=`700 ${size}px Unbounded, sans-serif`;
    while(g.measureText(sec.title).width>W-2*M && size>80){ size-=6; g.font=`700 ${size}px Unbounded, sans-serif`; }
    g.fillStyle="#f5f7fc"; g.fillText(sec.title,M,M+100+size*0.9);
    g.font='500 44px "Hanken Grotesk", sans-serif'; g.fillStyle=acc;
    g.fillText(`Inside the bend: ${sec.sceneName}`,M,M+170+size*0.9);
    let y=M+270+size*0.9;
    const rows=sec.items.slice(0,5), lh=Math.min(64,(H-M-y+40)/Math.max(1,rows.length));
    rows.forEach((idx,k)=>{ const it=DATA[idx];
      g.font='400 26px "JetBrains Mono", monospace'; g.fillStyle=hexA(KIND[it.kind],1); g.fillText(pad(idx+1),M,y+k*lh);
      g.font='500 38px "Hanken Grotesk", sans-serif'; g.fillStyle="rgba(240,243,250,.95)"; g.fillText(it.title,M+70,y+k*lh);
      const tw=g.measureText(it.title).width;
      g.font='400 32px "Hanken Grotesk", sans-serif'; g.fillStyle="rgba(210,218,235,.6)"; g.fillText(`  ·  ${it.subtitle}`,M+70+tw,y+k*lh); });
    const tex=new T.CanvasTexture(c); tex.encoding=T.sRGBEncoding; tex.anisotropy=maxAniso; return tex;
  }

  /* Post-processing: HDR bloom, then tone map, grade, vignette, grain */
  const rt=new T.WebGLRenderTarget(W0()*PR,H0()*PR,{type:T.HalfFloatType, samples:0});
  const composer=new T.EffectComposer(renderer,rt);
  composer.setPixelRatio(PR); composer.setSize(W0(),H0());
  composer.addPass(new T.RenderPass(scene,camera));
  const bloom=new T.UnrealBloomPass(new T.Vector2(W0(),H0()),0.85,0.6,0.92);
  { const set=bloom.setSize.bind(bloom); bloom.setSize=(w,h)=>set(Math.max(64,w*0.5),Math.max(64,h*0.5)); }   // bloom works at a quarter of the pixels
  let bloomOn=!LOW; if(bloomOn) composer.addPass(bloom);
  let degraded=LOW;
  /** Shed the expensive extras, one step per call: bloom first, then the real lights and half the rain.
      Returns false once there is nothing left to drop. */
  function degrade(){
    if(bloomOn){ bloomOn=false; composer.removePass(bloom); bloom.dispose(); return true; }
    if(!degraded){ degraded=true;
      dyn.forEach(L=>{ L.visible=false; }); dyn.length=0;
      car.remove(spot);   // the light cones carry the headlights, as on the low tier
      rainN=Math.round(RN/2); rGeo.setDrawRange(0,rainN*2);
      return true; }
    return false;
  }
  const grade=new T.ShaderPass({
    uniforms:{tDiffuse:{value:null}, uTime:{value:0}, uRes:{value:new T.Vector2(W0(),H0())}, uExp:{value:1.5}, uSpeed:{value:0}},
    vertexShader:"varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }",
    fragmentShader:`uniform sampler2D tDiffuse; uniform float uTime,uExp,uSpeed; uniform vec2 uRes; varying vec2 vUv;
      vec3 aces(vec3 x){ return clamp((x*(2.51*x+0.03))/(x*(2.43*x+0.59)+0.14),0.0,1.0); }
      vec3 srgb(vec3 c){ return mix(c*12.92,1.055*pow(c,vec3(1.0/2.4))-0.055,step(0.0031308,c)); }
      vec3 tap(vec2 uv,vec2 o){ return vec3(texture2D(tDiffuse,uv+o).r,texture2D(tDiffuse,uv).g,texture2D(tDiffuse,uv-o).b); }
      void main(){ vec2 d=vUv-0.5; float r=dot(d,d); vec2 o=d*r*0.01;
        vec3 c=tap(vUv,o);
        c*=uExp; c=aces(c);
        c=mix(c,c*vec3(1.03,1.0,1.06),0.6);
        c=srgb(c);
        c*=mix(1.0,0.42,smoothstep(0.12,0.62,r*1.5));
        float n=fract(sin(dot(vUv*uRes+fract(uTime)*91.0,vec2(12.9898,78.233)))*43758.5453);
        c+=(n-0.5)*0.03;
        gl_FragColor=vec4(c,1.0); }`
  });
  composer.addPass(grade);

  /* Camera choreography: a shot per catalogue stop */
  const SHOT={
    hero:{p:[5.4,1.15,-8.6], l:[0,0.75,0]},
    // the rest look ahead up the road at the overhead billboard (BB_AHEAD on, above the lanes),
    // aimed a little right of it so the board sits left of the info card
    side:{p:[-3.2,2.4,11.5], l:[3.2,5.4,-14]},
    chase:{p:[-1.0,3.4,14], l:[3.0,5.0,-14]},
    low:{p:[1.8,1.0,11], l:[2.2,6.0,-14]},
    crane:{p:[-5.5,8.5,19], l:[3,4.8,-14]}
  };
  // one camera shot per stop, for any number of stops: hero first, crane at the end, side/chase/low between
  const SEQ=Array.from({length:N},(_,i)=>i===0?"hero":i===N-1?"crane":["side","chase","low"][(i-1)%3]);
  const DRIVE_CAM={p:[0,3.3,11.5], l:[0,1.4,-16]};
  let zoneShown=-1;
  const UP=new T.Vector3(0,1,0), vA=new T.Vector3(), vB=new T.Vector3(), vC=new T.Vector3(), camPos=new T.Vector3(), camLook=new T.Vector3(), tmp=new T.Vector3();
  const sstep=(a,b,x)=>{ const t=Math.min(1,Math.max(0,(x-a)/(b-a))); return t*t*(3-2*t); };

  /* Input. Two ways to move:
     - autopilot: scroll, swipe, Prev/Next, the catalogue, PageUp/PageDown/Space and Home/End glide to stops
     - driving: ↑ (W) accelerates, ↓ (S) brakes then reverses, ← → (A D) steer across the lanes;
       the car keeps rolling when you let go, and the nearest billboard's card follows along */
  const LANE=2.15, LAT_MAX=5.6;
  let target=0, cur=0, vel=0, calm=false, prev=0, speed=0, accel=0, lastV=0, lastInput=performance.now(), inputOn=true, first=true;
  let manual=false, manualW=0, lat=LANE, prevLat=LANE, bumpShake=0;
  let head=0, u=0, steerS=0, odo=0;   // heading relative to the road, speed along the nose, smoothed steering, wheel travel
  let theta=0, snapCam=false;          // compass heading (0 = -z, positive turns toward +x)
  const PW=new T.Vector3(), proj={s:0,lat:0};
  /** Hand the wheel to the driver: the car keeps exactly where and how it's facing. */
  const takeWheel=()=>{ if(manual) return; manual=true; bend(lat,0,-cur,PW); theta=yawAt(cur)+head; u=vel; target=cur; };
  const keys={up:false, down:false, left:false, right:false};
  const clampT=v=>Math.min(END,Math.max(0,v));
  // any autopilot input takes the wheel back from the driver, starting from where the car is now
  const autopilot=()=>{ if(!manual) return; manual=false; target=cur; vel=u*Math.cos(head);
    // off down a side street: cut straight back to the main road rather than sliding through the city
    if(Math.abs(lat)>LAT_MAX+1){ lat=LANE; head=0; vel=0; snapCam=true; } };
  const inUi=e=>e.target && e.target.closest && e.target.closest("[data-scroll], .pedals");
  const onWheel=e=>{ if(!inputOn||inUi(e)) return; autopilot(); const k=e.deltaMode===1?16:1; target=clampT(target+e.deltaY*k*0.07); calm=false; lastInput=performance.now(); };
  let ty=null, swipeTouch=null;
  const onTS=e=>{
    if(!inputOn||inUi(e)||keys.up||keys.down||keys.left||keys.right||swipeTouch!==null) return;
    const touch=Array.from(e.changedTouches).find(t=>!t.target?.closest?.("[data-scroll], .pedals"));
    if(!touch) return;
    swipeTouch=touch.identifier; ty=touch.clientY;
  };
  const onTM=e=>{
    if(ty===null||!inputOn||swipeTouch===null) return;
    const touch=Array.from(e.changedTouches).find(t=>t.identifier===swipeTouch);
    if(!touch) return;
    if(keys.up||keys.down||keys.left||keys.right){ ty=touch.clientY; return; }
    autopilot(); const y=touch.clientY; target=clampT(target+(ty-y)*0.22); calm=false; ty=y; lastInput=performance.now();
  };
  const onTE=e=>{
    if(swipeTouch!==null&&Array.from(e.changedTouches).some(t=>t.identifier===swipeTouch)){ ty=null; swipeTouch=null; }
  };
  const goTo=(i,gentle=false)=>{ autopilot(); target=STOPS[Math.max(0,Math.min(N-1,i))]; calm=gentle; lastInput=performance.now(); };
  /** Step n stops from wherever the car is heading (not where it currently is). */
  const step=n=>{ autopilot(); const base=n>0?stopAtOrBefore(target):stopAtOrAfter(target); goTo(base+n,true); };
  const KEYMAP={ArrowUp:"up", KeyW:"up", ArrowDown:"down", KeyS:"down", ArrowLeft:"left", KeyA:"left", ArrowRight:"right", KeyD:"right"};
  const onKey=e=>{ if(!inputOn) return; const tag=(e.target&&e.target.tagName)||"";
    if(tag==="INPUT"||tag==="TEXTAREA"||(e.key===" "&&(tag==="BUTTON"||tag==="A"))) return;
    const k=KEYMAP[e.code];
    if(k){ e.preventDefault(); keys[k]=true; takeWheel(); lastInput=performance.now(); return; }
    if(e.key==="PageDown"||e.key===" "){ e.preventDefault(); step(1); }
    else if(e.key==="PageUp"){ e.preventDefault(); step(-1); }
    else if(e.key==="Home") goTo(0); else if(e.key==="End") goTo(N-1); };
  const onKeyUp=e=>{ const k=KEYMAP[e.code]; if(k) keys[k]=false; };
  const onBlur=()=>{ keys.up=keys.down=keys.left=keys.right=false; };
  addEventListener("wheel",onWheel,{passive:true});
  addEventListener("touchstart",onTS,{passive:true}); addEventListener("touchmove",onTM,{passive:true}); addEventListener("touchend",onTE); addEventListener("touchcancel",onTE);
  addEventListener("keydown",onKey); addEventListener("keyup",onKeyUp); addEventListener("blur",onBlur);

  const onResize=()=>{ const w=W0(),h=H0(); camera.aspect=w/h; camera.updateProjectionMatrix(); renderer.setSize(w,h); composer.setSize(w,h); grade.uniforms.uRes.value.set(w,h); };
  addEventListener("resize",onResize);
  let pmxT=0, pmyT=0, pmx=0, pmy=0;
  const onPM=e=>{ if(e.pointerType!=="mouse") return; pmxT=e.clientX/innerWidth*2-1; pmyT=e.clientY/innerHeight*2-1;
    ptrX=e.clientX; ptrY=e.clientY; ptrOn=e.target===renderer.domElement; };
  addEventListener("pointermove",onPM);
  /* Picking: billboards light up under the mouse and open on click or tap */
  const ray=new T.Raycaster(), ndc=new T.Vector2(); ray.far=320;
  let ptrX=0, ptrY=0, ptrOn=false, hover=-1, lastHover=0;
  const pickAt=(x,y)=>{ const r=renderer.domElement.getBoundingClientRect();
    ndc.set((x-r.left)/r.width*2-1, -((y-r.top)/r.height)*2+1); ray.setFromCamera(ndc,camera);
    const h=ray.intersectObjects(panelMeshes,false)[0]; return h?h.object.userData.stop:-1; };
  const onClick=e=>{ if(!inputOn||!opts.onPick) return; const i=pickAt(e.clientX,e.clientY); if(i>=0) opts.onPick(i); };
  renderer.domElement.addEventListener("click",onClick);
  let ignite=-1, lastAct=-1, disposed=false, perfMs=16, lastTune=0, bootAt=performance.now();
  const FOG_BASE=FOG.clone(), zoneCol=new T.Color(), zOut=new T.Vector3(), zCam=new T.Vector3();

  // dev-only hook for automated driving tests (stripped from production builds)
  if(import.meta.env.DEV) renderer.info.autoReset=false;
  if(import.meta.env.DEV) window.__nightDrive={ perf:()=>({calls:renderer.info.render.calls, tris:renderer.info.render.triangles, pr:renderer.getPixelRatio(), meshes:(()=>{ let n=0; scene.traverse(o=>{ if(o.isMesh||o.isPoints||o.isLine||o.isSprite) n++; }); return n; })(), ms:perfMs}), state:()=>({x:PW.x,z:PW.z,theta,cur,lat,u,manual}), fits, ok:drive.ok, links:LINKS.map(l=>({sA:l.sA,sB:l.sB,kind:l.kind,ax:l.a.x,az:l.a.z,bx:l.b.x,bz:l.b.z})),
    place:(x,z,th)=>{ takeWheel(); PW.set(x,0,z); theta=th; u=0; snapCam=true; }, bend:(x,z)=>{ const p=bend(x,0,z); return [p.x,p.z]; }, yawAt,
    board:i=>{ const v=panelMeshes[i].getWorldPosition(new T.Vector3()).project(camera), r=renderer.domElement.getBoundingClientRect(); return [r.left+(v.x+1)/2*r.width, r.top+(1-v.y)/2*r.height, v.z<1]; } };

  /* Static batching: every mesh that never moves is baked into world space and merged with the
     others that share its material, so the city, roads, lamps and signs cost a handful of draw calls.
     Anything under a group flagged userData.dyn (the car, sky, sea, animated set pieces) is left alone. */
  function batchStatic(){
    scene.updateMatrixWorld(true);
    const buckets=new Map();
    const visit=o=>{
      if(o.userData.dyn) return;
      if(o.isMesh&&!o.isInstancedMesh&&o.visible&&o.geometry&&!Array.isArray(o.material)){
        const g=o.geometry, attrs=Object.keys(g.attributes).sort().join(","), key=o.material.uuid+"|"+attrs+"|"+(g.index?"i":"n")+"|"+o.renderOrder;
        if(!buckets.has(key)) buckets.set(key,[]); buckets.get(key).push(o);
      }
      o.children.forEach(visit);
    };
    visit(scene);
    let merged=0, removed=0;
    buckets.forEach(list=>{
      if(list.length<2) return;
      const geos=list.map(o=>{ const g=o.geometry.clone(); g.applyMatrix4(o.matrixWorld); g.morphAttributes={}; return g; });
      const geo=T.BufferGeometryUtils.mergeBufferGeometries(geos,false);
      geos.forEach(g=>g.dispose());
      if(!geo) return;
      const m=new T.Mesh(geo,list[0].material); m.renderOrder=list[0].renderOrder; m.matrixAutoUpdate=false; scene.add(m);
      list.forEach(o=>{ o.parent.remove(o); }); merged++; removed+=list.length;
    });
    if(import.meta.env.DEV) console.info(`[night-drive] batched ${removed} static meshes into ${merged} draw calls`);
  }

  /* Loop */
  const clock=new T.Clock(); let raf=0, lastEmit=0, lastSt=null, running=true;
  let frameNo=0, slowFor=0, bench=null;
  function frame(){
    raf=requestAnimationFrame(frame);
    if(!inputOn && (frameNo++)%6) return;
    const rawDt=clock.getDelta(), dt=Math.min(rawDt,0.05), t=clock.elapsedTime, now=performance.now();
    perfMs+=(rawDt*1000-perfMs)*0.05;
    if(bench) bench.push(rawDt*1000);
    if(now-lastTune>1000&&now-bootAt>3000){ lastTune=now;
      let next=PR;
      if(perfMs>24) next=Math.max(QMIN,PR*0.85); else if(perfMs<18&&PR<QMAX) next=Math.min(QMAX,PR*1.08);
      if(Math.abs(next-PR)>0.02){ PR=next; renderer.setPixelRatio(PR); composer.setPixelRatio(PR); const w=W0(),h=H0(); renderer.setSize(w,h); composer.setSize(w,h); }
      // already at the lowest resolution and still slow: shed bloom, then the lamp lights, for good
      slowFor = PR<=QMIN+0.01 && perfMs>26 ? slowFor+1 : 0;
      if(slowFor>=3&&!opts.forced){ slowFor=0;
        if(degrade()&&import.meta.env.DEV) console.info("[night-drive] still slow, dropped a feature"); } }
    const prevTheta=theta;
    if(manual){
      /* Driving in the open: the car has a world position (PW) and compass heading (theta), so it
         goes exactly where it's pointed. Bends, U-turns and junctions are all steered by hand.
         It can only go where there's carriageway; kerbs, buildings and the sea stop it. */
      const ACC=7, BRAKE=26, REV=4, VF=28, VR=6;   // top speed ~100 km/h, reverse ~22 km/h
      if(keys.up) u+=(u<0?BRAKE:ACC*(1-0.65*Math.max(0,u)/VF))*dt;
      if(keys.down) u-=(u>0?BRAKE:REV)*dt;
      if(!keys.up&&!keys.down){ u*=Math.exp(-dt*0.22); if(Math.abs(u)<0.4) u*=Math.exp(-dt*4); }
      u=Math.max(-VR,Math.min(VF,u));
      steerS+=((keys.right?1:0)-(keys.left?1:0)-steerS)*(1-Math.exp(-dt*8));
      // turning circle is about 3 units at low speed (a U-turn fits across the road), wider at speed
      const rate=2.3*Math.min(1,Math.abs(u)/7)/(1+Math.max(0,Math.abs(u)-12)/22);
      const nt=theta+steerS*rate*Math.sign(u)*dt;
      if(fits(PW.x,PW.z,nt)) theta=nt;   // don't swing the nose into a wall
      const nx=PW.x+Math.sin(theta)*u*dt, nz=PW.z-Math.cos(theta)*u*dt;
      if(fits(nx,nz,theta)){ PW.x=nx; PW.z=nz; }
      else if(fits(nx,PW.z,theta)){ PW.x=nx; u*=Math.exp(-dt*3); }      // scrape along it
      else if(fits(PW.x,nz,theta)){ PW.z=nz; u*=Math.exp(-dt*3); }
      else { if(Math.abs(u)>5) bumpShake=Math.max(bumpShake,Math.min(1,Math.abs(u)/22)); u*=-0.15; }
      odo+=u*dt;
      // where that is along the main road, for the cards, progress bar and section titles
      project(PW.x,PW.z,proj); cur=proj.s; lat=proj.lat;
      head=Math.atan2(Math.sin(theta-yawAt(cur)),Math.cos(theta-yawAt(cur)));
      vel=u*Math.cos(head); target=cur;
    } else {
      if(now-lastInput>650){ const ns=STOPS[nearestStop(target)]; target+=(ns-target)*(1-Math.exp(-dt*3)); }
      // critically damped spring: eases out of rest and settles into each stop without overshoot
      // long roads: far jumps speed up so any jump takes about the same time
      const W=calm?1.1:1.4, VMAX=calm?24:Math.max(45,Math.min(200,Math.abs(target-cur)/4)); vel+=(W*W*(target-cur)-2*W*vel)*dt; vel=Math.max(-VMAX,Math.min(VMAX,vel)); cur+=vel*dt;
      if(Math.abs(target-cur)<0.02&&Math.abs(vel)<0.05){ cur=target; vel=0; }
      lat+=(LANE-lat)*(1-Math.exp(-dt*1.4));   // autopilot drifts back into its lane
      // if the driver left the car turned round, swing it back to face along the road
      head=Math.atan2(Math.sin(head),Math.cos(head)); head*=Math.exp(-dt*2.2); steerS*=Math.exp(-dt*6);
      u=vel; odo+=vel*dt;
    }
    manualW+=((manual?1:0)-manualW)*(1-Math.exp(-dt*1.6));
    const v=(cur-prev)/Math.max(dt,1e-4); prev=cur;
    const lv=(lat-prevLat)/Math.max(dt,1e-4); prevLat=lat;
    const vm=manual?u:v;   // speed along the car's own nose (negative = reversing)
    if(!manual) theta=yawAt(cur)+head;   // keep the compass heading in step while autopilot drives
    const headRate=Math.atan2(Math.sin(theta-prevTheta),Math.cos(theta-prevTheta))/Math.max(dt,1e-4);
    speed+=(Math.abs(vm)-speed)*(1-Math.exp(-dt*4));
    accel+=(((vm-lastV)/Math.max(dt,1e-4))-accel)*(1-Math.exp(-dt*3)); lastV=vm;

    // road-space position of the car, then bent onto the winding road
    const cz=-cur, cx=lat+Math.sin(cur*0.021)*0.22*(1-manualW), yaw=yawAt(cur), kappa=curveAt(cur);
    const drift=Math.atan2(lv,Math.abs(v)+3)*Math.sign(v||1)*(1-manualW);   // autopilot lane changes
    if(manual){ car.position.set(PW.x,0,PW.z); car.rotation.y=Math.PI/2-theta; }
    else { bend(cx,0,cz,car.position); car.rotation.y=Math.PI/2-yaw-head-drift+Math.cos(cur*0.021)*0.004*Math.min(speed,30); }
    body.rotation.z=Math.max(-0.035,Math.min(0.035,accel*0.0011));
    body.rotation.x=Math.max(-0.05,Math.min(0.05,-(v*v*kappa+vm*headRate)*0.0011));
    body.position.y=Math.sin(t*9)*0.004*Math.min(speed/20,1);
    const steer=Math.max(-0.5,Math.min(0.5,(kappa*40*Math.cos(head)+drift*3)*(1-manualW)+steerS*0.5));
    wheels.forEach((w,q)=>{ w.rotation.z=-odo/0.37; if(q<2) w.rotation.y=-steer; });
    if(modelWheels) modelWheels.forEach((w,q)=>{ w.rotation.x=-odo/0.36; if(q<2) w.rotation.y=-steer; });

    const i=stopAtOrBefore(cur,0), j=Math.min(N-1,i+1), f=j>i?Math.min(1,Math.max(0,(cur-STOPS[i])/(STOPS[j]-STOPS[i]))):0, b=sstep(0.22,0.88,f);
    const A=SHOT[SEQ[i]], B=SHOT[SEQ[j]];
    const portrait=camera.aspect<0.9, k=portrait?1.45:1;
    // camera offsets are authored relative to the road, so turn them with the road's heading;
    // while the user drives, every stop's shot blends into a chase cam that follows the car's own nose
    const camYaw=yaw+head*manualW;
    vA.fromArray(A.p).lerp(vB.fromArray(B.p),b).lerp(vC.fromArray(DRIVE_CAM.p),manualW).multiplyScalar(k); vA.y/=k; vA.y*=portrait?1.25:1;
    const desired=tmp.copy(vA).applyAxisAngle(UP,-camYaw).add(car.position);
    vA.fromArray(A.l).lerp(vB.fromArray(B.l),b).lerp(vC.fromArray(DRIVE_CAM.l),manualW);
    if(portrait) vA.x-=3.5*(1-manualW);  // keep the roadside billboard in frame on narrow screens
    vA.applyAxisAngle(UP,-camYaw);
    const look=vB.copy(car.position).add(vA);
    // inside a U-turn zone, rise to the outside of the bend and frame the set piece with the car still in shot
    let zw=0, zi=-1;
    const onMain=1-sstep(12,30,Math.abs(lat));   // set pieces belong to the main road, not the side streets
    ZONES.forEach((z,q)=>{ const w=sstep(z.from-45,z.from,cur)*(1-sstep(z.to,z.to+45,cur))*onMain; if(w>zw){ zw=w; zi=q; } });
    // settled at a stop, the billboard overhead takes the shot back from the set piece
    const atStop=manual?0:1-sstep(3,18,Math.abs(cur-STOPS[nearestStop(cur)]));
    if(zi>=0){ const Z=ZONES[zi], w=zw*Z.pull*(1-0.65*manualW)*(1-atStop);
      zOut.copy(car.position).sub(Z.centre); zOut.y=0; zOut.normalize();
      vC.set(Math.sin(yaw),0,-Math.cos(yaw));   // road forward
      zCam.copy(car.position).addScaledVector(zOut,19).addScaledVector(vC,-12).addScaledVector(UP,8.5);
      desired.lerp(zCam,w); look.lerp(vC.copy(car.position).lerp(Z.focus,0.32),w); }
    if(zw>0.6) zoneShown=zi; else if(zw<0.3) zoneShown=-1;
    if(snapCam){ camPos.copy(desired); camLook.copy(look); snapCam=false; }
    if(first){ camPos.copy(desired).add(new T.Vector3(7,2.5,-12)); camLook.copy(look); first=false; }
    const lam=reduce?6:2.3;
    camPos.lerp(desired,1-Math.exp(-dt*lam)); camLook.lerp(look,1-Math.exp(-dt*(lam+0.6)));
    bumpShake*=Math.exp(-dt*3);
    const shake=reduce?0:0.035*(1+Math.min(speed,60)/30)+bumpShake*0.5;
    camera.position.set(camPos.x+Math.sin(t*1.3)*shake, camPos.y+Math.sin(t*1.7+1)*shake*0.7, camPos.z+Math.sin(t*0.9+2)*shake);
    camera.lookAt(camLook);
    if(!reduce){
      pmx+=(pmxT-pmx)*(1-Math.exp(-dt*2)); pmy+=(pmyT-pmy)*(1-Math.exp(-dt*2));
      camera.translateX(pmx*0.55); camera.translateY(-pmy*0.32); camera.lookAt(camLook);
    }
    const fov=(portrait?58:40)+Math.min(speed*3.6/40,6);
    if(Math.abs(camera.fov-fov)>0.01){ camera.fov+=(fov-camera.fov)*(1-Math.exp(-dt*3)); camera.updateProjectionMatrix(); }

    skyGroup.position.copy(camera.position);
    farGroup.position.set(camera.position.x,0,camera.position.z);
    sea.position.set(camera.position.x,-1.4,camera.position.z);
    seaMat.uniforms.uTime.value=t;
    grade.uniforms.uTime.value=t;

    // the two working street lamps nearest the car get real lights (no allocations per frame)
    { const ka=Math.round((60-cz)/LAMP_GAP); let b0=null, b1=null, d0=1e9, d1=1e9;
      for(let q=ka*2-2;q<=ka*2+3;q++){ const n=lamps[q]; if(!n||n[2]) continue; const d=Math.abs(n[1]-cz-4);
        if(d<d0){ b1=b0; d1=d0; b0=n; d0=d; } else if(d<d1){ b1=n; d1=d; } }
      for(let q=0;q<dyn.length;q++){ const n=q===0?b0:b1, L=dyn[q]; if(n){ bend(n[0]*5.2,7.9,n[1],L.position); L.visible=true; } else L.visible=false; } }

    if(now-lastHover>90){ lastHover=now; const h=ptrOn&&inputOn?pickAt(ptrX,ptrY):-1;
      if(h!==hover){ hover=h; renderer.domElement.style.cursor=h>=0?"pointer":""; } }
    const act=nearestStop(cur);
    if(act!==lastAct && panels[act]){ panels[act].flick=0.75; panels[act].sweep.value=-0.4; lastAct=act; }
    panels.forEach((p,q)=>{
      const g=q===act||q===hover?1:0; p.glow+=(g-p.glow)*(1-Math.exp(-dt*3));
      let k=1;
      if(p.flick>0){ p.flick-=dt; k=Math.random()<0.45?0.18:1; }
      p.mat.color.setScalar((0.62+p.glow*0.72)*k);
      p.lip.color.setScalar(2.4*k*(0.4+p.glow*0.6));
      if(p.sweep.value<1.7) p.sweep.value+=dt*0.9; else if(q===act) p.sweep.value=-2.2;
    });

    /* Ignition: headlights stutter on once the loader clears */
    if(ignite<0) ignite=t+1.1;
    const it=t-ignite, ig=it<0?0:it>0.7?1:(Math.random()<0.5?0.15:0.6+it*0.5);
    hlM.color.setRGB(7*ig,7.5*ig,8.5*ig); spot.intensity=7*ig; coneMat.uniforms.uI.value=ig;

    /* Brake lights flare when slowing, reverse lights when backing up */
    const brake=Math.max(manual&&keys.down&&u>0.5?1:0, speed>1.5?Math.min(1,Math.max(0,-accel*Math.sign(vm)/35)):0);
    tlM.color.setRGB(9+brake*22,0.35+brake*0.9,0.25+brake*0.5); red.material.color.setRGB(0.5+brake*1.4,0.05+brake*0.08,0.03+brake*0.05);
    const rev=Math.min(1,Math.max(0,-vm/8)); revM.color.setRGB(0.04+rev*8,0.04+rev*8,0.045+rev*9);

    const hit=updateTraffic(dt,cz,cx);
    if(hit && manual){ u=-Math.sign(u||1)*Math.max(4,Math.abs(u)*0.35); bumpShake=1;
      const push=Math.sign(lat-hit.x||1)*0.8, h=yawAt(cur), px=PW.x+Math.cos(h)*push, pz=PW.z+Math.sin(h)*push; if(fits(px,pz,theta)){ PW.x=px; PW.z=pz; } }
    updateMeteor(dt);
    updateRain(dt,camera.position);
    updateFireworks(dt,t,cz,cur>END-45);
    lhBeams.rotation.y=t*0.55;
    { const bd=tmpM.set(Math.cos(-t*0.55),0,Math.sin(-t*0.55)); const tc=vA.copy(camera.position).sub(LH); tc.y=0; tc.normalize();
      const f=Math.pow(Math.max(Math.max(bd.dot(tc),-bd.dot(tc)),0),140); lhFlare.scale.setScalar(10+f*32); }
    boatSeed.forEach((b,q)=>{ b.z+=b.v*dt; boatPos[q*3]=b.x; boatPos[q*3+1]=0.6+Math.sin(t*1.3+b.ph)*0.35; boatPos[q*3+2]=b.z; });
    boatGeo.attributes.position.needsUpdate=true;
    { const a=t*0.018+1.2; plane.position.set(Math.cos(a)*950, 170+Math.sin(t*0.05)*20, Math.sin(a)*950);
      beaconR.visible=(t%1.4)<0.18; const s=t%1.1; beaconW.visible=s<0.05||(s>0.12&&s<0.17); }
    /* Zones: each set piece tints the fog and horizon as you drive into it */
    zoneCol.copy(FOG_BASE); if(zi>=0) zoneCol.lerp(ZONES[zi].fog,zw);
    FOG.copy(zoneCol); scene.fog.color.copy(zoneCol); skyMat.uniforms.uHor.value.copy(zoneCol);
    for(let q=0;q<sceneUpdates.length;q++){ const su=sceneUpdates[q]; if(su.at.distanceToSquared(camera.position)<450*450) su.fn(t,dt,cur); }
    grade.uniforms.uSpeed.value+=(Math.min(1,speed/75)-grade.uniforms.uSpeed.value)*(1-Math.exp(-dt*4));

    if(import.meta.env.DEV) renderer.info.reset();
    composer.render();
    if(now-lastEmit>90){ lastEmit=now; const st={dist:Math.round(cur*10)/10, active:Math.min(N-1,Math.max(0,act)), speed:Math.round(speed*36)/10, dir:vm>0.5?1:vm<-0.5?-1:0, zone:zoneShown>=0?ZONES[zoneShown].name:null, zoneScene:zoneShown>=0?ZONES[zoneShown].scene:null, zoneNo:zoneShown>=0?ZONES[zoneShown].no:0, manual, bump:bumpShake>0.5, carX:Math.round(car.position.x*20)/20, carZ:Math.round(car.position.z*20)/20, carH:Math.round(theta*500)/500};
      // only hand React a new object when something it shows has changed (parked or idle = no re-render)
      if(!lastSt||Object.keys(st).some(k=>st[k]!==lastSt[k])){ lastSt=st; onState(st); } }
  }

  /* Boot: wait for fonts, paint billboards, start */
  (async()=>{
    onProgress(0.2);
    const fonts=['700 100px Unbounded','500 50px Unbounded','400 30px "Hanken Grotesk"','500 30px "Hanken Grotesk"','400 24px "JetBrains Mono"'];
    try{ await Promise.race([Promise.all(fonts.map(f=>document.fonts.load(f))), new Promise(r=>setTimeout(r,3500))]); }catch(e){}
    onProgress(0.55);
    for(let i=0;i<N;i++){ panels[i].mat.map=drawPanel(DATA[i],i); panels[i].mat.needsUpdate=true; onProgress(0.55+0.3*(i+1)/N); await new Promise(r=>setTimeout(r,0)); }
    gantries.forEach(gy=>{ gy.mat.map=drawGantry(gy); gy.mat.needsUpdate=true; });
    sectionBoards.forEach(sb=>{ sb.mat.map=drawSectionBoard(sb); sb.mat.needsUpdate=true; });
    await carReady;
    onProgress(0.95);
    if(disposed) return;
    batchStatic();
    renderer.compile(scene,camera);
    frame();
    /* Boot benchmark: about a second of real frames behind the loader. GPU names can be hidden or
       misleading, so a machine that can't hold ~35 fps sheds the extras now, while the loader still
       hides the shader rebuild. A visitor who chose High keeps it. */
    if(!degraded&&!opts.forced){
      bench=[]; await new Promise(r=>setTimeout(r,1200));
      const ms=bench.slice(5).sort((a,b)=>a-b), med=ms.length?ms[ms.length>>1]:0; bench=null;
      if(disposed) return;
      if(med>28){ degrade(); degrade(); renderer.compile(scene,camera); perfMs=16; lastTune=performance.now();
        if(import.meta.env.DEV) console.info(`[night-drive] boot benchmark ${med.toFixed(1)} ms, running light`); }
    }
    onProgress(1);
    setTimeout(()=>onReady(degraded?"low":"high"),350);
  })();

  return {
    goTo, step, setInput:v=>{ inputOn=v; }, get tier(){ return degraded?"low":"high"; },
    /** The road network for the minimap: main road polyline, cross roads, stops (world x/z). */
    map:(()=>{ const road=[]; for(let s=ROAD_S0;s<=ROAD_S1;s+=6) road.push([sample(pathX,s),sample(pathZ,s)]);
      return { road, links:LINKS.map(l=>[l.a.x,l.a.z,l.b.x,l.b.z,l.kind]), stops:STOPS.map((s,i)=>{ const p=bend(0,0,-s-BB_AHEAD); return [p.x,p.z]; }),
        bounds:[drive.x0,drive.z0,drive.x0+drive.W*DRIVE_RES,drive.z0+drive.H*DRIVE_RES] }; })(),
    /** On-screen pedals: press("up"|"down"|"left"|"right", isDown) */
    press:(k,down)=>{ if(!(k in keys)) return; keys[k]=down; if(down) takeWheel(); lastInput=performance.now(); },
    dispose(){ disposed=true; cancelAnimationFrame(raf); removeEventListener("pointermove",onPM); renderer.domElement.removeEventListener("click",onClick); removeEventListener("wheel",onWheel); removeEventListener("touchstart",onTS); removeEventListener("touchmove",onTM); removeEventListener("touchend",onTE); removeEventListener("touchcancel",onTE); removeEventListener("keydown",onKey); removeEventListener("keyup",onKeyUp); removeEventListener("blur",onBlur); removeEventListener("resize",onResize); renderer.dispose(); renderer.domElement.remove(); }
  };
}
