'use strict';
(() => {
 const ROOTS=['ANGEKIS','AREC','FIBARO','HANSHIN','INTECH','KONKA','MAXON','OPTOMA','OSRAM','QSTECH','TENVEO','URC'];
 const DIRECTIONS=['LED дисплеи','OPS Компьютеры','PROMOUNT-Крепления','Документ-камеры','Интерактивные киоски','Интерактивные панели','Кабель','Коммутация','Крепления для проекторов','Моторизованные мониторы','Экраны проекционные'];
 const STAGES={draft:'Подготовка заказа',supplier:'Передан поставщику',ready:'Готов к отгрузке',departure:'Выезжает / вылетает',transit:'В дороге',customs:'На растаможке',delivered:'Получен'};
 const PAYMENTS={unpaid:'Не оплачен',partial:'Частично оплачен',paid:'Оплачен'};
 const CHECKS={memo:'Подписана служебная записка',created:'Создана позиция в 1С',filled:'Заполнена позиция в 1С'};
 const norm=s=>String(s||'').trim().toLocaleLowerCase().replace(/\s+/g,' ');
 const isBrand=c=>c?.workspace==='work'&&c.id!=='inbox'&&!['general','clearance'].includes(c.kind);
 const enabled=(c,key)=>isBrand(c)&&c.tools?.[key]===true;
 const date=s=>typeof s==='string'&&(!s||/^\d{4}-\d{2}-\d{2}$/.test(s)&&!Number.isNaN(Date.parse(s))&&new Date(s+'T12:00:00Z').toISOString().slice(0,10)===s);
 const month=s=>typeof s==='string'&&/^\d{4}-(0[1-9]|1[0-2])$/.test(s);
 const money=n=>n===null||typeof n==='number'&&Number.isFinite(n)&&n>=0&&n<=1e12&&Math.round(n*100)/100===n;
 function branchIds(data,id){const ids=new Set([id]);let changed=true;while(changed){changed=false;for(const c of data.categories)if(c.parentId&&ids.has(c.parentId)&&!ids.has(c.id)){ids.add(c.id);changed=true;}}return ids;}
 function pathName(data,c){const parts=[c.name],seen=new Set([c.id]);while(c.parentId){c=data.categories.find(x=>x.id===c.parentId);if(!c||seen.has(c.id))break;seen.add(c.id);parts.unshift(c.name);}return parts.join(' / ');}
 function children(data,id){return data.categories.filter(c=>c.parentId===id);}
 function validate(data){
  const bad=message=>{throw Error(message);};
  const str=(v,max,required=false)=>typeof v==='string'&&v.length<=max&&(!required||!!v.trim());
  const rows=(c,key,max)=>{if(c[key]===undefined)return [];if(!Array.isArray(c[key])||c[key].length>max)bad('Неверные данные: '+key);return c[key];};
  const log=list=>{if(list===undefined)return;if(!Array.isArray(list)||list.length>2000)bad('Слишком длинная история записи');for(const h of list)if(!str(h.text,6000,true)||typeof h.at!=='string'||Number.isNaN(Date.parse(h.at)))bad('Неверная история записи');};
  if(data.categories.filter(c=>c.kind==='clearance').length>1)bad('Раздел уценки уже существует. Добавляйте позиции внутрь него.');
  for(const c of data.categories){
   if(c.kind==='clearance'&&c.workspace!=='work')bad('Раздел уценки доступен только в рабочем пространстве');
   if(c.parentId!==undefined&&c.parentId!==null){const parent=data.categories.find(x=>x.id===c.parentId);if(!isBrand(c)||!isBrand(parent)||c.id===parent.id)bad('Направление должно находиться внутри рабочего бренда');const seen=new Set([c.id]);let at=parent;while(at){if(seen.has(at.id))bad('Бренды не могут содержать друг друга по кругу');seen.add(at.id);at=at.parentId?data.categories.find(x=>x.id===at.parentId):null;}}
   if(c.tools!==undefined){if(!c.tools||typeof c.tools!=='object'||Array.isArray(c.tools)||Object.keys(c.tools).some(k=>!['sales','orders','notes'].includes(k))||Object.values(c.tools).some(v=>typeof v!=='boolean'))bad('Неверные настройки инструментов');}
   if(c.currency!==undefined&&!['KZT','RUB','USD','EUR'].includes(c.currency))bad('Неверная валюта бренда');
   if(c.catalogKey!==undefined&&!str(c.catalogKey,100,true))bad('Неверный ключ портфеля');
   const seen=new Set();const record=r=>{if(!r||!str(r.id,100,true)||seen.has(r.id))bad('Повторяющаяся или неверная запись бренда');seen.add(r.id);};
   const periods=new Set();for(const r of rows(c,'sales',240)){if(!r||!month(r.month)||periods.has(r.month)||!money(r.plan)||!money(r.actual))bad('План и факт должны быть неотрицательными числами с точностью до копеек');periods.add(r.month);log(r.log);}
   const orders=rows(c,'orders',500);for(const r of orders){record(r);if(!str(r.title,200,true)||!str(r.number,100)||!str(r.supplier,200)||!str(r.notes,5000)||!Object.hasOwn(STAGES,r.stage)||!Object.hasOwn(PAYMENTS,r.payment)||!money(r.amount)||!date(r.due)||!date(r.reminderDate)||!str(r.reminderTime,5)||r.reminderTime&&!/^([01]\d|2[0-3]):[0-5]\d$/.test(r.reminderTime)||r.reminderTime&&!r.reminderDate)bad('Неверные данные заказа');log(r.log);}
   for(const r of rows(c,'brandNotes',1000)){record(r);if(!str(r.text,5000,true)||!date(r.date)||!str(r.time,5)||r.time&&!/^([01]\d|2[0-3]):[0-5]\d$/.test(r.time)||r.time&&!r.date||typeof r.done!=='boolean'||r.orderId!==null&&!orders.some(o=>o.id===r.orderId))bad('Неверная заметка или ссылка на заказ');}
   for(const r of rows(c,'clearanceItems',500)){record(r);if(!str(r.title,200,true)||!str(r.reason,2000,true)||!str(r.notes,5000)||!str(r.manager,120)||!str(r.client,200)||!date(r.date)||!r.checks||Object.keys(r.checks).length!==3||Object.keys(CHECKS).some(k=>typeof r.checks[k]!=='boolean')||!Array.isArray(r.photos)||r.photos.length>5)bad('Неверная карточка уценки');const photos=new Set();for(const p of r.photos){if(!p||!str(p.id,100,true)||photos.has(p.id)||!str(p.name,200,true)||typeof p.data!=='string'||p.data.length>160023||!/^data:image\/jpeg;base64,\/9j\/[A-Za-z0-9+/]*={0,2}$/.test(p.data))bad('Неверное фото: разрешена уменьшенная JPEG-копия до 120 КБ');photos.add(p.id);}log(r.log);}
  }
  return data;
 }
 function catalogPlan(data,uid,tools={sales:true,orders:true,notes:true},currency='KZT'){
  const next=structuredClone(data),changes=[];let maxon;
  function add(name,key,parentId=null,kind='brand'){
   let c=next.categories.find(x=>x.workspace==='work'&&(x.catalogKey===key||norm(x.name)===norm(name)||kind==='clearance'&&x.kind==='clearance'));
   if(!c){c={id:uid(),name,workspace:'work',kind,parentId,color:['blue','violet','cyan','sage','amber','rose'][next.categories.length%6],...(kind==='brand'?{tools:{...tools},currency}:{})};next.categories.push(c);changes.push({name,action:'Создать'});}
   else if((c.parentId||null)!==parentId||!isBrand(c)&&kind==='brand'||c.kind!==kind&&kind==='clearance'){changes.push({name:c.name,action:parentId?'Перенести в MAXON':kind==='clearance'?'Оформить как уценку':'Сделать корневым брендом'});c.parentId=parentId;c.kind=kind;}
   c.catalogKey=key;return c;
  }
  for(const name of ROOTS){const c=add(name,'brand:'+name);if(name==='MAXON')maxon=c;}
  for(const name of DIRECTIONS)add(name,'maxon:'+name,maxon.id);
  add('Уценка','clearance',null,'clearance');
  return {next,changes};
 }
 function salesSnapshot(c,period){const r=(c.sales||[]).find(r=>r.month===period);return {plan:r?.plan??null,actual:r?.actual??null,percent:r?.plan>0&&r.actual!==null?Math.round(r.actual/r.plan*100):null};}
 function reminders(data,scope='work'){
  const list=[];for(const c of data.categories.filter(c=>c.workspace===scope)){
   if(enabled(c,'notes'))for(const n of c.brandNotes||[])if(n.date&&!n.done)list.push({id:n.id,category:c.id,title:n.text,date:n.date,time:n.time||'09:00',kind:'note',label:c.name});
   if(enabled(c,'orders'))for(const o of c.orders||[])if(o.reminderDate&&o.stage!=='delivered')list.push({id:o.id,category:c.id,title:o.title,date:o.reminderDate,time:o.reminderTime||'09:00',kind:'order',label:c.name});
  }return list.sort((a,b)=>(a.date+'T'+a.time).localeCompare(b.date+'T'+b.time));
 }
 window.PoryadokBusinessModel={ROOTS,DIRECTIONS,STAGES,PAYMENTS,CHECKS,norm,isBrand,enabled,date,month,validate,branchIds,pathName,children,catalogPlan,salesSnapshot,reminders};
})();
