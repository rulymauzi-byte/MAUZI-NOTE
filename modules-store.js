/* MAUZI NOTE 5.0 — favoritos de la Biblia y agenda, sincronizados con Firestore.
   (Base: MAUZI NOTE 4 — separate journal for Bible favorites and agenda.)
   Does not change the v3 notes database, note revisions, Drive permissions or client ID.
   Every account has a separate workspace; Drive writes are acknowledged only after success.
   No access/refresh tokens are stored. App data is never uploaded to GitHub. */
(()=>{'use strict';
 const C=()=>window.MauziCloud, A=window.MauziApp, MARK='mauzi-note-modules-v4', DB='mauzi-note-modules-v4';
 const clone=v=>structuredClone(v), newid=()=>crypto.randomUUID?.()||Date.now().toString(36)+'_'+Math.random().toString(36).slice(2);
 const valid=s=>typeof s==='string'&&/^[\w-]{1,180}$/.test(s), limit=(v,n)=>String(v||'').slice(0,n);
 let dbp=null, active=null, data=null, loading=null, busy=false, again=false, timer=null, generation=0, syncTask=null;
 const channel=typeof BroadcastChannel==='function'?new BroadcastChannel('mauzi-note-modules-v4'):null;
 function openDB(){return dbp||(dbp=new Promise((resolve,reject)=>{const r=indexedDB.open(DB,1);r.onupgradeneeded=()=>r.result.createObjectStore('accounts',{keyPath:'key'});r.onerror=()=>{dbp=null;reject(new Error('No se pudo abrir el almacenamiento de favoritos y agenda.'));};r.onsuccess=()=>{r.result.onversionchange=()=>{r.result.close();dbp=null;};resolve(r.result);};}));}
 async function read(key){const d=await openDB();return new Promise((ok,no)=>{const r=d.transaction('accounts').objectStore('accounts').get(key);r.onsuccess=()=>ok(r.result);r.onerror=()=>no(r.error);});}
 async function change(key,fn){const d=await openDB();return new Promise((ok,no)=>{const t=d.transaction('accounts','readwrite'),o=t.objectStore('accounts'),r=o.get(key);let s,err;
 r.onsuccess=()=>{try{s=r.result||{key,records:{},queue:[],seen:{},journal:{},lastSync:0};fn(s);o.put(s);}catch(e){err=e;t.abort();}};
 t.oncomplete=()=>{if(active?.key===key){data=s;emit();}channel?.postMessage({key});ok(s);};t.onerror=t.onabort=()=>no(err||t.error||new Error('No hay espacio para guardar la agenda.'));});}
 function cleanPayload(kind,p){p=p||{};
  if(kind==='favorite'){
   if(!window.MauziBible.names[p.version]||!Object.values(window.MauziBible.books).includes(p.book)||!Number.isInteger(p.chapter)||p.chapter<1||p.chapter>150||!/^\d{1,3}(?:[-,]\d{1,3})*$/.test(p.verses))throw new Error('Favorito bíblico no válido.');
   return {version:p.version,book:p.book,chapter:p.chapter,verses:p.verses,name:limit(p.name,35)};
  }
  if(kind==='calendar'){
   if(!/^\d{4}-\d{2}-\d{2}$/.test(p.date)||!/^\d{2}:\d{2}$/.test(p.time)||!Number.isFinite(p.start)||p.start<0||!limit(p.title,120).trim())throw new Error('Revisa el título, la fecha y la hora de la actividad.');
   const reminder=Number(p.reminder);if(!Number.isInteger(reminder)||reminder < -1||reminder>40320)throw new Error('Recordatorio no válido.');
   return {title:limit(p.title,120).trim(),date:p.date,time:p.time,start:p.start,timeZone:limit(p.timeZone,100),allDay:!!p.allDay,duration:Math.max(5,Math.min(1440,Number(p.duration)||30)),reminder,noteId:limit(p.noteId,160),details:limit(p.details,1500),done:!!p.done,
    google:p.google&&typeof p.google==='object'?{calendarId:limit(p.google.calendarId,250),eventId:limit(p.google.eventId,200),signature:limit(p.google.signature,5000),link:/^https:\/\/(?:calendar\.google\.com|www\.google\.com)\//.test(p.google.link||'')?limit(p.google.link,1500):''}:null};
  }
  if(kind==='settings')return {calendarId:limit(p.calendarId,250)};
  throw new Error('Tipo de dato desconocido.');
 }
 function validate(r){if(!r||!valid(r.id)||!valid(r.rev)||r.parent&&!valid(r.parent))throw new Error('La agenda recibida no es válida.');return {id:r.id,rev:r.rev,parent:r.parent||'',kind:r.kind,payload:cleanPayload(r.kind,r.payload),deleted:!!r.deleted,updatedAt:Number(r.updatedAt)||Date.now(),serverAt:Number(r.serverAt)||0};}
 function emit(){window.dispatchEvent(new CustomEvent('mauzi:modules-changed',{detail:{key:active?.key,ready:!!data}}));status();}
 function status(){const el=document.getElementById('modulesSyncStatus');if(!el)return;el.textContent=!data?'Favoritos y agenda: abre tu cuenta.':data.error?'Favoritos y agenda: '+data.error:busy?'Favoritos y agenda: sincronizando…':active?.local?'Favoritos y agenda: copia de este dispositivo.':data.queue.length?'Favoritos y agenda: cambios pendientes en este dispositivo.':data.lastSync?'Favoritos y agenda: confirmados en la nube.':'Favoritos y agenda: conecta Google para recuperar.';}
 async function setAccount(a){if(a?.key===active?.key){active=a;if(a?.authorized&&!busy&&data?.queue.length)schedule();return;}
  generation++;active=a;data=null;emit();if(!a)return;const seq=generation;
  loading=change(a.key,()=>{});try{const loaded=await loading;if(seq!==generation)return;data=loaded;emit();schedule();}catch(e){A.toast(e.message);}finally{if(seq===generation)loading=null;}
 }
 async function ready(){if(loading)await loading;if(!active||!data)throw new Error('Abre tu cuenta antes de guardar favoritos o actividades.');}
 function list(kind,{deleted=false}={}){return Object.values(data?.records||{}).filter(r=>(!kind||r.kind===kind)&&(deleted||!r.deleted)).map(clone);}
 function get(id){return data?.records?.[id]?clone(data.records[id]):null;}
 async function save(kind,id,payload,{deleted=false}={}){await ready();id=id||newid();if(!valid(id))throw new Error('Identificador no válido.');const key=active.key,isLocal=active.local;
  await change(key,s=>{const r=validate({id,rev:newid(),parent:s.records[id]?.rev||'',kind,payload,deleted,updatedAt:Date.now()});s.records[id]=r;s.journal[r.rev]=r;if(!isLocal)s.queue.push({record:r,fileId:''});});schedule();return id;}
 async function remove(id){const r=get(id);if(r)await save(r.kind,r.id,r.payload,{deleted:true});}
 function schedule(delay=900){clearTimeout(timer);timer=setTimeout(()=>sync(),delay);}
 function check(b,key,seq){b.check();if(active?.key!==key||generation!==seq)throw new Error('La cuenta cambió. Los cambios permanecen en la cuenta original.');}
 function applyJournal(s){const groups=new Map();for(const r of Object.values(s.journal)){if(!groups.has(r.id))groups.set(r.id,[]);groups.get(r.id).push(r);}const pending=new Set(s.queue.map(q=>q.record.id));
  for(const [id,items] of groups){if(pending.has(id))continue;const parents=new Set(items.map(r=>r.parent));const heads=items.filter(r=>!parents.has(r.rev));if(!heads.length)throw new Error('Historial de agenda inconsistente; la copia local se conserva.');heads.sort((a,b)=>a.serverAt-b.serverAt||a.updatedAt-b.updatedAt||a.rev.localeCompare(b.rev));s.records[id]=clone(heads.at(-1));}
 }
 /* 5.0 — Firestore: users/{uid}/modules/{id} guarda la última revisión de cada favorito/actividad. */
 async function pull(b,key,seq){const f=b.fs,snapshot=await read(key);check(b,key,seq);
  const since=Math.max(0,(snapshot.cursor||0)-300000);
  const snap=await f.getDocs(f.query(f.collection(b.db,'users',b.uid,'modules'),f.where('syncAt','>',f.Timestamp.fromMillis(since))));check(b,key,seq);
  const rows=[];let cursor=snapshot.cursor||0;
  for(const d of snap.docs){const p=d.data();if(p.owner&&p.owner!==b.uid)continue;let r;try{r=validate(p.record);}catch(_){continue;}r.serverAt=p.syncAt?.toMillis?.()||0;cursor=Math.max(cursor,r.serverAt);rows.push(r);}
  await change(key,s=>{for(const r of rows){const old=s.journal[r.rev];if(!old)s.journal[r.rev]=r;else old.serverAt=r.serverAt;s.seen[r.rev]=true;}applyJournal(s);s.cursor=cursor;if(!s.queue.length)s.lastSync=Date.now();s.error='';});
 }
 async function send(b,key,seq,op){const f=b.fs;check(b,key,seq);
  await f.setDoc(f.doc(b.db,'users',b.uid,'modules',op.record.id),{owner:b.uid,record:JSON.parse(JSON.stringify(op.record)),syncAt:f.serverTimestamp()});check(b,key,seq);
  await change(key,s=>{const r={...op.record,serverAt:Date.now()};s.journal[r.rev]=r;s.seen[r.rev]=true;s.queue=s.queue.filter(q=>q.record.rev!==r.rev);applyJournal(s);});
 }
 /* Favoritos y agenda de la versión 4.x (Drive) del mismo correo: se copian una vez. */
 async function adoptLegacy(a){if(!a?.legacyKeys?.length||a.local)return;const cur=await read(a.key);if(cur?.legacyChecked)return;
  const rows=[];for(const k of a.legacyKeys){const old=await read(k);if(old)for(const r of Object.values(old.records||{}))rows.push(r);}
  await change(a.key,s=>{s.legacyChecked=true;for(const r of rows){if(s.records[r.id])continue;let v;try{v=validate({...r,rev:newid(),parent:''});}catch(_){continue;}s.records[v.id]=v;s.journal[v.rev]=v;s.queue.push({record:v,fileId:''});}});
 }
 function sync(){if(syncTask){again=true;return syncTask;}syncTask=performSync().finally(()=>{syncTask=null;});return syncTask;}
 async function performSync(){if(busy){again=true;return;}const current=C()?.account();if(current?.key===active?.key)active=current;if(!data||!active?.authorized||active.local||!navigator.onLine)return;
  busy=true;status();const key=active.key,seq=generation;try{const b=C().moduleBridge();await adoptLegacy(active);await pull(b,key,seq);let snapshot;
   while((snapshot=await read(key)).queue.length){check(b,key,seq);await send(b,key,seq,snapshot.queue[0]);}
  }catch(e){if(active?.key===key){data.error=e.code==='permission-denied'?'la nube no autorizó esta cuenta.':(e.message||'No se confirmó el guardado.');emit();}}
  finally{busy=false;status();if(again){again=false;schedule(1200);}}
 }
 async function importData(payload,{idMap={}}={}){if(!payload)return;await ready();if(payload.format!==MARK||!Array.isArray(payload.records))throw new Error('Respaldo de favoritos/agenda no válido.');
  const rows=payload.records.map(validate);if(rows.length>10000)throw new Error('El respaldo tiene demasiados actividades.');for(const r of rows){if(r.deleted)continue;const existing=get(r.id);if(existing)continue;if(r.kind==='settings'&&payload.owner!==active.uid)continue;if(r.kind==='calendar'){r.payload.noteId=idMap[r.payload.noteId]||r.payload.noteId;if(payload.owner!==active.uid)r.payload.google=null;}await save(r.kind,r.id,r.payload);}}
 async function exportForKey(key){
  if(typeof key!=='string'||!key.startsWith('local:'))return null;
  if(key===active?.key)await ready();
  const source=await read(key);if(!source)return null;
  return {format:MARK,owner:'local',records:Object.values(source.records||{}).map(clone)};
 }
 window.MauziModules={ready,list,get,save,remove,sync,exportForKey,account:()=>active?clone(active):null,isSyncing:()=>busy, syncState:()=>({lastSync:data?.lastSync||0,pending:data?.queue.length||0,error:data?.error||""}),
  exportData:()=>data?{format:MARK,owner:active.uid,records:Object.values(data.records).map(clone)}:null,importData,status,
  _validate:validate};
 const accountModal=document.getElementById('accountModal');if(accountModal){const e=document.createElement('p');e.id='modulesSyncStatus';e.className='module-status';accountModal.querySelector('.sheet').append(e);}
 window.addEventListener('mauzi:cloud-state',e=>setAccount(e.detail));
 channel?.addEventListener('message',async e=>{if(e.data?.key===active?.key){const d=await read(active.key);if(d?.key===active?.key){data=d;emit();}}});
 setInterval(()=>{if(!document.hidden)schedule(0);},30000);
 window.addEventListener('online',()=>{active=C()?.account();schedule(0);});
 document.addEventListener('visibilitychange',()=>{if(!document.hidden){active=C()?.account();schedule();}});
 setAccount(C()?.account());
 // Restore auxiliary records only after Drive's verified account importer has succeeded.
 if(C()){const old=C().importPayload;C().importPayload=async payload=>{const result=await old(payload);await importData(payload?.modules,result||{});return result;};}
})();
