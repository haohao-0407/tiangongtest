import type { ScreenPoint, ZoneGesture, ZoneSelection } from '../voxel/zone-selection.ts';

export function mountZoneMarquee(shell:HTMLElement, send:(action:string,data:Record<string,unknown>)=>void){
  const doc=shell.ownerDocument, win=doc.defaultView!;
  const canvas=doc.createElement('canvas');
  canvas.style.cssText='position:absolute;inset:0;width:100%;height:100%;pointer-events:none';
  canvas.hidden=true;
  shell.prepend(canvas);
  const ctx=canvas.getContext('2d')!;
  let tool='', pointer:number|null=null, sequence=0, gesture:ZoneGesture|null=null;
  let faces:ZoneSelection['faces']=[];
  let selectionHint='';
  const draw=()=>{
    canvas.hidden=!gesture;
    if(!gesture) return;
    const {width:w,height:h}=shell.getBoundingClientRect(), dpr=win.devicePixelRatio || 1;
    if(canvas.width!==Math.round(w*dpr)) canvas.width=Math.round(w*dpr);
    if(canvas.height!==Math.round(h*dpr)) canvas.height=Math.round(h*dpr);
    ctx.setTransform(dpr,0,0,dpr,0,0); ctx.clearRect(0,0,w,h);
    const color=tool==='zone:pasture'?'#d8ad69':tool==='zone:farm'?'#90bd65':'#75baca';
    for(const face of faces){
      ctx.beginPath();
      face.corners.forEach(([x,y],i)=>i?ctx.lineTo(x*w,y*h):ctx.moveTo(x*w,y*h));
      ctx.closePath();
      ctx.fillStyle=face.blocked?'#e4564dbb':face.pasture==='gate'?'#5fe88bd9':face.pasture==='fence'?'#8f5b3de0':color+'99'; ctx.fill();
      ctx.strokeStyle=face.blocked?'#ffafa8':color; ctx.lineWidth=1; ctx.stroke();
      if(face.blocked){
        ctx.beginPath();
        for(const [a,b] of [[0,2],[1,3]]){
          ctx.moveTo(face.corners[a][0]*w,face.corners[a][1]*h);
          ctx.lineTo(face.corners[b][0]*w,face.corners[b][1]*h);
        }
        ctx.stroke();
      }
    }
    if(gesture.dragged){
      const [ax,ay]=gesture.start,[bx,by]=gesture.end;
      const x=Math.min(ax,bx)*w,y=Math.min(ay,by)*h,width=Math.abs(ax-bx)*w,height=Math.abs(ay-by)*h;
      ctx.fillStyle=color+'30'; ctx.fillRect(x,y,width,height);
      ctx.strokeStyle=color; ctx.strokeRect(x,y,width,height);
    }
  };
  const clear=()=>{pointer=null;gesture=null;faces=[];selectionHint='';draw();};
  const point=(event:PointerEvent):ScreenPoint=>{
    const rect=shell.getBoundingClientRect();
    const clip=(n:number)=>Math.max(0,Math.min(1,n));
    return [clip((event.clientX-rect.left)/rect.width),clip((event.clientY-rect.top)/rect.height)];
  };
  const update=(event:PointerEvent)=>{
    if(!gesture) return;
    gesture.end=point(event);
    const rect=shell.getBoundingClientRect();
    gesture.dragged ||= Math.hypot((gesture.end[0]-gesture.start[0])*rect.width,(gesture.end[1]-gesture.start[1])*rect.height)>=4;
  };
  const abort=()=>{if(gesture){send('zone-abort',{});clear();}};
  const down=(event:PointerEvent)=>{
    if(!tool.startsWith('zone:') || !event.isPrimary) return;
    if(event.button===2 && gesture){abort();send('cancel-map-tool',{});return;}
    if(event.button!==0 || pointer!==null || !event.composedPath().some(el=>(el as HTMLElement).tagName==='CANVAS')) return;
    pointer=event.pointerId; sequence++;
    const start=point(event); gesture={start,end:start,dragged:false};
    (event.target as Element).setPointerCapture?.(pointer);
    send('zone-preview',{sequence,gesture});draw();
  };
  const move=(event:PointerEvent)=>{
    if(event.pointerId!==pointer || !gesture) return;
    update(event);send('zone-preview',{sequence,gesture});draw();
  };
  const up=(event:PointerEvent)=>{
    if(event.pointerId!==pointer || event.button!==0 || !gesture) return;
    update(event);send('zone-submit',{sequence,gesture});clear();
  };
  const escape=(event:KeyboardEvent)=>{if(event.code==='Escape') abort();};
  const listeners=new AbortController(), options={capture:true,signal:listeners.signal};
  win.addEventListener('pointerdown',down,options);win.addEventListener('pointermove',move,options);
  win.addEventListener('pointerup',up,options);win.addEventListener('pointercancel',abort,options);
  win.addEventListener('lostpointercapture',abort,options);win.addEventListener('blur',abort,options);
  win.addEventListener('keydown',escape,options);
  return {
    setTool(value:string){if(value!==tool){clear();tool=value;}},
    get hint(){return selectionHint;},
    preview(id:number,next:ZoneSelection['faces'],pastureHint?:string){
      if(!gesture || id!==sequence) return;
      faces=next;
      const invalid=next.filter(face=>face.blocked).length;
      selectionHint=invalid ? `已选 ${next.length} 格 · ${invalid} 格禁止规划` : pastureHint??`已选 ${next.length} 格 · 松开左键提交`;
      draw();
    },
    dispose(){listeners.abort();canvas.remove();},
  };
}
