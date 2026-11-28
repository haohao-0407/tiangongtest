import { GUIDE_RECYCLE_ITEMS, GUIDE_SHELF, merchantOrder, type TradeSide } from '../colony/guide-shop.ts';
import { RESOURCE_NAMES, type ColonyCommand, type ColonySnapshot, type MerchantId, type Resource } from '../colony/contracts.ts';
import { SPECIALISTS, SPECIALIST_MARKET_RULES } from '../colony/specialist-catalog.ts';
import { activeMarketEvent } from '../colony/market-calendar.ts';

export function createGuideShop(doc:Document, portraitUrl:string, icon:(item:Resource, className:string)=>HTMLElement,
  refresh:()=>void, submit:(command:ColonyCommand)=>void) {
  let order:{side:TradeSide; item:Resource; count:number}|null = null;
  let receipt = '', pending = false;
  let shelfPage = 0;
  let merchantId:MerchantId='guide', choosingRoom=false;
  const name=()=>merchantId==='guide'?'向导':SPECIALISTS[merchantId].name;
  const housing=(c:ColonySnapshot)=>merchantId==='guide'?c.guideHousing:c.specialistMarket.merchants.find(m=>m.id===merchantId)?.housing;
  function el<K extends keyof HTMLElementTagNameMap>(tag:K, cls:string, text='') {
    const node = doc.createElement(tag);
    node.className = cls;
    node.textContent = text;
    return node;
  }
  function button(text:string, id:string, action:()=>void, cls='') {
    const node = el('button',cls,text);
    node.dataset.testid = 'guide-'+id;
    node.disabled = pending;
    node.onclick = action;
    return node;
  }
  function select(side:TradeSide, item:Resource) {
    if (pending) return;
    order = {side,item,count:1};
    receipt = '';
    refresh();
  }
  return {
    open(id:MerchantId) { merchantId=id; order=null; receipt=''; shelfPage=0; choosingRoom=false; pending=false; },
    title(c?:ColonySnapshot) { return name()+(c && housing(c)?.status==='housed'?'商店':' · 安排住所'); },
    finish(id:MerchantId, ok:boolean, message:string) { if (id!==merchantId) return; pending=false; receipt=message; if (ok) order=null; refresh(); },
    render(c:ColonySnapshot, root:HTMLElement) {
      const h=housing(c);
      if (!h) return;
      const specialist=merchantId==='guide'?null:SPECIALISTS[merchantId];
      const layout=el('div','guide-layout'), figure=el('div','guide-figure');
      if (merchantId==='guide') {
        const img=el('img','guide-portrait');
        img.src=portraitUrl; img.alt='向导'; figure.append(img);
      } else {
        const badge=el('div','merchant-emblem '+merchantId);
        const symbol={chef:'🍞',tailor:'🧵',cheesemaker:'🧀',blacksmith:'⚒'}[merchantId];
        badge.append(el('span','',symbol),el('strong','',name()));
        figure.append(badge);
      }
      const terms=el('div','guide-home');
      terms.append(el('strong','',h.status==='camp'?'正在镇上寻找住所':`已入住 · 房间 ${h.roomId}`));
      if (h.status==='housed') terms.append(el('span','',`环境品质 ${Math.round(h.quality)} · 买价 −${Number(((1-h.buyFactor)*100).toFixed(1))}% / 回收 +${Number(((h.recycleFactor-1)*100).toFixed(1))}%`));
      figure.append(terms);
      if (h.status!=='housed') {
        const rooms=el('div','merchant-rooms');
        rooms.append(el('p','','请为我安排一间有床、有桌子的合格空房。入住后就可以开店了。'));
        if (!choosingRoom) rooms.append(button('安排住所','choose-room',()=>{choosingRoom=true;refresh();}));
        else {
          rooms.append(el('h3','','选择空房'));
          if (!c.specialistMarket.availableRooms.length) rooms.append(el('p','','目前没有合格空房。请准备至少六格、带门、床和桌子的封闭房间。'));
          for (const room of c.specialistMarket.availableRooms) {
            const [x,,z]=room.position;
            const choice=button(`指定房间 ${room.roomId} · 床位 (${Math.floor(x)}, ${Math.floor(z)}) · 舒适 ${room.comfort} / 清洁 ${room.cleanliness}`,
              'assign-'+room.bedId,()=>{if(pending)return;pending=true;refresh();submit({action:'assign-merchant-room',merchantId,id:room.bedId});});
            rooms.append(choice);
          }
        }
        if (receipt) rooms.append(el('p','guide-detail',receipt));
        layout.append(figure,rooms); root.append(layout);return;
      }
      const listings=specialist?.shelf??GUIDE_SHELF;
      const event=merchantId==='guide'?undefined:activeMarketEvent(c.specialistMarket.events,c.day,merchantId,SPECIALISTS[merchantId].request.item);
      const store=el('div','guide-store'), heading=el('div','guide-heading');
      const balance=el('strong','guide-balance',`可用 ${c.resources.silver} 银币`);
      balance.prepend(icon('silver','coin-icon'));
      balance.dataset.testid='guide-balance';
      const pages=Math.ceil(listings.length/3), nav=el('div','guide-pages');
      nav.append(button('‹','prev',()=>{shelfPage=(shelfPage+pages-1)%pages;refresh();}),el('span','',`${shelfPage+1} / ${pages}`),
        button('›','next',()=>{shelfPage=(shelfPage+1)%pages;refresh();}));
      heading.append(el('h3','','商品货架'));
      if (pages>1) heading.append(nav);
      heading.append(balance);
      const shelf=el('div','guide-shelf');
      for (const {item} of listings.slice(shelfPage*3,shelfPage*3+3)) {
        const card=button('','buy-'+item,()=>select('buy',item),'guide-sku');
        card.setAttribute('aria-pressed',String(order?.side==='buy' && order.item===item));
        const price=el('span','guide-plinth',`${merchantOrder(c,'buy',item,1,merchantId).total} 银币`);
        price.prepend(icon('silver','coin-icon'));
        card.append(el('strong','',RESOURCE_NAMES[item]),icon(item,'guide-product '+item),price);
        shelf.append(card);
      }
      const recycle=el('div','guide-recycle'), choices=el('div','guide-choices');
      const accepted=specialist ? [...new Set([...specialist.preferred,...event?[event.item]:[]])] : GUIDE_RECYCLE_ITEMS;
      const owned=accepted.filter(item=>c.resources[item]>0);
      for (const item of owned) {
        const chip=button('','recycle-'+item,()=>select('recycle',item),'guide-chip');
        chip.setAttribute('aria-pressed',String(order?.side==='recycle' && order.item===item));
        chip.append(icon(item,'guide-mini '+item),el('span','',`${RESOURCE_NAMES[item]} × ${c.resources[item]}`));
        choices.append(chip);
      }
      if (!owned.length) choices.append(el('span','','仓库里还没有可回收的货物'));
      recycle.append(el('h3','','回收栏'),el('small','',specialist?`平日收购 ×${SPECIALIST_MARKET_RULES.preferredFactor} · ${specialist.preferred.map(r=>RESOURCE_NAMES[r]).join('、')}`:'选择仓库物品交给商人'),choices);
      if (event && specialist) recycle.append(el('strong','merchant-event',`${specialist.request.name} · ${RESOURCE_NAMES[event.item]} ×${SPECIALIST_MARKET_RULES.requestFactor} · 剩余 ${event.remaining}/${event.limit} 件`));
      const checkout=el('div','guide-checkout');
      if (order) {
        const {side,item,count}=order, buy=side==='buy';
        let quote:ReturnType<typeof merchantOrder>|undefined, error='';
        try { quote=merchantOrder(c,side,item,count,merchantId); } catch(e) { error=e instanceof Error?e.message:'报价已更新'; }
        const available=!!quote && c.resources[buy?'silver':item] >= (buy?quote.total:count);
        const summary=el('div','guide-summary');
        summary.append(el('strong','',`${buy?'买入':'交售'}${RESOURCE_NAMES[item]}`),el('span','',`库存 ${c.resources[item]} 件`));
        const stepper=el('div','guide-stepper');
        const less=button('−','less',()=>{ if(order && order.count>1) { order.count--;refresh(); } });
        less.disabled=pending || count<=1;
        const more=button('+','more',()=>{ if(order) { order.count++;refresh(); } });
        stepper.append(less,el('b','',count+' 件'),more,button('+10','ten',()=>{if(order){order.count+=10;refresh();}}));
        const confirm=button(!quote ? error : available ? `${buy?'预留':'交付收取'} ${quote.total} 银币` : `${buy?'银币不足':'货物不足'} · ${quote.total} 银币`,'confirm',()=>{
          if (pending || !order || !quote) return;
          pending=true; refresh();
          submit({action:'guide-trade',merchantId,value:side,kind:item,amount:count,target:quote.total});
        },'guide-confirm');
        confirm.disabled=pending || !available;
        if (quote) confirm.prepend(icon('silver','coin-icon'));
        checkout.append(summary,stepper,confirm,button('取消','cancel',()=>{order=null;receipt='';refresh();}));
        if (!buy && event?.item===item) checkout.append(el('small','guide-detail',`本次可提交 ${Math.min(c.resources[item],event.remaining)} 件`));
        if (quote?.premiumCount) checkout.append(el('small','guide-detail',`保鲜 ${quote.premiumCount} 件 · 普通 ${quote.normalCount} 件`));
      } else {
        checkout.append(el('span','guide-detail',receipt || '选择货架商品买入，或从回收栏交售。'));
      }
      if (order && receipt) checkout.append(el('span','guide-detail',receipt));
      const orders=el('div','guide-orders');
      for (const job of c.jobs) {
        const s=job.guideSale;
        if (!s || (s.merchantId??'guide')!==merchantId) continue;
        const buy=s.side==='buy', name=RESOURCE_NAMES[s.item];
        const worker=c.colonists.find(p=>p.id===job.assignedTo)?.name??'等待居民';
        const row=el('div','guide-order');
        const payment=el('span','',buy?`预留余 ${s.total-s.paid} · 已付 ${s.paid} 银币`:`锁价 ${s.total} · 已收 ${s.paid} 银币`);
        payment.prepend(icon('silver','coin-icon'));
        row.append(el('strong','',`${name} × ${s.count} · ${job.label}`),el('span','',`${worker} · 在途 ${s.inTransit} · ${buy?'入库':'交付'} ${s.delivered}/${s.count}`),payment);
        orders.append(row);
      }
      const finished=c.events.filter(e=>e.text.startsWith(name()+'采购已入库')||e.text.startsWith(name()+'回收已交付')).slice(-2);
      for (const e of finished) orders.append(el('small','guide-complete',e.text));
      store.append(heading,shelf,recycle,checkout,orders); layout.append(figure,store); root.append(layout);
    },
  };
}
