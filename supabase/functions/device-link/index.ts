// Native fetch only. SUPABASE_SERVICE_ROLE_KEY stays inside the Edge Function.
export function createHandler(config: {url?:string;serviceKey?:string;appUrl?:string}, fetcher: typeof fetch = fetch) {
 const appUrl = new URL(config.appUrl || 'https://viktor945.github.io/dashboard/');
 const origin = appUrl.origin;
 const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: {
  'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Pragma': 'no-cache',
  'Access-Control-Allow-Origin': origin, 'Vary': 'Origin',
  'Access-Control-Allow-Headers': 'authorization,apikey,content-type,x-client-info',
  'Access-Control-Allow-Methods': 'POST,OPTIONS'
 }});
 const digest = async (value: string) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))).map(x => x.toString(16).padStart(2, '0')).join('');
 const random = () => btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
 async function api(path: string, body: Record<string, unknown> | null, userToken?: string) {
  const res = await fetcher(config.url + path, { method: body ? 'POST' : 'GET', headers: {
   apikey: config.serviceKey || '', Authorization: 'Bearer ' + (userToken || config.serviceKey), 'Content-Type': 'application/json'
  }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error('upstream');
  return res.json();
 }
 return async (request: Request) => {
  if (request.headers.get('origin') && request.headers.get('origin') !== origin) return json({ message: 'Этот адрес сайта не разрешён.' }, 403);
  if (request.method === 'OPTIONS') return json({});
  if (request.method !== 'POST') return json({ message: 'Используйте POST.' }, 405);
  if (!config.url || !config.serviceKey) return json({ message: 'Сервер QR-входа ещё не настроен.' }, 503);
  let reserved: Record<string, unknown> | null = null;
  try {
   const reader=request.body?.getReader();let text='',size=0;const decoder=new TextDecoder();
   if(reader){while(true){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>2048){await reader.cancel();return json({message:'Слишком большой запрос.'},413);}text+=decoder.decode(part.value,{stream:true});}text+=decoder.decode();}
   const body = JSON.parse(text);
   if (!body || !['create','status','approve','cancel','claim','consume'].includes(body.action)) return json({ message: 'Неверный запрос.' }, 400);
   const ownerAction = ['create','status','approve','cancel'].includes(body.action);
   let user;
   if (ownerAction) {
    const match = /^Bearer (\S+)$/i.exec(request.headers.get('authorization') || '');
    if (!match) return json({ message: 'Сначала войдите в аккаунт на компьютере.' }, 401);
    try { user = await api('/auth/v1/user', null, match[1]); } catch { return json({ message: 'Войдите в аккаунт на компьютере заново.' }, 401); }
    if (!user?.id || !user.email || !user.email_confirmed_at) return json({ message: 'Для QR-входа нужен аккаунт с подтверждённым email.' }, 403);
    if (['create','approve'].includes(body.action) && Array.isArray(user.factors) && user.factors.some((factor: {status?:string}) => factor.status === 'verified')) return json({message:'Для аккаунта с двухфакторной защитой используйте обычный вход на телефоне.'},403);
   }
   if (body.action === 'create') {
    if (!['work','personal'].includes(body.workspace)) return json({ message: 'Неверный планировщик.' }, 400);
    const offer = random(), code = String(crypto.getRandomValues(new Uint32Array(1))[0] % 1000000).padStart(6, '0');
    const result = await api('/rest/v1/rpc/device_link_create', { p_owner: user.id, p_offer_hash: await digest(offer), p_code: code, p_workspace: body.workspace });
    if (result.state === 'rate_limited') return json({ message: 'Слишком много QR-кодов. Подождите минуту.' }, 429);
    return json({ ...result, offer });
   }
   if (typeof body.id !== 'string' || !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(body.id)) return json({ message: 'Неверный QR-код.' }, 400);
   const args: Record<string, unknown> = { p_action: body.action, p_id: body.id };
   if (ownerAction) args.p_owner = user.id;
   else {
    if (!/^[A-Za-z0-9_-]{43}$/.test(body.offer || '') || !/^[A-Za-z0-9_-]{43}$/.test(body.device || '')) return json({ message: 'Неверный QR-код.' }, 400);
    args.p_offer_hash = await digest(body.offer); args.p_device_hash = await digest(body.device);
   }
   if (body.action === 'approve') {
    const state = await api('/rest/v1/rpc/device_link_transition', { ...args, p_action: 'reserve' });
    if (state.state !== 'approving') return json(state);
    reserved = args;
    const link = await api('/auth/v1/admin/generate_link', { type: 'magiclink', email: user.email, redirect_to: appUrl.href });
    const hash = link.hashed_token || link.properties?.hashed_token;
    if (typeof hash !== 'string' || hash.length < 20) throw new Error('no token');
    const result = await api('/rest/v1/rpc/device_link_transition', { ...args, p_action: 'approve', p_otp_hash: hash });
    reserved = null;
    return json(result);
   }
   return json(await api('/rest/v1/rpc/device_link_transition', args));
  } catch {
   if (reserved) { try { await api('/rest/v1/rpc/device_link_transition', { ...reserved, p_action: 'release' }); } catch {} }
   return json({ message: 'QR-вход пока недоступен. Проверьте подключение серверной функции и таблицы Supabase; затем создайте новый код.' }, 503);
  }
 };
}
if (typeof Deno !== 'undefined') {
 Deno.serve(createHandler({ url: Deno.env.get('SUPABASE_URL'), serviceKey: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'), appUrl: Deno.env.get('DASHBOARD_URL') }));
}
