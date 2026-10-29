const {chromium}=require('playwright');
const assert=require('assert/strict');
const fs=require('fs');
const jsQR=require('/tmp/poryadok-qr-test/node_modules/jsqr');
const {PNG}=require('/tmp/poryadok-qr-test/node_modules/pngjs');
const BASE=process.env.PORYADOK_TEST_URL||'http://127.0.0.1:8016/';
(async()=>{
 const {harness}=await import('./device-link-server.mjs');const h=await harness(BASE);
 const browser=await chromium.launch({headless:true,executablePath:'/usr/bin/chromium',args:['--no-sandbox']});
 const errors=[];
 const payload={version:1,categories:[{id:'inbox',name:'Общие задачи',workspace:'work'},{id:'personal',name:'Личное',workspace:'personal'}],tasks:[{id:'a-task',title:'Только аккаунт A',workspace:'work',category:'inbox',status:'todo',priority:'medium',due:'',description:'Личная запись',link:'',source:'self',history:[]}]};
 async function context(){const c=await browser.newContext({serviceWorkers:'block'});c.on('page',p=>p.on('pageerror',e=>errors.push(e.message)));
  await c.route('**/config.js',r=>r.fulfill({contentType:'application/javascript',body:"window.PORYADOK_CONFIG={supabaseUrl:'https://test-project.supabase.co',supabasePublishableKey:'sb_publishable_test'}"}));
  await c.route('https://test-project.supabase.co/**',async r=>{
   const q=r.request(),url=new URL(q.url());let response;
   try{
    if(url.pathname==='/functions/v1/device-link')response=await h.handle(new Request(q.url(),{method:q.method(),headers:q.headers(),body:q.postData()}));
    else if(url.pathname==='/rest/v1/dashboards'){
     const id=h.tokens.get((q.headers().authorization||'').replace(/^Bearer /,''));
     response=new Response(JSON.stringify(id===h.ids.a?[{revision:1,payload}]:[]),{status:id?200:401});
    }else response=await h.auth(q.url(),{method:q.method(),headers:q.headers(),body:q.postData()});
    await r.fulfill({status:response.status,headers:{...Object.fromEntries(response.headers),'Content-Type':'application/json'},body:await response.text()});
   }catch(e){console.error('Mock failed:',e.message);await r.fulfill({status:500,body:'{}'});}
  });return c;
 }
 try{
  const pc=await context(),desktop=await pc.newPage();await desktop.goto(BASE);await desktop.locator('[data-layout=list]').click();await desktop.locator('#account-button').click();
  await desktop.locator('#login-form [name=email]').fill('a@example.com');await desktop.locator('#login-form [name=password]').fill('test-password');await desktop.locator('#login-form button[type=submit]').click();await desktop.waitForFunction(()=>document.querySelector('#account-status').textContent.startsWith('Вход выполнен'));
  await desktop.locator('#device-link-create').click();await desktop.locator('#device-link-qr svg').waitFor();
  const png=PNG.sync.read(await desktop.locator('#device-link-qr').screenshot());const decoded=jsQR(new Uint8ClampedArray(png.data),png.width,png.height);assert(decoded,'Independent decoder must read the actual QR');
  const url=decoded.data;assert(url.startsWith(BASE+'#device_link='));assert(!url.includes('desktop_a'));assert(!url.includes('refresh'));assert(!url.includes('@'));
  const mobileContext=await context(),phone=await mobileContext.newPage();await phone.setViewportSize({width:390,height:844});await phone.goto(url);
  await phone.locator('#device-link-receiver').waitFor({state:'visible'});assert.equal(await phone.evaluate(()=>location.hash),'');
  assert.equal(await phone.evaluate(()=>localStorage.getItem('poryadok.trusted-auth.v1')),null);
  await phone.locator('#device-link-receiver-start').click();await phone.locator('#device-link-receiver-code').waitFor({state:'visible'});await desktop.locator('#device-link-approve').waitFor({state:'visible'});
  assert.equal(await phone.locator('#device-link-receiver-code').innerText(),await desktop.locator('#device-link-code').innerText());
  assert.equal(await phone.locator('#account-button').innerText(),'Войти');
  await desktop.locator('#device-link-approve').click();await phone.waitForFunction(()=>document.querySelector('#account-button').textContent==='Мой аккаунт');
  await phone.locator('[data-layout=list]').click();assert.equal(await phone.locator('.task-card h3').innerText(),'Только аккаунт A');
  const phoneToken=await phone.evaluate(()=>JSON.parse(sessionStorage.getItem('poryadok.auth.v1')).access_token);
  assert.notEqual(phoneToken,'desktop_a');assert.equal(await desktop.evaluate(()=>JSON.parse(sessionStorage.getItem('poryadok.auth.v1')).access_token),'desktop_a');
  const later=await mobileContext.newPage();await later.goto(BASE);await later.waitForFunction(()=>document.querySelector('#account-button').textContent==='Мой аккаунт');await later.locator('[data-layout=list]').click();assert.equal(await later.locator('.task-card h3').innerText(),'Только аккаунт A');
  const replayContext=await context(),replay=await replayContext.newPage();await replay.goto(url);await replay.locator('#device-link-receiver-start').click();await replay.waitForFunction(()=>/другом устройстве|использован/.test(document.querySelector('#device-link-receiver-status').textContent));assert.equal(await replay.locator('#account-button').innerText(),'Войти');
  await desktop.locator('#logout').click();await desktop.waitForFunction(()=>document.querySelector('#account-button').textContent==='Войти');assert(h.tokens.has(phoneToken));
  await later.reload();await later.waitForFunction(()=>document.querySelector('#account-button').textContent==='Мой аккаунт');await later.locator('#account-button').click();await later.locator('#logout').click();await later.waitForFunction(()=>document.querySelector('#account-button').textContent==='Войти');assert.equal(await later.evaluate(()=>localStorage.getItem('poryadok.trusted-auth.v1')),null);
  const cancelContext=await context(),cancel=await cancelContext.newPage();await cancel.goto(BASE);await cancel.evaluate(()=>localStorage.setItem('poryadok.trusted-auth.v1',JSON.stringify({access_token:'desktop_b',refresh_token:'refresh-desktop_b',expires_at:Math.floor(Date.now()/1000)+3600})));await cancel.goto(url);await cancel.locator('#device-link-receiver-close').click();await cancel.waitForFunction(()=>document.querySelector('#account-button').textContent==='Мой аккаунт');assert.equal(await cancel.evaluate(()=>cloud.user.id),h.ids.b);
  const temporaryOffer=(await h.call('create',{workspace:'personal'},'desktop_b')).body;
  const temporaryContext=await context(),temporary=await temporaryContext.newPage();await temporary.goto(BASE+'#device_link='+temporaryOffer.id+'.'+temporaryOffer.offer);await temporary.locator('#device-link-remember').uncheck();await temporary.locator('#device-link-receiver-start').click();await temporary.locator('#device-link-receiver-code').waitFor({state:'visible'});await h.call('approve',{id:temporaryOffer.id},'desktop_b');await temporary.waitForFunction(()=>document.querySelector('#account-button').textContent==='Мой аккаунт');assert.equal(await temporary.evaluate(()=>localStorage.getItem('poryadok.trusted-auth.v1')),null);assert.equal(await temporary.evaluate(()=>cloud.user.id),h.ids.b);assert.equal(await temporary.evaluate(()=>workspace),'personal');
  const mismatch=(await h.call('create',{workspace:'work'},'desktop_b')).body;const proof={id:mismatch.id,offer:mismatch.offer,device:'m'.repeat(43)};await h.call('claim',proof);await h.call('approve',{id:mismatch.id},'desktop_b');const once=(await h.call('consume',proof)).body;
  const beforeMismatch=await temporary.evaluate(()=>sessionStorage.getItem('poryadok.auth.v1'));const rejected=await temporary.evaluate(async ({hash,owner})=>{try{await cloud.qrLogin(hash,owner,true);return false;}catch{return true;}},{hash:once.token_hash,owner:h.ids.a});assert(rejected);assert.equal(await temporary.evaluate(()=>sessionStorage.getItem('poryadok.auth.v1')),beforeMismatch);
  const failedContext=await context();await failedContext.route('https://test-project.supabase.co/functions/v1/device-link',r=>r.fulfill({status:404,contentType:'application/json',body:'{}'}));const failed=await failedContext.newPage();await failed.goto(BASE);await failed.locator('#account-button').click();await failed.locator('#login-form [name=email]').fill('b@example.com');await failed.locator('#login-form [name=password]').fill('test-password');await failed.locator('#login-form button[type=submit]').click();await failed.waitForFunction(()=>document.querySelector('#account-status').textContent.startsWith('Вход выполнен'));await failed.locator('#device-link-create').click();await failed.locator('#device-link-setup').waitFor({state:'visible'});assert.match(await failed.locator('#device-link-status').innerText(),/не подключён/);assert.equal(await failed.locator('#device-link-qr svg').count(),0);
  assert(await phone.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.deepEqual(errors,[]);
  console.log('PASS: independently decoded QR, isolated computer/phone sessions, no login before approval, matching codes, account A tasks only, trusted-device reopen, replay rejected, device-local logout, cancel restores existing B account, mobile layout. Auth provider is mocked; production server activation still required.');
 }finally{await browser.close();await h.db.close();}
})().catch(e=>{console.error(e);process.exit(1)});
