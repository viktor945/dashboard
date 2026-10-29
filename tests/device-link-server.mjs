import assert from 'node:assert/strict';
import fs from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { fileURLToPath } from 'node:url';

export async function harness(appUrl = 'http://127.0.0.1:8014/') {
 const { PGlite } = await import(process.env.PORYADOK_PGLITE_MODULE || '/tmp/poryadok-qr-test/node_modules/@electric-sql/pglite/dist/index.js');
 const db = new PGlite();
 const ids = { a: '11111111-1111-4111-8111-111111111111', b: '22222222-2222-4222-8222-222222222222' };
 const users = new Map(Object.entries(ids).map(([key,id]) => [id,{id,email:key+'@example.com',email_confirmed_at:'2026-01-01T00:00:00Z'}]));
 const tokens = new Map([['desktop_a',ids.a],['desktop_b',ids.b]]), hashes = new Map();let adminCalls=0;
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key);insert into auth.users values('${ids.a}'),('${ids.b}');`);
 await db.exec(fs.readFileSync(new URL('../supabase/device-link.sql',import.meta.url),'utf8'));
 await db.exec(fs.readFileSync(new URL('../supabase/device-link.sql',import.meta.url),'utf8'));
 const serviceKey = 'test-server-key-never-return-to-browser';
 async function auth(url, init={}) {
  const path=new URL(url).pathname,headers=new Headers(init.headers),token=(headers.get('authorization')||'').replace(/^Bearer /,''),body=init.body?JSON.parse(init.body):{};
  let data,status=200;
  if(path==='/auth/v1/user'){data=users.get(tokens.get(token));if(!data){status=401;data={message:'unauthorized'};}}
  else if(path==='/auth/v1/admin/generate_link'){
   assert.equal(token,serviceKey);assert.equal(body.type,'magiclink');adminCalls++;
   const user=[...users.values()].find(u=>u.email===body.email);assert(user);
   const hash='one-time-auth-hash-'+crypto.randomUUID();hashes.set(hash,user.id);data={hashed_token:hash,verification_type:'magiclink'};
  } else if(path.startsWith('/rest/v1/rpc/')){
   assert.equal(token,serviceKey);
   const name=path.split('/').pop();assert(['device_link_create','device_link_transition'].includes(name));
   const keys=Object.keys(body);assert(keys.every(k=>/^p_[a-z_]+$/.test(k)));
   const result=await db.query('select public.'+name+'('+keys.map((k,i)=>k+'=> $'+(i+1)).join(',')+') as value',keys.map(k=>body[k]));data=result.rows[0].value;
  } else if(path==='/auth/v1/verify'){
   assert.equal(body.type,'magiclink');const id=hashes.get(body.token_hash);
   if(!id){status=403;data={message:'expired'};}else{hashes.delete(body.token_hash);const access='phone-'+crypto.randomUUID();tokens.set(access,id);data={access_token:access,refresh_token:'refresh-'+access,expires_at:Math.floor(Date.now()/1000)+3600,user:users.get(id)};}
  } else if(path==='/auth/v1/logout'){
   assert.equal(new URL(url).searchParams.get('scope'),'local');tokens.delete(token);data={};
  } else if(path==='/auth/v1/token'){
   const key=body.email?.startsWith('b')?'b':'a';data={access_token:'desktop_'+key,refresh_token:'refresh-desktop_'+key,expires_at:Math.floor(Date.now()/1000)+3600};tokens.set(data.access_token,ids[key]);
  } else throw Error('Unexpected test endpoint: '+path);
  return new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});
 }
 const source=stripTypeScriptTypes(fs.readFileSync(new URL('../supabase/functions/device-link/index.ts',import.meta.url),'utf8'));
 const {createHandler}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
 await db.exec('set role service_role');
 const handle=createHandler({url:'https://test-project.supabase.co',serviceKey,appUrl},auth);
 const call=async(action,body={},token=null)=>{
  const response=await handle(new Request('https://test-project.supabase.co/functions/v1/device-link',{method:'POST',headers:{'Content-Type':'application/json',Origin:new URL(appUrl).origin,...(token?{Authorization:'Bearer '+token}:{})},body:JSON.stringify({action,...body})}));
  return {status:response.status,body:await response.json()};
 };
 return {db,ids,users,tokens,handle,call,auth,serviceKey,get adminCalls(){return adminCalls;}};
}

async function test() {
 const h=await harness(),{db,call}=h;
 try {
  for(const role of ['anon','authenticated']){
   await db.exec('set role '+role);
   await assert.rejects(db.query('select * from public.device_links'),/permission denied/);
   await assert.rejects(db.query("select public.device_link_transition('status','33333333-3333-4333-8333-333333333333')"),/permission denied/);
   await db.exec('reset role');
  }
  await db.exec('set role service_role');
  assert.equal((await call('create',{workspace:'work'})).status,401);
  h.users.get(h.ids.a).factors=[{status:'verified'}];assert.equal((await call('create',{workspace:'work'},'desktop_a')).status,403);delete h.users.get(h.ids.a).factors;
  const offer=(await call('create',{workspace:'work'},'desktop_a')).body;
  assert(offer.id&&offer.offer.length===43);
  const row=(await db.query('select * from public.device_links where id=$1',[offer.id])).rows[0];assert.notEqual(row.offer_hash,offer.offer);assert.equal(row.otp_hash,null);
  const request={id:offer.id,offer:offer.offer,device:'x'.repeat(43)};
  assert.equal((await call('status',{id:offer.id},'desktop_b')).body.state,'invalid');
  assert.equal((await call('claim',{...request,offer:'y'.repeat(43)})).body.state,'invalid');
  const claimed=(await call('claim',request)).body;assert.equal(claimed.state,'scanned');assert.match(claimed.code,/^\d{6}$/);
  assert.equal((await call('claim',{...request,device:'z'.repeat(43)})).body.state,'other_device');
  assert.equal((await call('consume',request)).body.token_hash,undefined);
  assert.equal((await call('approve',{id:offer.id},'desktop_b')).body.state,'invalid');assert.equal(h.adminCalls,0);
  const approved=(await call('approve',{id:offer.id},'desktop_a')).body;assert.equal(approved.state,'approved');assert.equal(approved.token_hash,undefined);assert.equal(h.adminCalls,1);
  const results=await Promise.all([call('consume',request),call('consume',request)]);
  assert.equal(results.filter(r=>r.body.token_hash).length,1);
  const redeemed=results.find(r=>r.body.token_hash).body;assert.equal(redeemed.owner_id,h.ids.a);
  assert.equal((await db.query('select otp_hash from public.device_links where id=$1',[offer.id])).rows[0].otp_hash,null);
  assert.equal((await call('approve',{id:offer.id},'desktop_a')).body.token_hash,undefined);assert.equal(h.adminCalls,1);
  const cancelled=(await call('create',{workspace:'personal'},'desktop_b')).body;
  await call('claim',{id:cancelled.id,offer:cancelled.offer,device:request.device});
  await call('approve',{id:cancelled.id},'desktop_b');
  await call('cancel',{id:cancelled.id},'desktop_b');
  assert.equal((await call('consume',{id:cancelled.id,offer:cancelled.offer,device:request.device})).body.state,'revoked');
  const expired=(await call('create',{workspace:'work'},'desktop_b')).body;
  await db.query("update public.device_links set expires_at=now()-interval '1 second' where id=$1",[expired.id]);
  assert.equal((await call('claim',{id:expired.id,offer:expired.offer,device:request.device})).body.state,'expired');
  const previous=(await call('create',{workspace:'work'},'desktop_b')).body;
  await call('create',{workspace:'work'},'desktop_b');
  assert.equal((await call('claim',{id:previous.id,offer:previous.offer,device:request.device})).body.state,'revoked');
  await call('create',{workspace:'work'},'desktop_b');
  assert.equal((await call('create',{workspace:'work'},'desktop_b')).status,429);
  const forbidden=await h.handle(new Request('https://test-project.supabase.co/functions/v1/device-link',{method:'POST',headers:{Origin:'https://foreign.invalid'},body:'{}'}));assert.equal(forbidden.status,403);
  const oversized=await h.handle(new Request('https://test-project.supabase.co/functions/v1/device-link',{method:'POST',body:'x'.repeat(3000)}));assert.equal(oversized.status,413);
  console.log('PASS: real PostgreSQL functions/permissions, owner isolation, hashed secrets, approval required, first-device binding, atomic one-time redemption, cancel/expiry/replacement, rate limit, CORS/body limit. Auth admin is mocked; live Supabase deployment is not validated.');
 } finally {await db.close();}
}
if(process.argv[1]===fileURLToPath(import.meta.url))test().catch(e=>{console.error(e);process.exit(1);});
