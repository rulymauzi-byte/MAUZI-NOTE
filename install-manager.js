/* MAUZI NOTE 4.7 — invitación de instalación, sin obligar a instalar.
   La confirmación nativa requiere un toque. No confundimos pantalla completa
   de lectura con una PWA instalada. No cambiamos ninguna cuenta o nota. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const scope = new URL('./', location.href);
  const manifestURL = new URL('./manifest.webmanifest', scope).href;
  const key = 'mauzi-note:install-proof:' + scope.pathname;
  const legacyKey = 'mauzi_note_installed';
  const standaloneQuery = matchMedia('(display-mode: standalone)');
  const minimalQuery = matchMedia('(display-mode: minimal-ui)');
  const standalone = () => standaloneQuery.matches || minimalQuery.matches || navigator.standalone === true;
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const android = /Android/i.test(navigator.userAgent);
  const embedded = /FBAN|FBAV|Instagram|; wv\)/i.test(navigator.userAgent);
  const read = k => { try { return localStorage.getItem(k); } catch (_) { return null; } };
  const write = (k,v) => { try { localStorage.setItem(k,v); } catch (_) {} };
  const remove = k => { try { localStorage.removeItem(k); } catch (_) {} };
  let proof = read(key) === '1' || read(legacyKey) === '1';
  let relatedInstalled = false, deferred = null, prompting = false, requested = false;
  let offered = false, dismissed = false, opened = false, restoreInert = [], focusBefore = null;
  let detection = null, detectionReady = false;
  const installed = () => standalone() || proof || relatedInstalled;
  const canOffer = () => isSecureContext && location.protocol !== 'file:' && !installed() && !requested;

  const offer = document.createElement('section');
  offer.id = 'installOffer'; offer.className = 'install-offer hidden';
  offer.setAttribute('role','dialog'); offer.setAttribute('aria-modal','true');
  offer.setAttribute('aria-labelledby','installOfferTitle');
  offer.innerHTML = `
    <div class="install-offer-card">
      <button id="installOfferClose" class="install-offer-close" type="button" aria-label="Continuar en el navegador">×</button>
      <div class="install-offer-brand"><img src="./icons/icon-192.png" width="70" height="70" alt="Logo de MAUZI NOTE"><span>MAUZI NOTE<small>Tus notas, siempre a mano</small></span></div>
      <p class="install-offer-eyebrow">LLÉVALA A TU PANTALLA DE INICIO</p>
      <h2 id="installOfferTitle" tabindex="-1">Instala tu app de notas</h2>
      <p class="install-offer-description">Ábrela desde su icono, con más espacio para escribir y tu Biblia disponible sin conexión.</p>
      <div class="install-offer-benefits"><span>Notas e imágenes</span><span>Biblia sin internet</span><span>PC · tablet · celular</span></div>
      <p id="installOfferGuide" class="install-offer-guide" role="status" hidden></p>
      <button id="installOfferNow" class="install-offer-primary" type="button"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" aria-hidden="true"><path d="M12 3v12m-5-5 5 5 5-5M4 15v5h16v-5"/></svg><span>Instalar MAUZI NOTE</span></button>
      <button id="installOfferLater" class="install-offer-secondary" type="button">Continuar en el navegador</button>
      <p class="install-offer-foot">Instalar es opcional. No necesitas vincular correo para empezar. Espera «Lista sin conexión» para usarla sin internet.</p>
    </div>`;
  document.body.append(offer);

  function guide() {
    if (embedded) return 'Abre este enlace en Chrome (Android) o Safari (iPhone), fuera de la vista interna de WhatsApp o Facebook. Luego instala desde el menú del navegador.';
    if (ios) return 'En Safari, toca Compartir → Añadir a pantalla de inicio. Activa «Abrir como app web» si aparece y toca Añadir. Después ábrela desde su icono.';
    if (android) return 'En Chrome, toca el menú ⋮ → Instalar aplicación o Añadir a pantalla de inicio. Si aún no aparece, espera a que termine la descarga y vuelve a abrir el menú.';
    return 'En Chrome o Edge, busca el icono de instalar en la barra de direcciones o la opción de instalar esta página como aplicación en el menú. La opción depende del navegador.';
  }
  function closeOffer(reason='dismissed') {
    if (reason==='dismissed') dismissed = true;
    if (!opened) return;
    opened=false; offer.classList.add('hidden');
    document.documentElement.classList.remove('install-offer-open');
    for (const [el,value] of restoreInert) if (el.isConnected) el.inert=value;
    restoreInert=[];
    if (focusBefore?.isConnected && !focusBefore.inert) focusBefore.focus({preventScroll:true});
    window.dispatchEvent(new CustomEvent('mauzi:install-offer',{detail:{open:false}}));
  }
  function rememberInstallation() {
    proof=true; write(key,'1'); write(legacyKey,'1'); deferred=null; requested=false;
    closeOffer('installed'); refresh();
  }
  function refresh() {
    if (standalone() && !proof) { proof=true; write(key,'1'); write(legacyKey,'1'); }
    const known=installed();
    document.documentElement.classList.toggle('mauzi-installed',known);
    document.querySelectorAll('[data-install-open]').forEach(b => {
      b.hidden=known; b.classList.toggle('hidden',known);
    });
    $('installTitle').textContent=known?'MAUZI NOTE · aplicación':'Instalar MAUZI NOTE';
    $('installNowBtn').classList.toggle('hidden',!deferred || known || prompting || requested);
    const help=$('installHelp');
    if(known) help.textContent='La app ya está instalada. Aquí puedes revisar el uso sin conexión y las actualizaciones.';
    else if(location.protocol==='file:') help.textContent='Este es el archivo local. Para instalar, abre el enlace HTTPS publicado de MAUZI NOTE en tu navegador.';
    else if(!isSecureContext) help.textContent='Abre el enlace HTTPS publicado para instalar MAUZI NOTE.';
    else if(deferred) help.textContent='Toca Instalar aplicación y confirma en el navegador. No necesitas volver a instalar en cada actualización.';
    else help.textContent=guide();
    $('installOfferNow').disabled=prompting;
    $('installOfferNow').querySelector('span').textContent=prompting?'Esperando al navegador…':'Instalar MAUZI NOTE';
    if (known) closeOffer('installed');
    window.dispatchEvent(new CustomEvent('mauzi:installation-state',{detail:{installed:known,standalone:standalone(),ready:!!deferred}}));
  }
  function showOffer({manual=false}={}) {
    refresh();
    if (!canOffer() || opened || (!manual && (dismissed || offered))) return false;
    // Never interrupt a draft or a note the user is reading.
    if(!manual && (!$('noteModal').classList.contains('hidden') || !$('noteReadModal').classList.contains('hidden'))) return false;
    offered=true;opened=true;focusBefore=document.activeElement;restoreInert=[];
    for(const el of document.body.children) if(el!==offer && el instanceof HTMLElement && !['SCRIPT','STYLE','LINK'].includes(el.tagName)){
      restoreInert.push([el,el.inert]);el.inert=true;
    }
    offer.inert=false; offer.classList.remove('hidden');
    document.documentElement.classList.add('install-offer-open');
    $('installOfferGuide').hidden=true;
    requestAnimationFrame(()=>$('installOfferTitle').focus({preventScroll:true}));
    window.dispatchEvent(new CustomEvent('mauzi:install-offer',{detail:{open:true}}));
    return true;
  }
  async function installNow() {
    if(installed()){closeOffer('installed');return;}
    if(prompting)return;
    if(!deferred){$('installOfferGuide').textContent=guide();$('installOfferGuide').hidden=false;return;}
    const event=deferred;deferred=null;prompting=true;refresh();
    try {
      // This call stays on the direct click stack. Browsers require user activation.
      const resultPromise=event.prompt();
      const result=await (event.userChoice || resultPromise);
      if(result?.outcome==='accepted'){
        requested=true;closeOffer('requested');
        window.showToast?.('Instalación solicitada. El navegador completará el proceso.');
      } else { dismissed=true;closeOffer(); }
    } catch(error){
      $('installOfferGuide').textContent=guide();$('installOfferGuide').hidden=false;
      window.showToast?.('Usa el menú del navegador para instalar.');
    } finally {prompting=false;refresh();}
  }
  window.addEventListener('beforeinstallprompt',event=>{
    event.preventDefault();deferred=event;requested=false;
    // A fresh install prompt is positive evidence of installability after uninstall.
    if(!standalone()){proof=false;relatedInstalled=false;remove(key);remove(legacyKey);}
    refresh();if(detectionReady)showOffer();
  });
  window.addEventListener('appinstalled',()=>{rememberInstallation();window.showToast?.('MAUZI NOTE instalada');});
  standaloneQuery.addEventListener?.('change',refresh);minimalQuery.addEventListener?.('change',refresh);
  window.addEventListener('storage',event=>{if(event.key===key||event.key===legacyKey){proof=read(key)==='1'||read(legacyKey)==='1';refresh();}});
  function checkRelated() {
    if(detection)return detection;
    detection=(async()=>{
      if(standalone()){rememberInstallation();return;}
      if(typeof navigator.getInstalledRelatedApps!=='function')return;
      try{
        const apps=await Promise.race([navigator.getInstalledRelatedApps(),new Promise(resolve=>setTimeout(()=>resolve([]),1600))]);
        relatedInstalled=apps.some(a=>a.platform==='webapp' && (
          (a.url&&new URL(a.url,location.href).href===manifestURL)||
          (a.id&&new URL(a.id,location.href).href===scope.href)));
        if(relatedInstalled)rememberInstallation();
      }catch(_){}finally{refresh();}
    })().finally(()=>{detection=null;});return detection;
  }
  for (const b of document.querySelectorAll('[data-install-open]')) b.addEventListener('click',()=>{
    if(canOffer())showOffer({manual:true});else{refresh();window.openModal?.('installModal');}
  });
  for (const b of document.querySelectorAll('[data-app-status]')) b.addEventListener('click',()=>{
    refresh();window.openModal?.('installModal');window.dispatchEvent(new Event('mauzi:app-status-open'));
  });
  $('installNowBtn').addEventListener('click',installNow);
  $('installOfferNow').addEventListener('click',installNow);
  $('installOfferClose').addEventListener('click',()=>closeOffer());
  $('installOfferLater').addEventListener('click',()=>closeOffer());
  offer.addEventListener('click',event=>{if(event.target===offer)closeOffer();});
  document.addEventListener('keydown',event=>{
    if(!opened)return;
    if(event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();closeOffer();return;}
    if(event.key!=='Tab')return;
    const items=[...offer.querySelectorAll('button,a')].filter(n=>!n.disabled && n.getClientRects().length);
    const first=items[0],last=items.at(-1);
    if(event.shiftKey&&(document.activeElement===first||!offer.contains(document.activeElement))){event.preventDefault();last?.focus();}
    else if(!event.shiftKey&&(document.activeElement===last||!items.includes(document.activeElement))){event.preventDefault();first?.focus();}
  },true);
  window.addEventListener('pageshow',()=>{checkRelated();refresh();});
  document.addEventListener('visibilitychange',()=>{if(!document.hidden){checkRelated();refresh();}});
  window.MauziInstall=Object.freeze({refresh,isInstalled:installed,isOpen:()=>opened,show:showOffer,dismiss:()=>closeOffer(),check:checkRelated});
  refresh();
  const init=async()=>{await checkRelated();detectionReady=true;setTimeout(()=>showOffer(),450);};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
