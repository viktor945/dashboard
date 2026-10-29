'use strict';
(() => {
 const $ = selector => document.querySelector(selector);
 const params = new URLSearchParams(location.hash.slice(1));
 let incoming = params.has('device_link') ? params.get('device_link') : null;
 if (incoming !== null) history.replaceState(null, '', location.pathname + location.search);
 window.addEventListener('hashchange',()=>{if(new URLSearchParams(location.hash.slice(1)).has('device_link'))location.reload();});
 let cloud, context, sender = null, generation = 0, timer;
 const random = () => btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
 const unavailable = 'QR-вход ещё не подключён к Supabase. Откройте инструкцию ниже для владельца приложения.';
 async function call(action, values = {}, owner = false) {
  if (!cloud.configured) throw Error('Сначала подключите облачный аккаунт.');
  if (owner) await cloud.authorize();
  try { return await cloud.request('/functions/v1/device-link', { method: 'POST', body: { action, ...values } }); }
  catch (error) { throw Error(action === 'create' && /404|Failed to fetch|QR-вход пока недоступен|not found|failed to fetch/i.test(error.message) ? unavailable : error.message); }
 }
 function clearOffer(message = '', revoke = true) {
  const previous = sender; sender = null; generation++; clearTimeout(timer);
  $('#device-link-qr').replaceChildren(); $('#device-link-offer').hidden = true;
  $('#device-link-create').hidden = false; $('#device-link-create').disabled = false;
  $('#device-link-approve').hidden = true; $('#device-link-status').textContent = message;
  if (previous && revoke) call('cancel', { id: previous.id }, true).catch(() => {});
 }
 function sync() {
  if (sender && (!context().cloudMode || cloud.user?.id !== sender.owner)) clearOffer();
 }
 function statusError(result) {
  return ({ invalid: 'Этот QR-код недействителен.', expired: 'Время QR-кода истекло. Создайте новый код на компьютере.',
   revoked: 'Подключение отменено на компьютере. Создайте новый QR-код.', other_device: 'Этот QR уже открыт на другом устройстве. Создайте новый код.',
   not_ready: 'Телефон ещё не готов к подключению. Попробуйте создать новый код.' })[result.state];
 }
 async function poll(token) {
  if (!sender || token !== generation) return;
  const left = Math.ceil((Date.parse(sender.expires_at) - Date.now()) / 1000);
  if (left <= 0) { clearOffer('QR-код истёк. Для входа создайте новый.'); return; }
  $('#device-link-countdown').textContent = 'Действует ещё ' + Math.floor(left / 60) + ':' + String(left % 60).padStart(2, '0');
  try {
   const state = await call('status', { id: sender.id }, true);
   if (!sender || token !== generation) return;
   if (state.state === 'redeemed') { clearOffer('QR-код использован. Завершите открытие дашборда на телефоне.', false); return; }
   const error = statusError(state); if (error) { clearOffer(error); return; }
   if (state.state === 'scanned') {
    $('#device-link-match').hidden = false; $('#device-link-code').textContent = state.code;
    $('#device-link-approve').hidden = false;
    $('#device-link-status').textContent = 'Телефон ожидает подтверждения. Подключайте только своё устройство и сверьте код на двух экранах.';
   } else if (state.state === 'approved' || state.state === 'approving') {
    $('#device-link-approve').hidden = true; $('#device-link-status').textContent = 'Подключение подтверждено. Оставьте страницу на телефоне открытой.';
   }
  } catch (error) { if (token === generation) clearOffer(error.message); return; }
  if (sender && token === generation) timer = setTimeout(() => poll(token), 2000);
 }
 function mount(options) {
  ({ cloud, context } = options);
  $('#device-link-create').onclick = async () => {
   const state = context();
   if (!state.cloudMode || state.cloudLoading || state.writeBusy || cloud.needsPassword) { $('#device-link-status').textContent = 'Дождитесь входа и загрузки аккаунта.'; return; }
   clearOffer(); const token = generation; $('#device-link-create').disabled = true;
   $('#device-link-setup').hidden = true; $('#device-link-status').textContent = 'Создаём временный код…';
   try {
    const offer = await call('create', { workspace: state.workspace }, true);
    if (token !== generation) { call('cancel', { id: offer.id }, true).catch(() => {}); return; }
    sender = { ...offer, owner: cloud.user.id };
    const url = new URL('./', location.href); url.search = ''; url.hash = 'device_link=' + offer.id + '.' + offer.offer;
    const qr = qrcode(0, 'M'); qr.addData(url.href); qr.make();
    $('#device-link-qr').innerHTML = qr.createSvgTag({ cellSize: 5, margin: 20, scalable: true });
    $('#device-link-offer').hidden = false; $('#device-link-create').hidden = true; $('#device-link-match').hidden = true;
    $('#device-link-status').textContent = 'Откройте камеру телефона и отсканируйте QR. Код одноразовый и действует 5 минут.';
    poll(token);
   } catch (error) {
    if (token === generation) { clearOffer(error.message); $('#device-link-setup').hidden = false; }
   }
  };
  $('#device-link-cancel').onclick = () => clearOffer('Подключение отменено.');
  $('#account-dialog').addEventListener('close', () => clearOffer());
  $('#device-link-approve').onclick = async () => {
   if (!sender) return; const token = generation; $('#device-link-approve').disabled = true;
   try {
    const result = await call('approve', { id: sender.id }, true);
    if (token !== generation) return;
    const error = statusError(result); if (error) clearOffer(error);
    else { $('#device-link-approve').hidden = true; $('#device-link-status').textContent = 'Подтверждено. Дождитесь открытия дашборда на телефоне.'; }
   } catch (error) { if (token === generation) clearOffer(error.message); }
   finally { $('#device-link-approve').disabled = false; }
  };
 }
 async function receive(client) {
  if (incoming === null) return null;
  cloud = client; const value = incoming; incoming = null;
  const match = /^([a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12})\.([A-Za-z0-9_-]{43})$/i.exec(value);
  const dialog = $('#device-link-receiver'), status = $('#device-link-receiver-status'), start = $('#device-link-receiver-start');
  return new Promise(resolve => {
   let active = true, waiting;
   const finish = result => { if (!active) return; active = false; clearTimeout(waiting); dialog.close(); resolve(result); };
   $('#device-link-receiver-close').onclick = () => finish(null);
   dialog.oncancel = e => { e.preventDefault(); finish(null); };
   dialog.onclose = () => finish(null);
   dialog.showModal();
   if (!match || !cloud.configured) { status.textContent = !match ? 'Некорректный QR-код. Создайте новый в «Мой аккаунт» на компьютере.' : 'Этот сайт ещё не подключён к облачным аккаунтам.'; start.hidden = true; return; }
   const request = { id: match[1], offer: match[2], device: random() };
   start.onclick = async () => {
    start.disabled = true; status.textContent = 'Подключаемся к компьютеру…';
    try {
     const state = await call('claim', request); if (!active) return;
     const error = statusError(state); if (error || state.state === 'redeemed') throw Error(error || 'QR-код уже использован. Создайте новый.');
     $('#device-link-receiver-code').hidden = false; $('#device-link-receiver-code').textContent = state.code;
     status.textContent = 'Сверьте этот код с компьютером и нажмите там «Код совпадает — подключить телефон». Пароль вводить не нужно.';
     const expires = Date.parse(state.expires_at);
     const check = async () => {
      if (!active) return;
      try {
       if (Date.now() >= expires) throw Error('QR-код истёк. Создайте новый на компьютере.');
       const result = await call('consume', request); if (!active) return;
       const error = statusError(result); if (error) throw Error(error);
       if (result.token_hash) {
        status.textContent = 'Открываем ваш дашборд…';
        const accepted = await cloud.qrLogin(result.token_hash, result.owner_id, $('#device-link-remember').checked, () => active);
        if (active && accepted) finish({ workspace: result.workspace });
        return;
       }
       if (result.state === 'redeemed') throw Error('QR-код уже использован. Создайте новый на компьютере.');
       waiting = setTimeout(check, 2000);
      } catch (error) { if (active) status.textContent = error.message + ' Можно закрыть это окно и создать новый QR-код.'; }
     };
     check();
    } catch (error) { if (active) status.textContent = error.message; }
   };
  });
 }
 window.PoryadokDeviceLink = { mount, sync, receive };
})();
