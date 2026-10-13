'use strict';
(() => {
 const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
 const task=(label)=>({id:crypto.randomUUID(),title:'[Проверка доступа] '+label,category:'inbox',workspace:'work',status:'todo',priority:'low',source:'self',due:'',description:'Временная проверочная запись',link:'',history:[]});
 class ProbeAccount {
  constructor(config){this.url=config.supabaseUrl.replace(/\/$/,'');this.key=config.supabasePublishableKey;this.token=null;this.id=null;this.touched=false;this.original=null;this.allowedTasks=new Map();}
  async call(path,{method='GET',body,anonymous=false}={}) {
   const response=await fetch(this.url+path,{method,headers:{apikey:this.key,...(!anonymous&&this.token?{Authorization:'Bearer '+this.token}:{}),...(body?{'Content-Type':'application/json'}:{}),Prefer:'return=representation'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(20000)});
   let json=null;try{json=await response.json();}catch{}return {ok:response.ok,status:response.status,json};
  }
  async login(email,password){const r=await this.call('/auth/v1/token?grant_type=password',{method:'POST',body:{email,password}});if(!r.ok||!r.json?.access_token)throw Error('Вход в тестовый аккаунт не выполнен. Проверьте email, пароль и подтверждение email.');this.token=r.json.access_token;const u=await this.call('/auth/v1/user');if(!u.ok||!u.json?.id)throw Error('Не удалось проверить личность тестового пользователя.');this.id=u.json.id;}
  path(id=this.id,select='user_id,payload,revision'){return '/rest/v1/dashboards?user_id=eq.'+encodeURIComponent(id)+'&select='+select;}
  async row(){const r=await this.call(this.path());if(!r.ok||!Array.isArray(r.json)||r.json.length>1)throw Error('Не удалось прочитать личный тестовый дашборд (HTTP '+r.status+').');if(r.json[0]&&r.json[0].user_id!==this.id)throw Error('Сервис вернул чужой дашборд.');return r.json[0]||null;}
  safe(row){if(!row)return;if(JSON.stringify(canonical({...row.payload,tasks:[]}))!==JSON.stringify(canonical({...this.original,tasks:[]}))||!Array.isArray(row.payload.tasks)||row.payload.tasks.some(task=>this.allowedTasks.get(task.id)!==JSON.stringify(canonical(task))))throw Error('Тестовые данные изменились извне. Они не будут перезаписаны.');}
  async save(payload){const row=await this.row();this.safe(row);const r=await this.call(row?this.path(this.id)+'&revision=eq.'+row.revision:'/rest/v1/dashboards',{method:row?'PATCH':'POST',body:row?{payload}:{user_id:this.id,payload}});if(!r.ok||r.json?.length!==1||r.json[0].user_id!==this.id)throw Error('Не удалось записать собственную тестовую задачу (HTTP '+r.status+').');return r.json[0];}
  async logout(){if(!this.token)return;const r=await this.call('/auth/v1/logout?scope=local',{method:'POST'});if(!r.ok&&r.status!==401)throw Error('Не удалось завершить тестовую сессию.');this.token=null;}
 }
 async function run(config,credentials,{onResult=()=>{},onStatus=()=>{},emptyPayload=null}={}) {
  const results=[],cleanup=[],accounts=[new ProbeAccount(config),new ProbeAccount(config)];
  const check=(name,passed,detail='')=>{const result={name,passed,detail};results.push(result);onResult(result);if(!passed)throw Error('Проверка не пройдена: '+name);};
  try {
   onStatus('Входим в тестовые аккаунты…');await accounts[0].login(credentials.emailA,credentials.passwordA);await accounts[1].login(credentials.emailB,credentials.passwordB);const [a,b]=accounts;
   if(a.id===b.id)throw Error('Нужны два разных тестовых пользователя.');
   for(const account of accounts){const row=await account.row();if(row){if(!Array.isArray(row.payload?.tasks)||row.payload.tasks.length)throw Error('Один из аккаунтов содержит задачи. Проверка остановлена без изменения данных.');if(!row.payload.categories?.some(c=>c.id==='inbox'))throw Error('Тестовый дашборд имеет неподдерживаемый формат.');account.original=structuredClone(row.payload);}else{account.original=emptyPayload?structuredClone(emptyPayload):{version:1,categories:[{id:'inbox',name:'Без категории',workspace:'work'},{id:'personal',name:'Личные дела',workspace:'personal'}],tasks:[]};}}
   onStatus('Создаём две временные задачи…');
   for(const [i,account] of accounts.entries()){const marker=task(i===0?'A':'B');account.allowedTasks.set(marker.id,JSON.stringify(canonical(marker)));account.touched=true;await account.save({...account.original,tasks:[marker]});const own=await account.row();check('Аккаунт '+(i===0?'A':'B')+' читает и сохраняет свою задачу',own?.payload.tasks.length===1&&own.user_id===account.id);}
   for(const [viewer,owner,label] of [[b,a,'B → A'],[a,b,'A → B']]){const r=await viewer.call(viewer.path(owner.id,'user_id'));check('Чужая задача недоступна для чтения ('+label+')',r.ok&&Array.isArray(r.json)&&r.json.length===0);}
   const listing=await b.call('/rest/v1/dashboards?select=user_id');check('Список дашбордов содержит только свои данные',listing.ok&&listing.json?.length===1&&listing.json[0].user_id===b.id);
   const target=await a.row();a.safe(target);const foreignMarker=task('Недопустимая правка');a.allowedTasks.set(foreignMarker.id,JSON.stringify(canonical(foreignMarker)));const foreign=await b.call(b.path(a.id,'user_id')+'&revision=eq.'+target.revision,{method:'PATCH',body:{payload:{...a.original,tasks:[foreignMarker]}}});check('Аккаунт B не может изменить дашборд A',(foreign.ok&&Array.isArray(foreign.json)&&foreign.json.length===0)||(!foreign.ok&&foreign.json?.code==='42501'));
   const insert=await b.call('/rest/v1/dashboards',{method:'POST',body:{user_id:a.id,payload:a.original}});check('Нельзя записать данные от имени другого пользователя',!insert.ok&&insert.json?.code==='42501');
   const anon=await a.call('/rest/v1/dashboards?select=user_id&limit=1',{anonymous:true});check('Без входа задачи недоступны',[401,403].includes(anon.status)||(anon.ok&&Array.isArray(anon.json)&&anon.json.length===0));
   const old=await a.row();const newer=await a.save(old.payload);const stale=await a.call(a.path(a.id)+'&revision=eq.'+old.revision,{method:'PATCH',body:{payload:a.original}});check('Устаревшая версия не перезаписывает новую',newer.revision>old.revision&&stale.ok&&Array.isArray(stale.json)&&stale.json.length===0);
  }catch(error){if(results.at(-1)?.passed!==false){const result={name:'Проверка остановлена',passed:false,detail:error.message};results.push(result);onResult(result);}}
  finally {
   onStatus('Очищаем проверочные записи и завершаем тестовые сессии…');
   for(const [i,account] of accounts.entries()){
    if(account.touched){try{await account.save(account.original);const own=await account.row();if(JSON.stringify(canonical(own?.payload))!==JSON.stringify(canonical(account.original)))throw Error('Проверочная запись осталась');}catch{cleanup.push('Не удалось очистить тестовый аккаунт '+(i===0?'A':'B')+'. Проверьте его вручную.');}}
    try{await account.logout();}catch{cleanup.push('Не удалось подтвердить завершение одной из тестовых сессий.');}finally{account.token=null;}
   }
  }
  return {at:new Date().toISOString(),project:config.supabaseUrl,passed:results.length===9&&results.every(r=>r.passed)&&cleanup.length===0,results,cleanup};
 }
 window.PoryadokSecurityCheck={run};
 const dialog=document.querySelector('#security-dialog');if(!dialog)return;
 const form=document.querySelector('#security-form'),progress=document.querySelector('#security-progress'),list=document.querySelector('#security-results'),download=document.querySelector('#security-download');let busy=false,lastReport=null;
 const safe=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 document.querySelector('#security-button').onclick=()=>{document.querySelector('#account-dialog').close();form.reset();progress.textContent='';list.innerHTML='';download.hidden=true;dialog.showModal();};
 document.querySelector('#close-security').onclick=()=>{if(!busy)dialog.close();};dialog.addEventListener('close',()=>{form.elements.passwordA.value='';form.elements.passwordB.value='';});dialog.addEventListener('cancel',event=>{if(busy)event.preventDefault();});
 form.onsubmit=async event=>{
  event.preventDefault();if(busy||!form.reportValidity())return;
  const credentials={};for(const name of ['emailA','passwordA','emailB','passwordB'])credentials[name]=form.elements[name].value.trim();
  // Passwords are kept verbatim; whitespace can be part of a valid password.
  credentials.passwordA=form.elements.passwordA.value;credentials.passwordB=form.elements.passwordB.value;
  if(credentials.emailA.toLowerCase()===credentials.emailB.toLowerCase()){progress.textContent='Введите два разных email.';return;}
  busy=true;lastReport=null;list.innerHTML='';download.hidden=true;for(const element of form.elements)element.disabled=true;document.querySelector('#close-security').disabled=true;form.elements.passwordA.value='';form.elements.passwordB.value='';
  try {
   lastReport=await run(window.PORYADOK_CONFIG,credentials,{emptyPayload:initial(),onStatus:text=>progress.textContent=text,onResult:result=>{const item=document.createElement('li');item.className=result.passed?'passed':'failed';item.innerHTML=(result.passed?'✓ ':'✕ ')+safe(result.name)+(result.detail?'<small>'+safe(result.detail)+'</small>':'');list.append(item);}});
   progress.textContent=lastReport.passed?'Все 9 проверок пройдены. Проверочные задачи очищены.':'Полная проверка не пройдена. Смотрите результат ниже.';
   for(const warning of lastReport.cleanup){const item=document.createElement('li');item.className='failed';item.textContent=warning;list.append(item);}download.hidden=false;
   if(cloudMode){try{await loadCloud();accountUI();}catch{cloudLoading=true;setSync('Обновите облачные данные через «Мой аккаунт», прежде чем продолжать редактирование.');}}
  }catch{progress.textContent='Проверку не удалось завершить. Повторите с пустыми тестовыми аккаунтами.';}
  finally{credentials.passwordA='';credentials.passwordB='';busy=false;for(const element of form.elements)element.disabled=false;document.querySelector('#close-security').disabled=false;}
 };
 download.onclick=()=>{if(!lastReport)return;const report=['Проверка доступа «Порядок»',lastReport.at,lastReport.project,lastReport.passed?'ИТОГ: ПРОЙДЕНО':'ИТОГ: НЕ ПРОЙДЕНО',...lastReport.results.map(r=>(r.passed?'ПРОЙДЕНО: ':'НЕ ПРОЙДЕНО: ')+r.name+(r.detail?' — '+r.detail:'')),...lastReport.cleanup].join('\n');downloadFile(report,'text/plain;charset=utf-8','poryadok-security-check.txt');};
})();
