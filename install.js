'use strict';
(() => {
 const dialog=document.querySelector('#install-dialog'),native=document.querySelector('#install-native');
 let promptEvent=null;
 const installed=()=>matchMedia('(display-mode: standalone)').matches||navigator.standalone===true;
 function status(){document.querySelector('#install-status').textContent=installed()?'«Порядок» уже открыт как приложение.':promptEvent?'Ваш браузер поддерживает установку. Нажмите кнопку ниже.':'Выберите своё устройство и следуйте инструкции.';native.hidden=installed()||!promptEvent;}
 function platform(name){document.querySelectorAll('[data-instructions]').forEach(s=>s.hidden=s.dataset.instructions!==name);document.querySelectorAll('[data-platform]').forEach(b=>{b.classList.toggle('selected',b.dataset.platform===name);b.setAttribute('aria-pressed',String(b.dataset.platform===name));});}
 window.addEventListener('beforeinstallprompt',event=>{event.preventDefault();promptEvent=event;status();});
 window.addEventListener('appinstalled',()=>{promptEvent=null;status();});
 document.querySelector('#install-button').onclick=()=>{const ua=navigator.userAgent;platform(/iPhone|iPad|iPod/.test(ua)||(/Mac/.test(ua)&&navigator.maxTouchPoints>1)?'ios':/Android/.test(ua)?'android':'windows');status();dialog.showModal();};
 document.querySelector('#close-install').onclick=()=>dialog.close();
 document.querySelector('.install-tabs').onclick=e=>{const b=e.target.closest('[data-platform]');if(b)platform(b.dataset.platform);};
 native.onclick=async()=>{if(!promptEvent)return;const event=promptEvent;native.disabled=true;try{await event.prompt();const choice=await event.userChoice;document.querySelector('#install-status').textContent=choice.outcome==='accepted'?'Запрос установки принят браузером.':'Установка отменена. Можно установить приложение позже через меню браузера.';}catch{document.querySelector('#install-status').textContent='Установка через кнопку недоступна. Используйте инструкцию для вашего устройства.';}finally{promptEvent=null;native.hidden=true;native.disabled=false;}};
 document.querySelectorAll('[data-shortcut]').forEach(button=>button.onclick=()=>{const scope=button.dataset.shortcut;const url=new URL(location.pathname,location.origin);url.searchParams.set('workspace',scope);const blob=new Blob(['[InternetShortcut]\r\nURL='+url.href+'\r\n'],{type:'application/octet-stream'}),link=document.createElement('a'),objectUrl=URL.createObjectURL(blob);link.href=objectUrl;link.download='Poryadok-'+scope+'.url';link.click();setTimeout(()=>URL.revokeObjectURL(objectUrl),1000);});
 // Only static app files are cached. Supabase responses and tokens are never cached.
 if('serviceWorker' in navigator)window.addEventListener('load',()=>{navigator.serviceWorker.register('./sw.js').catch(()=>{/* Online use and manual home-screen shortcuts remain available. */});});
})();
