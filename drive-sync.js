/* MAUZI NOTE 4.2 — Google Drive de CADA USUARIO, sin Firebase ni servidor propio.
   Google Identity Services authorizes browser REST requests with drive.file.
   Access tokens live only in memory; refresh requires a user gesture, never a secret in GitHub.
   Immutable revision files + durable IndexedDB outbox; a successful Drive response is required
   before acknowledging cloud persistence. Explicit image removal redacts older app versions;
   the replacement is confirmed before the old image-bearing revision file is deleted.
   The same OAuth project/client must be retained after deployment. */
(() => {
  'use strict';
  const A=window.MauziApp, $=id=>document.getElementById(id);
  if(!A)return;
  const embeddedId=document.querySelector('meta[name="mauzi-google-client-id"]')?.content||'';
  const isClientId=v=>/^\d+-[a-z0-9_-]+\.apps\.googleusercontent\.com$/i.test(String(v||'').trim());
  const CLIENT_ID=String(isClientId(window.MAUZI_GOOGLE_CLIENT_ID)?window.MAUZI_GOOGLE_CLIENT_ID:embeddedId).trim();
  const configured=isClientId(CLIENT_ID);
  window.MAUZI_GOOGLE_CLIENT_ID=CLIENT_ID;
  const SCOPES='openid email https://www.googleapis.com/auth/drive.file';
  const APP='mauzi-note-drive-v3',FOLDER='mauzi-note-folder-v3';
  const ACTIVE_KEY='mauzi-note:drive-active:'+CLIENT_ID;
  const DB='mauzi-note-drive-v3';
  const GUEST_CHOICE='mauzi-note:guest-workspace';
  const DEVICE_EMAIL='copia@este-telefono.local';
  const ACTIVE_FALLBACK='mauzi-note:last-workspace';
  let storageReady=false,googleLoading=false,transferSource='',transferBusy=false;
  const guestIcon='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/></svg>';
  const clone=v=>structuredClone(v),txt=(n,t)=>{if(n)n.textContent=t;};
  const id=()=>crypto.randomUUID?crypto.randomUUID():Date.now().toString(36)+'_'+Math.random().toString(36).slice(2);
  const validId=v=>typeof v==='string'&&/^[a-zA-Z0-9_-]{1,160}$/.test(v);
  const safeId=v=>validId(v)?v:id();
  const safeColor=(v,f)=>/^#[0-9a-f]{6}$/i.test(String(v||''))?v:f;
  const safeTime=v=>Number.isFinite(Number(v))&&Number(v)>0?Number(v):Date.now();
  const channel='BroadcastChannel' in window?new BroadcastChannel('mauzi-note-drive-v3'):null;
  let storage=null,state=null,user=null,token='',expiresAt=0,session=0,authPending=false;
  let flushTimer=null,expiryTimer=null,flushing=false,flushAgain=false,flushTask=null,googleReady=null,cloudError='';
  let displayedBaseline={},displayedCategories=[],editorBase=new Map();
  let activeRequestController=null;
  const rawActivate=A.activate.bind(A);
  A.activate=(email,data)=>{displayedBaseline=Object.fromEntries((data.notes||[]).map(n=>[n.id,clone(n)]));displayedCategories=clone(data.categories||[]);rawActivate(email,data);};

  function cleanNote(n){
    if(!n||typeof n!=='object')throw new Error('La nota no tiene un formato válido.');
    n=window.MauziMedia?.redactNote(n,state?.mediaRedactions)||n;
    const contentHtml=A.sanitize(typeof n.contentHtml==='string'?n.contentHtml:A.oldText(String(n.content||'')));
    const note={id:safeId(n.id),title:String(n.title||'').slice(0,90),content:A.plain(contentHtml),contentHtml,
      categoryId:safeId(n.categoryId||'important'),bgColor:safeColor(n.bgColor,'#080808'),
      createdAt:safeTime(n.createdAt),updatedAt:safeTime(n.updatedAt),deleted:n.deleted===true};
    if(new TextEncoder().encode(JSON.stringify(note)).length>2000000)throw new Error('Esta nota supera 2 MB. Divídela antes de guardarla. El texto sigue en el editor.');
    return note;
  }
  function cleanCategories(items){
    const seen=new Set();
    return (Array.isArray(items)?items:[]).slice(0,200).filter(x=>x&&typeof x.name==='string').map(x=>({id:safeId(x.id),name:x.name.trim().slice(0,60),color:safeColor(x.color,'#c9a342')})).filter(x=>{if(!x.name||seen.has(x.id))return false;seen.add(x.id);return true;});
  }
  function sameNote(a,b){return !!a&&!!b&&JSON.stringify(cleanNote(a))===JSON.stringify(cleanNote(b));}
  function newWorkspace(uid,email,local=false){return {key:local?'local:'+email:CLIENT_ID+':'+uid,uid,email,local,
    notes:{},categories:A.defaults(),categoryRev:'',queue:[],events:{},seenFiles:{},localHistory:{},
    folderId:'',lastSyncedAt:0,lastScanAt:0,createdAt:Date.now()};}
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
  async function putInitial(s){const d=await openStorage();return new Promise((resolve,reject)=>{const t=d.transaction('workspaces','readwrite'),o=t.objectStore('workspaces'),r=o.get(s.key);let result;r.onsuccess=()=>{result=r.result||s;if(!r.result)o.put(s);};t.oncomplete=()=>resolve(result);t.onerror=()=>reject(t.error);t.onabort=()=>reject(t.error||new Error('No se guardó el perfil.'));});}
  async function mutate(fn,{key=state?.key,render=true,notify=true}={}){
    if(!key)throw new Error('Primero abre tu cuenta o tu copia local.');
    const d=await openStorage();
    const result=await new Promise((resolve,reject)=>{
      const t=d.transaction('workspaces','readwrite'),o=t.objectStore('workspaces'),r=o.get(key);let next,reason;
      r.onsuccess=()=>{try{next=r.result;if(!next)throw new Error('No se encontró la copia local.');fn(next);o.put(next);}catch(e){reason=e;t.abort();}};
      t.oncomplete=()=>resolve(next);t.onerror=()=>reject(reason||new Error('No hay espacio para guardar. Conserva el texto y exporta tus notas.'));
      t.onabort=()=>reject(reason||new Error('No se completó el guardado local. Tu texto sigue en el editor.'));
    });
    if(state?.key===key){state=result;if(render)applyState();refreshStatus();}
    if(notify)channel?.postMessage({key});return result;
  }
  const visibleNotes=(s=state)=>Object.values(s?.notes||{}).filter(n=>!n.deleted).map(cleanNote);
  function validToken(){return !!token&&!!user&&Date.now()<expiresAt&&state?.uid===user.uid&&!state?.local;}
  function rememberActive(){
    if(!state)return;
    try{localStorage.setItem(ACTIVE_KEY,state.key);localStorage.setItem(ACTIVE_FALLBACK,state.key);
      if(state.local)localStorage.setItem(GUEST_CHOICE,state.key);}catch(_){}
  }
  function applyState(){
    if(!state)return;
    A.activate(state.email,{notes:visibleNotes(),categories:state.categories});
    $('activeEmail').textContent=state.local?'Sin cuenta · En este dispositivo':state.email;
    $('activeAccountLabel').textContent=state.local?'Estás usando MAUZI NOTE sin cuenta':'Tu cuenta Google';
    $('accountCloudDescription').textContent=state.local?
      'Tus notas, imágenes, favoritos y agenda se guardan aquí. Conecta tu correo con Google cuando quieras tener una copia en TU Drive.':
      'Tus notas se sincronizan con TU Google Drive cuando autorizas la conexión. No se envían al Drive del creador.';
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
  function moduleAccount(){return state?{key:state.key,uid:state.uid,email:state.email,local:!!state.local,authorized:validToken()&&navigator.onLine}:null;}
  function moduleBridge(){const c=context();return {account:moduleAccount(),check:()=>assertContext(c),request:(url,options)=>driveFetch(url,options,c),folder:()=>getFolder(c)};}
  function refreshStatus(){
    let message='Abriendo la copia de este dispositivo…',kind='pending';
    if(state?.local){message='Guardado en este dispositivo. Conecta Google para tener respaldo en la nube.';kind='local';}
    else if(!configured)message='La configuración de Google no se cargó. La copia de tus notas sigue aquí.';
    else if(cloudError){message=cloudError;kind='error';}
    else if(!state)kind='info';
    else if(!navigator.onLine)message=state.queue.length?'Sin internet · cambios pendientes de subir':'Sin internet · copia del dispositivo';
    else if(!validToken())message=state.queue.length?'Cambios pendientes · conecta Google para subirlos':'Conecta Google para sincronizar. Puedes seguir usando tus notas.';
    else if(state.mediaQueue?.length||state.mediaPurgePending)message='Eliminación de imagen pendiente de confirmar en Drive';
    else if(flushing||state.queue.length)message='Guardado en el dispositivo · sincronizando con tu Drive…';
    else if(state.lastScanAt){message='Guardado en tu Google Drive ✓';kind='synced';}
    else message='Conectando con tu Google Drive…';
    const account=$('accountBtn');
    if(account){
      let indicator='offline';
      if(cloudError)indicator='error';else if(authPending||googleLoading)indicator='syncing';
      else if(navigator.onLine&&validToken())indicator=state?.lastScanAt?'online':'syncing';
      account.dataset.driveState=indicator;
      account.setAttribute('aria-label','Mi cuenta y respaldo. '+(indicator==='online'?'Conectado a Google Drive':indicator==='syncing'?'Preparando Google':indicator==='error'?'Revisar sincronización':state?.local?'Sin cuenta':'Sin conexión activa a Google Drive'));
      account.title='Mi cuenta y respaldo';
    }
    txt($('accountSyncStatus'),message+(state?.lastSyncedAt?'\nÚltima confirmación: '+new Date(state.lastSyncedAt).toLocaleString('es-GT'):''));$('accountSyncStatus').dataset.state=kind;
    txt($('syncNowBtn'),authPending?'Termina la conexión en Google…':googleLoading?'Preparando Google…':validToken()?'Sincronizar ahora':state?.local?'Conectar mi correo con Google':'Conectar Google y sincronizar');
    $('syncNowBtn').disabled=!configured||!storageReady||authPending||googleLoading||transferBusy;
    $('googleAccountBtn').classList.toggle('hidden',!state||state.local);
    $('googleAccountBtn').disabled=!configured||authPending||googleLoading||transferBusy;
    $('migrateLocalBtn').disabled=authPending||transferBusy;
    $('logoutBtn').disabled=authPending||transferBusy;
    $('driveBackupBtn').disabled=!state||state.local||authPending||transferBusy;
    $('driveRestoreBtn').disabled=!state||state.local||authPending;
    window.dispatchEvent(new CustomEvent('mauzi:cloud-state',{detail:moduleAccount()}));
  }
  function messageFor(e){
    if(e?.name==='AbortError')return 'La conexión se interrumpió. Las notas pendientes siguen en el teléfono.';
    return e?.message||'No se confirmó el guardado en Drive. La copia local se conserva.';
  }
  function addOperation(s,n,baseRev){
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
    },{key});editorBase.clear();scheduleFlush();
  }

  /* All network calls are bound to ONE verified account/token/session. A switch cannot
     send one user's queued data with another user's credentials. No tokens in storage or URLs. */
  function context(){if(!validToken())throw new Error('Toca Conectar Google para renovar el permiso de Drive.');return {uid:user.uid,key:state.key,token,session,signal:activeRequestController?.signal};}
  function assertContext(c){if(c.session!==session||c.uid!==user?.uid||c.key!==state?.key)throw new Error('La cuenta cambió; la operación quedó pendiente en su cuenta original.');}
  async function driveFetch(path,{method='GET',body,headers={}}={},c=context()){
    assertContext(c);if(!navigator.onLine)throw new Error('Sin internet. La copia local se conserva.');
    const url=new URL(path);if(url.origin!=='https://www.googleapis.com')throw new Error('Dirección de Drive no permitida.');
    const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),35000),abort=()=>controller.abort();
    c.signal?.addEventListener('abort',abort,{once:true});
    try{
      const response=await fetch(path,{method,body,headers:{Authorization:'Bearer '+c.token,...headers},cache:'no-store',signal:controller.signal});assertContext(c);
      if(!response.ok){let data={};try{data=await response.json();}catch(_){}
        const error=new Error(data.error?.message||'Drive respondió con un error.');error.status=response.status;
        if(response.status===401){token='';expiresAt=0;error.message='El permiso de Google venció. Toca Conectar Google; tus cambios siguen en el teléfono.';}
        else if(response.status===403){error.message='Drive no autorizó el guardado. Revisa el permiso y que Google Drive API esté activada. '+(data.error?.message||'');}
        else if(response.status===429)error.message='Google limitó temporalmente las solicitudes. Tus cambios se conservan; vuelve a sincronizar.';
        else if(response.status===507)error.message='Tu Google Drive no tiene espacio. Libera espacio y vuelve a sincronizar.';
        throw error;
      }return response;
    }finally{clearTimeout(timeout);c.signal?.removeEventListener('abort',abort);}
  }
  async function listDrive(query,c,fields='id,name,createdTime,appProperties'){
    const rows=[];let next='';do{
      const p=new URLSearchParams({q:query,spaces:'drive',fields:'nextPageToken,incompleteSearch,files('+fields+')',pageSize:'1000',orderBy:'createdTime'});
      if(next)p.set('pageToken',next);
      const data=await(await driveFetch('https://www.googleapis.com/drive/v3/files?'+p,{},c)).json();
      if(data.incompleteSearch)throw new Error('Google devolvió una búsqueda incompleta. No se marcará como sincronizado; vuelve a intentar.');
      rows.push(...(data.files||[]));next=data.nextPageToken||'';
    }while(next);return rows;
  }
  const queryMarker=m=>"trashed = false and 'me' in owners and appProperties has {key='mauziNote' and value='"+m+"'}";
  async function getFolder(c){
    const fresh=await getWorkspace(c.key);assertContext(c);
    if(fresh.folderId){
      try{const f=await(await driveFetch('https://www.googleapis.com/drive/v3/files/'+encodeURIComponent(fresh.folderId)+'?fields=id,trashed',{},c)).json();if(!f.trashed)return f.id;}
      catch(e){if(e.status!==404)throw e;}
    }
    const list=await listDrive(queryMarker(FOLDER)+" and mimeType = 'application/vnd.google-apps.folder'",c,'id,name');
    let folder=list[0]?.id;
    if(!folder){const f=await(await driveFetch('https://www.googleapis.com/drive/v3/files?fields=id',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'MAUZI NOTE',mimeType:'application/vnd.google-apps.folder',appProperties:{mauziNote:FOLDER},description:'Notas y versiones privadas de MAUZI NOTE. No borrar ni editar estos archivos desde Drive. Abre la aplicación para leer o recuperar las notas.'})},c)).json();folder=f.id;}
    if(!validId(folder))throw new Error('Drive no confirmó la carpeta.');
    await mutate(s=>{s.folderId=folder;},{key:c.key,render:false});return folder;
  }
  function cleanEvent(e,meta,c){
    if(e?.format!==APP||e.owner!==c.uid||!validId(e.opId)||!validId(e.entityId)||!['note','categories'].includes(e.kind))throw new Error('Una versión de Drive no es válida. Tu copia local sigue intacta.');
    if(e.baseRev&&!validId(e.baseRev))throw new Error('Una versión tiene una referencia inválida.');
    if(meta.appProperties?.opId&&meta.appProperties.opId!==e.opId)throw new Error('El identificador de una versión no coincide.');
    const data=e.kind==='note'?cleanNote(e.data):{categories:cleanCategories(e.data?.categories)};
    if(e.kind==='note'&&data.id!==e.entityId)throw new Error('La nota de Drive no coincide con su versión.');
    if(e.kind==='categories'&&!data.categories.length)throw new Error('La configuración de categorías llegó vacía.');
    return {opId:e.opId,entityId:e.entityId,kind:e.kind,baseRev:e.baseRev||'',data,queuedAt:safeTime(e.queuedAt),serverAt:(meta.appProperties?.mediaRewriteOf&&Number.isFinite(e.redactedServerAt)?e.redactedServerAt:Date.parse(meta.createdTime))||Date.now(),fileId:meta.id};
  }
  /* Reconstruct heads from revision ancestry. Concurrent leaves never overwrite each other's
     files. The selected head is deterministic, all alternatives remain in Historial. */
  function rebuild(s){
    const groups=new Map();for(const e of Object.values(s.events||{})){const key=e.kind+':'+e.entityId;if(!groups.has(key))groups.set(key,[]);groups.get(key).push(e);}
    const pending=new Set(s.queue.map(o=>o.kind+':'+o.entityId));
    for(const [key,events] of groups){
      const referenced=new Set(events.map(e=>e.baseRev).filter(Boolean));
      const leaves=events.filter(e=>!referenced.has(e.opId));if(!leaves.length)throw new Error('Se detectó un historial inconsistente. No se borró ninguna nota.');
      leaves.sort((a,b)=>a.serverAt-b.serverAt||a.opId.localeCompare(b.opId));
      const head=leaves[leaves.length-1];
      s.localHistory[key]=events.map(e=>({...e.data,rev:e.opId,serverAt:e.serverAt,conflict:leaves.length>1&&leaves.includes(e)}));
      if(pending.has(key))continue;
      if(head.kind==='note')s.notes[head.entityId]={...head.data,rev:head.opId,serverAt:head.serverAt,conflict:leaves.length>1};
      else{
        // If two devices added categories concurrently, retain categories from BOTH heads.
        let cs=clone(head.data.categories);
        if(leaves.length>1){for(const e of leaves)for(const cat of e.data.categories)if(!cs.some(x=>x.id===cat.id))cs.push(cat);}
        s.categories=cs;s.categoryRev=head.opId;
      }
    }
  }
  /* Explicit image removals are durable markers. Old immutable note versions
     containing a removed image are replaced by a redacted version BEFORE deleting
     the original file. Other notes, user photos and external backups are untouched. */
  const MEDIA=APP+'-image-removals', MM=window.MauziMedia;
  async function mediaPost(payload,metadata,driveId,c){
    const boundary='mauzi_media_'+id();const body='--'+boundary+'\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n'+JSON.stringify({...metadata,id:driveId})+'\r\n--'+boundary+'\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n'+JSON.stringify(payload)+'\r\n--'+boundary+'--';
    try{return await(await driveFetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,createdTime,appProperties',{method:'POST',headers:{'Content-Type':'multipart/related; boundary='+boundary},body},c)).json();}
    catch(e){if(e.status!==409)throw e;const existing=await(await driveFetch('https://www.googleapis.com/drive/v3/files/'+driveId+'?alt=media',{},c)).json();if(existing.owner!==c.uid||existing.opId!==payload.opId||JSON.stringify(existing.data||existing.hashes)!==JSON.stringify(payload.data||payload.hashes))throw Error('No se confirmó la sustitución de una imagen. Reintenta sincronizar.');return await(await driveFetch('https://www.googleapis.com/drive/v3/files/'+driveId+'?fields=id,createdTime,appProperties',{},c)).json();}
  }
  async function mediaReserve(c){const data=await(await driveFetch('https://www.googleapis.com/drive/v3/files/generateIds?count=1&space=drive&type=files',{},c)).json();if(!validId(data.ids?.[0]))throw Error('Drive no reservó el cambio de imagen.');return data.ids[0];}
  async function syncMediaMarkers(c){if(!MM)return;
    const list=await listDrive(queryMarker(MEDIA),c),fresh=await getWorkspace(c.key),newMarkers=[];
    for(const f of list){if(fresh.mediaSeen?.[f.id])continue;const e=await(await driveFetch('https://www.googleapis.com/drive/v3/files/'+f.id+'?alt=media',{},c)).json();
      if(e.format!==MEDIA||e.owner!==c.uid||!validId(e.noteId)||!Array.isArray(e.hashes)||e.hashes.length>1000||e.hashes.some(h=>!/^[a-f0-9]{64}$/.test(h)))throw Error('El registro de eliminación de imágenes no es válido.');newMarkers.push({...e,fileId:f.id});
    }
    if(newMarkers.length)await mutate(s=>{for(const e of newMarkers){MM.merge(s,e.noteId,e.hashes);(s.mediaSeen||={})[e.fileId]=true;}s.mediaPurgePending=true;MM.scrub(s);},{key:c.key});
    for(;;){let fresh=await getWorkspace(c.key),op=fresh.mediaQueue?.[0];if(!op)break;const folder=await getFolder(c);
      if(!op.driveId){const driveId=await mediaReserve(c);await mutate(s=>{const x=s.mediaQueue?.find(x=>x.id===op.id);if(x)x.driveId=driveId;},{key:c.key,render:false});fresh=await getWorkspace(c.key);op=fresh.mediaQueue[0];}
      const payload={format:MEDIA,owner:c.uid,opId:op.id,noteId:op.noteId,hashes:op.hashes,at:op.at};
      const meta=await mediaPost(payload,{name:'imagen-eliminada-'+op.id+'.json',mimeType:'application/json',parents:[folder],appProperties:{mauziNote:MEDIA}},op.driveId,c);
      await mutate(s=>{(s.mediaSeen||={})[meta.id]=true;s.mediaQueue=s.mediaQueue.filter(x=>x.id!==op.id);s.mediaPurgePending=true;},{key:c.key,render:false});
    }
  }
  async function purgeRemovedMedia(c){if(!MM)return;let fresh=await getWorkspace(c.key);if(!Object.keys(fresh.mediaRedactions||{}).length)return;
    const rules=fresh.mediaRedactions,signature=MM.hash(JSON.stringify(rules)),list=await listDrive(queryMarker(APP),c);
    for(const meta of list){assertContext(c);fresh=await getWorkspace(c.key);if(fresh.mediaCleaned?.[meta.id]===signature)continue;
      const raw=await(await driveFetch('https://www.googleapis.com/drive/v3/files/'+meta.id+'?alt=media',{},c)).json();
      if(raw.format!==APP||raw.owner!==c.uid)throw Error('No se puede limpiar una imagen fuera de tu cuenta.');
      if(raw.kind!=='note'||!rules[raw.entityId]?.length){await mutate(s=>{(s.mediaCleaned||={})[meta.id]=signature;},{key:c.key,render:false,notify:false});continue;}
      const clean=MM.redactNote(raw.data,rules);
      if(clean===raw.data){await mutate(s=>{(s.mediaCleaned||={})[meta.id]=signature;},{key:c.key,render:false,notify:false});continue;}
      let job=fresh.mediaJobs?.[meta.id];
      if(!job){job={driveId:await mediaReserve(c)};await mutate(s=>{(s.mediaJobs||={})[meta.id]=job;},{key:c.key,render:false});}
      const payload={...raw,data:clean,redactedServerAt:raw.redactedServerAt||Date.parse(meta.createdTime)||Date.now()};
      const folder=await getFolder(c);
      const replacement=await mediaPost(payload,{name:'version-'+raw.opId+'-sin-imagen.json',mimeType:'application/json',parents:[folder],appProperties:{mauziNote:APP,opId:raw.opId,mediaRewriteOf:meta.id}},job.driveId,c);
      // Only this known version is deleted; never the note folder or a user's photo.
      try{await driveFetch('https://www.googleapis.com/drive/v3/files/'+meta.id,{method:'DELETE'},c);}catch(e){if(e.status!==404)throw e;}
      await mutate(s=>{(s.mediaCleaned||={})[replacement.id]=signature;delete(s.mediaJobs||{})[meta.id];if(s.events[raw.opId])s.events[raw.opId].fileId=replacement.id;MM.scrub(s);},{key:c.key,render:false});
    }
    await mutate(s=>{s.mediaPurgePending=!!s.mediaQueue?.length;MM.scrub(s);},{key:c.key});
  }

  async function pull(c){
    const files=await listDrive(queryMarker(APP),c),fresh=await getWorkspace(c.key);assertContext(c);
    const additions=[];const known=fresh.seenFiles||{};
    for(const f of files){if(known[f.id])continue;
      const r=await driveFetch('https://www.googleapis.com/drive/v3/files/'+encodeURIComponent(f.id)+'?alt=media',{},c);
      const raw=await r.text();if(raw.length>4000000)throw new Error('Un archivo de versiones es demasiado grande. Revisa tu carpeta MAUZI NOTE.');
      additions.push(cleanEvent(JSON.parse(raw),f,c));
    }
    assertContext(c);
    await mutate(s=>{s.events||={};s.seenFiles||={};for(const e of additions){
      const prior=s.events[e.opId];if(prior&&JSON.stringify(prior.data)!==JSON.stringify(e.data))throw new Error('Hay dos versiones con el mismo identificador y distinto contenido. Conserva un respaldo.');
      if(!prior)s.events[e.opId]=e;s.seenFiles[e.fileId]=e.opId;
    }
    // Missing remote files never delete cached notes: deletions in this app are explicit revisions.
    rebuild(s);window.MauziMedia?.scrub(s);s.lastScanAt=Date.now();if(!s.queue.length)s.lastSyncedAt=Date.now();},{key:c.key});
  }
  async function commit(op,c,folder){
    assertContext(c);
    // A pre-generated Drive file ID makes POST retry safe even if the response was lost.
    if(!op.driveId){
      const d=await(await driveFetch('https://www.googleapis.com/drive/v3/files/generateIds?count=1&space=drive&type=files',{},c)).json();
      if(!validId(d.ids?.[0]))throw new Error('Drive no reservó un identificador.');
      await mutate(s=>{const x=s.queue.find(x=>x.opId===op.opId);if(x&&!x.driveId)x.driveId=d.ids[0];},{key:c.key,render:false});
      const fresh=await getWorkspace(c.key);op=clone(fresh.queue.find(x=>x.opId===op.opId)||op);
    }
    if(!op.driveId)throw new Error('No se guardó el identificador de subida.');
    const payload={format:APP,owner:c.uid,...op};delete payload.driveId;
    const metadata={id:op.driveId,name:'version-'+op.opId+'.json',mimeType:'application/json',parents:[folder],appProperties:{mauziNote:APP,opId:op.opId},description:'Versión de una nota MAUZI NOTE. Recuperar desde la aplicación.'};
    const boundary='mauzi_'+id(),body='--'+boundary+'\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n'+JSON.stringify(metadata)+'\r\n--'+boundary+'\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n'+JSON.stringify(payload)+'\r\n--'+boundary+'--';
    let meta;
    try{meta=await(await driveFetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,createdTime,appProperties',{method:'POST',headers:{'Content-Type':'multipart/related; boundary='+boundary},body},c)).json();}
    catch(e){if(e.status!==409)throw e;
      meta=await(await driveFetch('https://www.googleapis.com/drive/v3/files/'+encodeURIComponent(op.driveId)+'?fields=id,createdTime,appProperties',{},c)).json();
      const existing=await(await driveFetch('https://www.googleapis.com/drive/v3/files/'+encodeURIComponent(op.driveId)+'?alt=media',{},c)).json();
      if(existing.owner!==c.uid||existing.opId!==op.opId||JSON.stringify(existing.data)!==JSON.stringify(payload.data))throw new Error('La subida anterior no coincide. Conserva tu copia local.');
    }
    return cleanEvent(payload,meta,c);
  }
  function scheduleFlush(delay=650){clearTimeout(flushTimer);flushTimer=setTimeout(()=>flush().catch(e=>{cloudError=messageFor(e);refreshStatus();}),delay);}
  function flush(){
    if(flushTask){flushAgain=true;return flushTask;}
    flushTask=performFlush().finally(()=>{flushTask=null;});
    return flushTask;
  }
  async function performFlush(){
    if(flushing){flushAgain=true;return;}
    if(!state||state.local||!navigator.onLine||!validToken()){refreshStatus();return;}
    flushing=true;cloudError='';const c=context();refreshStatus();
    try{
      await syncMediaMarkers(c);
      await pull(c);
      let fresh=await getWorkspace(c.key);
      // Category settings are also written before the first note, including a previously empty account.
      if(!fresh.categoryRev&&!fresh.queue.some(o=>o.kind==='categories'))await mutate(s=>addCategories(s,s.categories),{key:c.key,render:false});
      fresh=await getWorkspace(c.key);
      let folder=fresh.queue.length?await getFolder(c):fresh.folderId;
      while(true){assertContext(c);fresh=await getWorkspace(c.key);const op=fresh.queue[0];if(!op)break;
        const event=await commit(clone(op),c,folder);assertContext(c);
        await mutate(s=>{s.events[event.opId]=event;s.seenFiles[event.fileId]=event.opId;s.queue=s.queue.filter(x=>x.opId!==event.opId);rebuild(s);if(!s.queue.length)s.lastSyncedAt=Date.now();},{key:c.key});
      }
      await syncMediaMarkers(c);
      await purgeRemovedMedia(c);
      await pull(c);cloudError='';
      if(Object.values(state.notes).some(n=>n.conflict))txt($('driveStatus'),'Hay ediciones simultáneas. Ambas se conservan: abre la nota → Historial.');
    }catch(e){if(c.session===session){cloudError=messageFor(e);if(e.status===429||e.status>=500)scheduleFlush(60000);}}
    finally{flushing=false;refreshStatus();if(flushAgain){flushAgain=false;scheduleFlush();}}
  }

  function loadGoogle(){
    if(window.google?.accounts?.oauth2)return Promise.resolve();
    if(googleReady)return googleReady;
    googleReady=new Promise((resolve,reject)=>{
      const script=document.createElement('script');script.src='https://accounts.google.com/gsi/client';script.async=true;
      const timeout=setTimeout(()=>{script.remove();googleReady=null;reject(new Error('Google tardó en cargar. Vuelve a tocar Conectar mi correo con Google.'));},20000);
      script.onload=()=>{clearTimeout(timeout);if(window.google?.accounts?.oauth2)resolve();else{googleReady=null;reject(new Error('No se cargó Google. Puedes seguir usando tus notas sin conexión.'));}};
      script.onerror=()=>{clearTimeout(timeout);script.remove();googleReady=null;reject(new Error('No se pudo conectar con Google. Revisa internet. Tus notas siguen en este dispositivo.'));};document.head.append(script);
    });return googleReady;
  }
  function prepareGoogle(){
    if(!configured||googleLoading||!navigator.onLine||location.protocol==='file:'||window.google?.accounts?.oauth2)return;
    googleLoading=true;authMessage('');refreshStatus();
    loadGoogle().then(()=>authMessage('')).catch(e=>authMessage(e.message,true)).finally(()=>{googleLoading=false;refreshStatus();});
  }
  function clearConnection(){activeRequestController?.abort();activeRequestController=null;session++;token='';expiresAt=0;user=null;clearTimeout(expiryTimer);clearTimeout(flushTimer);cloudError='';if($('openDriveLink')){$('openDriveLink').classList.add('hidden');$('openDriveLink').removeAttribute('href');}}
  function login({choose=false}={}){
    if(authPending)return;
    if(!configured){authMessage('No se cargó la configuración de Google. Esta edición incluye el ID: actualiza todos los archivos. Puedes seguir usando tus notas sin cuenta.',true);return;}
    if(location.protocol==='file:'){A.toast('Abre la dirección HTTPS publicada en GitHub Pages, no el archivo local.');return;}
    if(!navigator.onLine){A.toast('Necesitas internet para verificar Google. La copia del teléfono sigue disponible.');return;}
    if(!$('noteModal').classList.contains('hidden')){A.toast('Guarda y cierra la nota antes de conectar o cambiar de cuenta.');return;}
    if(!window.google?.accounts?.oauth2){prepareGoogle();return;}
    if(choose&&state?.queue.length&&!confirm('Hay cambios pendientes en esta cuenta. Se conservarán en este teléfono, pero aún no están en Drive. ¿Cambiar de cuenta?'))return;
    if(!storageReady||!state)return;
    if(transferBusy)return;
    const sourceLocal=state.local?state.key:'';
    const authSession=session;
    authPending=true;refreshStatus();$('loginBtn').disabled=true;
    const previous=state?.local?'':state?.uid;
    const finish=()=>{authPending=false;$('loginBtn').disabled=false;refreshStatus();};
    let client;try{client=google.accounts.oauth2.initTokenClient({client_id:CLIENT_ID,scope:SCOPES,include_granted_scopes:false,
      callback:async response=>{
        try{
          if(response.error||!response.access_token)throw new Error(response.error==='access_denied'?'Permiso cancelado. No se borró ninguna nota.':'Google no concedió el acceso: '+(response.error||'respuesta vacía'));
          if(!google.accounts.oauth2.hasGrantedAllScopes(response,'https://www.googleapis.com/auth/drive.file'))throw new Error('Autoriza el permiso para que MAUZI NOTE guarde sus archivos en TU Drive.');
          const r=await fetch('https://www.googleapis.com/oauth2/v3/userinfo',{headers:{Authorization:'Bearer '+response.access_token},cache:'no-store'});
          if(!r.ok)throw new Error('Google no pudo verificar la cuenta.');
          const info=await r.json();
          if(authSession!==session)throw new Error('La conexión cambió. Vuelve a tocar Conectar Google.');
          if(!$('noteModal').classList.contains('hidden'))throw new Error('Guarda y cierra la nota antes de terminar la conexión con Google.');
          if(!validId(info.sub)||!info.email||info.email_verified!==true)throw new Error('Google debe devolver un correo verificado.');
          if(previous&&previous!==info.sub&&!choose)throw new Error('Seleccionaste otra cuenta. Tus cambios NO se enviaron. Usa Cambiar cuenta Google para abrirla.');
          clearConnection();user={uid:info.sub,email:info.email};token=response.access_token;expiresAt=Date.now()+Math.max(1,Number(response.expires_in||3000)-45)*1000;activeRequestController=new AbortController();
          state=await putInitial(newWorkspace(user.uid,user.email));editorBase.clear();
          rememberActive();applyState();authMessage('Cuenta verificada. Recuperando tus notas de Google Drive…');
          transferSource='';$('guestTransferPanel').classList.add('hidden');
          if(sourceLocal)await offerGuestTransfer(sourceLocal);
          expiryTimer=setTimeout(()=>{token='';expiresAt=0;refreshStatus();},Math.max(1,expiresAt-Date.now()));scheduleFlush(0);
        }catch(e){authMessage(messageFor(e),true);A.toast(messageFor(e));}finally{finish();}
      },error_callback:e=>{authMessage(e.type==='popup_closed'?'Cerraste la ventana de Google. No se borró ninguna nota.':'Permite la ventana de Google o abre la app con Chrome/Safari.',true);finish();}});}catch(e){authMessage(messageFor(e),true);finish();return;}
    // Must remain synchronous inside the user's tap; never open an OAuth popup after an await.
    try{client.requestAccessToken(choose?{prompt:'select_account'}:{prompt:'',...(state&&!state.local?{hint:state.uid}:{})});}
    catch(e){authMessage(messageFor(e),true);finish();}
  }
  async function enterLocal(){
    // Keep the same local workspace across reloads and OAuth reauthorizations.
    // Never mix a Google user's cached workspace into this guest workspace.
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
    if(state?.queue.length&&!confirm('Hay cambios que todavía no llegaron a Drive. Se conservarán en la cuenta de este dispositivo. ¿Salir de Google y abrir las notas sin cuenta?'))return;
    clearConnection();state=null;editorBase.clear();A.closeSession();
    try{await enterLocal();A.toast('Ahora usas MAUZI NOTE sin cuenta. Las notas de Google se conservan.');}
    catch(e){authMessage(messageFor(e),true);}
  }
  async function localOnly(){
    if(state&&!state.local){await logout();return;}
    try{await enterLocal();}catch(e){authMessage(messageFor(e),true);}
  }
  async function localPayload(key){
    const source=await getWorkspace(key);if(!source?.local)return null;
    const modules=await window.MauziModules?.exportForKey?.(source.key);
    return {email:source.email,notes:visibleNotes(source),trash:Object.values(source.notes||{}).filter(n=>n.deleted).map(cleanNote),categories:clone(source.categories),modules:modules||null};
  }
  async function offerGuestTransfer(sourceKey){
    const destination=state?.key;const payload=await localPayload(sourceKey);
    if(state?.key!==destination||!payload)return;
    const records=payload.modules?.records?.filter(r=>!r.deleted&&r.kind!=='settings')||[];
    if(!payload.notes.length&&!payload.trash.length&&!records.length)return;
    transferSource=sourceKey;
    $('guestTransferDescription').textContent='Conectaste '+state.email+'. Tienes notas o favoritos/actividades guardados sin cuenta. ¿Quieres añadirlos a este Google Drive? La copia original del dispositivo se conserva.';
    $('guestTransferStatus').textContent='';$('guestTransferPanel').classList.remove('hidden');
    A.open('accountModal');
  }
  async function transferGuest(){
    if(transferBusy||!transferSource||!state||state.local)return;
    const key=state.key,sourceKey=transferSource;
    if(!validToken()){authMessage('Conecta Google primero para elegir la cuenta de destino.',true);return;}
    transferBusy=true;$('transferGuestBtn').disabled=true;$('skipGuestTransferBtn').disabled=true;refreshStatus();
    try{
      $('guestTransferStatus').textContent='Recuperando primero lo que ya está guardado en tu Drive…';
      await flush();if(state?.key!==key)throw new Error('La cuenta cambió. La copia local se conserva.');
      if(cloudError)throw new Error(cloudError);
      const payload=await localPayload(sourceKey);if(!payload)throw new Error('No se encontró esa copia local.');
      if(state?.key!==key)throw new Error('La cuenta cambió.');
      // Call the public importer so notes AND the modules participate, including image data.
      await window.MauziCloud.importPayload(payload);
      if(state?.key!==key)throw new Error('La cuenta cambió; revisa tus copias.');
      transferSource='';$('guestTransferPanel').classList.add('hidden');
      authMessage('Añadidas a esta cuenta. Espera la confirmación de Drive antes de cambiar de dispositivo.');
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
      for(const n of ns){const original=n.id;n.categoryId=mapping.get(n.categoryId)||s.categories[0].id;const same=Object.values(s.notes).find(x=>x.title===n.title&&x.contentHtml===n.contentHtml&&x.bgColor===n.bgColor&&x.deleted===n.deleted);if(same){idMap[original]=same.id;continue;}if(s.notes[n.id])n.id=id();idMap[original]=n.id;addOperation(s,n,'');}
    });scheduleFlush();return {idMap};
  }
  async function oldWorkspaces(){
    // Never create an empty old database just to look for a previous installation.
    if(indexedDB.databases){const ds=await indexedDB.databases();if(!ds.some(d=>d.name==='mauzi-note-private-v2'))return [];}
    return new Promise(resolve=>{const r=indexedDB.open('mauzi-note-private-v2');r.onupgradeneeded=()=>r.transaction.abort();r.onerror=()=>resolve([]);r.onsuccess=()=>{const d=r.result;if(!d.objectStoreNames.contains('workspaces')){d.close();resolve([]);return;}const q=d.transaction('workspaces').objectStore('workspaces').getAll();q.onsuccess=()=>{d.close();resolve(q.result||[]);};q.onerror=()=>{d.close();resolve([]);};};});
  }
  async function migrate(){
    if(!state||state.local)return;
    const candidates=[];const email=A.legacyEmail();if(email){const legacy=A.legacy(email);if(legacy.notes?.length)candidates.push({email,...legacy});}
    const d=await openStorage();const locals=await new Promise((resolve,reject)=>{const r=d.transaction('workspaces').objectStore('workspaces').getAll();r.onsuccess=()=>resolve(r.result||[]);r.onerror=()=>reject(r.error);});
    for(const s of [...locals.filter(s=>s.local),...await oldWorkspaces()]){
      const modules=s.local?await window.MauziModules?.exportForKey?.(s.key):null;
      if(Object.keys(s.notes||{}).length||modules?.records?.length)candidates.push({email:s.local?'Notas sin cuenta de este dispositivo':s.email,notes:visibleNotes(s),trash:Object.values(s.notes||{}).filter(n=>n.deleted),categories:s.categories,modules});
    }
    recoveryStart('Importar notas anteriores','Elige una copia de ESTE teléfono. No se borrará la original. Importa solamente notas que sean tuyas.');
    if(!candidates.length)txt($('recoveryHint'),'No hay copias antiguas en este navegador. En el archivo o navegador anterior usa Guardar copia y aquí usa Recuperar copia.');
    for(const data of candidates)recoveryCard({title:data.email||'Copia local',details:'Importar a '+state.email,content:'Incluye notas y colores de una versión anterior.',action:'Importar esta copia',run:async()=>{if(!confirm('¿Importar estas notas a '+state.email+'?'))return;await window.MauziCloud.importPayload(data);A.close('cloudRecoveryModal');A.toast('Importadas al teléfono. Espera la confirmación de Drive.');}});
  }
  function recoveryStart(title,hint){txt($('recoveryTitle'),title);txt($('recoveryHint'),hint);$('recoveryItems').replaceChildren();A.open('cloudRecoveryModal');}
  function recoveryCard({title,details,content,action,run}){const box=document.createElement('div');box.className='recovery-item';const h=document.createElement('h3'),small=document.createElement('small'),p=document.createElement('p'),button=document.createElement('button');h.textContent=title;small.textContent=details||'';p.textContent=content||'';button.className='secondary-btn';button.textContent=action;button.addEventListener('click',async()=>{button.disabled=true;try{await run();}catch(e){A.toast(messageFor(e));}finally{button.disabled=false;}});box.append(h,small,p,button);$('recoveryItems').append(box);}
  async function restoreNote(n){if(!confirm('¿Restaurar esta versión? El historial anterior se conserva.'))return;await mutate(s=>addOperation(s,{...cleanNote(n),deleted:false,updatedAt:Date.now()},s.notes[n.id]?.rev||''));scheduleFlush();A.close('cloudRecoveryModal');A.toast('Restaurada en el teléfono. Revisa la confirmación de Drive.');}
  async function showTrash(){if(!state)return;state=await getWorkspace(state.key);recoveryStart('Papelera','Estas notas no se eliminan automáticamente. Recuperar crea una nueva versión.');const rows=Object.values(state.notes).filter(n=>n.deleted);if(!rows.length)txt($('recoveryHint'),'La papelera está vacía.');for(const n of rows)recoveryCard({title:n.title||'Sin título',content:n.content,action:'Recuperar',run:()=>restoreNote(n)});}
  async function showHistory(){
    if(!state||!A.currentReadId())return;const nid=A.currentReadId();state=await getWorkspace(state.key);
    const versions=state.local?(state.localHistory[nid]||[]):(state.localHistory['note:'+nid]||[]);
    const pending=state.queue.filter(x=>x.kind==='note'&&x.entityId===nid).map(x=>({...x.data,rev:x.opId,serverAt:x.queuedAt,pending:true}));
    recoveryStart('Historial de la nota','Se conservan las versiones descargadas y pendientes. Conecta Google y sincroniza para traer las de otros teléfonos.');
    const rows=[...versions,...pending].sort((a,b)=>b.serverAt-a.serverAt);
    if(!rows.length)txt($('recoveryHint'),'Aún no hay versiones. Guarda la nota y sincroniza.');
    for(const n of rows)recoveryCard({title:n.title||'Sin título',details:new Date(n.serverAt||n.updatedAt).toLocaleString('es-GT')+(n.pending?' · Solo en el teléfono':n.conflict?' · Edición simultánea conservada':''),content:n.content,action:'Restaurar versión',run:()=>restoreNote(n)});
  }
  async function showAllHistory(){if(!state)return;recoveryStart('Recuperar de Google Drive','Las notas de Drive se recuperan automáticamente al conectar la misma cuenta. Aquí puedes abrir el historial de las notas descargadas.');for(const n of Object.values(state.notes))recoveryCard({title:n.title||'Sin título',content:n.deleted?'En papelera':n.content,action:n.deleted?'Recuperar nota':'Abrir nota',run:async()=>{if(n.deleted)await restoreNote(n);else{A.close('cloudRecoveryModal');window.openNoteReader(n.id);}}});}
  async function openDriveFolder(){if(!validToken()){login();return;}try{const c=context(),folder=await getFolder(c);txt($('driveStatus'),'Tus archivos están en Mi unidad → MAUZI NOTE. No los compartas ni los borres.');const a=$('openDriveLink');a.href='https://drive.google.com/drive/folders/'+encodeURIComponent(folder);a.classList.remove('hidden');}catch(e){txt($('driveStatus'),messageFor(e));}}

  channel?.addEventListener('message',async e=>{if(e.data?.key!==state?.key)return;const key=state.key;try{const s=await getWorkspace(key);if(state?.key===key&&s){state=s;applyState();}}catch(_){};});
  window.addEventListener('online',()=>{cloudError='';refreshStatus();if(!$('accountModal').classList.contains('hidden'))prepareGoogle();scheduleFlush();});
  window.addEventListener('offline',refreshStatus);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden){refreshStatus();scheduleFlush();}});
  setInterval(()=>{if(!document.hidden&&validToken())scheduleFlush();},60000);
  $('localOnlyBtn').addEventListener('click',localOnly);
  $('accountBtn').addEventListener('click',prepareGoogle);
  $('transferGuestBtn').addEventListener('click',transferGuest);
  $('skipGuestTransferBtn').addEventListener('click',()=>{transferSource='';$('guestTransferPanel').classList.add('hidden');authMessage('La copia sin cuenta sigue en este dispositivo. Puedes importarla después.');});
  $('googleAccountBtn').addEventListener('click',()=>login({choose:true}));
  $('syncNowBtn').addEventListener('click',()=>{cloudError='';if(!validToken())login();else scheduleFlush(0);refreshStatus();});
  $('migrateLocalBtn').addEventListener('click',()=>migrate().catch(e=>A.toast(messageFor(e))));
  $('openTrashBtn').addEventListener('click',()=>showTrash().catch(e=>A.toast(messageFor(e))));
  $('historyNoteBtn').addEventListener('click',()=>showHistory().catch(e=>A.toast(messageFor(e))));
  $('driveBackupBtn').addEventListener('click',openDriveFolder);
  $('driveRestoreBtn').addEventListener('click',()=>showAllHistory().catch(e=>A.toast(messageFor(e))));
  window.MauziCloud={save,login,logout,flush,importPayload,localOnly,config:()=>({clientId:CLIENT_ID,configured}),account:moduleAccount,moduleBridge,beginEdit(nid){editorBase.clear();if(nid)editorBase.set(nid,state?.notes[nid]?.rev||'');},getExport:()=>state?{notes:visibleNotes(),categories:clone(state.categories),trash:Object.values(state.notes).filter(n=>n.deleted).map(cleanNote),modules:window.MauziModules?.exportData()||null}:null};
  async function startApp(){
    try{
      await openStorage();let key='';try{key=localStorage.getItem(ACTIVE_KEY)||'';if(!key){const fallback=localStorage.getItem(ACTIVE_FALLBACK)||'';if(fallback.startsWith('local:')||fallback.startsWith(CLIENT_ID+':'))key=fallback;}}catch(_){}
      const cached=key?await getWorkspace(key):null;
      if(cached){state=cached;rememberActive();applyState();}else await enterLocal();
      $('retryLocalStorageBtn').classList.add('hidden');
      authMessage('');
      // No Google network request or sign-in popup occurs on startup.
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
