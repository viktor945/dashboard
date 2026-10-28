'use strict';
const KEY = 'poryadok.tasks.v1';
const cloud = new DashboardCloud(window.PORYADOK_CONFIG || {});
let cloudMode=false, writeBusy=false, cloudLoading=false, accountEpoch=0;
const $ = s => document.querySelector(s);
const priorities = {high:'Высокий',medium:'Средний',low:'Низкий'};
const statuses = {todo:'К выполнению',progress:'В работе',waiting:'Ожидаю ответа',done:'Завершена'};
const viewNames = {all:'Все задачи',today:'Мой день',incoming:'Входящие',attention:'Требуют внимания',waiting:'Ожидаем ответа',unassigned:'Без бренда / другие задачи',done:'Завершённые'};
const workspaceNames={work:'Рабочее',personal:'Личное'};
let workspace='work';
try{const chosen=new URLSearchParams(location.search).get('workspace')||localStorage.getItem('poryadok.workspace.v1');if(Object.hasOwn(workspaceNames,chosen))workspace=chosen;}catch{}
const colors = ['#be9561','#8894b9','#619e86','#be8593','#7d9eaf'];
const arrowIcon='<svg viewBox="0 0 24 24" aria-hidden="true" class="icon"><path d="M6 18 18 6M6 6h12v12"/></svg>';
const brandColors=['sage','violet','amber','blue','rose','cyan','slate'];
const initial = () => ({version:1,categories:[{id:'inbox',name:'Общие задачи',workspace:'work',color:'slate'},{id:'personal',name:'Личные дела',workspace:'personal'},{id:'home',name:'Дом и семья',workspace:'personal'},{id:'health',name:'Здоровье',workspace:'personal'},{id:'self-learning',name:'Развитие',workspace:'personal'}],tasks:[]});
const uid = () => crypto.randomUUID();
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };
const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function validate(data) {
  if (!data || data.version !== 1 || !Array.isArray(data.categories) || !Array.isArray(data.tasks) || !data.categories.length || data.categories.length > 501 || data.tasks.length > 50000) throw Error('Неверный формат резервной копии');
  data=structuredClone(data);
  const cats = new Set(), ids = new Set();
  for (const c of data.categories) { if (!c || typeof c.id !== 'string' || !c.id || cats.has(c.id) || typeof c.name !== 'string' || !c.name.trim() || c.name.length>80) throw Error('Неверные категории'); if(c.workspace!==undefined&&!Object.hasOwn(workspaceNames,c.workspace))throw Error('Неверный раздел категории');c.workspace=c.workspace||(c.id==='personal'?'personal':'work');if(c.kind!==undefined&&!['brand','general'].includes(c.kind))throw Error('Неверный тип категории');if(c.color!==undefined&&!brandColors.includes(c.color))throw Error('Неверный цвет бренда');if(c.description!==undefined&&(typeof c.description!=='string'||c.description.length>300))throw Error('Неверное описание бренда');cats.add(c.id); }
  if (!data.categories.some(c=>c.workspace==='personal')){let id='personal';while(cats.has(id))id+='-new';data.categories.push({id,name:'Личные дела',workspace:'personal'});cats.add(id);}
  if(data.categories.length>501)throw Error('Превышен лимит категорий');
  if (!cats.has('inbox') || data.categories.find(c=>c.id==='inbox').workspace!=='work') throw Error('Нет категории входящих');
  for (const t of data.tasks) {
    if (!t || typeof t.id !== 'string' || !t.id || ids.has(t.id) || typeof t.title !== 'string' || !t.title.trim() || t.title.length>200 || !cats.has(t.category) || !Object.hasOwn(priorities,t.priority) || !Object.hasOwn(statuses,t.status) || !['self','incoming','bitrix'].includes(t.source) || typeof t.description !== 'string' || t.description.length>10000 || typeof t.link !== 'string' || (t.link && !/^https?:\/\//i.test(t.link)) || typeof t.due !== 'string' || (t.due && (!/^\d{4}-\d{2}-\d{2}$/.test(t.due) || Number.isNaN(Date.parse(t.due)))) || !Array.isArray(t.history)) throw Error('Неверные данные задачи');
    const taskWorkspace=data.categories.find(c=>c.id===t.category).workspace;
    if(t.workspace!==undefined&&t.workspace!==taskWorkspace)throw Error('Раздел задачи не совпадает с категорией');t.workspace=taskWorkspace;
    if(t.dueTime!==undefined&&(typeof t.dueTime!=='string'||(t.dueTime&&!/^([01]\d|2[0-3]):[0-5]\d$/.test(t.dueTime))))throw Error('Неверное время срока');if(t.dueTime&&!t.due)throw Error('Время срока требует дату');t.dueTime=t.dueTime||'';
    ids.add(t.id);
    for (const h of t.history) if (!h || typeof h.text !== 'string' || h.text.length>10000 || !['note','system'].includes(h.kind) || typeof h.at !== 'string' || Number.isNaN(Date.parse(h.at))) throw Error('Неверная хронология');
  }
  return data;
}
let data = initial(), storageBlocked = false;
try { const stored = localStorage.getItem(KEY); if (stored) data = validate(JSON.parse(stored)); } catch { storageBlocked = true; }
let view='all', category=null, layout='groups', portfolioScroll=0, lastOpenedBrand=null, edited=null, toastTimer, categoryEdited=null;
try{const saved=localStorage.getItem('poryadok.layout.v1');if(['groups','list','board'].includes(saved))layout=saved;}catch{}
function toast(message) { $('#toast').textContent=message; $('#toast').hidden=false; clearTimeout(toastTimer); toastTimer=setTimeout(()=>$('#toast').hidden=true,6000); }
async function commit(next) {
  try{next=validate(next);}catch(error){toast(error.message);return false;}
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
function spaceTasks(){return data.tasks.filter(t=>t.workspace===workspace);}
function isGeneral(c){return c?.id==='inbox'||c?.kind==='general';}
function spaceCategories(scope=workspace){return data.categories.filter(c=>c.workspace===scope);}
function defaultCategory(scope=workspace){return (scope==='work'?data.categories.find(c=>c.id==='inbox'):spaceCategories(scope)[0]).id;}
function categoryOptions(scope=workspace){return spaceCategories(scope).map(c=>`<option value="${escapeHTML(c.id)}">${escapeHTML(c.name)}</option>`).join('');}
function taskWorkspaceOptions(scope,selected){$('#task-category').innerHTML=categoryOptions(scope);$('#task-category').value=spaceCategories(scope).some(c=>c.id===selected)?selected:defaultCategory(scope);}
function overdue(t){return t.status!=='done'&&!!t.due&&(t.due<today()||(t.due===today()&&!!t.dueTime&&t.dueTime<new Date().toTimeString().slice(0,5)));}
function attention(t){return t.status!=='done'&&(t.priority==='high'||overdue(t));}
function lastUpdate(t){return t.history.reduce((at,h)=>Math.max(at,Date.parse(h.at)||0),0);}
function taskMatches(t,q){return (t.title+' '+t.description+' '+t.history.map(h=>h.text).join(' ')+' '+(data.categories.find(c=>c.id===t.category)?.name||'')).toLocaleLowerCase().includes(q);}
function compareTasks(a,b){
 const priority={high:0,medium:1,low:2},date=t=>(t.due||'9999-12-31')+'T'+(t.dueTime||'23:59'),order=$('#sort-order').value;
 if(a.status==='done'&&b.status!=='done')return 1;if(b.status==='done'&&a.status!=='done')return -1;
 if(order==='updated')return lastUpdate(b)-lastUpdate(a)||a.title.localeCompare(b.title,'ru');
 return (order==='due'?date(a).localeCompare(date(b))||priority[a.priority]-priority[b.priority]:priority[a.priority]-priority[b.priority]||date(a).localeCompare(date(b)))||a.title.localeCompare(b.title,'ru');
}
function visibleTasks() {
 const q=$('#search').value.trim().toLocaleLowerCase(),p=$('#priority-filter').value,status=$('#status-filter').value,done=$('#show-completed').checked;
 return spaceTasks().filter(t=>(view==='done'?t.status==='done':done||t.status!=='done')&&(view!=='unassigned'||isGeneral(data.categories.find(c=>c.id===t.category)))&&(view!=='today'||t.due===today())&&(view!=='incoming'||t.source!=='self')&&(view!=='attention'||attention(t))&&(view!=='waiting'||t.status==='waiting')&&(!category||t.category===category)&&(p==='all'||t.priority===p)&&(status==='all'||view==='done'||t.status===status)&&taskMatches(t,q)).sort(compareTasks);
}
function initials(name){name=name.replace(/^\[Демо\]\s*/,'');return (name.trim().split(/\s+/).length>1?name.trim().split(/\s+/).slice(0,2).map(s=>[...s][0]).join(''):[...name].slice(0,2).join('')).toUpperCase();}
function brandColor(c){return c.color||brandColors[Math.max(0,data.categories.findIndex(x=>x.id===c.id))%brandColors.length];}
function brandStats(c){const tasks=spaceTasks().filter(t=>t.category===c.id),active=tasks.filter(t=>t.status!=='done');return {tasks,active,done:tasks.length-active.length,attention:active.filter(attention).length,waiting:active.filter(t=>t.status==='waiting').length,next:active.filter(t=>t.due).sort((a,b)=>(a.due+'T'+(a.dueTime||'23:59')).localeCompare(b.due+'T'+(b.dueTime||'23:59')))[0]};}
function brandTile(c){const stats=brandStats(c),ratio=stats.tasks.length?Math.round(stats.done/stats.tasks.length*100):0;return `<button class="brand-tile tone-${brandColor(c)} ${category===c.id?'selected':''}" data-brand="${escapeHTML(c.id)}" aria-expanded="${category===c.id}" aria-controls="brand-detail" aria-label="Открыть ${workspace==='work'?'бренд':'категорию'} ${escapeHTML(c.name)}"><span class="brand-tile-top"><span class="brand-avatar">${escapeHTML(initials(c.name))}</span><span class="brand-signal ${stats.attention?'signal-attention':''}">${stats.attention?'⚑ '+stats.attention+' · внимание':stats.active.length?'● Всё спокойно':'○ Нет активных'}</span><span class="brand-arrow">${arrowIcon}</span></span><span class="brand-tile-name">${escapeHTML(c.name)}</span><span class="brand-tile-description">${escapeHTML(c.description||'Задачи и история работы по направлению')}</span><span class="brand-numbers"><span><b>${stats.active.length}</b> активных</span><span><b>${stats.waiting}</b> ожидают</span><span><b>${stats.done}</b> готово</span></span><span class="brand-progress"><span style="width:${ratio}%"></span></span><span class="brand-tile-bottom"><span>${stats.tasks.length?ratio+'% задач завершено':'Добавьте первую задачу'}</span><span class="${stats.next&&overdue(stats.next)?'overdue':''}">${stats.next?'◷ '+dueLabel(stats.next.due):'Без ближайшего срока'}</span></span></button>`;}
function card(t,mode='list'){const c=data.categories.find(c=>c.id===t.category);const control=mode==='board'?'<label class="board-status-label">Статус<select data-task-status="'+escapeHTML(t.id)+'" aria-label="Изменить статус: '+escapeHTML(t.title)+'">'+Object.entries(statuses).map(([status,label])=>'<option value="'+status+'" '+(status===t.status?'selected':'')+'>'+label+'</option>').join('')+'</select></label>':'';return `<article ${mode==='board'?'draggable="true" ':''}class="task-card ${t.status==='done'?'done':''} ${overdue(t)?'late-task':''}" data-task="${escapeHTML(t.id)}" tabindex="0" role="button" aria-label="Открыть задачу: ${escapeHTML(t.title)}"><button class="check ${t.status==='done'?'checked':''}" data-complete="${escapeHTML(t.id)}" aria-label="${t.status==='done'?'Вернуть в работу':'Завершить'}: ${escapeHTML(t.title)}">${t.status==='done'?'✓':''}</button><div class="task-copy"><h3>${escapeHTML(t.title)}</h3><p>${escapeHTML(t.description||'Откройте задачу, чтобы добавить детали и заметки')}</p><div class="task-meta"><span class="task-brand tone-${brandColor(c)}">${escapeHTML(c.name)}</span><span>☷ ${t.history.filter(h=>h.kind==='note').length} записей</span></div></div><div class="task-pills"><span class="badge ${t.priority}">${priorities[t.priority]}</span><span class="status ${t.status}">${statuses[t.status]}</span></div><div class="task-deadline ${overdue(t)?'overdue':''}"><span>◷ ${dueLabel(t.due)}</span>${t.dueTime?'<small>'+escapeHTML(t.dueTime)+'</small>':''}${overdue(t)?'<small>Просрочена</small>':''}</div>${control}<span class="task-open">${arrowIcon}</span></article>`;}
function render(){
 document.body.dataset.workspace=workspace;document.body.classList.toggle('brand-open',!!category);$('#header-back-portfolio').hidden=!category;$('#header-back-portfolio').setAttribute('aria-label',workspace==='work'?'К брендам':'К категориям');document.body.classList.toggle('board-view',layout==='board');(category?$('.brand-detail-actions'):$('.page-heading')).appendChild($('.task-actions'));$('#views [data-view=unassigned]').hidden=workspace==='personal';document.title=workspace==='work'?'Порядок — портфель брендов':'Порядок — личный планировщик';$('meta[name=theme-color]').content=workspace==='work'?'#4f63e6':'#8653c7';$('.workspace b').textContent=workspaceNames[workspace];$('#space-breadcrumb').textContent=workspaceNames[workspace];
 $('#space-description').textContent=workspace==='work'?'Все направления, приоритеты и следующие шаги — на одном экране.':'Дом, здоровье и личные планы — в своём ритме.';
 $('#all-view-label').textContent=workspace==='work'?'Бренды и задачи':'Категории и задачи';$('.tabs [data-layout=groups]').textContent=workspace==='work'?'▦ Обзор брендов':'▦ Обзор категорий';$('.brand-detail-note').hidden=workspace==='personal';
 $('#page-kicker').textContent=workspace==='work'?'ВАШ ПОРТФЕЛЬ ПОД КОНТРОЛЕМ':'ПРОСТРАНСТВО ДЛЯ СЕБЯ';$('#category-nav-label').textContent=workspace==='work'?'БРЕНДЫ И НАПРАВЛЕНИЯ':'ЛИЧНЫЕ КАТЕГОРИИ';$('#create-brand').textContent=workspace==='work'?'＋ Добавить бренд':'＋ Добавить категорию';
 document.querySelectorAll('#workspace-switch [data-workspace]').forEach(b=>{b.classList.toggle('selected',b.dataset.workspace===workspace);b.setAttribute('aria-pressed',String(b.dataset.workspace===workspace));});
 const all=spaceTasks(),active=all.filter(t=>t.status!=='done');$('#all-count').textContent=active.length;$('#stat-active').textContent=active.length;$('#stat-high').textContent=active.filter(attention).length;$('#stat-today').textContent=active.filter(t=>t.due===today()).length;$('#stat-done').textContent=all.length-active.length;
 const title=category?data.categories.find(c=>c.id===category)?.name:view==='all'?(workspace==='work'?'Портфель брендов':'Личный планировщик'):viewNames[view];$('#page-title').textContent=layout==='groups'&&view==='all'&&!category?(workspace==='work'?'Портфель брендов':'Личный планировщик'):title;$('#breadcrumb-view').textContent=title;
 $('#categories').innerHTML=spaceCategories().filter(c=>workspace==='personal'||!isGeneral(c)).map(c=>`<button data-category="${escapeHTML(c.id)}" class="${category===c.id?'active':''}"><i class="dot tone-dot-${brandColor(c)}"></i><span>${escapeHTML(c.name)}</span><small>${active.filter(t=>t.category===c.id).length}</small></button>`).join('');
 document.querySelectorAll('[data-view]').forEach(b=>b.classList.toggle('active',!category&&b.dataset.view===view));document.querySelectorAll('[data-layout]').forEach(b=>{b.classList.toggle('selected',b.dataset.layout===(layout==='groups'&&(view!=='all'||category)?'list':layout));b.setAttribute('aria-pressed',String(b.classList.contains('selected')));});
 const previousQuick=$('#quick-category').value;$('#quick-category').innerHTML=categoryOptions();$('#quick-category').value=category||((spaceCategories().some(c=>c.id===previousQuick))?previousQuick:defaultCategory());$('#quick-new-brand').textContent=workspace==='work'?'＋ Создать бренд':'＋ Создать категорию';$('#back-portfolio').textContent=workspace==='work'?'← К брендам':'← К категориям';
 const overview=layout==='groups'&&view==='all'&&!category;$('#brand-overview').hidden=!overview;
 const q=$('#search').value.trim().toLocaleLowerCase(),p=$('#priority-filter').value;
 const brands=spaceCategories().filter(c=>workspace==='personal'||!isGeneral(c)).filter(c=>(c.name.toLocaleLowerCase().includes(q)||all.some(t=>t.category===c.id&&taskMatches(t,q)))&&(p==='all'||all.some(t=>t.category===c.id&&t.priority===p))).sort((a,b)=>brandStats(b).attention-brandStats(a).attention||brandStats(b).active.length-brandStats(a).active.length||a.name.localeCompare(b.name,'ru'));
 $('#brands-heading').innerHTML=(workspace==='work'?'Бренды и направления':'Личные категории')+' <span class="group-count">'+brands.length+'</span>';
 $('#demo-overview').hidden=all.length>0;
 const general=all.filter(t=>isGeneral(data.categories.find(c=>c.id===t.category)));$('#general-summary').hidden=workspace!=='work';$('#general-summary').innerHTML='<button data-open-general><b>Без бренда / другие задачи</b><span>'+general.filter(t=>t.status!=='done').length+' активных · отдельный список без показателей продаж →</span></button>';
 $('#brand-grid').innerHTML=brands.length?brands.map(brandTile).join(''):'<div class="empty">Ничего не найдено. Попробуйте изменить поиск или добавьте новый бренд.</div>';
 const focus=active.filter(t=>t.due||t.priority==='high').sort((a,b)=>{const rank=t=>overdue(t)?0:t.due===today()?1:t.priority==='high'?2:3;return rank(a)-rank(b)||(a.due||'9999').localeCompare(b.due||'9999')||({high:0,medium:1,low:2}[a.priority]-{high:0,medium:1,low:2}[b.priority]);}).slice(0,3);
 $('#focus-tasks').innerHTML=focus.length?focus.map(t=>`<button data-task="${escapeHTML(t.id)}"><span class="focus-task-title">${escapeHTML(t.title)}</span><span class="${overdue(t)?'overdue':''}">${dueLabel(t.due)}${t.dueTime?' · '+escapeHTML(t.dueTime):''}</span></button>`).join(''):'<div class="focus-empty">Нет срочных задач.<br>Укажите сроки и приоритеты — ближайшие шаги появятся здесь.</div>';
 $('#portfolio-pulse').innerHTML=`<span class="pulse-dot"></span><div><b>${active.filter(t=>t.status==='waiting').length} задач ожидают ответа</b><small>Фиксируйте договорённости в журнале задачи.</small></div>`;
 $('#brand-detail').hidden=!category;if(category){const c=data.categories.find(c=>c.id===category),stats=brandStats(c);$('.brand-detail-note').hidden=workspace==='personal'||isGeneral(c);$('#brand-detail-heading').innerHTML=`<div class="brand-avatar tone-${brandColor(c)}">${escapeHTML(initials(c.name))}</div><div><span class="section-kicker">${workspace==='work'?'КАРТОЧКА БРЕНДА':'ЛИЧНАЯ КАТЕГОРИЯ'}</span><h2>${escapeHTML(c.name)}</h2><p>${escapeHTML(c.description||'Все задачи и договорённости по этому направлению.')}</p></div><div class="detail-summary"><b>${stats.active.length}</b><span>активных задач</span></div>`;$('#edit-brand').textContent='⚙ Настройки';}
 $('#general-directions').hidden=workspace!=='work'||view!=='unassigned';$('#general-directions').innerHTML='<b>Общие направления</b><p>Задачи без бренда собраны в одном списке. Настройте названия направлений или измените их тип.</p><div>'+spaceCategories('work').filter(isGeneral).map(c=>'<button class="secondary" data-general-edit="'+escapeHTML(c.id)+'">Настроить: '+escapeHTML(c.name)+'</button>').join('')+'<button class="secondary" data-general-create>＋ Добавить направление</button></div>';
 const showTasks=!overview||!!category;$('#task-list-controls').hidden=!showTasks;$('#task-groups').hidden=!showTasks;
 $('#show-completed').disabled=view==='done';if(view==='done')$('#show-completed').checked=true;
 const tasks=visibleTasks();$('#task-list-count').textContent=tasks.length;$('#task-list-title').textContent=category?(workspace==='work'?'Задачи бренда':'Задачи категории'):view==='done'?'Завершённые задачи':'Список задач';
 const archivedOnly=category&&view==='all'&&!$('#show-completed').checked&&$('#status-filter').value==='all'&&!tasks.length?all.filter(t=>t.category===category&&t.status==='done'&&(p==='all'||t.priority===p)&&taskMatches(t,q)).length:0;
 $('#task-groups').innerHTML=layout==='board'?board(tasks):tasks.length?'<div class="cards">'+tasks.map(card).join('')+'</div>':'<div class="empty"><span class="empty-symbol">✓</span><h3>'+(archivedOnly?(all.some(t=>t.category===category&&t.status!=='done')?'Найдены завершённые задачи':'Все задачи завершены'):'Здесь пока нет задач')+'</h3><p>'+(archivedOnly?'Сохранено завершённых задач: '+archivedOnly+'. Откройте их, чтобы посмотреть результаты и историю.':'Добавьте новую задачу или измените фильтры.')+'</p>'+(archivedOnly?'<button class="primary" data-show-done>Показать завершённые ('+archivedOnly+')</button> ':'')+'<button class="secondary" data-add="'+escapeHTML(category||defaultCategory())+'">＋ Добавить задачу</button>'+(!all.length?'<button id="examples" class="text-button">Посмотреть демопример</button>':'')+'</div>';
}
function taskLayout(){try{return localStorage.getItem('poryadok.task-layout.v1')==='board'?'board':'list';}catch{return 'list';}}
function revealBrand(id){
 if(workspace==='work'&&isGeneral(data.categories.find(c=>c.id===id))){category=null;view='unassigned';layout=taskLayout();render();window.scrollTo({top:0,behavior:'instant'});return;}
 if(!category&&view==='all'&&layout==='groups')portfolioScroll=window.scrollY;
 category=id;lastOpenedBrand=id;view='all';layout=taskLayout();$('#show-completed').checked=false;$('#status-filter').value='all';render();window.scrollTo({top:0,behavior:'instant'});
 const heading=$('#brand-detail-heading h2');heading.tabIndex=-1;heading.focus({preventScroll:true});
}
function backToPortfolio(){category=null;view='all';layout='groups';$('#show-completed').checked=false;$('#status-filter').value='all';try{localStorage.setItem('poryadok.layout.v1',layout);}catch{}render();window.scrollTo({top:portfolioScroll,behavior:'instant'});Array.from(document.querySelectorAll('[data-brand]')).find(b=>b.dataset.brand===lastOpenedBrand)?.focus({preventScroll:true});}
function board(tasks){
 return '<div class="kanban-board" aria-label="Доска задач">'+Object.entries(statuses).map(([status,label])=>{
  const list=tasks.filter(t=>t.status===status),heading=status==='done'?'Завершено':label;
  const empty=!list.length?'<div class="column-empty">'+(status==='done'&&!$('#show-completed').checked&&view!=='done'?'Завершённые скрыты.<button class="text-button" data-show-done>Показать завершённые</button>':'Пока нет задач')+'</div>':'';
  return '<section class="kanban-column" data-column="'+status+'" aria-label="'+heading+'">'+
   '<div class="kanban-heading"><span class="status-dot '+status+'"></span><h3>'+heading+'</h3><span>'+list.length+'</span></div>'+
   '<div class="kanban-cards">'+list.map(t=>card(t,'board')).join('')+empty+'</div>'+
   '<button class="column-add" data-add="'+escapeHTML(category||defaultCategory())+'" data-status="'+status+'">＋ Добавить задачу</button></section>';
 }).join('')+'</div>';
}
async function changeTaskStatus(id,status){
 const task=data.tasks.find(t=>t.id===id);if(!task||!Object.hasOwn(statuses,status)||task.status===status)return;
 if(status==='done'&&!confirm('Завершить задачу «'+task.title+'»? Она перейдёт в раздел «Завершённые».')){render();return;}
 const saved=await update(n=>{const t=n.tasks.find(t=>t.id===id),previous=t.status;t.status=status;t.history.push({...event(status==='done'?'Задача завершена':'Статус: '+statuses[status]),eventType:'status',fromStatus:previous,toStatus:status});});if(!saved)render();
}
function openTask(id=null,cat=null) {
 edited=id; const t=data.tasks.find(t=>t.id===id); const form=$('#task-form'); form.reset();
 $('#dialog-title').textContent=t?'Детали задачи':'Новая задача';
 form.elements.workspace.value=t?.workspace||workspace;
 taskWorkspaceOptions(form.elements.workspace.value,t?.category||category);
 if(t) for(const name of ['title','category','priority','due','dueTime','source','status','description','link']) form.elements[name].value=t[name]||'';
 else { form.elements.category.value=cat||category||defaultCategory(); if(view==='today') form.elements.due.value=today(); if(view==='incoming') form.elements.source.value='incoming'; }
 $('#task-category-caption').textContent=form.elements.workspace.value==='work'?'Бренд / направление':'Категория';$('#task-external').hidden=!t?.link;if(t?.link)$('#task-external').href=t.link;
 $('#completion-actions').hidden=!t||t.status==='done'; $('#delete-task').hidden=!t; $('#history-section').hidden=!t; $('#note-text').value=''; renderHistory(); $('#task-dialog').showModal(); form.elements.title.focus();
}
const recordNames={note:'Заметка',report:'Отчёт о работе',change:'Уточнение / правка'};
function renderHistory() { const t=data.tasks.find(t=>t.id===edited); $('#history').innerHTML=(t?.history||[]).map(h=>`<div class="event ${h.kind}"><time>${h.kind==='note'?escapeHTML(recordNames[h.recordType]||'Заметка')+' · ':''}${escapeHTML(new Date(h.at).toLocaleString('ru-RU'))}</time>${escapeHTML(h.text)}</div>`).join(''); }
function switchWorkspace(scope){
 workspace=scope;view='all';category=null;portfolioScroll=0;lastOpenedBrand=null;$('#show-completed').checked=false;$('#status-filter').value='all';$('#search').value='';$('#priority-filter').value='all';
 try{localStorage.setItem('poryadok.workspace.v1',scope);}catch{}
 const url=new URL(location.href);url.searchParams.set('workspace',scope);history.replaceState(null,'',url.pathname+url.search+url.hash);render();
}
$('#workspace-switch').onclick=e=>{const button=e.target.closest('[data-workspace]');if(button)switchWorkspace(button.dataset.workspace);};
$('#task-form [name=workspace]').onchange=e=>taskWorkspaceOptions(e.target.value);
$('#current-date').textContent=new Date().toLocaleDateString('ru-RU',{weekday:'long',day:'numeric',month:'long'});
$('#views').onclick=e=>{const b=e.target.closest('[data-view]');if(b){if(b.dataset.view==='all'){backToPortfolio();return;}view=b.dataset.view;category=null;$('#show-completed').checked=view==='done';$('#status-filter').value='all';render();}};
$('#categories').onclick=e=>{const b=e.target.closest('[data-category]');if(b)revealBrand(b.dataset.category);};
$('.stats').onclick=e=>{const b=e.target.closest('[data-stat]');if(b){view=b.dataset.stat;category=null;$('#priority-filter').value='all';$('#status-filter').value='all';$('#show-completed').checked=view==='done';render();}};
$('.tabs').onclick=e=>{const b=e.target.closest('[data-layout]');if(b){layout=b.dataset.layout;try{localStorage.setItem('poryadok.layout.v1',layout);if(layout!=='groups')localStorage.setItem('poryadok.task-layout.v1',layout);}catch{}if(layout==='groups'){backToPortfolio();return;}render();}};
$('#demo-overview').onclick=()=>seedExamples();
$('#general-summary').onclick=()=>{view='unassigned';category=null;render();};
$('#general-directions').onclick=e=>{const edit=e.target.closest('[data-general-edit]');if(edit)openBrand(edit.dataset.generalEdit);else if(e.target.closest('[data-general-create]')){openBrand();$('#category-kind').value='general';}};
$('#brand-grid').onclick=e=>{const b=e.target.closest('[data-brand]');if(b)revealBrand(b.dataset.brand);};
$('#focus-tasks').onclick=e=>{const b=e.target.closest('[data-task]');if(b)openTask(b.dataset.task);};
$('#back-portfolio').onclick=backToPortfolio;$('#header-back-portfolio').onclick=backToPortfolio;
$('#status-filter').onchange=render;$('#sort-order').onchange=render;$('#show-completed').onchange=render;
$('#search').oninput=render; $('#priority-filter').onchange=render;
$('#new-task').onclick=()=>openTask(); $('#close-dialog').onclick=()=>$('#task-dialog').close();
$('#quick-form').onsubmit=async e=>{e.preventDefault();const title=$('#quick-title').value.trim();if(!title)return;const target=$('#quick-category').value;const task={id:uid(),title,category:target,workspace,priority:'medium',due:view==='today'?today():'',source:view==='incoming'?'incoming':'self',status:'todo',description:'',link:'',history:[event('Задача создана')]};if(await update(n=>n.tasks.push(task))){$('#quick-title').value='';if(category&&category!==target)revealBrand(target);if(view==='done'){view='all';$('#show-completed').checked=false;render();}toast('Задача добавлена');}};
async function handleTasks(e) {
 if(e.target.closest('[data-task-status]'))return;
 if(e.target.closest('[data-show-done]')){$('#show-completed').checked=true;render();return;}
 const check=e.target.closest('[data-complete]');if(check){const task=data.tasks.find(t=>t.id===check.dataset.complete);if(task.status!=='done'&&!confirm('Завершить задачу «'+task.title+'»? Она перейдёт в раздел «Завершённые».'))return;await update(n=>{const t=n.tasks.find(t=>t.id===check.dataset.complete);const previous=t.status;t.status=t.status==='done'?'todo':'done';t.history.push({...event(t.status==='done'?'Задача завершена':'Задача возвращена в работу'),eventType:'status',fromStatus:previous,toStatus:t.status});});return;}
 const add=e.target.closest('[data-add]');if(add){openTask(null,add.dataset.add);if(add.dataset.status)$('#task-form').elements.status.value=add.dataset.status;return;}
 const c=e.target.closest('[data-task]');if(c)openTask(c.dataset.task);
 if(e.target.closest('#examples'))await seedExamples();
}
$('#task-groups').onclick=handleTasks;
$('#task-groups').onchange=e=>{const select=e.target.closest('[data-task-status]');if(select)changeTaskStatus(select.dataset.taskStatus,select.value);};
let draggedTask=null;
$('#task-groups').ondragstart=e=>{const task=e.target.closest('[draggable][data-task]');if(!task||e.target.closest('select,input,button')){e.preventDefault();return;}draggedTask=task.dataset.task;e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('text/plain',draggedTask);task.classList.add('dragging');};
$('#task-groups').ondragover=e=>{const column=e.target.closest('[data-column]');if(draggedTask&&column){e.preventDefault();e.dataTransfer.dropEffect='move';document.querySelectorAll('.drag-over').forEach(c=>c.classList.remove('drag-over'));column.classList.add('drag-over');}};
$('#task-groups').ondrop=e=>{const column=e.target.closest('[data-column]');if(draggedTask&&column){e.preventDefault();const id=draggedTask;draggedTask=null;document.querySelectorAll('.drag-over').forEach(c=>c.classList.remove('drag-over'));changeTaskStatus(id,column.dataset.column);}};
$('#task-groups').ondragend=()=>{draggedTask=null;document.querySelectorAll('.dragging,.drag-over').forEach(c=>c.classList.remove('dragging','drag-over'));};

$('#task-groups').onkeydown=e=>{if(e.target.matches('[data-task]')&&['Enter',' '].includes(e.key)){e.preventDefault();openTask(e.target.dataset.task);}};
async function saveTask(complete=false) {
 const f=$('#task-form');if(!f.reportValidity())return;
 const fields={};for(const name of ['title','category','workspace','priority','due','dueTime','source','status','description','link'])fields[name]=f.elements[name].value.trim();
 if(complete)fields.status='done';if(fields.dueTime&&!fields.due){toast('Для времени срока укажите дату.');return;}
 if(!fields.title)return;
 if(fields.link&&!/^https?:\/\//i.test(fields.link)){toast('Для ссылки используйте http:// или https://');return;}
 const current=data.tasks.find(t=>t.id===edited);
 if(fields.status==='done'&&current?.status!=='done'&&!confirm('Завершить задачу «'+fields.title+'»? Она перейдёт в раздел «Завершённые».'))return;
 const ok=await update(n=>{if(edited){const t=n.tasks.find(t=>t.id===edited);const changed=Object.keys(fields).filter(k=>t[k]!==fields[k]);const previous=t.status,old={...t};Object.assign(t,fields);if(previous!==t.status)t.history.push({...event('Статус: '+statuses[t.status]),eventType:'status',fromStatus:previous,toStatus:t.status});if(old.due!==t.due||old.dueTime!==t.dueTime)t.history.push({...event('Срок: '+(old.due||'не указан')+' '+(old.dueTime||'')+' → '+(t.due||'не указан')+' '+(t.dueTime||'')),eventType:'deadline',before:{due:old.due,time:old.dueTime},after:{due:t.due,time:t.dueTime}});if(old.category!==t.category)t.history.push({...event('Бренд / категория: '+(data.categories.find(c=>c.id===old.category)?.name||old.category)+' → '+(data.categories.find(c=>c.id===t.category)?.name||t.category)),eventType:'brand',before:old.category,after:t.category});if(changed.includes('workspace'))t.history.push({...event('Перенесена в раздел «'+workspaceNames[t.workspace]+'»'),eventType:'workspace',before:old.workspace,after:t.workspace});for(const key of changed.filter(k=>!['status','due','dueTime','category','workspace'].includes(k))){const label={title:'Название',priority:'Приоритет',source:'Источник',description:'Описание',link:'Ссылка'}[key]||key;const value=v=>key==='priority'?priorities[v]:key==='source'?({self:'Моя задача',incoming:'Входящая',bitrix:'Битрикс24'})[v]:v||'не указано';const text=label+': '+value(old[key])+' → '+value(t[key]);for(let i=0;i<text.length;i+=9000)t.history.push({...event(text.slice(i,i+9000)),eventType:'details',field:key});}}else n.tasks.push({...fields,id:uid(),history:[{...event('Задача создана'),eventType:'created',initialStatus:fields.status}]});});
 if(ok){if(fields.workspace!==workspace)switchWorkspace(fields.workspace);$('#task-dialog').close();toast(complete?'Задача завершена':'Задача сохранена');}
}
$('#task-form').onsubmit=async e=>{e.preventDefault();await saveTask();};
$('#complete-task').onclick=()=>saveTask(true);
$('#note-form').onsubmit=async e=>{e.preventDefault();const text=$('#note-text').value.trim();if(!text)return;if(await update(n=>n.tasks.find(t=>t.id===edited).history.push({...event(text,'note'),recordType:$('#note-kind').value}))){$('#note-text').value='';renderHistory();toast('Заметка добавлена');}};
$('#delete-task').onclick=async()=>{if(confirm('Удалить задачу и всю её хронологию?'))if(await update(n=>n.tasks=n.tasks.filter(t=>t.id!==edited))){$('#task-dialog').close();toast('Задача удалена');}};
function openBrand(id=null){categoryEdited=id;$('#category-form').reset();const c=data.categories.find(c=>c.id===id);$('#category-dialog-title').textContent=id?(workspace==='work'?'Настройки бренда':'Настройки категории'):(workspace==='work'?'Новый бренд':'Новая категория');$('#category-name').value=c?.name||'';$('#category-description').value=c?.description||'';$('#category-kind').disabled=c?.id==='inbox';$('#category-kind').value=isGeneral(c)||workspace==='personal'?'general':'brand';$('#category-color').value=c?brandColor(c):brandColors[spaceCategories().length%brandColors.length];$('#category-dialog').showModal();$('#category-name').focus();}
$('#quick-new-brand').onclick=()=>openBrand();$('#add-category').onclick=()=>openBrand();$('#create-brand').onclick=()=>openBrand();$('#edit-brand').onclick=()=>openBrand(category);
$('#close-category').onclick=()=>$('#category-dialog').close();
$('#category-form').onsubmit=async e=>{e.preventDefault();const name=$('#category-name').value.trim(),description=$('#category-description').value.trim(),color=$('#category-color').value,kind=$('#category-kind').value;if(!name)return;if(spaceCategories().some(c=>c.id!==categoryEdited&&c.name.toLocaleLowerCase()===name.toLocaleLowerCase())){toast('Такое название уже есть в этом планировщике');return;}const editedId=categoryEdited||uid();if(await update(n=>{if(categoryEdited){const c=n.categories.find(c=>c.id===categoryEdited),oldKind=c.workspace==='personal'||isGeneral(c)?'general':'brand';Object.assign(c,{name,description,color,kind});if(oldKind!==kind)for(const task of n.tasks.filter(t=>t.category===categoryEdited))task.history.push({...event('Тип направления «'+name+'»: '+(oldKind==='brand'?'Бренд':'Общие / другие')+' → '+(kind==='brand'?'Бренд':'Общие / другие')),eventType:'brand',beforeKind:oldKind,afterKind:kind});}else n.categories.push({id:editedId,name,description,color,workspace,kind});})){$('#category-dialog').close();category=null;revealBrand(editedId);toast('Карточка сохранена');}};
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
 const header=['Раздел','Задача','Бренд / категория','Приоритет','Статус','Срок','Время','Источник','Ссылка на Битрикс24','Описание','Заметки','Полная хронология'];
 const sources={self:'Поставил себе',incoming:'Входящая задача',bitrix:'Из Битрикс24 вручную'};
 const rows=data.tasks.map(t=>[workspaceNames[t.workspace],t.title,data.categories.find(c=>c.id===t.category)?.name||'',priorities[t.priority],statuses[t.status],t.due,t.dueTime||'',sources[t.source],t.link,t.description,t.history.filter(h=>h.kind==='note').map(h=>new Date(h.at).toLocaleString('ru-RU')+' — '+h.text).join('\n'),t.history.map(h=>new Date(h.at).toLocaleString('ru-RU')+' — '+h.text).join('\n')]);
 // UTF-8 BOM lets desktop Excel detect Russian text correctly.
 return '\uFEFF'+[header,...rows].map(row=>row.map(csvCell).join(';')).join('\r\n')+'\r\n';
}
$('#data-tools').onclick=()=>$('#data-dialog').showModal();
$('#close-data').onclick=()=>$('#data-dialog').close();
$('#export-csv').onclick=()=>{downloadFile(csvReport(),'text/csv;charset=utf-8',`poryadok-tasks-${today()}.csv`);toast('Таблица скачана. Откройте CSV в Excel.');};
$('#export').onclick=()=>{downloadFile(JSON.stringify(data,null,2),'application/json;charset=utf-8',`poryadok-backup-${today()}.json`);toast('Резервная копия скачана. Храните её для восстановления.');};
$('#import').onclick=()=>$('#import-file').click();
$('#import-file').onchange=async e=>{const file=e.target.files[0];if(!file)return;try{if(file.size>20000000)throw Error('Файл больше 20 МБ');const next=validate(JSON.parse(await file.text()));if(!confirm(`Восстановить ${next.tasks.length} задач и ${next.categories.length} категорий? Текущие ${data.tasks.length} задач будут заменены. Сначала сохраните экспорт, если они вам нужны.`))return;if(storageBlocked)throw Error('Хранилище повреждено или недоступно. Импорт отменён для защиты исходных данных.');if(await commit(next)){$('#data-dialog').close();category=null;view='all';$('#search').value='';$('#priority-filter').value='all';render();toast('Данные восстановлены');}}catch(error){toast('Импорт отменён: '+error.message);}finally{e.target.value='';}};
async function seedExamples(){
 if(spaceTasks().length)return;
 const date=offset=>{const d=new Date();d.setDate(d.getDate()+offset);return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');};
 const samples=workspace==='work'?[['Бренд Альфа','Согласовать заказ поставщику','high','progress',-1],['Бренд Альфа','Подготовить материалы для обучения','medium','todo',2],['Бренд Бета','Уточнить дату отгрузки','high','waiting',0],['Бренд Бета','Обновить карточки на сайте','low','todo',5],['Бренд Гамма','Согласовать презентацию','medium','waiting',3],['Бренд Гамма','Отправить коммерческое предложение','low','done',-2]]:[['Личные дела','Запланировать выходные','medium','todo',3],['Личные дела','Записаться на обследование','high','todo',1]];
 if(await update(n=>{for(const [name,title,priority,status,offset] of samples){const label='[Демо] '+name;let c=n.categories.find(c=>c.workspace===workspace&&c.name===label);if(!c){c={id:uid(),name:label,workspace,color:brandColors[n.categories.length%brandColors.length]};n.categories.push(c);}n.tasks.push({id:uid(),title:'[Демо] '+title,category:c.id,workspace,priority,status,due:date(offset),dueTime:'',source:'self',description:'Демонстрационная задача. Её можно изменить или удалить.',link:'',history:[event('Создан демонстрационный пример')]});}}))toast('Добавлены демонстрационные примеры с меткой [Демо].');
}
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
async function loadCloud(onlyIfChanged=false) {
 if(writeBusy)throw Error('Дождитесь сохранения.');
 cloudLoading=true;const epoch=accountEpoch;
 try { const loaded=await cloud.load({onlyIfChanged});if(epoch!==accountEpoch||!cloudMode||loaded===undefined)return;data=loaded?validate(loaded):initial();if(category&&!spaceCategories().some(c=>c.id===category))category=null;render();setSync('Облачные данные загружены. Изменения будут сохраняться в вашем аккаунте.'); }
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
  for(const c of local.categories){const same=next.categories.find(x=>x.name===c.name&&x.workspace===c.workspace);if(same){map.set(c.id,same.id);continue;}const id=next.categories.some(x=>x.id===c.id)?uid():c.id;next.categories.push({id,name:c.name,workspace:c.workspace});map.set(c.id,id);}
  next.tasks.push(...tasks.map(t=>({...t,category:map.get(t.category)})));validate(next);
  if(await commit(next))$('#account-status').textContent='Задачи добавлены. Локальная копия сохранена.';
 }catch(error){$('#account-status').textContent='Перенос отменён: '+error.message;}
};
function bulkItems(){
 const lines=$('#bulk-text').value.split(/\r?\n/).map(t=>t.replace(/^\s*(?:\d+[.)]\s+|[-*•]\s+)/,'').trim()).filter(Boolean);
 const seen=new Set(spaceTasks().map(t=>t.title.toLocaleLowerCase()));const titles=[];let duplicates=0;
 for(const title of lines){const norm=title.toLocaleLowerCase();if(seen.has(norm)){duplicates++;continue;}seen.add(norm);titles.push(title);}
 return {titles,duplicates,invalid:titles.some(t=>t.length>200)||lines.length>500};
}
function previewBulk(){const {titles,duplicates,invalid}=bulkItems();$('#bulk-submit').disabled=!titles.length||invalid;$('#bulk-preview').innerHTML=invalid?'Не более 500 строк и 200 символов в названии задачи. Укоротите длинные строки.':`Будет добавлено: ${titles.length}. Совпадения по названию пропущены: ${duplicates}.<ol>${titles.slice(0,50).map(t=>'<li>'+escapeHTML(t)+'</li>').join('')}</ol>`;}
$('#bulk-button').onclick=()=>{$('#bulk-form').reset();$('#bulk-category').innerHTML=categoryOptions();$('#bulk-space').textContent=workspaceNames[workspace];$('#bulk-category').value=category||defaultCategory();previewBulk();$('#bulk-dialog').showModal();$('#bulk-text').focus();};
$('#close-bulk').onclick=()=>$('#bulk-dialog').close();$('#bulk-text').oninput=previewBulk;
$('#bulk-form').onsubmit=async e=>{e.preventDefault();const {titles,invalid}=bulkItems();if(invalid||!titles.length)return;const categoryId=$('#bulk-category').value;const tasks=titles.map(title=>({id:uid(),title,category:categoryId,workspace,priority:'medium',status:'todo',source:'self',due:'',description:'',link:'',history:[event('Задача добавлена из списка')]}));if(data.tasks.length+tasks.length>50000){toast('Превышен лимит задач.');return;}if(await update(n=>n.tasks.push(...tasks))){$('#bulk-dialog').close();category=null;view='all';$('#search').value='';$('#priority-filter').value='all';render();toast('Добавлено задач: '+tasks.length);}};
async function initializeCloud(){
 cloudLoading=cloud.configured;accountUI();
 try{if(await cloud.restore()){await beginCloud();if(cloud.needsPassword){accountUI();$('#account-dialog').showModal();}}else{cloudLoading=false;if(cloud.invitationError){accountUI();$('#account-status').textContent=cloud.invitationError;$('#account-dialog').showModal();}}}
 catch(error){if(cloud.session){cloudMode=true;data=initial();cloudLoading=true;render();accountUI();}else cloudLoading=false;setSync('Облачный вход не завершён: '+error.message);}
}
render();if(storageBlocked)toast('Не удалось прочитать сохранённые данные. Исходное хранилище защищено от перезаписи.');
initializeCloud();
// Refresh only when no form is open or being edited; do not replace unsaved drafts.
setInterval(async()=>{if(!cloudMode||writeBusy||cloudLoading||document.hidden||$('dialog[open]')||['INPUT','TEXTAREA','SELECT'].includes(document.activeElement.tagName))return;try{await loadCloud(true);}catch(error){setSync('Не удалось обновить облачные данные: '+error.message);}},30000);
