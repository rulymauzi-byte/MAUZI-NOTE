/* MAUZI NOTE: app shell + embedded Bibles, cached for offline startup.
   Deploy next to index.html. Relative URLs also work in /repository-name/.
   When publishing an update, change BUILD (or regenerate this package). */
'use strict';
const BUILD = '4.7.0-instalacion-seleccion-20260914';
const CACHE_PREFIX = 'mauzi-note::'+self.registration.scope+'::';
const CACHE_NAME = CACHE_PREFIX+BUILD;
const ASSETS = [
  './index.html', './install-manager.js', './install-manager.css', './text-selection.js', './text-selection.css', './quick-sync.js', './quick-sync.css', './welcome-access.js', './welcome-access.css', './manifest.webmanifest', './favicon.ico',
  './archive-core.js', './archive-ui.js', './archive-ui.css', './AYUDA_GOOGLE_Y_CARPETAS.html',
  './studio.js', './studio.css', './navigation.js', './media-sync.js',
  './editor-enhancements.js', './editor-enhancements.css', './note-experience.js', './note-experience.css', './drive-sync.js', './google-config.js', './CONFIGURAR_GOOGLE.html', './PRIVACIDAD.html',
  './ACTUALIZAR.html', './account-config.js', './account-access.css', './modules-store.js', './modules-ui.js', './modules.css', './editor-modes.js', './calendar-link.js', './ACTIVAR_RECORDATORIOS.html',
  './icons/icon-192.png', './icons/icon-512.png',
  './icons/icon-maskable-512.png', './icons/apple-touch-icon.png', './icons/favicon-32.png'
].map(path=>new URL(path,self.registration.scope).href);
const INDEX_URL = ASSETS[0];
const SCOPE_URL = new URL(self.registration.scope);
const FILE_URLS = new Set(ASSETS);

async function cacheApplication() {
  const cache = await caches.open(CACHE_NAME);
  // One complete install: a missing asset fails the install instead of claiming offline readiness.
  await cache.addAll(ASSETS.map(url=>new Request(url,{cache:'reload',credentials:'same-origin'})));
}

async function getOfflineStatus() {
  const cache = await caches.open(CACHE_NAME);
  const matches = await Promise.all(ASSETS.map(url=>cache.match(url)));
  return {ready:matches.every(Boolean),build:BUILD};
}

self.addEventListener('install',event=>{
  event.waitUntil(cacheApplication());
  // No automatic skipWaiting: an open editor should not be interrupted by an update.
});

self.addEventListener('activate',event=>{
  event.waitUntil((async()=>{
    const names = await caches.keys();
    await Promise.all(names.filter(name=>name.startsWith(CACHE_PREFIX)&&name!==CACHE_NAME).map(name=>caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch',event=>{
  const request = event.request;
  if(request.method!=='GET') return;
  const url = new URL(request.url);
  // Configuration is network-first so filling in google-config.js does not leave an old blank configuration cached.
  if(url.origin===SCOPE_URL.origin && url.pathname===new URL('./google-config.js',self.registration.scope).pathname){
    event.respondWith((async()=>{
      const cache=await caches.open(CACHE_NAME);
      try{const response=await fetch(new Request(request,{cache:'no-store'}));if(response.ok){await cache.put(url.href,response.clone());return response;}}catch(_){}
      return await cache.match(url.href) || new Response('window.MAUZI_GOOGLE_CLIENT_ID="";',{headers:{'Content-Type':'text/javascript'}});
    })());
    return;
  }
  if(url.origin!==SCOPE_URL.origin || !url.href.startsWith(self.registration.scope)) return;
  if(request.mode==='navigate' && (url.pathname===SCOPE_URL.pathname || url.pathname===new URL(INDEX_URL).pathname)){
    event.respondWith((async()=>{
      const cache=await caches.open(CACHE_NAME);
      const stored=await cache.match(INDEX_URL);
      if(stored) return stored;
      const response=await fetch(request);
      if(response.ok) await cache.put(INDEX_URL,response.clone());
      return response;
    })());
    return;
  }
  url.search='';url.hash='';
  if(!FILE_URLS.has(url.href)) return;
  event.respondWith((async()=>{
    const cache=await caches.open(CACHE_NAME);
    const stored=await cache.match(url.href);
    if(stored) return stored;
    const response=await fetch(request);
    if(response.ok && response.type!=='opaque') await cache.put(url.href,response.clone());
    return response;
  })());
});

self.addEventListener('message',event=>{
  const type=event.data&&event.data.type;
  if(type==='SKIP_WAITING'){
    event.waitUntil(self.skipWaiting());
    return;
  }
  if(type!=='GET_OFFLINE_STATUS' && type!=='REPAIR_OFFLINE') return;
  event.waitUntil((async()=>{
    try{
      if(type==='REPAIR_OFFLINE') await cacheApplication();
      const status=await getOfflineStatus();
      if(event.ports[0]) event.ports[0].postMessage(status);
    }catch(error){
      if(event.ports[0]) event.ports[0].postMessage({ready:false,error:String(error.message||error),build:BUILD});
    }
  })());
});

// Clicks on persistent foreground-created reminders may reopen the app.
// No setTimeout/setInterval is used here to pretend closed-app alarms are reliable.
self.addEventListener('notificationclick',event=>{
  const data=event.notification.data||{};event.notification.close();
  if(!/^[\w-]+$/.test(data.eventId||''))return;
  event.waitUntil((async()=>{
    const windows=await self.clients.matchAll({type:'window',includeUncontrolled:true});
    const windowClient=windows.find(c=>c.url.startsWith(self.registration.scope));
    if(windowClient){await windowClient.focus();windowClient.postMessage({type:'MAUZI_OPEN_EVENT',eventId:data.eventId,account:data.account||''});}
    else{const url=new URL('./',self.registration.scope);url.hash='agenda='+data.eventId;await self.clients.openWindow(url.href);}
  })());
});
