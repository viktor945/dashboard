const fs=require('fs'),vm=require('vm'),assert=require('assert/strict'),crypto=require('crypto').webcrypto;
const SCRIPT=fs.readFileSync(require('path').join(__dirname,'../security-check.js'),'utf8');
const base=()=>({version:1,categories:[{id:'inbox',name:'Без категории'}],tasks:[]});
async function simulate(options={}){
 const rows=new Map(),calls=[];let raced=false;if(options.nonempty)rows.set('user-a',{user_id:'user-a',revision:1,payload:{...base(),tasks:[{title:'Реальная задача'}]}});
 const fetch=async(input,init)=>{
  const url=new URL(input),method=init.method||'GET',body=init.body?JSON.parse(init.body):null,token=init.headers.Authorization||'',id=token==='Bearer token-a'?'user-a':token==='Bearer token-b'?(options.sameIdentity?'user-a':'user-b'):null;
  calls.push({path:url.pathname,method,body});let status=200,result;
  if(url.pathname==='/auth/v1/token'){const a=body.email==='a@test.invalid';result={access_token:a?'token-a':'token-b'};}
  else if(url.pathname==='/auth/v1/user')result={id};
  else if(url.pathname==='/auth/v1/logout'){assert.equal(url.searchParams.get('scope'),'local');status=204;}
  else if(url.pathname==='/rest/v1/dashboards'){
   const target=url.searchParams.get('user_id')?.replace('eq.',''),projection=url.searchParams.get('select');
   if(!id){status=401;result={code:'42501'};}
   else if(method==='GET'){if(options.race&&!raced&&rows.get('user-a')?.payload.tasks.length===1){rows.get('user-a').payload.tasks.push({id:'concurrent-real',title:'Добавлено параллельно'});rows.get('user-a').revision++;raced=true;}const visible=[...rows.values()].filter(row=>(!target||row.user_id===target)&&(options.leakReads||row.user_id===id));result=visible.map(row=>projection==='user_id'?{user_id:row.user_id}:row);}
   else if(method==='POST'){
    if(body.user_id!==id){status=options.wrongInsertError?409:403;result={code:options.wrongInsertError?'23505':'42501'};}
    else if(options.denyOwn){status=403;result={code:'42501'};}
    else if(rows.has(id)){status=409;result={code:'23505'};}
    else{const row={user_id:id,revision:1,payload:body.payload};rows.set(id,row);result=[row];}
   }else if(method==='PATCH'){
    if(options.failCleanup&&body.payload.tasks.length===0){status=503;result={code:'network'};}
    else if(target!==id||!rows.has(id)||(url.searchParams.has('revision')&&Number(url.searchParams.get('revision').replace('eq.',''))!==rows.get(id).revision))result=[];
    else{const row={user_id:id,revision:rows.get(id).revision+1,payload:body.payload};rows.set(id,row);result=[row];}
   }
  }else{status=404;result={};}
  // JSONB returns object keys in a different order from the client.
  const sorted=v=>Array.isArray(v)?v.map(sorted):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,sorted(v[k])])):v;
  return new Response(status===204?null:JSON.stringify(sorted(result)),{status,headers:{'Content-Type':'application/json'}});
 };
 const context={window:{},document:{querySelector:()=>null},crypto,fetch,Response,URL,AbortSignal,structuredClone,console};vm.createContext(context);vm.runInContext(SCRIPT,context);
 const report=await context.window.PoryadokSecurityCheck.run({supabaseUrl:'https://test.supabase.co',supabasePublishableKey:'public-test-key'},{emailA:'a@test.invalid',passwordA:' password-a ',emailB:'b@test.invalid',passwordB:'password-b'},{currentUserId:options.currentUserId||null});
 assert(!JSON.stringify(report).includes('password-a'));assert(!JSON.stringify(report).includes('token-a'));assert(!JSON.stringify(report).includes('a@test.invalid'));
 return {report,rows,calls};
}
(async()=>{
 const good=await simulate();assert.equal(good.report.passed,true);assert.equal(good.report.results.length,9);assert.equal(good.report.cleanup.length,0);assert([...good.rows.values()].every(row=>row.payload.tasks.length===0));assert.equal(good.calls.filter(c=>c.path==='/auth/v1/logout').length,2);
 const leaked=await simulate({leakReads:true});assert.equal(leaked.report.passed,false);assert(leaked.report.results.some(r=>!r.passed));assert([...leaked.rows.values()].every(row=>row.payload.tasks.length===0));
 const nonempty=await simulate({nonempty:true});assert.equal(nonempty.report.passed,false);assert.equal(nonempty.rows.get('user-a').payload.tasks[0].title,'Реальная задача');assert.equal(nonempty.calls.filter(c=>c.path.includes('dashboards')&&['POST','PATCH'].includes(c.method)).length,0);
 const same=await simulate({sameIdentity:true});assert.equal(same.report.passed,false);assert.equal(same.rows.size,0);
 const current=await simulate({currentUserId:'user-a'});assert.equal(current.report.passed,true);assert([...current.rows.values()].every(row=>row.payload.tasks.length===0));
 const denied=await simulate({denyOwn:true});assert.equal(denied.report.passed,false);
 const ambiguous=await simulate({wrongInsertError:true});assert.equal(ambiguous.report.passed,false);assert(ambiguous.report.results.find(r=>r.name.startsWith('Нельзя записать')).passed===false);
 const raced=await simulate({race:true});assert.equal(raced.report.passed,false);assert(raced.rows.get('user-a').payload.tasks.some(t=>t.id==='concurrent-real'));
 const cleanup=await simulate({failCleanup:true});assert.equal(cleanup.report.passed,false);assert(cleanup.report.cleanup.length>0);
 console.log('PASS: nine API probes, JSONB order, safe cleanup, leak detection, refuse nonempty/same account, reject inconclusive insert, report cleanup failure, no credentials in report, local-only logout. Simulated API; live two-account check still requires users.');
})().catch(error=>{console.error(error);process.exit(1)});
