'use strict';
const KEY = 'poryadok.tasks.v1';
const cloud = new DashboardCloud(window.PORYADOK_CONFIG || {});
let cloudMode=false, writeBusy=false, cloudLoading=false, accountEpoch=0;
const $ = s => document.querySelector(s);
const priorities = {high:'Высокий',medium:'Средний',low:'Низкий'};
const statuses = {todo:'К выполнению',progress:'В работе',waiting:'Ожидаю ответа',done:'Завершена'};
const viewNames = {all:'Все задачи',today:'Мой день',incoming:'Входящие',done:'Завершённые'};
const colors = ['#be9561','#8894b9','#619e86','#be8593','#7d9eaf'];
const initial = () => ({version:1,categories:[{id:'inbox',name:'Без категории'},{id:'suppliers',name:'Заказы поставщикам'},{id:'learning',name:'Обучение и презентации'},{id:'work',name:'Рабочие задачи'},{id:'personal',name:'Личное'}],tasks:[]});
const uid = () => crypto.randomUUID();
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };
const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function validate(data) {
  if (!data || data.version !== 1 || !Array.isArray(data.categories) || !Array.isArray(data.tasks) || !data.categories.length || data.categories.length > 500 || data.tasks.length > 50000) throw Error('Неверный формат резервной копии');
  const cats = new Set(), ids = new Set();
  for (const c of data.categories) { if (!c || typeof c.id !== 'string' || !c.id || cats.has(c.id) || typeof c.name !== 'string' || !c.name.trim() || c.name.length>80) throw Error('Неверные категории'); cats.add(c.id); }
  if (!cats.has('inbox')) throw Error('Нет категории входящих');
  for (const t of data.tasks) {
    if (!t || typeof t.id !== 'string' || !t.id || ids.has(t.id) || typeof t.title !== 'string' || !t.title.trim() || t.title.length>200 || !cats.has(t.category) || !Object.hasOwn(priorities,t.priority) || !Object.hasOwn(statuses,t.status) || !['self','incoming','bitrix'].includes(t.source) || typeof t.description !== 'string' || t.description.length>10000 || typeof t.link !== 'string' || (t.link && !/^https?:\/\//i.test(t.link)) || typeof t.due !== 'string' || (t.due && (!/^\d{4}-\d{2}-\d{2}$/.test(t.due) || Number.isNaN(Date.parse(t.due)))) || !Array.isArray(t.history)) throw Error('Неверные данные задачи');
    ids.add(t.id);
    for (const h of t.history) if (!h || typeof h.text !== 'string' || h.text.length>10000 || !['note','system'].includes(h.kind) || typeof h.at !== 'string' || Number.isNaN(Date.parse(h.at))) throw Error('Неверная хронология');
  }
  return data;
}
let data = initial(), storageBlocked = false;
try { const stored = localStorage.getItem(KEY); if (stored) data = validate(JSON.parse(stored)); } catch { storageBlocked = true; }
let view='all', category=null, layout='groups', edited=null, toastTimer;
function toast(message) { $('#toast').textContent=message; $('#toast').hidden=false; clearTimeout(toastTimer); toastTimer=setTimeout(()=>$('#toast').hidden=true,6000); }
async function commit(next) {
  if (cloudLoading || writeBusy) { toast('Дождитесь завершения сохранения или загрузки.'); return false; }
  if (cloudMode) {
    writeBusy=true;
    try { await cloud.save(next); data=next; render(); setSync('Сохранено в личном аккаунте'); return true; }
    catch(error) { setSync('Изменение не сохранено: '+error.message); toast(error.message); return false; }
    finally { writeBusy=false; }
  }
  if (storageBlocked) { toast('Хранилище недоступно или повреждено. Экспортируйте данные; исходное хранилище не перезаписано.'); return false; }
  try { localStorage.setItem(KEY,JSON.stringify(next)); data=next; render(); return true; } catch { toast('Не удалось сохранить: проверьте свободное место и доступ к хранилищу.'); return false; }
}
async function update(mutator) { const next=structuredClone(data); mutator(next); return commit(next); }
function event(text,kind='system') { return {text,kind,at:new Date().toISOString()}; }
function dueLabel(due) { if (!due) return 'Без срока'; if (due===today()) return 'Сегодня'; return new Date(due+'T12:00:00').toLocaleDateString('ru-RU',{day:'numeric',month:'short'}); }
function visibleTasks() {
 const q=$('#search').value.toLocaleLowerCase(), p=$('#priority-filter').value;
 return data.tasks.filter(t => (view==='done' ? t.status==='done' : t.status!=='done') && (view!=='today'||t.due===today()) && (view!=='incoming'||t.source!=='self') && (!category||t.category===category) && (p==='all'||t.priority===p) && (t.title+' '+t.description+' '+t.history.map(h=>h.text).join(' ')).toLocaleLowerCase().includes(q)).sort((a,b)=>({high:0,medium:1,low:2}[a.priority]-{high:0,medium:1,low:2}[b.priority]) || (a.due||'9999').localeCompare(b.due||'9999'));
}
function card(t) {
 return `<article class="task-card ${t.status==='done'?'done':''}" data-task="${escapeHTML(t.id)}" tabindex="0" role="button" aria-label="Открыть задачу: ${escapeHTML(t.title)}"><div class="card-top"><span class="badge ${t.priority}">${priorities[t.priority]} приоритет</span><span class="more">···</span></div><div class="task-title"><button class="check ${t.status==='done'?'checked':''}" data-complete="${escapeHTML(t.id)}" aria-label="${t.status==='done'?'Вернуть в работу':'Завершить'}: ${escapeHTML(t.title)}">${t.status==='done'?'✓':''}</button><h3>${escapeHTML(t.title)}</h3></div><p>${escapeHTML(t.description || (t.source==='bitrix'?'Из Битрикс24':t.source==='incoming'?'Входящая задача':'Поставил себе'))}</p><div class="card-bottom"><span class="${t.due && t.due<today() && t.status!=='done'?'overdue':''}">◷ ${dueLabel(t.due)}${t.due && t.due<today() && t.status!=='done'?' · просрочена':''}</span><span>♧ ${t.history.filter(h=>h.kind==='note').length}</span><span class="status ${t.status}">${statuses[t.status]}</span></div></article>`;
}
function render() {
 const active=data.tasks.filter(t=>t.status!=='done');
 $('#all-count').textContent=active.length;
 $('#stat-active').textContent=active.length;
 $('#stat-high').textContent=active.filter(t=>t.priority==='high').length;
 $('#stat-today').textContent=active.filter(t=>t.due===today()).length;
 $('#stat-done').textContent=data.tasks.length-active.length;
 const title=category?data.categories.find(c=>c.id===category)?.name:viewNames[view];
 $('#page-title').innerHTML=escapeHTML(title)+'<span class="title-dot">.</span>';
 $('#breadcrumb-view').textContent=title;
 $('#categories').innerHTML=data.categories.map((c,i)=>`<button data-category="${escapeHTML(c.id)}" class="${category===c.id?'active':''}"><i class="dot" style="background:${colors[i%colors.length]};margin:0"></i>${escapeHTML(c.name)}</button>`).join('');
 document.querySelectorAll('[data-view]').forEach(b=>b.classList.toggle('active',!category&&b.dataset.view===view));
 const tasks=visibleTasks();
 $('#task-groups').classList.toggle('list-layout',layout==='list');
 if (!tasks.length) { $('#task-groups').innerHTML=`<div class="empty">${data.tasks.length?'Задач по этим условиям пока нет.':'Начните с одной задачи — запишите её в строке выше.'}${!data.tasks.length?'<br><button id="examples" class="plain" style="margin-top:15px">Посмотреть на примере демозадач</button>':''}</div>`; return; }
 const groups=layout==='list'?[{name:'Задачи',tasks}]:data.categories.map(c=>({...c,tasks:tasks.filter(t=>t.category===c.id)})).filter(c=>c.tasks.length);
 $('#task-groups').innerHTML=groups.map((c,i)=>`<section class="task-group"><div class="group-heading"><i class="dot" style="background:${colors[(c.id?data.categories.findIndex(x=>x.id===c.id):0)%colors.length]}"></i><h2>${escapeHTML(c.name)}</h2><span class="group-count">${c.tasks.length}</span><button data-add="${escapeHTML(c.id||category||'inbox')}">＋ Добавить</button></div><div class="cards">${c.tasks.map(card).join('')}</div></section>`).join('');
}
function openTask(id=null,cat=null) {
 edited=id; const t=data.tasks.find(t=>t.id===id); const form=$('#task-form'); form.reset();
 $('#dialog-title').textContent=t?'Детали задачи':'Новая задача';
 $('#task-category').innerHTML=data.categories.map(c=>`<option value="${escapeHTML(c.id)}">${escapeHTML(c.name)}</option>`).join('');
 if(t) for(const name of ['title','category','priority','due','source','status','description','link']) form.elements[name].value=t[name];
 else { form.elements.category.value=cat||category||'inbox'; if(view==='today') form.elements.due.value=today(); if(view==='incoming') form.elements.source.value='incoming'; }
 $('#delete-task').hidden=!t; $('#history-section').hidden=!t; $('#note-text').value=''; renderHistory(); $('#task-dialog').showModal(); form.elements.title.focus();
}
const recordNames={note:'Заметка',report:'Отчёт о работе',change:'Уточнение / правка'};
function renderHistory() { const t=data.tasks.find(t=>t.id===edited); $('#history').innerHTML=(t?.history||[]).map(h=>`<div class="event ${h.kind}"><time>${h.kind==='note'?escapeHTML(recordNames[h.recordType]||'Заметка')+' · ':''}${escapeHTML(new Date(h.at).toLocaleString('ru-RU'))}</time>${escapeHTML(h.text)}</div>`).join(''); }
$('#current-date').textContent=new Date().toLocaleDateString('ru-RU',{weekday:'long',day:'numeric',month:'long'});
$('#views').onclick=e=>{const b=e.target.closest('[data-view]');if(b){view=b.dataset.view;category=null;render();}};
$('#categories').onclick=e=>{const b=e.target.closest('[data-category]');if(b){category=b.dataset.category;view='all';render();}};
$('.stats').onclick=e=>{const b=e.target.closest('[data-stat]');if(b){view=b.dataset.stat==='high'?'all':b.dataset.stat;category=null;$('#priority-filter').value=b.dataset.stat==='high'?'high':'all';render();}};
$('.tabs').onclick=e=>{const b=e.target.closest('[data-layout]');if(b){layout=b.dataset.layout;document.querySelectorAll('[data-layout]').forEach(x=>x.classList.toggle('selected',x===b));render();}};
$('#search').oninput=render; $('#priority-filter').onchange=render;
$('#new-task').onclick=()=>openTask(); $('#close-dialog').onclick=()=>$('#task-dialog').close();
$('#quick-form').onsubmit=async e=>{e.preventDefault();const title=$('#quick-title').value.trim();if(!title)return;const task={id:uid(),title,category:category||'inbox',priority:'medium',due:view==='today'?today():'',source:view==='incoming'?'incoming':'self',status:'todo',description:'',link:'',history:[event('Задача создана')]};if(await update(n=>n.tasks.push(task))){$('#quick-form').reset();if(view==='done'){view='all';render();}toast('Задача добавлена');}};
async function handleTasks(e) {
 const check=e.target.closest('[data-complete]');if(check){await update(n=>{const t=n.tasks.find(t=>t.id===check.dataset.complete);t.status=t.status==='done'?'todo':'done';t.history.push(event(t.status==='done'?'Задача завершена':'Задача возвращена в работу'));});return;}
 const add=e.target.closest('[data-add]');if(add){openTask(null,add.dataset.add);return;}
 const c=e.target.closest('[data-task]');if(c)openTask(c.dataset.task);
 if(e.target.closest('#examples'))await seedExamples();
}
$('#task-groups').onclick=handleTasks;
$('#task-groups').onkeydown=e=>{if(e.target.matches('[data-task]')&&['Enter',' '].includes(e.key)){e.preventDefault();openTask(e.target.dataset.task);}};
$('#task-form').onsubmit=async e=>{e.preventDefault();const f=e.target;const fields={};for(const name of ['title','category','priority','due','source','status','description','link'])fields[name]=f.elements[name].value.trim();if(!fields.title)return;if(fields.link&&!/^https?:\/\//i.test(fields.link)){toast('Для ссылки используйте http:// или https://');return;}const ok=await update(n=>{if(edited){const t=n.tasks.find(t=>t.id===edited);const changed=Object.keys(fields).filter(k=>t[k]!==fields[k]);const previous=t.status;Object.assign(t,fields);if(changed.length)t.history.push(event(previous!==t.status?'Статус: '+statuses[t.status]:'Детали задачи обновлены'));}else n.tasks.push({...fields,id:uid(),history:[event('Задача создана')]});});if(ok){$('#task-dialog').close();toast('Задача сохранена');}};
$('#note-form').onsubmit=async e=>{e.preventDefault();const text=$('#note-text').value.trim();if(!text)return;if(await update(n=>n.tasks.find(t=>t.id===edited).history.push({...event(text,'note'),recordType:$('#note-kind').value}))){$('#note-text').value='';renderHistory();toast('Заметка добавлена');}};
$('#delete-task').onclick=async()=>{if(confirm('Удалить задачу и всю её хронологию?'))if(await update(n=>n.tasks=n.tasks.filter(t=>t.id!==edited))){$('#task-dialog').close();toast('Задача удалена');}};
$('#add-category').onclick=()=>{$('#category-form').reset();$('#category-dialog').showModal();$('#category-name').focus();};
$('#close-category').onclick=()=>$('#category-dialog').close();
$('#category-form').onsubmit=async e=>{e.preventDefault();const name=$('#category-name').value.trim();if(!name)return;if(data.categories.some(c=>c.name.toLocaleLowerCase()===name.toLocaleLowerCase())){toast('Такая категория уже есть');return;}if(await update(n=>n.categories.push({id:uid(),name}))){$('#category-dialog').close();toast('Категория добавлена');}};
function downloadFile(contents, type, filename) {
 const blob=new Blob([contents],{type}),url=URL.createObjectURL(blob),a=document.createElement('a');
 a.href=url;a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function csvCell(value) {
 let text=String(value??'');
 // Treat user text as text, preventing Excel from executing a formula.
 if (/^[\s]*[=+@-]/.test(text) || /^[\t\r\n]/.test(text)) text="'"+text;
 return '"'+text.replace(/"/g,'""')+'"';
}
function csvReport() {
 const header=['Задача','Категория','Приоритет','Статус','Срок','Источник','Ссылка на Битрикс24','Описание','Заметки','Полная хронология'];
 const sources={self:'Поставил себе',incoming:'Входящая задача',bitrix:'Из Битрикс24 вручную'};
 const rows=data.tasks.map(t=>[t.title,data.categories.find(c=>c.id===t.category)?.name||'',priorities[t.priority],statuses[t.status],t.due,sources[t.source],t.link,t.description,t.history.filter(h=>h.kind==='note').map(h=>new Date(h.at).toLocaleString('ru-RU')+' — '+h.text).join('\n'),t.history.map(h=>new Date(h.at).toLocaleString('ru-RU')+' — '+h.text).join('\n')]);
 // UTF-8 BOM lets desktop Excel detect Russian text correctly.
 return '\uFEFF'+[header,...rows].map(row=>row.map(csvCell).join(';')).join('\r\n')+'\r\n';
}
$('#data-tools').onclick=()=>$('#data-dialog').showModal();
$('#close-data').onclick=()=>$('#data-dialog').close();
$('#export-csv').onclick=()=>{downloadFile(csvReport(),'text/csv;charset=utf-8',`poryadok-tasks-${today()}.csv`);toast('Таблица скачана. Откройте CSV в Excel.');};
$('#export').onclick=()=>{downloadFile(JSON.stringify(data,null,2),'application/json;charset=utf-8',`poryadok-backup-${today()}.json`);toast('Резервная копия скачана. Храните её для восстановления.');};
$('#import').onclick=()=>$('#import-file').click();
$('#import-file').onchange=async e=>{const file=e.target.files[0];if(!file)return;try{if(file.size>20000000)throw Error('Файл больше 20 МБ');const next=validate(JSON.parse(await file.text()));if(!confirm(`Восстановить ${next.tasks.length} задач и ${next.categories.length} категорий? Текущие ${data.tasks.length} задач будут заменены. Сначала сохраните экспорт, если они вам нужны.`))return;if(storageBlocked)throw Error('Хранилище повреждено или недоступно. Импорт отменён для защиты исходных данных.');if(await commit(next)){$('#data-dialog').close();category=null;view='all';$('#search').value='';$('#priority-filter').value='all';render();toast('Данные восстановлены');}}catch(error){toast('Импорт отменён: '+error.message);}finally{e.target.value='';}};
async function seedExamples(){if(data.tasks.length)return;const examples=[['Согласовать заказ с поставщиком','suppliers','high','progress','Уточнить наличие и получить счёт'],['Проверить сроки поставки','suppliers','medium','waiting','Ожидаю подтверждение от менеджера'],['Подготовить презентацию продукта','learning','high','todo','Собрать ключевые преимущества и примеры'],['Пройти обучение по новому ассортименту','learning','low','todo','Выделить 30 минут на материалы'],['Ответить на запрос клиента','work','medium','todo','Подготовить варианты и условия'],['Записать идеи на следующую неделю','personal','low','todo','Разобрать заметки и выбрать главное']];await update(n=>n.tasks=examples.map(([title,category,priority,status,description],i)=>({id:uid(),title:'[Демо] '+title,category,priority,status,description,due:i%2===0?today():'',source:i===4?'incoming':'self',link:'',history:[event('Создана демонстрационная задача')]})));toast('Добавлены примеры с меткой [Демо]. Их можно удалить в карточке.');}
function setSync(message) { $('#sync-banner').hidden=!message; $('#sync-banner').textContent=message||''; }
function accountUI() {
 $('#account-button').textContent=cloudMode?'Мой аккаунт':'Войти';
 $('#login-form').hidden=!cloud.configured||cloudMode;
 $('#password-form').hidden=!cloudMode||!cloud.needsPassword;
 $('#account-controls').hidden=!cloudMode;
 $('#account-info').textContent=!cloud.configured?'Облачные аккаунты ещё не подключены. Пока можно пользоваться локальными задачами. Владелец приложения настраивает подключение Supabase.':cloudMode?'Личное пространство: '+(cloud.user?.email||'аккаунт'):'Войдите, чтобы работать со своими задачами на разных устройствах.';
 let localCount=0;try{const raw=localStorage.getItem(KEY);if(raw)localCount=validate(JSON.parse(raw)).tasks.length;}catch{}
 $('#migrate-local').textContent='Добавить задачи с этого устройства ('+localCount+')';
 $('#migration-info').textContent=localCount?'Найдено '+localCount+' локальных задач. Нажмите кнопку выше, чтобы добавить их в аккаунт. Облачные задачи и локальная копия сохранятся.':'В этом браузере локальных задач нет. Можно создать новые задачи или восстановить JSON через «Импорт / экспорт». Для переноса с другого браузера сначала скачайте там резервную копию.';
 const footer=$('.sidebar-bottom');footer.textContent=cloudMode?'Личное облачное пространство':'Данные на этом устройстве';
}
async function loadCloud() {
 if(writeBusy)throw Error('Дождитесь сохранения.');
 cloudLoading=true;const epoch=accountEpoch;
 try { const loaded=await cloud.load();if(epoch!==accountEpoch||!cloudMode)return;data=loaded?validate(loaded):initial();category=null;view='all';render();setSync('Облачные данные загружены. Изменения будут сохраняться в вашем аккаунте.'); }
 catch(error){if(epoch===accountEpoch)throw error;}
 finally {if(epoch===accountEpoch)cloudLoading=false;}
}
async function beginCloud() {
 accountEpoch++;cloudMode=true;data=initial();category=null;render();accountUI();
 try {await loadCloud();}catch(error){cloudLoading=true;setSync('Облако не загружено. Редактирование заблокировано до успешного обновления: '+error.message);throw error;}
}
$('#account-button').onclick=()=>{accountUI();$('#account-status').textContent='';$('#account-dialog').showModal();};
$('#close-account').onclick=()=>$('#account-dialog').close();
$('#login-form').onsubmit=async e=>{
 e.preventDefault();if(cloudLoading||writeBusy){$('#account-status').textContent='Дождитесь загрузки аккаунта.';return;}const form=e.target,button=form.querySelector('[type=submit]');button.disabled=true;
 try {await cloud.login(form.elements.email.value.trim(),form.elements.password.value);form.elements.password.value='';await beginCloud();$('#account-status').textContent='Вход выполнен. Локальные задачи не загружались автоматически.';}
 catch(error){$('#account-status').textContent=error.message;}finally{button.disabled=false;accountUI();}
};
$('#password-form').onsubmit=async e=>{e.preventDefault();const button=e.target.querySelector('button');button.disabled=true;try{await cloud.password(e.target.elements.password.value);e.target.reset();accountUI();$('#account-status').textContent='Пароль сохранён.';}catch(error){$('#account-status').textContent=error.message;}finally{button.disabled=false;}};
$('#forgot-password').onclick=async()=>{const form=$('#login-form');if(!form.elements.email.reportValidity())return;try{await cloud.reset(form.elements.email.value.trim());$('#account-status').textContent='Если аккаунт существует, на email придёт ссылка для смены пароля.';}catch(error){$('#account-status').textContent=error.message;}};
$('#cloud-refresh').onclick=async()=>{try{await loadCloud();$('#account-status').textContent='Обновлено из облака.';}catch(error){cloudLoading=true;$('#account-status').textContent=error.message;setSync('Обновление не выполнено. Попробуйте снова.');}};
$('#logout').onclick=async()=>{
 if(writeBusy){toast('Дождитесь сохранения.');return;}
 accountEpoch++;try{await cloud.logout();}catch{toast('Сессия удалена на этом устройстве. Завершение на сервере не подтверждено.');}
 cloudMode=false;cloudLoading=false;data=initial();storageBlocked=false;
 try{const local=localStorage.getItem(KEY);if(local)data=validate(JSON.parse(local));}catch{storageBlocked=true;}
 category=null;view='all';render();accountUI();setSync('Вы вышли. Показаны только локальные задачи этого браузера.');$('#account-status').textContent='Выход выполнен.';
};
$('#migrate-local').onclick=async()=>{
 try {
  const raw=localStorage.getItem(KEY);if(!raw){$('#account-status').textContent='Нет локальных задач для переноса.';return;}
  const local=validate(JSON.parse(raw));const ids=new Set(data.tasks.map(t=>t.id));const tasks=local.tasks.filter(t=>!ids.has(t.id));
  if(!tasks.length){$('#account-status').textContent='Нет новых задач для переноса.';return;}
  if(!confirm('Добавить '+tasks.length+' локальных задач в ваш аккаунт? Облачные и локальные задачи не будут удалены.'))return;
  const next=structuredClone(data),map=new Map();
  for(const c of local.categories){const same=next.categories.find(x=>x.name===c.name);if(same){map.set(c.id,same.id);continue;}const id=next.categories.some(x=>x.id===c.id)?uid():c.id;next.categories.push({id,name:c.name});map.set(c.id,id);}
  next.tasks.push(...tasks.map(t=>({...t,category:map.get(t.category)})));validate(next);
  if(await commit(next))$('#account-status').textContent='Задачи добавлены. Локальная копия сохранена.';
 }catch(error){$('#account-status').textContent='Перенос отменён: '+error.message;}
};
function bulkItems(){
 const lines=$('#bulk-text').value.split(/\r?\n/).map(t=>t.replace(/^\s*(?:\d+[.)]\s+|[-*•]\s+)/,'').trim()).filter(Boolean);
 const seen=new Set(data.tasks.map(t=>t.title.toLocaleLowerCase()));const titles=[];let duplicates=0;
 for(const title of lines){const norm=title.toLocaleLowerCase();if(seen.has(norm)){duplicates++;continue;}seen.add(norm);titles.push(title);}
 return {titles,duplicates,invalid:titles.some(t=>t.length>200)||lines.length>500};
}
function previewBulk(){const {titles,duplicates,invalid}=bulkItems();$('#bulk-submit').disabled=!titles.length||invalid;$('#bulk-preview').innerHTML=invalid?'Не более 500 строк и 200 символов в названии задачи. Укоротите длинные строки.':`Будет добавлено: ${titles.length}. Совпадения по названию пропущены: ${duplicates}.<ol>${titles.slice(0,50).map(t=>'<li>'+escapeHTML(t)+'</li>').join('')}</ol>`;}
$('#bulk-button').onclick=()=>{$('#bulk-form').reset();$('#bulk-category').innerHTML=data.categories.map(c=>`<option value="${escapeHTML(c.id)}">${escapeHTML(c.name)}</option>`).join('');$('#bulk-category').value=category||'inbox';previewBulk();$('#bulk-dialog').showModal();$('#bulk-text').focus();};
$('#close-bulk').onclick=()=>$('#bulk-dialog').close();$('#bulk-text').oninput=previewBulk;
$('#bulk-form').onsubmit=async e=>{e.preventDefault();const {titles,invalid}=bulkItems();if(invalid||!titles.length)return;const categoryId=$('#bulk-category').value;const tasks=titles.map(title=>({id:uid(),title,category:categoryId,priority:'medium',status:'todo',source:'self',due:'',description:'',link:'',history:[event('Задача добавлена из списка')]}));if(data.tasks.length+tasks.length>50000){toast('Превышен лимит задач.');return;}if(await update(n=>n.tasks.push(...tasks))){$('#bulk-dialog').close();category=null;view='all';$('#search').value='';$('#priority-filter').value='all';render();toast('Добавлено задач: '+tasks.length);}};
async function initializeCloud(){
 cloudLoading=cloud.configured;accountUI();
 try{if(await cloud.restore()){await beginCloud();if(cloud.needsPassword){accountUI();$('#account-dialog').showModal();}}else{cloudLoading=false;if(cloud.invitationError){accountUI();$('#account-status').textContent=cloud.invitationError;$('#account-dialog').showModal();}}}
 catch(error){if(cloud.session){cloudMode=true;data=initial();cloudLoading=true;render();accountUI();}else cloudLoading=false;setSync('Облачный вход не завершён: '+error.message);}
}
render();if(storageBlocked)toast('Не удалось прочитать сохранённые данные. Исходное хранилище защищено от перезаписи.');
initializeCloud();
// Refresh only when no form is open or being edited; do not replace unsaved drafts.
setInterval(async()=>{if(!cloudMode||writeBusy||cloudLoading||document.hidden||$('dialog[open]')||['INPUT','TEXTAREA','SELECT'].includes(document.activeElement.tagName))return;try{await loadCloud();}catch(error){setSync('Не удалось обновить облачные данные: '+error.message);}},30000);
