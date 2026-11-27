import type { ColonySnapshot, MerchantId, Position } from '../colony/contracts.ts';
import { SPECIALISTS, housingToolResident } from '../colony/specialist-catalog.ts';
import { mapProjection } from '../voxel/zone-selection.ts';

export type HousingCamera = {eye:Position; target:Position; distance:number; overhead:boolean; mode?:'god'|'character'};
const colors:Record<MerchantId,string>={guide:'#527643',chef:'#9b572e',tailor:'#775782',cheesemaker:'#876b28',blacksmith:'#4c687b'};
const name=(id:MerchantId)=>id==='guide'?'向导':SPECIALISTS[id].name;
const home=(c:ColonySnapshot,id:MerchantId)=>id==='guide'?c.guideHousing:c.specialistMarket.merchants.find(m=>m.id===id)?.housing;
function address(c:ColonySnapshot,id:MerchantId){
  const h=home(c,id);
  if(h?.status!=='housed')return '';
  if(h.roomId!=null)return '房间 '+h.roomId;
  const flag=c.specialistMarket.flags?.[id];
  return flag?`住所 (${Math.floor(flag[0])}, ${Math.floor(flag[2])})`:'原住所';
}

export function residentWindow(doc:Document, refresh:()=>void, arrange:(id:MerchantId)=>void){
  let selected:MerchantId='guide';
  return (c:ColonySnapshot,root:HTMLElement)=>{
    for(const id of ['guide',...c.specialistMarket.merchants.map(m=>m.id)] as MerchantId[]){
      const h=home(c,id),row=doc.createElement('button');
      row.className='resident-entry';row.dataset.tenant=id;row.disabled=!h;
      row.setAttribute('aria-pressed',String(id===selected));
      const badge=doc.createElement('span'),title=doc.createElement('strong'),status=doc.createElement('span');
      badge.className='resident-swatch';badge.style.background=colors[id];badge.textContent='⚑';
      title.textContent=name(id);
      status.textContent=!h?'未到镇':h.status==='camp'?'已到镇 · 待安排':'已入住 · '+address(c,id);
      row.append(badge,title,status);row.onclick=()=>{selected=id;refresh();};root.append(row);
    }
    const actions=doc.createElement('div'),summary=doc.createElement('span'),button=doc.createElement('button');
    actions.className='resident-actions';button.className='primary';button.textContent='安排入住';
    button.disabled=!home(c,selected);button.onclick=()=>arrange(selected);
    summary.textContent=`可分配住房 ${c.specialistMarket.availableRooms.length} 间`;
    actions.append(summary,button);root.append(actions);
  };
}

/** Map annotations share the engine camera. Housing selection uses its vertical orthographic view. */
export function residentMap(shell:HTMLElement){
  const doc=shell.ownerDocument,win=doc.defaultView!;
  const layer=doc.createElement('div'),tiles=doc.createElement('canvas'),cursor=doc.createElement('span');
  layer.className='housing-map';layer.hidden=true;layer.append(tiles);shell.prepend(layer);
  function flag(id:MerchantId,label:string){
    const el=doc.createElement('span');el.className='housing-flag';el.textContent=label;
    el.style.backgroundColor=colors[id];return el;
  }
  cursor.className='housing-flag housing-pointer';cursor.hidden=true;layer.append(cursor);
  let tenant:MerchantId|null=null, pointer:[number,number]|null=null;
  const move=(e:PointerEvent)=>{
    const rect=shell.getBoundingClientRect();
    pointer=e.composedPath().some(el=>(el as Element).tagName==='CANVAS')?[e.clientX-rect.left,e.clientY-rect.top]:null;
    cursor.hidden=!tenant || !pointer;
    if(pointer){cursor.style.left=pointer[0]+8+'px';cursor.style.top=pointer[1]-3+'px';}
  };
  win.addEventListener('pointermove',move,true);
  const markers=new Map<MerchantId,HTMLElement>();
  return {
    update(c:ColonySnapshot,camera:HousingCamera,tool:string){
      tenant=housingToolResident(tool);
      const flags=c.specialistMarket.flags??{};
      layer.hidden=camera.mode!=='god' || (!tenant && !Object.keys(flags).length);
      if(layer.hidden)return;
      const {width,height}=shell.getBoundingClientRect(),tan=Math.tan(Math.PI/8);
      const scale=height/(2*camera.distance*tan);
      const xPixel=(x:number)=>width/2+(x-camera.target[0])*scale;
      const zPixel=(z:number)=>height/2+(z-camera.target[2])*scale;
      tiles.hidden=!tenant;
      if(tenant){
        if(tiles.width!==Math.round(width))tiles.width=Math.round(width);
        if(tiles.height!==Math.round(height))tiles.height=Math.round(height);
        const ctx=tiles.getContext('2d')!;
        ctx.clearRect(0,0,width,height);
        ctx.fillStyle='#89ed9090';ctx.strokeStyle='#e6ffba';ctx.lineWidth=1;
        for(const room of c.specialistMarket.availableRooms){
          for(const [x,z] of c.rooms[room.roomId]?.cells??[]){
            const left=xPixel(x),top=zPixel(z);
            ctx.fillRect(left,top,scale,scale);ctx.strokeRect(left,top,scale,scale);
          }
        }
        cursor.textContent=name(tenant);cursor.style.backgroundColor=colors[tenant];
      }
      cursor.hidden=!tenant || !pointer;
      const projection=camera.overhead?null:mapProjection(camera.eye,camera.target,width/height,tan);
      for(const [id,marker] of markers)if(!flags[id]){marker.remove();markers.delete(id);}
      for(const [id,pos] of Object.entries(flags) as [MerchantId,Position][]){
        let marker=markers.get(id);
        if(!marker){marker=flag(id,'');marker.dataset.homeFlag=id;layer.append(marker);markers.set(id,marker);}
        marker.textContent=name(id)+' · '+address(c,id);
        const uv=projection?.project(...pos);
        const x=uv?uv[0]*width:xPixel(pos[0]),y=uv?uv[1]*height:zPixel(pos[2]);
        marker.hidden=!(x>=0 && x<=width && y>=0 && y<=height);
        marker.style.left=x+'px';marker.style.top=y+'px';
      }
    },
    dispose(){win.removeEventListener('pointermove',move,true);layer.remove();},
  };
}
