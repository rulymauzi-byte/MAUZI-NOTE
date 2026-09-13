/* MAUZI NOTE: app shell + embedded Bibles, cached for offline startup.
   Deploy next to index.html. Relative URLs also work in /repository-name/.
   When publishing an update, change BUILD (or regenerate this package). */
'use strict';
const BUILD = '3.1.0-rich-paper-0b27f93f7cd8';
const CACHE_PREFIX = 'mauzi-note::'+self.registration.scope+'::';
const CACHE_NAME = CACHE_PREFIX+BUILD;
const ASSETS = [
  './index.html', './manifest.webmanifest', './favicon.ico',
  './editor-enhancements.js', './editor-enhancements.css', './drive-sync.js', './google-config.js', './CONFIGURAR_GOOGLE.html', './PRIVACIDAD.html',
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
