/* MAUZI NOTE 4.5 — elección de acceso y validación por el administrador.
   No guarda credenciales ni una lista de correos en el sitio público.
   Un clic en WhatsApp NO equivale a enviar el mensaje, aprobar una cuenta ni
   autenticarla. La autorización efectiva sigue a cargo de Google.
   No cambia el almacenamiento o la sincronización de las versiones anteriores. */
(()=>{
  'use strict';
  const A=window.MauziApp, C=window.MauziCloud;
  if(!A||!C){document.documentElement.classList.remove('mauzi-welcome-pending');return;}
  const CHOICE_KEY='mauzi-note:access-choice-v1', PHONE='50258484682';
  const $=id=>document.getElementById(id);
  const icon=(body)=>`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
  const device=icon('<rect x="6" y="2.5" width="12" height="19" rx="3"/><path d="M10 18h4"/>');
  const cloud=icon('<path d="M7 18h10a4 4 0 0 0 0-8 5.5 5.5 0 0 0-10.6-1.5A4.8 4.8 0 0 0 7 18Z"/><path d="m9 12 3-3 3 3m-3-3v7"/>');
  const arrow=icon('<path d="m9 5 7 7-7 7"/>');
  const check=icon('<path d="m5 12 4 4L19 6"/>');
  let stage='choice', opened=false, initial=false, waitingForGoogle=false, ready=false, busy=false, focusBefore=null;
  let inertBefore=[], lastSignal='';
  const root=document.createElement('section');
  root.id='accessWelcome';root.className='modal-backdrop access-overlay hidden';
  root.setAttribute('role','dialog');root.setAttribute('aria-modal','true');root.setAttribute('aria-labelledby','accessWelcomeTitle');
  root.innerHTML=`
  <div class="access-surface">
    <div class="access-top"><div class="access-brand"><img src="./icons/icon-192.png" width="46" height="46" alt="Logo de MAUZI NOTE"><div><strong>MAUZI NOTE</strong><span>Escribe. Organiza. Conserva.</span></div></div><button type="button" id="accessClose" class="close access-close" aria-label="Continuar sin vincular correo">${icon('<path d="m7 7 10 10M17 7 7 17"/>')}</button></div>
    <div id="accessChoicePanel">
      <div class="access-hero"><p class="access-eyebrow">BIENVENIDO A TU ESPACIO</p><h1 id="accessWelcomeTitle" tabindex="-1">Tus notas, a tu manera.</h1><p>Elige cómo empezar. Vincular tu correo es opcional.</p></div>
      <div class="access-options">
        <article class="access-option access-guest">
          <div class="access-card-head"><span class="access-emblem">${device}</span><span class="access-tag">Sin cuenta</span></div>
          <h2>Empieza ahora</h2><p>Escribe notas, agrega imágenes y usa la Biblia y la agenda en este dispositivo.</p>
          <div class="access-caution"><strong>Solo en este dispositivo</strong><p>Sin vincular correo no hay copia automática en Drive ni recuperación en otro equipo. Si pierdes el dispositivo o borras sus datos, podrías perder lo que no respaldaste.</p></div>
          <button id="accessUseLocal" type="button" class="access-button access-button-blue">Usar sin vincular correo ${arrow}</button>
          <small>Después puedes vincular tu cuenta desde Mi cuenta.</small>
        </article>
        <article class="access-option access-linked">
          <div class="access-card-head"><span class="access-emblem">${cloud}</span><span class="access-tag">Con respaldo en tu Drive</span></div>
          <h2>Lleva tus notas contigo</h2>
          <div class="access-benefits"><p>${check}<span>Recupera lo sincronizado al cambiar de celular.</span></p><p>${check}<span>Usa la misma cuenta en PC, tablet y celular.</span></p><p>${check}<span>Respalda notas, imágenes, favoritos y agenda.</span></p></div>
          <p class="access-approval">Primero solicita al administrador que valide tu correo. Después conecta tu cuenta Google.</p>
          <button id="accessChooseGoogle" type="button" class="access-button access-button-gold">Vincular mi correo ${arrow}</button>
          <small>La copia va a tu propio Drive, no al del creador.</small>
        </article>
      </div>
      <p class="access-footnote">La sincronización requiere internet y permiso vigente de Google. Antes de cambiar de equipo, comprueba que tus cambios llegaron a Drive y conserva una copia independiente.</p>
    </div>
    <div id="accessValidationPanel" hidden>
      <button id="accessGoBack" type="button" class="access-text-button">${icon('<path d="m15 5-7 7 7 7"/>')} Volver a las opciones</button>
      <p class="access-eyebrow">VINCULACIÓN POR INVITACIÓN</p><h1 id="accessValidationTitle" tabindex="-1">Valida tu acceso</h1>
      <p class="access-lead">Envía tu correo Google al administrador de <strong>MAUZI NOTE</strong> por WhatsApp. Espera su confirmación y luego entra con ese mismo correo.</p>
      <form id="accessRequestForm" class="access-request-box">
        <label for="accessRequestEmail">Correo de tu cuenta Google</label><input id="accessRequestEmail" type="email" inputmode="email" autocomplete="email" spellcheck="false" autocapitalize="none" maxlength="254" placeholder="tucorreo@gmail.com" aria-describedby="accessRequestPrivacy" required>
        <a id="accessWhatsApp" class="access-button access-button-gold" href="https://wa.me/50258484682" target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer">${icon('<path d="M20 11.5a8 8 0 0 1-8 8 9 9 0 0 1-4-.9L3 20l1.4-4.4a8 8 0 1 1 15.6-4.1Z"/><path d="M8 8c0 4 4 7 7 7l1-2-2-1-1 1-3-3 1-1-1-2-2 1Z"/>')} Solicitar validación por WhatsApp</a>
        <span class="access-contact">Administrador · Guatemala · <b>+502 5848 4682</b></span>
        <p id="accessRequestPrivacy" class="access-micro">El mensaje contiene solo el correo que escribas y la solicitud. Tú lo revisas y lo envías en WhatsApp. No envíes contraseñas, códigos ni tus notas.</p>
      </form>
      <p id="accessRequestStatus" class="access-message" role="status" aria-live="polite" hidden></p>
      <div class="access-approved-box"><strong>¿Ya confirmaron tu acceso?</strong><p>Elige en Google el correo que te autorizaron y acepta el permiso para los archivos de MAUZI NOTE.</p><button id="accessConnectGoogle" class="access-button access-button-blue" type="button">Ya validaron mi correo: conectar Google</button><p id="accessGoogleStatus" class="access-message" role="status" aria-live="polite"></p></div>
      <button id="accessContinueLocal" class="access-button access-button-outline" type="button">Usar sin vincular correo por ahora</button>
      <p class="access-footnote">La validación la realiza el administrador de MAUZI NOTE; no es una verificación oficial de Google. Abrir WhatsApp no activa tu cuenta. Puedes usar la app sin correo mientras esperas.</p>
    </div>
    <div class="access-footer"><span>No te pedimos tu contraseña.</span><a href="./PRIVACIDAD.html" target="_blank" rel="noopener noreferrer">Privacidad</a></div>
  </div>`;
  document.body.append(root);

  function remember(kind){try{localStorage.setItem(CHOICE_KEY,kind);localStorage.removeItem('mauzi-note:access-pending-v1');}catch(_){} }
  function focusHeading(){const n=$(stage==='choice'?'accessWelcomeTitle':'accessValidationTitle');requestAnimationFrame(()=>n?.focus({preventScroll:true}));}
  function show(which='choice',{first=false}={}){
    if(!opened){focusBefore=document.activeElement;inertBefore=[];
      for(const el of document.body.children){if(el!==root&&el instanceof HTMLElement&&!['SCRIPT','STYLE','LINK'].includes(el.tagName)){inertBefore.push([el,el.inert]);el.inert=true;}}
      root.classList.remove('hidden');document.documentElement.classList.add('access-is-open');opened=true;
    }
    initial=first;stage=which;root.setAttribute('aria-labelledby',which==='choice'?'accessWelcomeTitle':'accessValidationTitle');
    $('accessChoicePanel').hidden=which!=='choice';$('accessValidationPanel').hidden=which!=='validation';
    $('accessClose').setAttribute('aria-label',first?'Continuar sin vincular correo':'Cerrar opciones de acceso');
    root.scrollTop=0;focusHeading();
    if(which==='validation') C.prepareConnection?.();
    update();
  }
  function hide(){
    opened=false;waitingForGoogle=false;root.classList.add('hidden');document.documentElement.classList.remove('access-is-open','mauzi-welcome-pending');
    for(const [el,value] of inertBefore)if(el.isConnected)el.inert=value;inertBefore=[];
    if(focusBefore?.isConnected&&!focusBefore.inert)focusBefore.focus({preventScroll:true});
  }
  async function useLocal(){
    if(busy)return;busy=true;update();
    try{
      await C.ready;
      const before=C.account();
      if(before&&!before.local)await C.localOnly();
      const after=C.account();
      if(!after||!after.local){if(!after)A.toast('La copia local no está lista. Revisa Mi cuenta sin borrar tus datos.');return;}
      remember('local');hide();A.close('accountModal');
    }finally{busy=false;update();}
  }
  function close(){if(initial){useLocal();return;}hide();}
  function prepareRequest(event){
    const input=$('accessRequestEmail');input.value=input.value.trim();
    if(!input.checkValidity()||/[\r\n]/.test(input.value)){event.preventDefault();input.reportValidity();return;}
    const message='Hola, solicito validar mi acceso a MAUZI NOTE. Mi correo Google es: '+input.value+'. Gracias.';
    $('accessWhatsApp').href='https://wa.me/'+PHONE+'?text='+encodeURIComponent(message);
    const status=$('accessRequestStatus');status.hidden=false;
    status.textContent='En WhatsApp, revisa el mensaje y pulsa Enviar. Luego espera la confirmación del administrador. Esta pantalla no puede confirmar el envío ni la autorización.';
    // Never set an "approved" flag from this event or store the entered email.
  }
  function update(){
    const control=$('syncNowBtn'), auth=$('authMessage');
    const googleButton=$('accessConnectGoogle');
    googleButton.disabled=!ready||busy||!!control?.disabled;
    $('accessUseLocal').disabled=!ready||busy;
    $('accessContinueLocal').disabled=!ready||busy;
    const message=$('accessGoogleStatus');
    if(!ready)message.textContent='Preparando tu copia local…';
    else if(control?.disabled)message.textContent=control.textContent||'Preparando Google…';
    else if(auth?.textContent?.trim()){
      const error=auth.dataset.state==='error';
      message.textContent=auth.textContent;
      if(error&&/cancelado|deneg|denied|concedi/i.test(auth.textContent))message.textContent+=' Si tu acceso aún no fue autorizado, envía tu correo al administrador. Puedes continuar sin vincular.';
      message.dataset.state=error?'error':'info';
    }else{message.textContent='Solo continúa cuando el administrador haya confirmado tu correo.';message.dataset.state='info';}
  }
  function connect(){
    if($('accessConnectGoogle').disabled)return;
    if(!navigator.onLine){$('accessGoogleStatus').textContent='Necesitas internet para conectar Google. Puedes usar la app sin correo.';return;}
    waitingForGoogle=true;
    // Keep this on the click stack: Google's popup requires a direct user action.
    C.login({choose:!!C.account()&&!C.account().local});
    update();
  }
  $('accessUseLocal').addEventListener('click',useLocal);
  $('accessContinueLocal').addEventListener('click',useLocal);
  $('accessChooseGoogle').addEventListener('click',()=>show('validation',{first:initial}));
  $('accessGoBack').addEventListener('click',()=>show('choice',{first:initial}));
  $('accessClose').addEventListener('click',close);
  $('accessWhatsApp').addEventListener('click',prepareRequest);
  $('accessRequestForm').addEventListener('submit',e=>{e.preventDefault();$('accessWhatsApp').click();});
  $('accessConnectGoogle').addEventListener('click',connect);

  const block=document.createElement('section');block.className='access-account-block';
  block.innerHTML='<h3>Vinculación y validación de acceso</h3><p>Vincula tu correo para respaldar en tu Drive y recuperar lo sincronizado en otro dispositivo. Sin vincular, tus notas solo están aquí: conserva una copia independiente.</p><button id="accessAccountOptions" class="secondary-btn" type="button">Opciones de acceso y WhatsApp</button><small>Solicita al administrador la validación de tu correo antes de conectarlo por primera vez. No compartas contraseñas ni códigos.</small>';
  $('googleOptionalHint').after(block);
  $('accessAccountOptions').addEventListener('click',()=>show('choice'));
  // Gate only a first linkage. Known accounts keep their ordinary reconnect/sync
  // controls, without having to request WhatsApp validation again.
  document.addEventListener('click',e=>{
    const b=e.target.closest?.('#syncNowBtn,#loginBtn,#googleAccountBtn,#driveBackupBtn');
    if(!b||b.disabled||opened)return;
    const account=C.account();
    if(b.id==='googleAccountBtn'||!account||account.local){e.preventDefault();e.stopImmediatePropagation();show('validation');}
  },true);
  window.addEventListener('mauzi:cloud-state',e=>{
    if(waitingForGoogle&&e.detail?.authorized){remember('google');hide();A.open('accountModal');}
    update();
  });
  const observer=new MutationObserver(()=>{
    // Mutations concern only the existing account controls, not this overlay.
    update();
  });
  observer.observe($('syncNowBtn'),{attributes:true,childList:true,subtree:true,characterData:true});
  observer.observe($('authMessage'),{attributes:true,childList:true,subtree:true,characterData:true});
  root.addEventListener('keydown',e=>{
    if(e.key!=='Tab')return;
    const focusable=[...root.querySelectorAll('button,a,input')].filter(n=>!n.disabled&&!n.inert&&n.getClientRects().length);
    if(!focusable.length)return;
    const first=focusable[0],last=focusable.at(-1);
    if(e.shiftKey&&(document.activeElement===first||!focusable.includes(document.activeElement))){e.preventDefault();last.focus();}
    else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}
  });
  window.MauziAccess=Object.freeze({show,hide,isOpen:()=>opened,goBack:()=>stage==='validation'?show('choice',{first:initial}):close()});
  if(window.MauziWelcomeFirstRun)show('choice',{first:true});
  document.documentElement.classList.remove('mauzi-welcome-pending');
  Promise.resolve(C.ready).then(()=>{ready=!!C.account();update();}).catch(()=>{ready=false;update();});
})();
