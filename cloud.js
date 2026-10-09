'use strict';
// REST only: no third-party CDN code, no privileged keys in the browser.
class DashboardCloud {
 constructor(config) {
  this.url=(config.supabaseUrl||'').replace(/\/$/,'');this.key=config.supabasePublishableKey||'';
  this.session=null;this.user=null;this.revision=null;
  this.sessionKey='poryadok.auth.v1';
 }
 get configured(){if(this.key.split('.').length===3){try{if(JSON.parse(atob(this.key.split('.')[1].replace(/-/g,'+').replace(/_/g,'/'))).role==='service_role')return false;}catch{return false;}}return /^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(this.url)&&!!this.key&&!this.key.startsWith('sb_secret_');}
 async request(path,{method='GET',body,headers={}}={}){
  const response=await fetch(this.url+path,{method,headers:{apikey:this.key,...(this.session?.access_token?{Authorization:'Bearer '+this.session.access_token}:{}),...(body?{'Content-Type':'application/json'}:{}),...headers},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(20000)});
  const raw=await response.text();let result;try{result=raw?JSON.parse(raw):null;}catch{result=null;}
  if(!response.ok){const message=result?.msg||result?.message||result?.error_description||'';if(message==='Invalid login credentials')throw Error('Неверный email или пароль. Используйте пароль, заданный при создании пользователя в Supabase.');if(message==='Email not confirmed')throw Error('Email не подтверждён. Подтвердите его в Supabase или перейдите по новой ссылке из письма.');if(response.status===401&&path.includes('grant_type=password'))throw Error('Не удалось войти: проверьте email и пароль.');if(response.status===401)throw Error('Сессия истекла. Войдите снова.');if(response.status===409)throw Error('Данные уже изменились на другом устройстве. Обновите облачные данные.');throw Error(result?.msg||result?.message||result?.error_description||'Облачный сервис недоступен ('+response.status+')');}return result;
 }
 remember(session){this.session=session;sessionStorage.setItem(this.sessionKey,JSON.stringify(session));}
 async restore(){
  if(!this.configured)return false;
  const fragment=new URLSearchParams(location.hash.slice(1));
  if(fragment.has('error')){this.invitationError=fragment.get('error_code')==='otp_expired'?'Ссылка из письма истекла или уже использована. Войдите с email и паролем либо запросите новое письмо.':'Переход из письма не завершён. Попробуйте войти с email и паролем или запросите новое письмо.';history.replaceState(null,'',location.pathname+location.search);return false;}
  if(fragment.has('access_token')){
   const session={access_token:fragment.get('access_token'),refresh_token:fragment.get('refresh_token'),expires_at:Math.floor(Date.now()/1000)+Number(fragment.get('expires_in')||3600)};
   history.replaceState(null,'',location.pathname+location.search);session.needs_password=true;this.remember(session);this.needsPassword=true;
  }else{try{this.session=JSON.parse(sessionStorage.getItem(this.sessionKey)||'null');}catch{this.session=null;}}
  if(!this.session)return false;this.needsPassword=!!this.session.needs_password;await this.authorize();return true;
 }
 async authorize(){
  if(!this.session)throw Error('Сначала войдите в аккаунт.');
  if(!this.session.expires_at||this.session.expires_at<Date.now()/1000+60){const refreshed=await this.request('/auth/v1/token?grant_type=refresh_token',{method:'POST',body:{refresh_token:this.session.refresh_token}});this.remember({...refreshed,needs_password:!!this.needsPassword});}
  // Never trust a user ID from local storage or a decoded, unverified JWT.
  this.user=await this.request('/auth/v1/user');
 }
 async login(email,password){const session=await this.request('/auth/v1/token?grant_type=password',{method:'POST',body:{email,password}});this.remember(session);await this.authorize();}
 async password(password){await this.authorize();await this.request('/auth/v1/user',{method:'PUT',body:{password}});this.needsPassword=false;this.remember({...this.session,needs_password:false});}
 async reset(email){await this.request('/auth/v1/recover?redirect_to='+encodeURIComponent(location.origin+location.pathname),{method:'POST',body:{email}});}
 async logout(){try{if(this.session)await this.request('/auth/v1/logout',{method:'POST'});}finally{this.session=null;this.user=null;this.revision=null;sessionStorage.removeItem(this.sessionKey);}}
 async load(){await this.authorize();const rows=await this.request('/rest/v1/dashboards?user_id=eq.'+encodeURIComponent(this.user.id)+'&select=payload,revision');if(rows.length){this.revision=rows[0].revision;return rows[0].payload;}this.revision=null;return null;}
 async save(payload){
  await this.authorize();
  const insert=this.revision===null;
  const rows=await this.request('/rest/v1/dashboards'+(insert?'':'?user_id=eq.'+encodeURIComponent(this.user.id)+'&revision=eq.'+this.revision),{method:insert?'POST':'PATCH',body:insert?{user_id:this.user.id,payload}:{payload},headers:{Prefer:'return=representation'}});
  if(!rows?.length)throw Error('Данные изменились на другом устройстве. Нажмите «Обновить из облака» и повторите правку.');
  this.revision=rows[0].revision;
 }
}
window.DashboardCloud=DashboardCloud;
