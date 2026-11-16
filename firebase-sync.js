/* MAUZI NOTE 5.0 — Nube con FIREBASE (Firestore + inicio de sesión con Google).
   Reemplaza a drive-sync.js y conserva la MISMA interfaz window.MauziCloud.
   - La copia del dispositivo (IndexedDB) sigue siendo la fuente principal: se guarda
     primero aquí y después se envía a Firestore. Sin internet nada se pierde.
   - Cada cuenta escribe SOLO en users/{uid}/… (las reglas de Firestore lo exigen).
   - Sesión persistente de Firebase: no vence a los 7 días ni hay límite de 100 usuarios.
   - Cambios en tiempo real (onSnapshot): las notas llegan a los otros equipos al instante.
   - Notas grandes (con imágenes) se dividen en partes de ≤300 000 caracteres porque un
     documento de Firestore admite hasta 1 MiB.
   - No usa contraseñas ni claves secretas. La apiKey de Firebase es pública por diseño. */
(() => {
  'use strict';
  const A=window.MauziApp, $=id=>document.getElementById(id), ND=window.MauziNoteDeletionCore;
  if(!A)return;
  const CFG=window.MAUZI_FIREBASE_CONFIG||{};
  const configured=!!(CFG.apiKey&&CFG.authDomain&&CFG.projectId&&CFG.appId&&!/PEGAR|XXXX/i.test(CFG.apiKey));
  const SDK='https://www.gstatic.com/firebasejs/12.15.0/';
  const PROJECT=String(CFG.projectId||'sin-proyecto');
  const DB='mauzi-note-drive-v3';                      // misma base local de 4.x: conserva copias y modo sin cuenta
  const PREFIX='fb:'+PROJECT+':';
  const ACTIVE_KEY='mauzi-note:firebase-active:'+PROJECT;
  const GUEST_CHOICE='mauzi-note:guest-workspace';
  const DEVICE_EMAIL='copia@este-telefono.local';
  const ACTIVE_FALLBACK='mauzi-note:last-workspace';
  const REDIRECT_KEY='mauzi-note:firebase-redirect';
  const CHUNK=300000, HISTORY_KEEP=30, HISTORY_PRUNE_AT=45;
  const guestIcon='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/></svg>';
  const clone=v=>structuredClone(v),txt=(n,t)=>{if(n)n.textContent=t;};
  const id=()=>crypto.randomUUID?crypto.randomUUID():Date.now().toString(36)+'_'+Math.random().toString(36).slice(2);
  const validId=v=>typeof v==='string'&&/^[a-zA-Z0-9_-]{1,160}$/.test(v);
  const safeId=v=>validId(v)?v:id();
  const safeColor=(v,f)=>/^#[0-9a-f]{6}$/i.test(String(v||''))?v:f;
  const safeTime=v=>Number.isFinite(Number(v))&&Number(v)>0?Number(v):Date.now();
  const plainJSON=v=>JSON.parse(JSON.stringify(v));
  const channel='BroadcastChannel' in window?new BroadcastChannel('mauzi-note-drive-v3'):null;

  let storage=null,state=null,user=null,session=0,authPending=false,storageReady=false,fbLoading=false,transferSource='',transferBusy=false;
  let fb=null,fbReady=null,unsubs=[],notesChain=Promise.resolve(),notesLoaded=null,catsLoaded=null,loginInFlight=false,accessDenied='';
  let flushTimer=null,flushing=false,flushAgain=false,flushTask=null,cloudError='',flushDue=0,retryNotBefore=0,retryAttempt=0,cycleReason='inicio',localWarningShown=false,lastWake=0;
  let displayedBaseline={},displayedCategories=[],editorBase=new Map();
  const syncMetrics={lastStarted:0,lastFinished:0,lastDuration:0,received:0,sent:0,mode:'tiempo real',reason:''};

  const rawActivate=A.activate.bind(A);
  A.activate=(email,data)=>{displayedBaseline=Object.fromEntries((data.notes||[]).map(n=>[n.id,clone(n)]));displayedCategories=clone(data.categories||[]);rawActivate(email,data);};

  /* ---------- Datos limpios (idéntico a 4.9) ---------- */
  function cleanNote(n){
    if(!n||typeof n!=='object')throw new Error('La nota no tiene un formato válido.');
    if(ND.isPurged(n))return ND.tombstone(n.id,n.updatedAt);
    n=window.MauziMedia?.redactNote(n,state?.mediaRedactions)||n;
    const contentHtml=A.sanitize(typeof n.contentHtml==='string'?n.contentHtml:A.oldText(String(n.content||'')));
    const note={id:safeId(n.id),title:String(n.title||'').slice(0,90),content:A.plain(contentHtml),contentHtml,
      categoryId:safeId(n.categoryId||'important'),bgColor:safeColor(n.bgColor,'#080808'),
      createdAt:safeTime(n.createdAt),updatedAt:safeTime(n.updatedAt),deleted:n.deleted===true,...window.MauziArchiveCore.fields(n)};
    if(new TextEncoder().encode(JSON.stringify(note)).length>2000000)throw new Error('Esta nota supera 2 MB. Divídela antes de guardarla. El texto sigue en el editor.');
    return note;
  }
  function cleanCategories(items){
    const seen=new Set();
    return (Array.isArray(items)?items:[]).slice(0,200).filter(x=>x&&typeof x.name==='string').map(x=>({id:safeId(x.id),name:x.name.trim().slice(0,60),color:safeColor(x.color,'#c9a342')})).filter(x=>{if(!x.name||seen.has(x.id))return false;seen.add(x.id);return true;});
  }
  function sameNote(a,b){return !!a&&!!b&&JSON.stringify(cleanNote(a))===JSON.stringify(cleanNote(b));}
  function newWorkspace(uid,email,local=false){return {key:local?'local:'+email:PREFIX+uid,uid,email,local,backend:local?'':'firebase',
    notes:{},categories:A.defaults(),categoryRev:'',queue:[],events:{},seenFiles:{},localHistory:{},
    remoteCursor:0,lastSyncedAt:0,lastScanAt:0,createdAt:Date.now()};}

  /* ---------- Almacenamiento local (idéntico a 4.9) ---------- */
  function openStorage(){
    if(storage)return Promise.resolve(storage);
    return new Promise((resolve,reject)=>{
      const r=indexedDB.open(DB,1);
      r.onupgradeneeded=()=>r.result.createObjectStore('workspaces',{keyPath:'key'});
      r.onerror=()=>reject(new Error('El navegador bloqueó el almacenamiento. No cierres el editor: no se puede confirmar el guardado local.'));
      r.onblocked=()=>reject(new Error('Cierra otras ventanas de MAUZI NOTE para abrir el almacenamiento.'));
      r.onsuccess=()=>{storage=r.result;storage.onversionchange=()=>{storage.close();storage=null;};resolve(storage);};
    });
  }
  async function getWorkspace(key){const d=await openStorage();return new Promise((resolve,reject)=>{const r=d.transaction('workspaces').objectStore('workspaces').get(key);r.onsuccess=()=>resolve(r.result||null);r.onerror=()=>reject(r.error);});}
  async function allWorkspaces(){const d=await openStorage();return new Promise((resolve,reject)=>{const r=d.transaction('workspaces').objectStore('workspaces').getAll();r.onsuccess=()=>resolve(r.result||[]);r.onerror=()=>reject(r.error);});}
  async function putInitial(s){const d=await openStorage();return new Promise((resolve,reject)=>{const t=d.transaction('workspaces','readwrite'),o=t.objectStore('workspaces'),r=o.get(s.key);let result;r.onsuccess=()=>{result=r.result||s;if(!r.result)o.put(s);};t.oncomplete=()=>resolve(result);t.onerror=()=>reject(t.error);t.onabort=()=>reject(t.error||new Error('No se guardó el perfil.'));});}
  async function mutate(fn,{key=state?.key,render=true,notify=true}={}){
    if(!key)throw new Error('Primero abre tu cuenta o tu copia local.');
    const d=await openStorage();
    const result=await new Promise((resolve,reject)=>{
      const t=d.transaction('workspaces','readwrite'),o=t.objectStore('workspaces'),r=o.get(key);let next,reason;
      r.onsuccess=()=>{try{next=r.result;if(!next)throw new Error('No se encontró la copia local.');fn(next);ND.enforce(next);o.put(next);}catch(e){reason=e;t.abort();}};
      t.oncomplete=()=>resolve(next);t.onerror=()=>reject(reason||new Error('No hay espacio para guardar. Conserva el texto y exporta tus notas.'));
      t.onabort=()=>reject(reason||new Error('No se completó el guardado local. Tu texto sigue en el editor.'));
    });
    if(state?.key===key){state=result;if(render)applyState();refreshStatus();}
    if(notify)channel?.postMessage({key});return result;
  }
  const visibleNotes=(s=state)=>Object.values(s?.notes||{}).filter(n=>!n.deleted).map(cleanNote);
  function validToken(){return !!fb&&!!user&&!!state&&!state.local&&state.uid===user.uid;}
  function rememberActive(){
    if(!state)return;
    try{localStorage.setItem(ACTIVE_KEY,state.key);localStorage.setItem(ACTIVE_FALLBACK,state.key);
      if(state.local)localStorage.setItem(GUEST_CHOICE,state.key);}catch(_){}
  }
  function applyState(){
    if(!state)return;
    ND.enforce(state);
    A.activate(state.email,{notes:visibleNotes(),categories:state.categories});
    $('activeEmail').textContent=state.local?'Sin cuenta · En este dispositivo':state.email;
    $('activeAccountLabel').textContent=state.local?'Estás usando MAUZI NOTE sin cuenta':'Tu cuenta Google';
    $('accountCloudDescription').textContent=state.local?
      'Tus notas, imágenes, favoritos y agenda se guardan aquí. Conecta tu correo con Google cuando quieras tener una copia en la nube.':
      'Tus notas se sincronizan en la nube de MAUZI NOTE (Firebase), en un espacio privado de tu cuenta.';
    $('accountBtn').dataset.localProfile=String(!!state.local);
    if(state.local){$('accountBtn').innerHTML=guestIcon;$('welcomeName').textContent='Mis notas';}
    $('migrateLocalBtn').classList.toggle('hidden',state.local);
    $('driveFolderSection').classList.toggle('hidden',state.local);
    $('googleOptionalHint').classList.toggle('hidden',!state.local);
    $('logoutBtn').classList.toggle('hidden',state.local);
    $('mainApp').setAttribute('aria-busy','false');
    $('addNoteBtn').disabled=false;
    $('appBootNotice').classList.add('hidden');
    storageReady=true;refreshStatus();
  }
  function authMessage(message,error=false){
    txt($('authMessage'),message);$('authMessage').dataset.state=error?'error':'info';
  }
  function moduleAccount(){return state?{key:state.key,uid:state.uid,email:state.email,local:!!state.local,authorized:validToken()&&navigator.onLine,backend:'firebase',legacyKeys:clone(state.legacyKeys||[])}:null;}
  function moduleBridge(){const c=context();return {account:moduleAccount(),check:()=>assertContext(c),db:fb.db,fs:fb.f,uid:c.uid};}
  function refreshStatus(){
    let message='Abriendo la copia de este dispositivo…',kind='pending';
    if(state?.local){message='Guardado en este dispositivo. Conecta Google para tener respaldo en la nube.';kind='local';}
    else if(!configured)message='Falta la configuración de Firebase (firebase-config.js). La copia de tus notas sigue aquí.';
    else if(accessDenied){message=accessDenied;kind='error';}
    else if(cloudError){message=cloudError;kind='error';}
    else if(!state)kind='info';
    else if(!navigator.onLine)message=state.queue.length?'Sin internet · cambios pendientes de subir':'Sin internet · copia del dispositivo';
    else if(!validToken())message=state.queue.length?'Cambios pendientes · conecta Google para subirlos':'Conecta Google para sincronizar. Puedes seguir usando tus notas.';
    else if(ND.pending(state))message='Eliminación definitiva pendiente de confirmar en la nube';
    else if(state.mediaQueue?.length||state.mediaPurgePending)message='Eliminación de imagen pendiente de confirmar en la nube';
    else if(flushing||state.queue.length)message='Guardado en el dispositivo · sincronizando con la nube…';
    else if(state.lastScanAt){message='Guardado en la nube ✓';kind='synced';}
    else message='Conectando con la nube…';
    const account=$('accountBtn');
    if(account){
      let indicator='offline';
      if(cloudError||accessDenied)indicator='error';else if(authPending||fbLoading)indicator='syncing';
      else if(navigator.onLine&&validToken())indicator=flushing||state?.queue.length||ND.pending(state)?'syncing':state?.lastScanAt?'online':'syncing';
      account.dataset.driveState=indicator;
      account.setAttribute('aria-label','Mi cuenta y respaldo. '+(indicator==='online'?'Conectado a la nube':indicator==='syncing'?'Sincronizando':indicator==='error'?'Revisar sincronización':state?.local?'Sin cuenta':'Sin conexión activa a la nube'));
      account.title='Mi cuenta y respaldo';
    }
    txt($('accountSyncStatus'),message+(state?.lastSyncedAt?'\nÚltima confirmación: '+new Date(state.lastSyncedAt).toLocaleString('es-GT'):''));$('accountSyncStatus').dataset.state=kind;
    txt($('syncNowBtn'),authPending?'Termina la conexión en Google…':fbLoading?'Preparando la conexión…':validToken()?'Sincronizar ahora':state?.local?'Conectar mi correo con Google':'Conectar Google y sincronizar');
    $('syncNowBtn').disabled=!configured||!storageReady||authPending||fbLoading||transferBusy;
    $('googleAccountBtn').classList.toggle('hidden',!state||state.local);
    $('googleAccountBtn').disabled=!configured||authPending||fbLoading||transferBusy;
    $('migrateLocalBtn').disabled=authPending||transferBusy;
    $('logoutBtn').disabled=authPending||transferBusy;
    $('driveBackupBtn').disabled=!state||state.local||authPending||transferBusy;
    $('driveRestoreBtn').disabled=!state||state.local||authPending;
    const detail=syncState();
    if($('syncProgressDetails')){
      const fmt=t=>t?new Date(t).toLocaleTimeString('es-GT',{hour:'2-digit',minute:'2-digit',second:'2-digit'}):'Aún no confirmada';
      $('syncProgressDetails').textContent='Cuenta: '+(state?.local?'Sin cuenta Google':state?.email||'Sin cuenta')+'\nÚltima subida: '+fmt(state?.lastUploadAt)+'\nÚltima consulta a la nube: '+fmt(state?.lastCheckedAt)+'\nÚltimo cambio recibido: '+fmt(state?.lastDownloadAt)+'\nPendientes: '+(state?.queue.length||0)+(state?.mediaQueue?.length?' · eliminaciones de imagen pendientes':'');
      $('syncConnectionHelp').textContent=!state||state.local?'Sin Google, los cambios solo están en este dispositivo. Conecta la misma cuenta en PC y celular.':!navigator.onLine?'Sin internet. Se reintentará al volver la conexión.':!validToken()?'Toca Conectar Google. La sesión queda abierta en este dispositivo: no vence cada semana.':'Automático y en tiempo real: sube al guardar y recibe los cambios de tus otros equipos al instante.';
    }
    window.dispatchEvent(new CustomEvent('mauzi:sync-status',{detail}));
    window.dispatchEvent(new CustomEvent('mauzi:archive-status',{detail:archiveState()}));
    window.dispatchEvent(new CustomEvent('mauzi:cloud-state',{detail:moduleAccount()}));
  }
  function messageFor(e){
    const code=String(e?.code||'');
    if(code==='mauzi/not-validated')return e.message;
    if(code==='auth/popup-closed-by-user'||code==='auth/cancelled-popup-request')return 'Cerraste la ventana de Google. No se borró ninguna nota.';
    if(code==='auth/popup-blocked')return 'El navegador bloqueó la ventana de Google. Permite ventanas emergentes o abre la app en Chrome/Safari.';
    if(code==='auth/unauthorized-domain')return 'Este sitio aún no está autorizado en Firebase (Authentication → Configuración → Dominios autorizados).';
    if(code==='auth/operation-not-allowed')return 'En Firebase falta habilitar el acceso con Google (Authentication → Sign-in method).';
    if(code==='auth/network-request-failed'||code==='unavailable')return 'Sin conexión con la nube. Tus cambios siguen en este dispositivo y se reintentará.';
    if(code==='permission-denied')return 'La nube no autorizó esta operación. Revisa que las reglas de Firestore estén publicadas.';
    if(code==='resource-exhausted')return 'Se alcanzó el límite diario gratuito de la nube. Tus cambios se conservan aquí y se enviarán después.';
    if(code==='deadline-exceeded'||e?.name==='AbortError')return 'La conexión tardó demasiado. Las notas pendientes siguen en el dispositivo.';
    return e?.message||'No se confirmó el guardado en la nube. La copia local se conserva.';
  }
  const retryable=e=>['unavailable','deadline-exceeded','resource-exhausted','aborted','internal','auth/network-request-failed'].includes(String(e?.code||''))||e instanceof TypeError;

  /* ---------- Cola local (idéntico a 4.9) ---------- */
  function addOperation(s,n,baseRev){
    if(s.notePurges?.[n.id]&&!ND.isPurged(n))throw Error('Esta nota fue eliminada definitivamente. Copia el contenido en una nota nueva si deseas conservarlo.');
    n=window.MauziMedia?.redactNote(n,s.mediaRedactions)||n;
    const op={opId:id(),kind:'note',entityId:n.id,baseRev:baseRev||'',data:n,queuedAt:Date.now()};
    s.notes[n.id]={...n,rev:op.opId};
    if(s.local)(s.localHistory[n.id]||=[]).push({...n,rev:op.opId,serverAt:Date.now()});else s.queue.push(op);
  }
  function addCategories(s,cs){s.categories=cs;if(!s.local){const op={opId:id(),kind:'categories',entityId:'categories',baseRev:s.categoryRev||'',data:{categories:cs},queuedAt:Date.now()};s.categoryRev=op.opId;s.queue.push(op);}}
  async function save(){
    if(!state)throw new Error('Espera a que se abra tu copia antes de guardar.');
    const input=A.snapshot(),key=state.key,ns=input.notes.map(cleanNote),cs=cleanCategories(input.categories),before=clone(displayedBaseline);
    if(!cs.length)throw new Error('Debe quedar una categoría.');
    if(new Set(ns.map(n=>n.id)).size!==ns.length)throw new Error('Hay identificadores de notas repetidos. Exporta una copia antes de continuar.');
    await mutate(s=>{
      window.MauziMedia?.trackChanges(s,before,ns);
      const incoming=new Set(ns.map(n=>n.id));
      for(const n of ns){if(sameNote(before[n.id],n))continue;if(!before[n.id]&&sameNote(s.notes[n.id],n))continue;
        const base=editorBase.has(n.id)?editorBase.get(n.id):(s.notes[n.id]?.rev||'');addOperation(s,n,base);}
      for(const [nid,n] of Object.entries(before)){if(n.deleted||incoming.has(nid)||s.notes[nid]?.deleted)continue;addOperation(s,{...cleanNote(n),deleted:true,updatedAt:Date.now()},editorBase.get(nid)??s.notes[nid]?.rev??'');}
      if(JSON.stringify(cs)!==JSON.stringify(displayedCategories))addCategories(s,cs);
    },{key});editorBase.clear();scheduleFlush(250,'guardar');
    if(!state.local&&!validToken()&&!localWarningShown){localWarningShown=true;A.toast('Guardada aquí. Conecta Google en Mi cuenta para enviarla a tus otros equipos.');}
  }
  async function removeNote(nid,{permanent=false,accountKey}={}){
    if(!state||!validId(nid))throw Error('No se encontró la nota para eliminar.');
    const key=state.key;
    if(accountKey&&accountKey!==key)throw Error('La cuenta cambió. No se eliminó ninguna nota.');
    await mutate(s=>{
      const original=s.notes[nid];
      if(!original)throw Error('La nota ya no está disponible.');
      if(s.notePurges?.[nid])return;
      if(permanent){
        const n=ND.tombstone(nid,Date.now()),base=original.rev||'';
        s.queue=s.queue.filter(o=>o.kind!=='note'||o.entityId!==nid);
        addOperation(s,n,base);
        s.notePurges||={};s.notePurges[nid]={at:n.updatedAt,pending:!s.local,confirmed:false};
        ND.enforce(s);
      }else if(!original.deleted){addOperation(s,{...cleanNote(original),deleted:true,updatedAt:Date.now()},original.rev||'');}
    },{key});
    editorBase.delete(nid);scheduleFlush(0,'eliminar nota');
    return {local:!!state?.local,pending:!state?.local,permanent};
  }
  function deletionState(){return {pending:ND.pending(state),local:!!state?.local,lastCompleted:state?.lastDeleteCompleted||0};}

  /* ---------- Firebase ---------- */
  function withTimeout(p,ms,msg){let t;return Promise.race([p,new Promise((_,no)=>{t=setTimeout(()=>no(new Error(msg)),ms);})]).finally(()=>clearTimeout(t));}
  function loadFirebase(){
    if(fb)return Promise.resolve(fb);
    if(fbReady)return fbReady;
    fbReady=withTimeout((async()=>{
      const [appM,a,f]=await Promise.all([import(SDK+'firebase-app.js'),import(SDK+'firebase-auth.js'),import(SDK+'firebase-firestore.js')]);
      const app=appM.getApps().length?appM.getApp():appM.initializeApp(CFG);
      const auth=a.getAuth(app);auth.languageCode='es';
      let db;try{db=f.initializeFirestore(app,{ignoreUndefinedProperties:true});}catch(_){db=f.getFirestore(app);}
      fb={app,auth,db,a,f};
      a.onAuthStateChanged(auth,u=>{onAuthUser(u).catch(e=>{authMessage(messageFor(e),true);refreshStatus();});});
      let back=false;try{back=!!sessionStorage.getItem(REDIRECT_KEY);}catch(_){}
      if(back)setTimeout(()=>completeRedirect(),0);
      return fb;
    })(),25000,'La nube tardó en cargar. Revisa internet y vuelve a tocar Conectar.').catch(e=>{fbReady=null;throw e;});
    return fbReady;
  }
  function prepareConnection(){
    if(!configured||fb||fbLoading||!navigator.onLine||location.protocol==='file:')return;
    fbLoading=true;refreshStatus();
    loadFirebase().then(()=>{if($('authMessage').dataset.state==='error')authMessage('');}).catch(e=>authMessage(messageFor(e),true)).finally(()=>{fbLoading=false;refreshStatus();});
  }
  const userDoc=uid=>fb.f.doc(fb.db,'users',uid);
  const noteRef=(uid,nid)=>fb.f.doc(fb.db,'users',uid,'notes',nid);
  const metaRef=(uid,name)=>fb.f.doc(fb.db,'users',uid,'meta',name);
  const partRef=(ref,i)=>fb.f.doc(ref,'parts','p'+i);

  /* Comprueba que la nube acepta la cuenta (las reglas solo dejan a cada uno su propio users/{uid}). */
  async function verifyAccess(u){
    if(!u.email||u.emailVerified!==true)throw Object.assign(new Error('Google debe devolver un correo verificado.'),{code:'mauzi/not-validated'});
    try{await withTimeout(fb.f.getDoc(userDoc(u.uid)),20000,'La nube no respondió. Revisa internet.');}
    catch(e){
      if(e.code==='permission-denied'){
        throw Object.assign(new Error('La nube rechazó la cuenta '+u.email+'. Revisa que las reglas de Firestore estén publicadas. Puedes seguir usando la app sin cuenta.'),{code:'mauzi/not-validated'});
      }
      throw e;
    }
  }
  async function onAuthUser(u){
    if(loginInFlight)return;
    if(!u){if(user){clearConnection();refreshStatus();}return;}
    // Restaurar en silencio la sesión guardada por Firebase si coincide con la cuenta abierta.
    if(state&&!state.local&&state.uid===u.uid&&!user){
      try{await verifyAccess(u);accessDenied='';attach(u);}
      catch(e){if(e.code==='mauzi/not-validated'){accessDenied=e.message;await fb.a.signOut(fb.auth).catch(()=>{});}authMessage(messageFor(e),true);refreshStatus();}
    }
  }
  function attach(u){
    user={uid:u.uid,email:String(u.email||'').toLowerCase()};
    startListeners();scheduleFlush(0,'conectar');refreshStatus();
    fb.f.setDoc(userDoc(u.uid),{email:user.email,lastSeen:fb.f.serverTimestamp(),app:'MAUZI NOTE 5.0'},{merge:true}).catch(()=>{});
  }
  function context(){if(!validToken())throw new Error('Toca Conectar Google para sincronizar.');return {uid:user.uid,key:state.key,session};}
  function assertContext(c){if(c.session!==session||c.uid!==user?.uid||c.key!==state?.key)throw new Error('La cuenta cambió; la operación quedó pendiente en su cuenta original.');}

  /* ---------- Codificación de notas para Firestore ---------- */
  function hashNote(n){const x={...n};delete x.content;delete x.rev;delete x.serverAt;delete x.conflict;return window.MauziMedia.hash(JSON.stringify(x));}
  function encode(n){
    const data=plainJSON(n);delete data.content;delete data.rev;delete data.serverAt;delete data.conflict;
    const html=String(data.contentHtml||''),chunks=[];
    if(html.length>CHUNK){for(let i=0;i<html.length;i+=CHUNK)chunks.push(html.slice(i,i+CHUNK));data.contentHtml='';}
    return {data,chunks,hash:hashNote(n)};
  }
  async function decode(ref,raw){
    const data={...(raw.data||{})};
    if(raw.parts>0){
      const snap=await fb.f.getDocs(fb.f.collection(ref,'parts'));
      const rows=snap.docs.map(d=>d.data()).filter(p=>p.rev===raw.rev).sort((a,b)=>a.i-b.i);
      if(rows.length!==raw.parts)return null; // llegó una versión más nueva mientras se leía: se ignora
      data.contentHtml=rows.map(p=>String(p.html||'')).join('');
    }
    return cleanNote(data);
  }
  function setChunks(tx,ref,rev,chunks,oldCount=0){
    chunks.forEach((html,i)=>tx.set(partRef(ref,i),{rev,i,html}));
    for(let i=chunks.length;i<oldCount;i++)tx.delete(partRef(ref,i));
  }

  /* ---------- Recepción en tiempo real ---------- */
  function stopListeners(){for(const u of unsubs){try{u();}catch(_){}}unsubs=[];}
  function startListeners(){
    stopListeners();const c=context(),f=fb.f;
    let resolveNotes,resolveCats;notesLoaded=new Promise(r=>resolveNotes=r);catsLoaded=new Promise(r=>resolveCats=r);
    const since=Math.max(0,(state.remoteCursor||0)-300000);
    const q=f.query(f.collection(fb.db,'users',c.uid,'notes'),f.where('syncAt','>',f.Timestamp.fromMillis(since)));
    unsubs.push(f.onSnapshot(q,snap=>{
      const changes=snap.docChanges().filter(x=>x.type!=='removed'&&!x.doc.metadata.hasPendingWrites);
      notesChain=notesChain.then(()=>receiveNotes(changes,c)).catch(e=>{if(c.session===session){cloudError=messageFor(e);refreshStatus();}}).finally(resolveNotes);
    },e=>listenError(e,c,resolveNotes)));
    unsubs.push(f.onSnapshot(metaRef(c.uid,'categories'),snap=>{
      receiveCategories(snap,c).catch(e=>{cloudError=messageFor(e);refreshStatus();}).finally(resolveCats);
    },e=>listenError(e,c,resolveCats)));
    unsubs.push(f.onSnapshot(metaRef(c.uid,'media'),snap=>{receiveMedia(snap,c).catch(()=>{});},e=>listenError(e,c)));
  }
  function listenError(e,c,done){
    done?.();if(c.session!==session)return;
    cloudError=messageFor(e);
    if(e.code==='permission-denied'){accessDenied=cloudError;stopListeners();}
    else setTimeout(()=>{if(c.session===session&&validToken()){cloudError='';startListeners();}},15000);
    refreshStatus();
  }
  async function receiveNotes(changes,c){
    assertContext(c);
    const items=[];
    for(const ch of changes){
      const raw=ch.doc.data(),nid=ch.doc.id;
      if(raw.owner&&raw.owner!==c.uid)continue;
      const note=await decode(ch.doc.ref,raw);if(!note||note.id!==nid)continue;
      items.push({note,rev:String(raw.rev||''),serverAt:raw.syncAt?.toMillis?.()||Date.now(),conflict:!!raw.conflict,purged:!!raw.purged||ND.isPurged(note)});
    }
    assertContext(c);
    await mutate(s=>{
      for(const it of items){
        const nid=it.note.id;
        if(it.purged){
          s.notePurges||={};
          if(!s.notePurges[nid])s.notePurges[nid]={at:it.note.updatedAt,pending:false,confirmed:true,finishedAt:Date.now(),opId:it.rev};
          else s.notePurges[nid].confirmed=true;
          s.queue=s.queue.filter(o=>o.kind!=='note'||o.entityId!==nid||ND.isPurged(o.data));
          continue;
        }
        if(s.notePurges?.[nid])continue;
        const hk='note:'+nid,hist=(s.localHistory[hk]||=[]);
        if(!hist.some(h=>h.rev===it.rev)){hist.push({...it.note,rev:it.rev,serverAt:it.serverAt,conflict:it.conflict});if(hist.length>HISTORY_KEEP)hist.splice(0,hist.length-HISTORY_KEEP);}
        if(s.queue.some(o=>o.kind==='note'&&o.entityId===nid))continue; // hay cambios locales sin enviar: no se pisan
        if(s.notes[nid]?.rev!==it.rev)s.notes[nid]={...it.note,rev:it.rev,serverAt:it.serverAt,conflict:it.conflict};
        else if(s.notes[nid])s.notes[nid].conflict=it.conflict;
      }
      for(const it of items)s.remoteCursor=Math.max(s.remoteCursor||0,it.serverAt);
      window.MauziMedia?.scrub(s);
      s.lastCheckedAt=Date.now();if(items.length)s.lastDownloadAt=Date.now();
      if(!s.queue.length&&!ND.pending(s))s.lastSyncedAt=Date.now();
    },{key:c.key,render:items.length>0});
    syncMetrics.received+=items.length;
    if(Object.values(state?.notes||{}).some(n=>n.conflict&&!n.deleted))txt($('driveStatus'),'Hubo ediciones simultáneas desde dos equipos. Se conservan ambas: abre la nota → Historial.');
  }
  async function receiveCategories(snap,c){
    assertContext(c);if(!snap.exists())return;
    const raw=snap.data(),cs=cleanCategories(raw.categories);if(!cs.length)return;
    await mutate(s=>{
      if(s.queue.some(o=>o.kind==='categories'))return;
      if(s.categoryRev===raw.rev)return;
      s.categories=cs;s.categoryRev=String(raw.rev||'');
    },{key:c.key});
  }
  async function receiveMedia(snap,c){
    assertContext(c);if(!snap.exists()||!window.MauziMedia)return;
    const rules=snap.data().rules||{};
    await mutate(s=>{for(const [nid,hashes]of Object.entries(rules)){if(validId(nid)&&Array.isArray(hashes))window.MauziMedia.merge(s,nid,hashes.filter(h=>/^[a-f0-9]{64}$/.test(h)));}window.MauziMedia.scrub(s);},{key:c.key});
  }

  /* ---------- Envío ---------- */
  async function commitNote(op,c){
    const f=fb.f,ref=noteRef(c.uid,op.entityId),purged=ND.isPurged(op.data),enc=encode(op.data);
    return f.runTransaction(fb.db,async tx=>{
      const snap=await tx.get(ref),cur=snap.exists()?snap.data():null;
      if(cur?.rev===op.opId)return {done:true};
      if(cur?.purged&&!purged)return {remotePurged:true};
      if(cur&&!purged&&cur.rev!==op.baseRev&&cur.hash===enc.hash)return {adopt:cur.rev};   // mismo contenido: no se duplica
      const conflict=!!cur&&!purged&&cur.rev!==op.baseRev&&!cur.purged;
      setChunks(tx,ref,op.opId,enc.chunks,cur?.parts||0);
      const head={owner:c.uid,kind:'note',rev:op.opId,baseRev:op.baseRev||'',data:enc.data,parts:enc.chunks.length,hash:enc.hash,purged,conflict,clientAt:op.queuedAt,syncAt:f.serverTimestamp()};
      tx.set(ref,head);
      if(!purged){const v=f.doc(ref,'versions',op.opId);tx.set(v,head);setChunks(tx,v,op.opId,enc.chunks,0);}
      return {written:true,conflict};
    });
  }
  async function commitCategories(op,c){
    const f=fb.f,ref=metaRef(c.uid,'categories');
    return f.runTransaction(fb.db,async tx=>{
      const snap=await tx.get(ref),cur=snap.exists()?snap.data():null;
      if(cur?.rev===op.opId)return {categories:op.data.categories};
      let cs=clone(op.data.categories);
      // Si otro equipo agregó categorías al mismo tiempo, se conservan las de ambos.
      if(cur&&cur.rev!==op.baseRev)for(const cat of cleanCategories(cur.categories))if(!cs.some(x=>x.id===cat.id))cs.push(cat);
      tx.set(ref,{owner:c.uid,rev:op.opId,categories:cs,syncAt:f.serverTimestamp()});
      return {categories:cs};
    });
  }
  async function deleteVersionDocs(ref,c,{keep=0}={}){
    const f=fb.f,col=f.collection(ref,'versions');
    const snap=await f.getDocs(f.query(col,f.orderBy('clientAt','desc')));
    const victims=snap.docs.slice(keep);
    for(let i=0;i<victims.length;i+=40){
      assertContext(c);const batch=f.writeBatch(fb.db);
      for(const d of victims.slice(i,i+40)){const n=d.data().parts||0;for(let p=0;p<n;p++)batch.delete(partRef(d.ref,p));batch.delete(d.ref);}
      await batch.commit();
    }
    return victims.length;
  }
  async function syncMedia(c){
    const MM=window.MauziMedia;if(!MM)return;
    for(;;){
      const fresh=await getWorkspace(c.key);assertContext(c);const op=fresh.mediaQueue?.[0];if(!op)break;
      const f=fb.f,ref=metaRef(c.uid,'media');
      await f.runTransaction(fb.db,async tx=>{const snap=await tx.get(ref),rules=snap.exists()?{...(snap.data().rules||{})}:{};rules[op.noteId]=[...new Set([...(rules[op.noteId]||[]),...op.hashes])];tx.set(ref,{owner:c.uid,rules,syncAt:f.serverTimestamp()});});
      // Quitar la imagen también de las versiones anteriores de ESA nota.
      const rulesNow=(await getWorkspace(c.key)).mediaRedactions||{};
      const vs=await f.getDocs(f.collection(noteRef(c.uid,op.noteId),'versions'));
      for(const d of vs.docs){
        assertContext(c);const raw=d.data(),note=await decode(d.ref,raw);if(!note)continue;
        const clean=MM.redactNote(note,rulesNow);if(clean===note)continue;
        const enc=encode(clean);
        await f.runTransaction(fb.db,async tx=>{setChunks(tx,d.ref,raw.rev,enc.chunks,raw.parts||0);tx.set(d.ref,{...raw,data:enc.data,parts:enc.chunks.length,hash:enc.hash});});
      }
      await mutate(s=>{s.mediaQueue=(s.mediaQueue||[]).filter(x=>x.id!==op.id);s.mediaPurgePending=!!s.mediaQueue.length;MM.scrub(s);},{key:c.key,render:false});
    }
    const fresh=await getWorkspace(c.key);if(fresh.mediaPurgePending&&!fresh.mediaQueue?.length)await mutate(s=>{s.mediaPurgePending=false;},{key:c.key,render:false});
  }
  async function purgeDeletedNotes(c){
    const fresh=await getWorkspace(c.key);assertContext(c);
    const jobs=Object.entries(fresh.notePurges||{}).filter(([,j])=>j.confirmed&&j.pending);
    for(const [nid]of jobs){
      await deleteVersionDocs(noteRef(c.uid,nid),c);
      await mutate(s=>{const j=s.notePurges?.[nid];if(j){j.pending=false;j.finishedAt=Date.now();s.lastDeleteCompleted=Date.now();}},{key:c.key,render:false});
    }
  }
  function syncState(){return {deletePending:ND.pending(state),lastDeleteCompleted:state?.lastDeleteCompleted||0,ready:storageReady,authPending,googleLoading:fbLoading,transferBusy,mediaPending:(state?.mediaQueue?.length||0)+(state?.mediaPurgePending?1:0),authorized:validToken()&&navigator.onLine,requiresConnection:!!state&&!state.local&&!validToken(),local:!!state?.local,email:state?.email||'',pending:state?.queue.length||0,busy:flushing,error:cloudError||accessDenied,pollSeconds:0,lastCheckedAt:state?.lastCheckedAt||0,lastUploadAt:state?.lastUploadAt||0,lastDownloadAt:state?.lastDownloadAt||0,backend:'firebase',...syncMetrics};}
  function scheduleFlush(delay=250,reason='cambio'){
    if(!state||state.local)return;
    const now=Date.now(),due=Math.max(now+Math.max(0,delay),retryNotBefore);
    if(flushTimer&&flushDue<=due)return;
    clearTimeout(flushTimer);flushDue=due;cycleReason=reason;
    flushTimer=setTimeout(()=>{flushTimer=null;flushDue=0;flush().catch(e=>{cloudError=messageFor(e);refreshStatus();});},Math.max(0,due-now));
  }
  function flush(){
    if(flushTask){flushAgain=true;return flushTask;}
    if(Date.now()<retryNotBefore){scheduleFlush(retryNotBefore-Date.now(),'reintento');return Promise.resolve();}
    const run=()=>performFlush();
    flushTask=(navigator.locks&&state?navigator.locks.request('mauzi-firebase-sync:'+state.key,{ifAvailable:true},lock=>lock?run():undefined):run()).finally(()=>{flushTask=null;});
    return flushTask;
  }
  async function performFlush(){
    if(flushing){flushAgain=true;return;}
    if(!state||state.local||!navigator.onLine||!validToken()){refreshStatus();return;}
    flushing=true;cloudError='';const c=context();
    Object.assign(syncMetrics,{lastStarted:Date.now(),sent:0,reason:cycleReason});refreshStatus();
    try{
      // Antes del primer envío se recibe lo que ya existe (eliminaciones y categorías incluidas).
      await withTimeout(Promise.all([notesLoaded,catsLoaded]),30000,'La nube tarda en responder. Se reintentará.');assertContext(c);
      let fresh=await getWorkspace(c.key);
      if(!fresh.categoryRev&&!fresh.queue.some(o=>o.kind==='categories'))await mutate(s=>addCategories(s,s.categories),{key:c.key,render:false});
      await syncMedia(c);
      for(;;){
        fresh=await getWorkspace(c.key);assertContext(c);const op=fresh.queue[0];if(!op)break;
        if(op.kind==='note'){
          const r=await commitNote(op,c);assertContext(c);
          await mutate(s=>{
            s.queue=s.queue.filter(x=>x.opId!==op.opId);
            const nid=op.entityId,later=s.queue.some(x=>x.kind==='note'&&x.entityId===nid);
            if(r.remotePurged){s.notePurges||={};s.notePurges[nid]||={at:Date.now(),pending:false,confirmed:true,finishedAt:Date.now()};return;}
            if(r.adopt){for(const x of s.queue)if(x.kind==='note'&&x.entityId===nid&&x.baseRev===op.opId)x.baseRev=r.adopt;if(!later&&s.notes[nid])s.notes[nid].rev=r.adopt;return;}
            if(ND.isPurged(op.data)){const j=(s.notePurges||={})[nid]||={at:op.data.updatedAt,pending:true};j.confirmed=true;j.pending=true;return;}
            const hk='note:'+nid,hist=(s.localHistory[hk]||=[]);
            if(!hist.some(h=>h.rev===op.opId))hist.push({...op.data,rev:op.opId,serverAt:Date.now(),conflict:!!r.conflict});
            if(hist.length>HISTORY_KEEP)hist.splice(0,hist.length-HISTORY_KEEP);
            if(!later&&s.notes[nid]?.rev===op.opId)s.notes[nid].conflict=!!r.conflict;
            s.lastUploadAt=Date.now();
          },{key:c.key,render:!!r.adopt||!!r.remotePurged});
          if(r.written&&!ND.isPurged(op.data)&&(state.localHistory['note:'+op.entityId]||[]).length>=HISTORY_PRUNE_AT-HISTORY_KEEP&&Math.random()<0.15)
            deleteVersionDocs(noteRef(c.uid,op.entityId),c,{keep:HISTORY_KEEP}).catch(()=>{});
        }else{
          const r=await commitCategories(op,c);assertContext(c);
          await mutate(s=>{s.queue=s.queue.filter(x=>x.opId!==op.opId);if(!s.queue.some(x=>x.kind==='categories')){s.categories=cleanCategories(r.categories);s.categoryRev=op.opId;}s.lastUploadAt=Date.now();},{key:c.key});
        }
        syncMetrics.sent++;
      }
      await purgeDeletedNotes(c);
      await mutate(s=>{s.lastCheckedAt=Date.now();s.lastScanAt=Date.now();if(!s.queue.length&&!s.mediaQueue?.length&&!s.mediaPurgePending&&!ND.pending(s))s.lastSyncedAt=Date.now();},{key:c.key,render:false,notify:false});
      cloudError='';retryAttempt=0;retryNotBefore=0;
      window.MauziModules?.sync();
    }catch(e){if(c.session===session){
      cloudError=messageFor(e);
      if(e.code==='permission-denied'){accessDenied=cloudError;}
      else if(retryable(e)||/tarda/.test(e.message||'')){
        retryAttempt++;const delay=Math.min(60000,2000*2**Math.min(retryAttempt-1,5))+Math.floor(Math.random()*500);
        retryNotBefore=Date.now()+delay;scheduleFlush(delay,'reintento');
      }
    }}finally{
      flushing=false;syncMetrics.lastFinished=Date.now();syncMetrics.lastDuration=syncMetrics.lastFinished-syncMetrics.lastStarted;refreshStatus();
      if(flushAgain){flushAgain=false;scheduleFlush(250,'cambios pendientes');}
    }
  }

  /* ---------- Cuenta ---------- */
  function clearConnection(){stopListeners();session++;user=null;retryNotBefore=0;retryAttempt=0;localWarningShown=false;clearTimeout(flushTimer);flushTimer=null;flushDue=0;cloudError='';notesLoaded=catsLoaded=null;}
  /* Las notas de la versión 4.x (Drive) que siguen en este dispositivo con el MISMO correo
     se pasan una sola vez a la cuenta de Firebase. La copia original no se borra. */
  async function adoptLegacy(key,email){
    const fresh=await getWorkspace(key);if(!fresh||fresh.legacyChecked)return 0;
    const olds=(await allWorkspaces()).filter(w=>!w.local&&w.key!==key&&!String(w.key).startsWith('fb:')&&String(w.email||'').toLowerCase()===email);
    let count=0;
    await mutate(s=>{
      s.legacyChecked=true;s.legacyKeys=olds.map(w=>w.key);
      for(const w of olds){
        for(const [nid,j]of Object.entries(w.notePurges||{})){(s.notePurges||={})[nid]||={at:j.at||Date.now(),pending:false,confirmed:false};}
        for(const n of Object.values(w.notes||{})){
          if(ND.isPurged(n)||s.notePurges?.[n.id]||s.notes[n.id])continue;
          let clean;try{clean=cleanNote(n);}catch(_){continue;}
          addOperation(s,clean,'');count++;
          const hist=w.localHistory?.['note:'+n.id];if(hist?.length)s.localHistory['note:'+n.id]=hist.slice(-HISTORY_KEEP);
        }
        for(const op of w.queue||[])if(op.kind==='note'&&!ND.isPurged(op.data)&&!s.notePurges?.[op.entityId]){try{addOperation(s,cleanNote(op.data),'');count++;}catch(_){}}
        const cats=cleanCategories(w.categories);
        if(cats.length){const merged=clone(s.categories);for(const cat of cats)if(!merged.some(x=>x.id===cat.id))merged.push(cat);if(JSON.stringify(merged)!==JSON.stringify(s.categories))addCategories(s,merged);}
        if(w.mediaRedactions)for(const [nid,h]of Object.entries(w.mediaRedactions))window.MauziMedia?.merge(s,nid,h);
      }
    },{key,render:false});
    return count;
  }
  function login({choose=false}={}){
    if(authPending)return;
    if(!configured){authMessage('Falta la configuración de Firebase en firebase-config.js. Puedes seguir usando tus notas sin cuenta.',true);return;}
    if(location.protocol==='file:'){A.toast('Abre la dirección HTTPS publicada en GitHub Pages, no el archivo local.');return;}
    if(!navigator.onLine){A.toast('Necesitas internet para verificar Google. La copia del dispositivo sigue disponible.');return;}
    if(!$('noteModal').classList.contains('hidden')){A.toast('Guarda y cierra la nota antes de conectar o cambiar de cuenta.');return;}
    if(!fb){prepareConnection();A.toast('Preparando la conexión. Vuelve a tocar en un momento.');return;}
    if(choose&&(state?.queue.length||ND.pending(state))&&!confirm('Hay cambios pendientes en esta cuenta. Se conservarán en este dispositivo y se enviarán cuando vuelvas a abrirla. ¿Cambiar de cuenta?'))return;
    if(!storageReady||!state||transferBusy)return;
    const sourceLocal=state.local?state.key:'';
    authPending=true;loginInFlight=true;accessDenied='';refreshStatus();$('loginBtn').disabled=true;
    const finish=()=>{authPending=false;loginInFlight=false;$('loginBtn').disabled=false;refreshStatus();};
    const provider=new fb.a.GoogleAuthProvider();provider.setCustomParameters({prompt:'select_account'});
    // Debe ejecutarse dentro del toque del usuario: sin await antes de abrir la ventana.
    fb.a.signInWithPopup(fb.auth,provider).then(cred=>finishLogin(cred.user,sourceLocal)).catch(async e=>{
      // Igual que la app del maratón: si el navegador bloquea la ventana, se entra por redirección.
      if(/popup-blocked|operation-not-supported|web-storage/i.test(String(e.code||''))){
        try{sessionStorage.setItem(REDIRECT_KEY,JSON.stringify({sourceLocal,at:Date.now()}));}catch(_){}
        authMessage('Abriendo Google en esta misma página…');
        await fb.a.signInWithRedirect(fb.auth,provider);return;
      }
      throw e;
    }).catch(async e=>{
      if(e.code==='mauzi/not-validated'){accessDenied='';await fb.a.signOut(fb.auth).catch(()=>{});}
      authMessage(messageFor(e),true);if(e.code!=='auth/popup-closed-by-user'&&e.code!=='auth/cancelled-popup-request')A.toast(messageFor(e));
    }).finally(finish);
  }
  async function finishLogin(u,sourceLocal){
      if(!$('noteModal').classList.contains('hidden'))throw new Error('Guarda y cierra la nota antes de terminar la conexión con Google.');
      await verifyAccess(u);
      clearConnection();
      const email=String(u.email).toLowerCase();
      state=await putInitial(newWorkspace(u.uid,email));editorBase.clear();
      const adopted=await adoptLegacy(state.key,email);state=await getWorkspace(state.key);
      rememberActive();applyState();attach(u);
      authMessage(adopted?'Cuenta verificada. Pasando '+adopted+' notas de la versión anterior a la nube…':'Cuenta verificada. Sincronizando tus notas…');
      try{localStorage.setItem('mauzi-note:access-choice-v1','google');}catch(_){}
      transferSource='';$('guestTransferPanel').classList.add('hidden');
      if(sourceLocal)await offerGuestTransfer(sourceLocal);
  }
  /* Vuelta de una entrada por redirección (cuando el navegador bloqueó la ventana de Google). */
  async function completeRedirect(){
    let pending=null;try{pending=JSON.parse(sessionStorage.getItem(REDIRECT_KEY)||'null');sessionStorage.removeItem(REDIRECT_KEY);}catch(_){}
    if(!pending)return;
    loginInFlight=true;authPending=true;refreshStatus();
    try{
      await window.MauziCloud.ready;
      const res=await fb.a.getRedirectResult(fb.auth);const u=res?.user||fb.auth.currentUser;
      if(!u)throw Object.assign(new Error('No se completó la entrada con Google.'),{code:'auth/popup-closed-by-user'});
      await finishLogin(u,pending.sourceLocal&&(await getWorkspace(pending.sourceLocal))?.local?pending.sourceLocal:'');
    }catch(e){
      if(e.code==='mauzi/not-validated')await fb.a.signOut(fb.auth).catch(()=>{});
      authMessage(messageFor(e),true);
    }finally{loginInFlight=false;authPending=false;$('loginBtn').disabled=false;refreshStatus();}
  }
  async function enterLocal(){
    let key='';try{key=localStorage.getItem(GUEST_CHOICE)||'';}catch(_){}
    let cached=key?await getWorkspace(key):null;
    if(cached&&!cached.local)cached=null;
    if(!cached){
      const legacyEmail=A.legacyEmail()||DEVICE_EMAIL;
      cached=await getWorkspace('local:'+legacyEmail);
      if(!cached){
        const s=newWorkspace('local',legacyEmail,true),legacy=A.legacy(legacyEmail);
        for(const item of legacy.notes||[]){const n=cleanNote(item);s.notes[n.id]={...n,rev:''};}
        s.categories=cleanCategories(legacy.categories);if(!s.categories.length)s.categories=A.defaults();
        cached=await putInitial(s);
      }
    }
    state=cached;editorBase.clear();transferSource='';$('guestTransferPanel').classList.add('hidden');
    rememberActive();applyState();authMessage('');return state;
  }
  async function logout(){
    if(authPending||transferBusy){A.toast('Termina la operación antes de salir.');return;}
    if(!$('noteModal').classList.contains('hidden')){A.toast('Guarda la nota antes de salir.');return;}
    if((state?.queue.length||ND.pending(state))&&!confirm('Hay cambios que todavía no llegaron a la nube. Se conservarán en la cuenta de este dispositivo. ¿Salir de Google y abrir las notas sin cuenta?'))return;
    clearConnection();accessDenied='';
    if(fb)await fb.a.signOut(fb.auth).catch(()=>{});
    state=null;editorBase.clear();A.closeSession();
    try{await enterLocal();A.toast('Ahora usas MAUZI NOTE sin cuenta. Las notas de tu cuenta siguen guardadas en la nube.');}
    catch(e){authMessage(messageFor(e),true);}
  }
  async function localOnly(){
    if(state&&!state.local){await logout();return;}
    try{await enterLocal();}catch(e){authMessage(messageFor(e),true);}
  }

  /* ---------- Traspaso, importación, papelera e historial (como 4.9) ---------- */
  async function localPayload(key){
    const source=await getWorkspace(key);if(!source?.local)return null;
    const modules=await window.MauziModules?.exportForKey?.(source.key);
    return {email:source.email,notes:visibleNotes(source),trash:Object.values(source.notes||{}).filter(n=>n.deleted&&!ND.isPurged(n)).map(cleanNote),categories:clone(source.categories),modules:modules||null};
  }
  async function offerGuestTransfer(sourceKey){
    const destination=state?.key;const payload=await localPayload(sourceKey);
    if(state?.key!==destination||!payload)return;
    const records=payload.modules?.records?.filter(r=>!r.deleted&&r.kind!=='settings')||[];
    if(!payload.notes.length&&!payload.trash.length&&!records.length)return;
    transferSource=sourceKey;
    $('guestTransferDescription').textContent='Conectaste '+state.email+'. Tienes notas o favoritos/actividades guardados sin cuenta. ¿Quieres añadirlos a tu cuenta en la nube? La copia original del dispositivo se conserva.';
    $('guestTransferStatus').textContent='';$('guestTransferPanel').classList.remove('hidden');
    A.open('accountModal');
  }
  async function transferGuest(){
    if(transferBusy||!transferSource||!state||state.local)return;
    const key=state.key,sourceKey=transferSource;
    if(!validToken()){authMessage('Conecta Google primero para elegir la cuenta de destino.',true);return;}
    transferBusy=true;$('transferGuestBtn').disabled=true;$('skipGuestTransferBtn').disabled=true;refreshStatus();
    try{
      $('guestTransferStatus').textContent='Recuperando primero lo que ya está guardado en la nube…';
      await flush();if(state?.key!==key)throw new Error('La cuenta cambió. La copia local se conserva.');
      if(cloudError)throw new Error(cloudError);
      const payload=await localPayload(sourceKey);if(!payload)throw new Error('No se encontró esa copia local.');
      if(state?.key!==key)throw new Error('La cuenta cambió.');
      await window.MauziCloud.importPayload(payload);
      if(state?.key!==key)throw new Error('La cuenta cambió; revisa tus copias.');
      transferSource='';$('guestTransferPanel').classList.add('hidden');
      authMessage('Añadidas a esta cuenta. Espera «Guardado en la nube ✓» antes de cambiar de dispositivo.');
      scheduleFlush(0);window.MauziModules?.sync();
    }catch(e){$('guestTransferStatus').textContent=messageFor(e);}
    finally{transferBusy=false;$('transferGuestBtn').disabled=false;$('skipGuestTransferBtn').disabled=false;refreshStatus();}
  }
  async function importPayload(data){
    if(!state)throw new Error('Abre una cuenta primero.');
    if(!Array.isArray(data?.notes)||!Array.isArray(data.categories))throw new Error('El respaldo no tiene el formato esperado.');
    const ns=[...data.notes,...(data.trash||[])].map(cleanNote),cs=cleanCategories(data.categories),idMap={};
    if(ns.length>10000)throw new Error('La copia contiene demasiadas notas para importarla de una sola vez.');
    await mutate(s=>{
      const cats=clone(s.categories),mapping=new Map();for(const cat of cs){const eq=cats.find(c=>c.name===cat.name&&c.color===cat.color);if(eq){mapping.set(cat.id,eq.id);continue;}const old=cat.id;if(cats.some(c=>c.id===cat.id))cat.id=id();mapping.set(old,cat.id);cats.push(cat);}
      if(cats.length>200)throw new Error('La copia contiene demasiadas categorías.');if(JSON.stringify(cats)!==JSON.stringify(s.categories))addCategories(s,cats);
      for(const n of ns){const original=n.id;if(ND.isPurged(n))continue;if(s.notePurges?.[n.id])n.id=id();n.categoryId=mapping.get(n.categoryId)||s.categories[0].id;const same=Object.values(s.notes).find(x=>x.title===n.title&&x.contentHtml===n.contentHtml&&x.bgColor===n.bgColor&&x.deleted===n.deleted&&JSON.stringify(window.MauziArchiveCore.location(x))===JSON.stringify(window.MauziArchiveCore.location(n)));if(same){idMap[original]=same.id;continue;}if(s.notes[n.id])n.id=id();idMap[original]=n.id;addOperation(s,n,'');}
    });scheduleFlush();return {idMap};
  }
  async function oldWorkspaces(){
    if(indexedDB.databases){const ds=await indexedDB.databases();if(!ds.some(d=>d.name==='mauzi-note-private-v2'))return [];}
    return new Promise(resolve=>{const r=indexedDB.open('mauzi-note-private-v2');r.onupgradeneeded=()=>r.transaction.abort();r.onerror=()=>resolve([]);r.onsuccess=()=>{const d=r.result;if(!d.objectStoreNames.contains('workspaces')){d.close();resolve([]);return;}const q=d.transaction('workspaces').objectStore('workspaces').getAll();q.onsuccess=()=>{d.close();resolve(q.result||[]);};q.onerror=()=>{d.close();resolve([]);};};});
  }
  async function migrate(){
    if(!state||state.local)return;
    const candidates=[];const email=A.legacyEmail();if(email){const legacy=A.legacy(email);if(legacy.notes?.length)candidates.push({email,...legacy});}
    const locals=await allWorkspaces();
    for(const s of [...locals.filter(s=>s.local||(s.key!==state.key&&!String(s.key).startsWith('fb:'))),...await oldWorkspaces()]){
      const modules=s.local?await window.MauziModules?.exportForKey?.(s.key):null;
      if(Object.keys(s.notes||{}).length||modules?.records?.length)candidates.push({email:s.local?'Notas sin cuenta de este dispositivo':(s.email+' · versión anterior (Drive)'),notes:visibleNotes(s),trash:Object.values(s.notes||{}).filter(n=>n.deleted&&!ND.isPurged(n)),categories:s.categories,modules});
    }
    recoveryStart('Importar notas anteriores','Elige una copia de ESTE dispositivo. No se borrará la original. Importa solamente notas que sean tuyas.');
    if(!candidates.length)txt($('recoveryHint'),'No hay copias antiguas en este navegador. En el archivo o navegador anterior usa Guardar copia y aquí usa Recuperar copia.');
    for(const data of candidates)recoveryCard({title:data.email||'Copia local',details:'Importar a '+state.email,content:'Incluye notas y colores de una versión anterior.',action:'Importar esta copia',run:async()=>{if(!confirm('¿Importar estas notas a '+state.email+'?'))return;await window.MauziCloud.importPayload(data);A.close('cloudRecoveryModal');A.toast('Importadas. Espera «Guardado en la nube ✓».');}});
  }
  function recoveryStart(title,hint){txt($('recoveryTitle'),title);txt($('recoveryHint'),hint);$('recoveryItems').replaceChildren();A.open('cloudRecoveryModal');}
  function recoveryCard({title,details,content,action,run}){const box=document.createElement('div');box.className='recovery-item';const h=document.createElement('h3'),small=document.createElement('small'),p=document.createElement('p'),button=document.createElement('button');h.textContent=title;small.textContent=details||'';p.textContent=content||'';button.className='secondary-btn';button.textContent=action;button.addEventListener('click',async()=>{button.disabled=true;try{await run();}catch(e){A.toast(messageFor(e));}finally{button.disabled=false;}});box.append(h,small,p,button);$('recoveryItems').append(box);return box;}
  async function restoreNote(n){if(state?.notePurges?.[n.id])throw Error('La nota se eliminó definitivamente y no puede restaurarse.');if(!confirm('¿Restaurar esta versión? El historial anterior se conserva.'))return;await mutate(s=>addOperation(s,{...cleanNote(n),deleted:false,updatedAt:Date.now()},s.notes[n.id]?.rev||''));scheduleFlush();A.close('cloudRecoveryModal');A.toast('Restaurada. Se enviará a la nube.');}
  async function showTrash(){
    if(!state)return;const key=state.key,loaded=await getWorkspace(key);if(state?.key!==key||!loaded)return;state=loaded;ND.enforce(state);
    recoveryStart('Papelera','Las notas aquí están ocultas en todos los dispositivos al sincronizar. Puedes recuperarlas o eliminar definitivamente su contenido e historial de la nube.');
    const rows=Object.values(state.notes).filter(n=>n.deleted&&!ND.isPurged(n));
    if(!rows.length)txt($('recoveryHint'),'La papelera está vacía.');
    for(const n of rows){
      const box=recoveryCard({title:n.title||'Sin título',content:n.content,action:'Recuperar',run:()=>restoreNote(n)});
      const button=document.createElement('button');button.type='button';button.className='delete-forever-action';button.textContent='Eliminar definitivamente';
      button.addEventListener('click',()=>window.MauziNoteDeletionUI?.open(n.id,{permanent:true,title:n.title}));box.append(button);
    }
    const count=ND.pending(state);if(count){const p=document.createElement('p');p.className='delete-pending-summary';p.textContent=count+' eliminación(es) definitiva(s) pendientes de confirmar en la nube. Conecta Google y sincroniza.';$('recoveryItems').prepend(p);}
  }
  async function remoteVersions(nid){
    if(!validToken()||!navigator.onLine)return [];
    const c=context(),f=fb.f,ref=noteRef(c.uid,nid);
    const snap=await withTimeout(f.getDocs(f.query(f.collection(ref,'versions'),f.orderBy('clientAt','desc'),f.limit(HISTORY_KEEP))),20000,'La nube tardó en entregar el historial.');
    const rows=[];for(const d of snap.docs){const raw=d.data();const n=await decode(d.ref,raw);if(n)rows.push({...n,rev:raw.rev,serverAt:raw.syncAt?.toMillis?.()||raw.clientAt||0,conflict:!!raw.conflict});}
    return rows;
  }
  async function showHistory(){
    if(!state||!A.currentReadId())return;const nid=A.currentReadId();state=await getWorkspace(state.key);
    recoveryStart('Historial de la nota',validToken()?'Buscando las versiones guardadas en la nube…':'Se muestran las versiones de este dispositivo. Conecta Google para ver las de tus otros equipos.');
    let remote=[];try{remote=await remoteVersions(nid);}catch(e){txt($('recoveryHint'),messageFor(e));}
    if(validToken())txt($('recoveryHint'),'Versiones guardadas de esta nota (las más recientes primero).');
    const versions=state.local?(state.localHistory[nid]||[]):(state.localHistory['note:'+nid]||[]);
    const pending=state.queue.filter(x=>x.kind==='note'&&x.entityId===nid).map(x=>({...x.data,rev:x.opId,serverAt:x.queuedAt,pending:true}));
    const byRev=new Map();for(const n of [...versions,...remote,...pending])byRev.set(n.rev,n);
    const rows=[...byRev.values()].sort((a,b)=>(b.serverAt||0)-(a.serverAt||0));
    if(!rows.length)txt($('recoveryHint'),'Aún no hay versiones. Guarda la nota y sincroniza.');
    for(const n of rows)recoveryCard({title:n.title||'Sin título',details:new Date(n.serverAt||n.updatedAt).toLocaleString('es-GT')+(n.pending?' · Solo en este dispositivo':n.conflict?' · Edición simultánea conservada':''),content:n.content,action:'Restaurar versión',run:()=>restoreNote(n)});
  }
  async function showAllHistory(){if(!state)return;recoveryStart('Notas en la nube','Las notas se recuperan automáticamente al conectar la misma cuenta. Aquí puedes abrir o recuperar cualquiera.');for(const n of Object.values(state.notes).filter(n=>!ND.isPurged(n)))recoveryCard({title:n.title||'Sin título',content:n.deleted?'En papelera':n.content,action:n.deleted?'Recuperar nota':'Abrir nota',run:async()=>{if(n.deleted)await restoreNote(n);else{A.close('cloudRecoveryModal');window.openNoteReader(n.id);}}});}
  async function cloudInfo(){
    if(!validToken()){login();return;}
    try{
      const c=context(),f=fb.f;let count='';
      try{const agg=await withTimeout(f.getCountFromServer(f.collection(fb.db,'users',c.uid,'notes')),15000,'');count=' · '+agg.data().count+' notas registradas';}catch(_){}
      txt($('driveStatus'),'Cuenta '+user.email+count+'.\nTus notas están en la nube de MAUZI NOTE (Firebase · '+PROJECT+'), en un espacio que solo tu cuenta puede abrir desde la app.');
    }catch(e){txt($('driveStatus'),messageFor(e));}
  }
  function archiveState(){return {pending:0,error:'',local:!!state?.local,finishedAt:state?.lastScanAt||0,missing:0,authorized:validToken()&&navigator.onLine,backend:'firebase'};}
  async function organizeNow(){A.toast('En la nube, el año y la carpeta viajan dentro de cada nota: no hace falta reorganizar.');}

  /* ---------- Eventos ---------- */
  channel?.addEventListener('message',async e=>{if(e.data?.key!==state?.key)return;const key=state.key;try{const s=await getWorkspace(key);if(state?.key===key&&s){state=s;applyState();}}catch(_){};});
  window.addEventListener('online',()=>{cloudError='';retryNotBefore=0;refreshStatus();if(state&&!state.local)prepareConnection();scheduleFlush(0,'internet recuperado');});
  window.addEventListener('offline',refreshStatus);
  function wakeSync(){
    if(document.hidden)return;refreshStatus();
    if(state&&!state.local&&!fb)prepareConnection();
    if(Date.now()-lastWake<800)return;lastWake=Date.now();scheduleFlush(0,'volver a la app');
  }
  document.addEventListener('visibilitychange',wakeSync);
  window.addEventListener('focus',wakeSync);window.addEventListener('pageshow',wakeSync);
  setInterval(()=>{if(!document.hidden&&validToken()&&state?.queue.length)scheduleFlush(0,'pendientes');},30000);
  $('localOnlyBtn').addEventListener('click',localOnly);
  $('accountBtn').addEventListener('click',prepareConnection);
  $('transferGuestBtn').addEventListener('click',transferGuest);
  $('skipGuestTransferBtn').addEventListener('click',()=>{transferSource='';$('guestTransferPanel').classList.add('hidden');authMessage('La copia sin cuenta sigue en este dispositivo. Puedes importarla después.');});
  $('googleAccountBtn').addEventListener('click',()=>login({choose:true}));
  $('syncNowBtn').addEventListener('click',()=>{cloudError='';if(!validToken())login();else{if(!unsubs.length)startListeners();scheduleFlush(0,'manual');}refreshStatus();});
  $('migrateLocalBtn').addEventListener('click',()=>migrate().catch(e=>A.toast(messageFor(e))));
  $('openTrashBtn').addEventListener('click',()=>showTrash().catch(e=>A.toast(messageFor(e))));
  $('historyNoteBtn').addEventListener('click',()=>showHistory().catch(e=>A.toast(messageFor(e))));
  $('driveBackupBtn').addEventListener('click',cloudInfo);
  $('driveRestoreBtn').addEventListener('click',()=>showAllHistory().catch(e=>A.toast(messageFor(e))));
  const syncInfo=document.createElement('section');syncInfo.className='sync-diagnostics';syncInfo.innerHTML='<h3>Sincronización automática</h3><p id="syncConnectionHelp"></p><div id="syncProgressDetails" role="status"></div><small>Usa la misma cuenta en todos tus dispositivos. Los cambios sin guardar o la app sin internet se sincronizan al guardar y reconectar.</small>';
  $('accountSyncStatus').after(syncInfo);
  window.MauziCloud={removeNote,showTrash,deletionState,save,login,logout,flush,prepareConnection,syncState,archiveState,organizeNow,requestSync:()=>scheduleFlush(0,'manual'),importPayload,localOnly,
    config:()=>({configured,projectId:PROJECT,backend:'firebase'}),isReady:()=>!!fb,account:moduleAccount,moduleBridge,
    beginEdit(nid){editorBase.clear();if(nid)editorBase.set(nid,state?.notes[nid]?.rev||'');},
    getExport:()=>state?{notes:visibleNotes(),categories:clone(state.categories),trash:Object.values(state.notes).filter(n=>n.deleted&&!ND.isPurged(n)).map(cleanNote),modules:window.MauziModules?.exportData()||null}:null};
  async function startApp(){
    try{
      await openStorage();let key='';try{key=localStorage.getItem(ACTIVE_KEY)||'';if(!key){const fallback=localStorage.getItem(ACTIVE_FALLBACK)||'';if(fallback.startsWith('local:')||fallback.startsWith(PREFIX))key=fallback;}}catch(_){}
      const cached=key?await getWorkspace(key):null;
      let returning=false;try{returning=!!sessionStorage.getItem(REDIRECT_KEY);}catch(_){}
      if(cached){state=cached;rememberActive();applyState();if(!state.local||returning)prepareConnection();}
      else{
        // Usuario de la 4.x conectado a Drive: se siguen mostrando SUS notas de este dispositivo
        // hasta que conecte Google otra vez; entonces se pasan solas a Firebase.
        let old='';try{old=localStorage.getItem(ACTIVE_FALLBACK)||'';}catch(_){}
        const legacy=old&&!old.startsWith('local:')&&!old.startsWith('fb:')?await getWorkspace(old):null;
        if(legacy&&!legacy.local){
          state=legacy;applyState();prepareConnection();
          authMessage('MAUZI NOTE ahora guarda en la nube con Firebase. Toca «Conectar Google y sincronizar» con la misma cuenta ('+legacy.email+'): tus notas de este dispositivo se pasarán solas.',false);
        }else{await enterLocal();if(returning)prepareConnection();}
      }
      $('retryLocalStorageBtn').classList.add('hidden');
    }catch(e){
      authMessage(messageFor(e),true);$('accountSyncStatus').textContent='No se pudo abrir el almacenamiento. No borres los datos del navegador.';
      $('retryLocalStorageBtn').classList.remove('hidden');A.open('accountModal');
    }finally{
      $('loginScreen').classList.add('hidden');$('mainApp').classList.remove('hidden');$('appBootNotice').classList.add('hidden');
      $('mainApp').setAttribute('aria-busy','false');$('loginBtn').disabled=false;
      if(storageReady)refreshStatus();
    }
  }
  $('retryLocalStorageBtn').addEventListener('click',startApp);
  window.MauziCloud.ready=startApp();
})();
