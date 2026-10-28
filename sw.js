'use strict';
const CACHE='poryadok-shell-v5';
const ROOT=new URL('./',self.location.href);
const FILES=['./','index.html','style.css','app.js','excel-export.js','report-xlsx.js','report-import.js','cloud.js','config.js','install.js','security-check.js','manifest.webmanifest','icons/icon-192.png','icons/icon-512.png','icons/apple-touch-icon.png'];
const PATHS=new Set(FILES.map(file=>new URL(file,ROOT).pathname));
self.addEventListener('install',event=>{event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(FILES.map(file=>new URL(file,ROOT).href))).then(()=>self.skipWaiting()));});
self.addEventListener('activate',event=>{event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith('poryadok-shell-')&&key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim()));});
self.addEventListener('fetch',event=>{
 const request=event.request,url=new URL(request.url);
 if(request.method!=='GET'||url.origin!==ROOT.origin||!PATHS.has(url.pathname)||request.headers.has('Authorization'))return;
 // Only workspace links are safe to normalize; do not cache auth callback queries.
 if([...url.searchParams.keys()].some(key=>key!=='workspace'))return;
 const key=new URL(url.pathname,ROOT).href;
 event.respondWith((async()=>{
  try{const response=await fetch(request,{cache:'no-cache'});if(response.ok){const cache=await caches.open(CACHE);await cache.put(key,response.clone());}return response;}
  catch{const cached=await caches.match(key);return cached||new Response('Нет сети. Откройте «Порядок» с интернетом хотя бы один раз.',{status:503,headers:{'Content-Type':'text/plain;charset=utf-8'}});}
 })());
});
