/* Optional Google Calendar delivery. No tokens in localStorage, URLs, GitHub or Drive.
   calendar.app.created grants only app-created secondary calendars, not all calendars.
   A successful API response is required before the UI confirms a scheduled Google reminder. */
(()=>{'use strict';
 const M=window.MauziModules,A=window.MauziApp,SCOPE='https://www.googleapis.com/auth/calendar.app.created';
 let token='',expires=0,accountKey='',pending=null,authEpoch=0;
 function identity(){const a=M.account();if(!a||a.local)throw new Error('Conecta primero tu cuenta Google en MAUZI NOTE.');return a;}
 function check(a){if(M.account()?.key!==a.key)throw new Error('Cambiaste de cuenta. No se enviará la actividad a otra persona.');}
 function valid(){return !!token&&Date.now()<expires&&accountKey===M.account()?.key;}
 async function json(path,options={},a=identity()){
  check(a);if(!valid())throw new Error('Vuelve a tocar Activar en Google Calendar para renovar el permiso.');
  if(!path.startsWith('https://www.googleapis.com/calendar/v3/'))throw new Error('Dirección de calendario no permitida.');
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),30000);
  try{const r=await fetch(path,{...options,cache:'no-store',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token,...options.headers},signal:controller.signal});check(a);
   if(!r.ok){let d={};try{d=await r.json();}catch(_){}const e=new Error(d.error?.message||'Google no confirmó el aviso.');e.status=r.status;
    if(r.status===401){token='';e.message='El permiso de Calendar venció. Vuelve a activar el aviso.';}
    if(r.status===403)e.message='Google Calendar no autorizó esta acción. Activa Google Calendar API en el mismo proyecto y el permiso calendar.app.created. Consulta ACTIVAR_RECORDATORIOS.html. '+(d.error?.message||'');
    throw e;
   }return r.status===204?{}:r.json();
  }catch(e){if(e.name==='AbortError')throw new Error('Google no respondió a tiempo. El aviso no está confirmado; vuelve a intentar.');throw e;}finally{clearTimeout(timer);}
 }
 function authorize(){
  const a=identity();if(!navigator.onLine)return Promise.reject(new Error('Necesitas internet para confirmar el aviso en Google Calendar.'));
  if(valid())return Promise.resolve();if(pending)return pending;
  if(!window.google?.accounts?.oauth2)return Promise.reject(new Error('Google todavía está cargando. Conecta Google en Mi cuenta y vuelve a tocar este botón.'));
  const clientId=String(window.MAUZI_GOOGLE_CLIENT_ID||'');if(!clientId.endsWith('.apps.googleusercontent.com'))return Promise.reject(new Error('Falta el ID público de Google. Conserva google-config.js.'));
  const epoch=++authEpoch;
  pending=new Promise((ok,no)=>{
   const timeout=setTimeout(()=>{pending=null;no(new Error('La autorización de Calendar no terminó. Vuelve a intentarlo.'));},180000);
   function fail(e){clearTimeout(timeout);pending=null;no(e);}
   const c=google.accounts.oauth2.initTokenClient({client_id:clientId,scope:'openid email '+SCOPE,include_granted_scopes:true,hint:a.email,
    error_callback:()=>fail(new Error('Se cerró o bloqueó la ventana de Google. Permite la ventana emergente y vuelve a intentar.')),
    callback:async response=>{try{if(epoch!==authEpoch)throw new Error('La cuenta cambió durante la autorización.');if(response.error||!response.access_token)throw new Error('No se autorizó Google Calendar. Tus notas y tu actividad se conservan.');
     if(!google.accounts.oauth2.hasGrantedAllScopes(response,SCOPE))throw new Error('Falta autorizar la creación del calendario de MAUZI NOTE.');
     const abort=new AbortController(),t=setTimeout(()=>abort.abort(),20000);let u;try{const r=await fetch('https://www.googleapis.com/oauth2/v3/userinfo',{headers:{Authorization:'Bearer '+response.access_token},signal:abort.signal,cache:'no-store'});if(!r.ok)throw new Error('Google no verificó la identidad de Calendar.');u=await r.json();}finally{clearTimeout(t);}
     check(a);if(u.sub!==a.uid)throw new Error('Seleccionaste otra cuenta. Elige '+a.email+' también para Calendar.');
     token=response.access_token;expires=Date.now()+Math.max(0,(Number(response.expires_in)||3600)-90)*1000;accountKey=a.key;clearTimeout(timeout);pending=null;ok();
    }catch(e){fail(e);}}
   });
   // Called synchronously from the explicit button click, never by a background timer.
   c.requestAccessToken({prompt:'',hint:a.email});
  });return pending;
 }
 async function ownCalendar(a){await M.sync();check(a);if(M.syncState().error||!M.syncState().lastSync)throw new Error('Primero sincroniza favoritos y agenda con Drive; así evitamos crear un calendario duplicado.');const setting=M.get('google-calendar-settings');
  if(setting&&!setting.deleted&&setting.payload.calendarId)return setting.payload.calendarId;
  const created=await json('https://www.googleapis.com/calendar/v3/calendars',{method:'POST',body:JSON.stringify({summary:'MAUZI NOTE · Agenda',description:'Recordatorios que envías expresamente desde MAUZI NOTE. No contiene tus notas completas.',timeZone:Intl.DateTimeFormat().resolvedOptions().timeZone||'UTC'})},a);
  if(!created.id)throw new Error('Google no confirmó el calendario.');await M.save('settings','google-calendar-settings',{calendarId:created.id});await M.sync();check(a);return created.id;
 }
 async function remoteEventId(a,id){const raw=new TextEncoder().encode(a.key+'|'+id),hash=await crypto.subtle.digest('SHA-256',raw);return 'mn'+Array.from(new Uint8Array(hash)).map(n=>n.toString(16).padStart(2,'0')).join('');}
 function body(p,id,recordId){const url=new URL('./',location.href);url.hash='agenda='+recordId;
  return {id,summary:p.title,description:(p.allDay?'Actividad para todo el día; el evento indica la hora elegida para recordar.\n':'')+p.details+'\nAbrir MAUZI NOTE: '+url.href,
   start:{dateTime:new Date(p.start).toISOString(),timeZone:p.timeZone||'UTC'},end:{dateTime:new Date(p.start+p.duration*60000).toISOString(),timeZone:p.timeZone||'UTC'},
   reminders:{useDefault:false,overrides:p.reminder>=0?[{method:'popup',minutes:p.reminder}]:[]},visibility:'private',transparency:'transparent',extendedProperties:{private:{mauziNoteEvent:recordId}}};
 }
 async function send(id){const a=identity();check(a);if(!valid())throw new Error('Autoriza Calendar primero.');const record=M.get(id);if(!record||record.deleted)throw new Error('No se encontró la actividad.');const p=record.payload;if(p.start-p.reminder*60000<Date.now()-60000)throw new Error('La hora del recordatorio ya pasó. Elige una fecha futura para activar el aviso.');
  const calendar=p.google?.calendarId||await ownCalendar(a),eid=p.google?.eventId||await remoteEventId(a,id);check(a);
  const base='https://www.googleapis.com/calendar/v3/calendars/'+encodeURIComponent(calendar)+'/events',payload=body(p,eid,id);let result;
  // Deterministic IDs make lost responses safe to retry without duplicate events.
  try{result=await json(base,{method:'POST',body:JSON.stringify(payload)},a);}catch(e){if(e.status!==409)throw e;const update={...payload};delete update.id;result=await json(base+'/'+encodeURIComponent(eid),{method:'PATCH',body:JSON.stringify(update)},a);}
  if(!result.id||result.status==='cancelled')throw new Error('Google no confirmó un aviso activo.');check(a);
  const latest=M.get(id);if(!latest||latest.deleted)throw new Error('La actividad cambió. Revisa el evento creado en Google Calendar.');
  const signature=window.MauziSections.calendarSignature(p);await M.save('calendar',id,{...latest.payload,google:{calendarId:calendar,eventId:result.id,link:result.htmlLink||'',signature}});await M.sync();
 }
 async function cancel(record){const a=identity(),g=record.payload.google;if(!g)return;try{await json('https://www.googleapis.com/calendar/v3/calendars/'+encodeURIComponent(g.calendarId)+'/events/'+encodeURIComponent(g.eventId),{method:'DELETE'},a);}catch(e){if(![404,410].includes(e.status))throw e;}}
 window.addEventListener('mauzi:cloud-state',e=>{if(accountKey&&e.detail?.key!==accountKey){authEpoch++;token='';expires=0;accountKey='';}});
 window.MauziCalendarLink={authorize,send,cancel,isAuthorized:valid,_body:body};
})();
