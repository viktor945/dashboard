'use strict';
(() => {
 const MAX=20*1024*1024,decoder=new TextDecoder('utf-8',{fatal:true});
 const norm=value=>String(value??'').trim().toLocaleLowerCase().replace(/ё/g,'е').replace(/\s+/g,' ');
 const crcTable=Array.from({length:256},(_,n)=>{let c=n;for(let k=0;k<8;k++)c=(c&1)?0xedb88320^(c>>>1):c>>>1;return c>>>0;});
 function crc32(bytes){let crc=0xffffffff;for(const b of bytes)crc=crcTable[(crc^b)&255]^(crc>>>8);return (crc^0xffffffff)>>>0;}
 function xml(bytes){const text=decoder.decode(bytes);if(/<!DOCTYPE|<!ENTITY/i.test(text))throw Error('XML с объявлениями сущностей не поддерживается.');const document=new DOMParser().parseFromString(text,'application/xml');if(document.getElementsByTagName('parsererror').length)throw Error('Повреждён XML внутри Excel.');return document;}
 const tags=(node,name)=>Array.from(node.getElementsByTagNameNS('*',name));
 async function archive(buffer){
  if(buffer.byteLength>MAX)throw Error('Файл больше 20 МБ.');const view=new DataView(buffer),bytes=new Uint8Array(buffer);let end=-1;
  for(let i=bytes.length-22;i>=Math.max(0,bytes.length-65557);i--)if(view.getUint32(i,true)===0x06054b50&&i+22+view.getUint16(i+20,true)===bytes.length){end=i;break;}
  if(end<0)throw Error('Нужен файл XLSX, а не старый XLS или повреждённый архив.');
  const count=view.getUint16(end+10,true),directory=view.getUint32(end+16,true),directorySize=view.getUint32(end+12,true);
  if(view.getUint16(end+4,true)||view.getUint16(end+6,true)||count>1000||count===65535||directory===0xffffffff||directory+directorySize>end)throw Error('Этот вариант ZIP/XLSX не поддерживается.');
  const entries=new Map();let pos=directory,total=0;
  for(let i=0;i<count;i++){
   if(pos+46>end||view.getUint32(pos,true)!==0x02014b50)throw Error('Повреждён список файлов XLSX.');
   const flags=view.getUint16(pos+8,true),method=view.getUint16(pos+10,true),crc=view.getUint32(pos+16,true),compressed=view.getUint32(pos+20,true),size=view.getUint32(pos+24,true),nameSize=view.getUint16(pos+28,true),extra=view.getUint16(pos+30,true),comment=view.getUint16(pos+32,true),offset=view.getUint32(pos+42,true);
   if(pos+46+nameSize+extra+comment>end||flags&1||![0,8].includes(method)||size>MAX||offset+30>directory)throw Error('Зашифрованный или слишком большой XLSX не поддерживается.');
   const name=decoder.decode(bytes.subarray(pos+46,pos+46+nameSize));if(entries.has(name))throw Error('Повторяющиеся части в XLSX.');total+=size;if(total>MAX)throw Error('Распакованный Excel больше 20 МБ.');entries.set(name,{method,crc,compressed,size,offset});pos+=46+nameSize+extra+comment;
  }
  const cache=new Map();
  async function read(name,optional=false){
   if(cache.has(name))return cache.get(name);const entry=entries.get(name);if(!entry){if(optional)return null;throw Error('В XLSX не найдена часть '+name);}
   const {offset,compressed,size,method,crc}=entry;
   if(view.getUint32(offset,true)!==0x04034b50||view.getUint16(offset+8,true)!==method)throw Error('Повреждена часть XLSX.');
   const start=offset+30+view.getUint16(offset+26,true)+view.getUint16(offset+28,true);if(start+compressed>directory)throw Error('Повреждён размер части XLSX.');let output;
   if(method===0)output=bytes.slice(start,start+compressed);
   else{
    let stream;try{stream=new Blob([bytes.subarray(start,start+compressed)]).stream().pipeThrough(new DecompressionStream('deflate-raw'));}catch{throw Error('Для чтения XLSX обновите браузер или используйте современный Chrome, Edge или Safari.');}
    const reader=stream.getReader(),chunks=[];let length=0;
    try{while(true){const next=await reader.read();if(next.done)break;length+=next.value.length;if(length>size||length>MAX){await reader.cancel();throw Error('Размер распакованной части XLSX превышен.');}chunks.push(next.value);}}finally{reader.releaseLock();}
    output=new Uint8Array(length);let cursor=0;for(const chunk of chunks){output.set(chunk,cursor);cursor+=chunk.length;}
   }
   if(output.length!==size||crc32(output)!==crc)throw Error('Проверка целостности XLSX не пройдена.');cache.set(name,output);return output;
  }
  return {read};
 }
 function column(reference){let n=0;for(const char of reference.replace(/\d/g,'').toUpperCase())n=n*26+char.charCodeAt(0)-64;return n-1;}
 function dueDate(cell,date1904){
  if(!cell||!cell.value)return '';
  if(cell.numeric){const serial=Number(cell.value);if(Number.isFinite(serial)&&serial>=1&&serial<=2958465){const base=date1904?Date.UTC(1904,0,1):Date.UTC(1899,11,30);return new Date(base+Math.floor(serial)*86400000).toISOString().slice(0,10);}}
  const text=cell.value.trim(),iso=/^(\d{4})-(\d{2})-(\d{2})(?:[T ].*)?$/.exec(text),local=/^(\d{2})[./](\d{2})[./](\d{4})$/.exec(text);let result=iso?iso[1]+'-'+iso[2]+'-'+iso[3]:local?local[3]+'-'+local[2]+'-'+local[1]:'';
  if(result){const parsed=new Date(result+'T12:00:00Z');if(Number.isNaN(parsed.getTime())||parsed.toISOString().slice(0,10)!==result)result='';}return result;
 }
 async function parse(buffer){
  const zip=await archive(buffer),workbook=xml(await zip.read('xl/workbook.xml')),relations=xml(await zip.read('xl/_rels/workbook.xml.rels')),sharedBytes=await zip.read('xl/sharedStrings.xml',true),shared=sharedBytes?tags(xml(sharedBytes),'si').map(si=>tags(si,'t').map(t=>t.textContent).join('')):[],sheets=tags(workbook,'sheet');
  if(sheets.length>30)throw Error('В книге больше 30 листов.');const date1904=['true','1'].includes(tags(workbook,'workbookPr')[0]?.getAttribute('date1904'));
  const statusMap={'завершено':'done','завершена':'done','выполнено':'done','в работе':'progress','запланировано':'todo','к выполнению':'todo','ожидаю ответа':'waiting','ожидаем ответа':'waiting','ожидание':'waiting'};
  const all=[];let reportLabel='',found=0;
  for(const sheet of sheets){
   const relId=sheet.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships','id')||sheet.getAttribute('r:id'),rel=tags(relations,'Relationship').find(r=>r.getAttribute('Id')===relId&&r.getAttribute('Type')?.endsWith('/worksheet')&&r.getAttribute('TargetMode')!=='External');if(!rel)continue;
   const target=new URL(rel.getAttribute('Target'),'https://xlsx.invalid/xl/');if(target.origin!=='https://xlsx.invalid'||!target.pathname.startsWith('/xl/'))throw Error('Внешние листы не поддерживаются.');const sheetDoc=xml(await zip.read(target.pathname.slice(1))),rows=tags(sheetDoc,'row');if(rows.length>5000)throw Error('В отчёте больше 5000 строк.');
   const decoded=rows.map(row=>{const values=[];for(const cell of tags(row,'c')){const ref=cell.getAttribute('r')||'',index=column(ref);if(index<0||index>100)continue;const type=cell.getAttribute('t'),v=tags(cell,'v')[0]?.textContent||'';let value='';if(type==='s'){if(!/^\d+$/.test(v)||Number(v)>=shared.length)throw Error('Некорректная строка в XLSX.');value=shared[Number(v)];}else if(type==='inlineStr')value=tags(cell,'t').map(t=>t.textContent).join('');else value=v;values[index]={value,numeric:(!type||type==='n')&&!!v,ref,formulaUncached:tags(cell,'f').length>0&&(!tags(cell,'v').length||(!v&&type!=='str'))};}return {row:Number(row.getAttribute('r')),values};});
   let headerIndex=-1,columns;
   for(let i=0;i<Math.min(decoded.length,50);i++){const values=decoded[i].values;const task=values.findIndex(c=>norm(c?.value)==='задача'),status=values.findIndex(c=>norm(c?.value)==='статус');if(task>=0&&status>=0){headerIndex=i;columns={task,status,number:values.findIndex(c=>['№','номер'].includes(norm(c?.value))),result:values.findIndex(c=>norm(c?.value).startsWith('результат')),next:values.findIndex(c=>norm(c?.value).startsWith('что осталось')),due:values.findIndex(c=>norm(c?.value)==='срок'),delay:values.findIndex(c=>norm(c?.value).startsWith('причина задержки')),comment:values.findIndex(c=>norm(c?.value)==='комментарий'),brand:values.findIndex(c=>norm(c?.value).startsWith('бренд')),priority:values.findIndex(c=>norm(c?.value).startsWith('приоритет')),categoryKind:values.findIndex(c=>norm(c?.value)==='тип категории'),review:values.findIndex(c=>norm(c?.value).startsWith('проверить'))};break;}}
   if(headerIndex<0)continue;found++;
   const labels=decoded.slice(0,headerIndex).flatMap(r=>r.values.filter(Boolean).map(c=>c.value)).filter(t=>norm(t).startsWith('период:'));const sheetLabel=labels[0]||'';if(sheetLabel)reportLabel=[...new Set([reportLabel,sheetLabel].filter(Boolean))].join(' | ');
   for(const row of decoded.slice(headerIndex+1)){
    const val=name=>String(row.values[columns[name]]?.value||'').trim(),title=val('task');if(row.values[columns.task]?.formulaUncached)throw Error('Строка '+row.row+': название содержит формулу без сохранённого результата.');if(!title)continue;for(const index of Object.values(columns))if(row.values[index]?.formulaUncached)throw Error('Строка '+row.row+': формула без сохранённого результата. Откройте Excel, пересчитайте и сохраните файл или замените формулу значением.');const rawStatus=val('status'),status=Object.hasOwn(statusMap,norm(rawStatus))?statusMap[norm(rawStatus)]:null;if(!status)throw Error('Строка '+row.row+': неподдерживаемый статус «'+rawStatus+'». Данные не изменены.');if(title.length>200)throw Error('Строка '+row.row+': название длиннее 200 символов. Укоротите его в Excel.');
    const rawPriority=val('priority'),priority=!rawPriority?'medium':norm(rawPriority).startsWith('высок')?'high':norm(rawPriority).startsWith('низк')?'low':norm(rawPriority).startsWith('сред')?'medium':null;if(!priority)throw Error('Строка '+row.row+': непонятный приоритет. Используйте Высокий, Средний или Низкий.');const due=dueDate(row.values[columns.due],date1904),number=val('number')||String(row.row),source={sheet:sheet.getAttribute('name'),row:row.row,number,reportLabel:sheetLabel,status:rawStatus,statusCode:status,result:val('result'),next:val('next'),delay:val('delay'),comment:val('comment'),dueRaw:val('due'),review:val('review'),brandFromFile:val('brand'),priorityFromFile:rawPriority};
    const notes=[source.review,source.dueRaw&&!due?'Срок записан текстом — точная дата не назначена.':'',!rawPriority?'Приоритет не указан — предложен средний.':'',!val('brand')?'Бренд не указан — предложены общие задачи.':''].filter(Boolean);
    const keyText='report|'+norm(sheet.getAttribute('name'))+'|'+norm(sheetLabel)+'|'+norm(title)+'|'+number,hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(keyText)))).map(n=>n.toString(16).padStart(2,'0')).join('');
    if(all.length>=5000)throw Error('В одном добавлении поддерживается до 5000 задач.');all.push({title,status,priority,due,categoryKind:['другие','без бренда','общие'].includes(norm(val('categoryKind')))?'general':'brand',brand:val('brand')||'Общие задачи',source,importKey:'report:'+hash,notes});
   }
  }
  if(!found||!all.length)throw Error('Не найден отчёт со столбцами «Задача» и «Статус». Нужен XLSX с таблицей задач.');return {rows:all,reportLabel,found};
 }
 window.PoryadokReportXlsx={parse};
})();
