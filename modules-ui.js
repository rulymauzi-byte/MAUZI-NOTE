/* MAUZI NOTE 4 — Bible, favorites, calendar and honest foreground reminders. */
(()=>{'use strict';
 const $=id=>document.getElementById(id),A=window.MauziApp,B=window.MauziBible,M=window.MauziModules;
 const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const svg=p=>`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
 const I={note:svg('<path d="M6 3h12a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM8 8h8M8 12h8M8 16h5"/>'),bible:svg('<path d="M12 5v16M12 5C8 2 4 3 2 4v15c4-1 7-1 10 2 3-3 6-3 10-2V4c-3-1-7-2-10 1"/>'),calendar:svg('<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M7 2v6M17 2v6M3 11h18M7 15h2M14 15h2"/>'),star:svg('<path d="m12 3 2.8 5.8 6.4.9-4.6 4.5 1.1 6.3-5.7-3-5.7 3 1.1-6.3-4.6-4.5 6.4-.9z"/>'),left:svg('<path d="m15 5-7 7 7 7"/>'),right:svg('<path d="m9 5 7 7-7 7"/>'),plus:svg('<path d="M12 4v16M4 12h16"/>'),close:svg('<path d="m6 6 12 12M18 6 6 18"/>'),bell:svg('<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/>'),check:svg('<path d="m4 12 5 5 11-11"/>')};
 const button=(id,label,icon,extra='')=>`<button id="${id}" type="button" class="module-icon" title="${label}" aria-label="${label}" ${extra}>${I[icon]}</button>`;
 const dateKey=d=>d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
 const today=()=>dateKey(new Date());
 const noteList=$('notesList').parentElement;
 const bible=document.createElement('section');bible.id='bibleSection';bible.className='module-section hidden';
 bible.innerHTML=`<div class="module-heading"><div><small>LECTURA SIN CONEXIÓN</small><h1>Biblia</h1></div>${button('bibleFavoritesToggle','Ver favoritos','star','aria-pressed="false"')}</div>
 <div class="bible-version-pills" id="libraryVersions">${Object.keys(B.names).map(v=>`<button type="button" data-lib-version="${v}" class="${v==='RVR1960'?'active':''}">${v==='RVR1960'?'RV60':v}</button>`).join('')}</div>
 <div id="bibleSelectors" class="bible-selectors"><select id="libraryBook" aria-label="Libro de la Biblia">${Object.entries(B.books).map(([name,code])=>`<option value="${code}" ${code==='MAT'?'selected':''}>${name}</option>`).join('')}</select><select id="libraryChapter" aria-label="Capítulo"><option>1</option></select></div>
 <form id="libraryReferenceForm" class="reference-search"><input id="libraryReference" placeholder="Ir a una cita: Mt. 3:5" aria-label="Referencia bíblica" enterkeyhint="go"><button type="submit">Ir</button></form>
 <div id="libraryReaderHeader" class="chapter-controls">${button('previousChapter','Capítulo anterior','left')}<strong id="libraryPassageTitle">Mateo 1</strong>${button('nextChapter','Capítulo siguiente','right')}</div>
 <div id="libraryText" class="library-paper" aria-live="polite"></div><div id="libraryFavorites" class="favorites-panel hidden"></div>`;
 const agenda=document.createElement('section');agenda.id='agendaSection';agenda.className='module-section hidden';
 agenda.innerHTML=`<div class="module-heading"><div><small>TUS ACTIVIDADES</small><h1>Agenda</h1></div><div class="heading-actions">${button('enableAgendaNotifications','Activar avisos en este dispositivo','bell')}${button('newAgendaEvent','Nueva actividad','plus')}</div></div>
 <div class="month-nav">${button('previousMonth','Mes anterior','left')}<strong id="agendaMonth"></strong>${button('nextMonth','Mes siguiente','right')}<button type="button" id="agendaToday">Hoy</button></div>
 <div class="calendar-week" aria-hidden="true"><span>L</span><span>M</span><span>X</span><span>J</span><span>V</span><span>S</span><span>D</span></div>
 <div id="agendaGrid" class="calendar-grid" role="group" aria-label="Elegir día"></div>
 <div class="agenda-date"><h2 id="agendaDayTitle"></h2><button id="allAgendaEvents" type="button">Próximas</button></div><div id="agendaEvents"></div>
 <details class="agenda-help"><summary>¿Cómo funcionan los avisos?</summary><p>La app puede avisar mientras permanece activa. Si está cerrada o el sistema la suspende, no puede garantizar una alarma.</p><p>Para recibir el aviso con MAUZI NOTE cerrada, guarda la actividad y usa <b>Activar en Google Calendar</b>. Google Calendar debe tener las notificaciones activadas en ese dispositivo. No se envía el contenido de tu nota.</p><a href="./ACTIVAR_RECORDATORIOS.html" target="_blank" rel="noopener">Preparar Google Calendar (una vez)</a></details>`;
 noteList.after(bible,agenda);
 const nav=document.createElement('nav');nav.id='moduleNav';nav.className='module-nav';nav.setAttribute('aria-label','Secciones de MAUZI NOTE');
 nav.innerHTML=[['notes','note','Notas'],['bible','bible','Biblia'],['agenda','calendar','Agenda']].map(([id,icon,name])=>`<button type="button" data-section="${id}" class="${id==='notes'?'active':''}" aria-label="Abrir ${name}" aria-pressed="${id==='notes'}">${I[icon]}<span>${name}</span></button>`).join('');$('mainApp').append(nav);
 let section='notes', version='RVR1960',bookCode='MAT',chapter=1,bookData=null,showFavorites=false,renderSequence=0;
 const bookName=code=>Object.keys(B.books).find(k=>B.books[k]===code)||code;
 const selectStateKey=()=> 'mauzi-bible-position:'+ (M.account()?.key||'guest');
 function selectSection(name){section=name;noteList.classList.toggle('hidden',name!=='notes');bible.classList.toggle('hidden',name!=='bible');agenda.classList.toggle('hidden',name!=='agenda');$('addNoteBtn').classList.toggle('hidden',name!=='notes');$('mainApp').dataset.section=name;
  nav.querySelectorAll('button').forEach(b=>{const on=b.dataset.section===name;b.classList.toggle('active',on);b.setAttribute('aria-pressed',String(on));});
  $('compactSearchPanel').classList.add('hidden');$('toggleSearchBtn').setAttribute('aria-expanded','false');
  if(name==='bible'){if(!bookData)loadChapter();else updateStars();}if(name==='agenda')renderCalendar();window.scrollTo({top:0,behavior:'auto'});
 }
 nav.addEventListener('click',e=>{const b=e.target.closest('[data-section]');if(b)selectSection(b.dataset.section);});
 function favoriteId(numbers){return 'fav_'+version+'_'+bookCode+'_'+chapter+'_'+numbers.join('_');}
 async function loadChapter({highlight=[]}={}){const seq=++renderSequence;$('libraryText').textContent='Abriendo Biblia guardada…';
  try{const data=await B.book(version,bookCode);if(seq!==renderSequence)return;bookData=data;const chapters=Object.keys(data).filter(c=>/^\d+$/.test(c)).map(Number).sort((a,b)=>a-b);if(!chapters.includes(chapter))chapter=chapters[0];
   $('libraryBook').value=bookCode;$('libraryChapter').innerHTML=chapters.map(c=>`<option value="${c}" ${c===chapter?'selected':''}>${c}</option>`).join('');$('libraryPassageTitle').textContent=bookName(bookCode)+' '+chapter;
   $('previousChapter').disabled=chapter===1&&bookCode==='GEN';$('nextChapter').disabled=chapter===chapters.at(-1)&&bookCode==='REV';
   $('libraryText').replaceChildren();for(const [numbers,text] of data[String(chapter)]){if(!text.trim())continue;
    const row=document.createElement('div');row.className='library-verse';row.id='libraryVerse_'+numbers[0];if(highlight.some(n=>numbers.includes(n)))row.classList.add('highlight-verse');
    const p=document.createElement('p'),num=document.createElement('sup'),span=document.createElement('span');num.textContent=B.label(numbers);span.textContent=text;p.append(num,span);
    const star=document.createElement('button');star.type='button';star.className='favorite-star';star.innerHTML=I.star;star.dataset.favoriteId=favoriteId(numbers);star.dataset.verses=numbers.join(',');star.setAttribute('aria-label','Guardar '+bookName(bookCode)+' '+chapter+':'+B.label(numbers)+' en favoritos');star.title='Guardar o quitar favorito';
    star.addEventListener('click',async()=>{star.disabled=true;try{const id=star.dataset.favoriteId,existing=M.get(id);if(existing&&!existing.deleted)await M.remove(id);else await M.save('favorite',id,{version,book:bookCode,name:bookName(bookCode),chapter,verses:star.dataset.verses});updateStars();}catch(e){A.toast(e.message);}finally{star.disabled=false;}});
    row.append(p,star);$('libraryText').append(row);
   }
   if(data[String(chapter)].some(r=>r[0].length>1)){const hint=document.createElement('p');hint.className='combined-verses';hint.textContent='Se conservan los versículos unidos y la numeración del archivo original.';$('libraryText').append(hint);}
   try{localStorage.setItem(selectStateKey(),JSON.stringify({version,bookCode,chapter}));}catch(_){}updateStars();
   if(highlight.length)setTimeout(()=>$('libraryVerse_'+highlight[0])?.scrollIntoView({block:'center',behavior:'smooth'}),40);
  }catch(e){if(seq===renderSequence)$('libraryText').textContent=e.message;}
 }
 function updateStars(){for(const el of document.querySelectorAll('[data-favorite-id]')){const r=M.get(el.dataset.favoriteId),on=!!r&&!r.deleted;el.classList.toggle('saved',on);el.setAttribute('aria-pressed',String(on));}if(showFavorites)renderFavorites();}
 function renderFavorites(){const rows=M.list('favorite').sort((a,b)=>b.updatedAt-a.updatedAt);const box=$('libraryFavorites');box.replaceChildren();
  if(!rows.length){box.innerHTML='<div class="module-empty">Toca una estrella junto a un versículo para guardarlo aquí.</div>';return;}
  for(const r of rows){const p=r.payload,card=document.createElement('div');card.className='favorite-card';const open=document.createElement('button');open.type='button';open.className='favorite-open';const h=document.createElement('strong'),small=document.createElement('span');h.textContent=p.name+' '+p.chapter+':'+p.verses;small.textContent=p.version==='RVR1960'?'RV60':p.version;open.append(h,small);open.onclick=()=>{version=p.version;bookCode=p.book;chapter=p.chapter;toggleFavorites(false);updateVersionButtons();loadChapter({highlight:p.verses.split(/[-,]/).map(Number)});};
   const remove=document.createElement('button');remove.type='button';remove.className='favorite-star saved';remove.innerHTML=I.star;remove.title='Quitar favorito';remove.setAttribute('aria-label','Quitar '+h.textContent+' de favoritos');remove.onclick=()=>M.remove(r.id).catch(e=>A.toast(e.message));card.append(open,remove);box.append(card);}
 }
 function toggleFavorites(force){showFavorites=typeof force==='boolean'?force:!showFavorites;$('bibleFavoritesToggle').classList.toggle('active',showFavorites);$('bibleFavoritesToggle').setAttribute('aria-pressed',String(showFavorites));for(const id of ['bibleSelectors','libraryReferenceForm','libraryReaderHeader','libraryText'])$(id).classList.toggle('hidden',showFavorites);$('libraryFavorites').classList.toggle('hidden',!showFavorites);if(showFavorites)renderFavorites();}
 function updateVersionButtons(){document.querySelectorAll('[data-lib-version]').forEach(el=>el.classList.toggle('active',el.dataset.libVersion===version));}
 $('bibleFavoritesToggle').onclick=()=>toggleFavorites();$('libraryVersions').onclick=e=>{const b=e.target.closest('[data-lib-version]');if(!b)return;version=b.dataset.libVersion;updateVersionButtons();if(!showFavorites)loadChapter();};
 $('libraryBook').onchange=()=>{bookCode=$('libraryBook').value;chapter=1;loadChapter();};$('libraryChapter').onchange=()=>{chapter=Number($('libraryChapter').value);loadChapter();};
 async function moveChapter(direction){if(!bookData)return;const count=Math.max(...Object.keys(bookData).filter(s=>/^\d+$/.test(s)).map(Number)),codes=Object.values(B.books);chapter+=direction;
  if(chapter>count){bookCode=codes[Math.min(codes.length-1,codes.indexOf(bookCode)+1)];chapter=1;}
  else if(chapter<1){bookCode=codes[Math.max(0,codes.indexOf(bookCode)-1)];const b=await B.book(version,bookCode);chapter=Math.max(...Object.keys(b).filter(s=>/^\d+$/.test(s)).map(Number));}
  await loadChapter();window.scrollTo({top:0,behavior:'smooth'});
 }
 $('previousChapter').onclick=()=>moveChapter(-1);$('nextChapter').onclick=()=>moveChapter(1);
 $('libraryReferenceForm').onsubmit=e=>{e.preventDefault();try{let s=$('libraryReference').value.trim();if(!s.includes(':'))s+=':1';const p=B.parse(s);bookCode=p.usfm;chapter=p.chapter;loadChapter({highlight:[...p.wanted]});}catch(err){A.toast(err.message);}};
 // ----- Event editor and calendar -----
 const dialog=document.createElement('div');dialog.id='agendaEventModal';dialog.className='modal-backdrop module-dialog hidden';dialog.innerHTML=`<section class="sheet module-sheet" role="dialog" aria-modal="true" aria-labelledby="agendaEditorTitle"><div class="module-dialog-head"><h2 id="agendaEditorTitle">Nueva actividad</h2>${button('closeAgendaEvent','Cerrar actividad','close')}</div>
 <form id="agendaEventForm"><input id="agendaEventId" type="hidden"><label for="agendaTitle">Actividad</label><input id="agendaTitle" class="field" required maxlength="120" placeholder="¿Qué quieres recordar?">
 <div class="event-row"><div><label for="agendaDate">Fecha</label><input id="agendaDate" class="field" type="date" required></div><div><label id="agendaTimeLabel" for="agendaTime">Hora</label><input id="agendaTime" class="field" type="time" required></div></div>
 <label class="check-row"><input type="checkbox" id="agendaAllDay"> Actividad para ese día (hora del aviso a la derecha)</label>
 <div class="event-row"><div><label for="agendaReminder">Recordar</label><select id="agendaReminder" class="field"><option value="0">A esa hora</option><option value="5">5 minutos antes</option><option value="15">15 minutos antes</option><option value="30">30 minutos antes</option><option value="60">1 hora antes</option><option value="1440">1 día antes</option><option value="-1">Sin aviso</option></select></div><div><label for="agendaDuration">Duración</label><select id="agendaDuration" class="field"><option value="15">15 minutos</option><option value="30" selected>30 minutos</option><option value="60">1 hora</option><option value="120">2 horas</option></select></div></div>
 <label for="agendaLinkedNote">Nota vinculada</label><select id="agendaLinkedNote" class="field"></select>
 <label for="agendaDetails">Detalle opcional</label><textarea id="agendaDetails" class="field" rows="2" maxlength="1500" placeholder="Lugar o indicaciones"></textarea>
 <p id="agendaEditorStatus" class="module-status" role="status"></p>
 <button id="saveAgendaEvent" class="primary-btn" type="submit">Guardar actividad</button>
 <button id="sendAgendaGoogle" class="secondary-btn" type="button">Guardar y activar en Google Calendar</button>
 <p class="event-disclosure">Google Calendar puede avisar con MAUZI NOTE cerrada. Necesita configuración inicial y permiso. La nota completa no se envía al calendario.</p>
 <div class="event-row"><button id="exportAgendaIcs" class="secondary-btn" type="button">Exportar .ics</button><button id="deleteAgendaEvent" class="danger-btn" type="button">Eliminar actividad</button></div>
 </form></section>`;document.body.append(dialog);
 let month=new Date(new Date().getFullYear(),new Date().getMonth(),1),selectedDate=today(),allEvents=false,editingRecord=null,eventBusy=false;
 function events(){return M.list('calendar').sort((a,b)=>a.payload.start-b.payload.start);}
 function renderCalendar(){const monthTitle=new Intl.DateTimeFormat('es-GT',{month:'long',year:'numeric'}).format(month);$('agendaMonth').textContent=monthTitle;
  const first=new Date(month),offset=(first.getDay()+6)%7;first.setDate(1-offset);const rows=events(),byDay=new Set(rows.filter(r=>!r.payload.done).map(r=>r.payload.date));
  $('agendaGrid').replaceChildren();for(let i=0;i<42;i++){const d=new Date(first);d.setDate(first.getDate()+i);const key=dateKey(d),b=document.createElement('button');b.type='button';b.className='calendar-day';b.textContent=d.getDate();b.classList.toggle('outside',d.getMonth()!==month.getMonth());b.classList.toggle('today',key===today());b.classList.toggle('selected',key===selectedDate);b.classList.toggle('has-events',byDay.has(key));b.setAttribute('aria-label',new Intl.DateTimeFormat('es-GT',{dateStyle:'full'}).format(d)+(byDay.has(key)?', con actividades':''));b.setAttribute('aria-pressed',String(key===selectedDate));b.onclick=()=>{selectedDate=key;allEvents=false;renderCalendar();};$('agendaGrid').append(b);}
  $('agendaDayTitle').textContent=allEvents?'Próximas actividades':new Intl.DateTimeFormat('es-GT',{weekday:'long',day:'numeric',month:'long'}).format(new Date(selectedDate+'T12:00:00'));
  $('allAgendaEvents').textContent=allEvents?'Ver día':'Próximas';const list=rows.filter(r=>allEvents?r.payload.start>=Date.now()-86400000:r.payload.date===selectedDate);
  const box=$('agendaEvents');box.replaceChildren();if(!list.length){box.innerHTML='<div class="module-empty">Sin actividades. Toca + para agendar.</div>';return;}
  for(const r of list){const p=r.payload,card=document.createElement('article');card.className='agenda-card';card.classList.toggle('completed',p.done);
   const main=document.createElement('button');main.type='button';main.className='agenda-open';main.innerHTML=`<span class="agenda-time">${esc(allEvents?p.date+' · ':'')}${esc(p.allDay?'Día · '+p.time:p.time)}</span><strong>${esc(p.title)}</strong><small>${esc(p.noteId?'Con nota vinculada':'Actividad personal')}${p.google?' · Google Calendar':''}${p.google&&p.google.signature!==calendarSignature(p)?' · actualizar aviso':''}</small>`;main.onclick=()=>openEvent(r.id);
   const done=document.createElement('button');done.type='button';done.className='module-icon complete-event';done.title=p.done?'Marcar pendiente':'Marcar realizada';done.setAttribute('aria-label',done.title);done.setAttribute('aria-pressed',String(p.done));done.innerHTML=I.check;done.onclick=async()=>{try{await M.save('calendar',r.id,{...p,done:!p.done});if(p.google)A.toast('Estado local actualizado. Google conserva su aviso hasta que lo canceles.');}catch(e){A.toast(e.message);}};card.append(main,done);
   if(p.noteId){const openNote=document.createElement('button');openNote.className='agenda-note-link';openNote.textContent='Abrir nota';openNote.onclick=()=>{if(!A.note(p.noteId)){A.toast('Esta nota no se ha descargado o está en la papelera.');return;}window.openNoteReader(p.noteId);};card.append(openNote);}box.append(card);
  }
 }
 function calendarSignature(p){return JSON.stringify([p.title,p.start,p.duration,p.reminder,p.details,p.allDay,p.noteId]);}
 function openEvent(id='',linkedNote=''){editingRecord=id?M.get(id):null;const p=editingRecord?.payload,n=A.note(linkedNote);$('agendaEventId').value=id;$('agendaEditorTitle').textContent=p?'Editar actividad':'Nueva actividad';
  $('agendaTitle').value=p?.title||n?.title||'';$('agendaDate').value=p?.date||selectedDate;$('agendaTime').value=p?.time||'09:00';$('agendaAllDay').checked=!!p?.allDay;$('agendaTimeLabel').textContent=p?.allDay?'Hora del aviso':'Hora';$('agendaReminder').value=String(p?.reminder??0);$('agendaDuration').value=String(p?.duration||30);$('agendaDetails').value=p?.details||'';
  $('agendaLinkedNote').replaceChildren(new Option('Sin nota vinculada',''));for(const item of A.snapshot().notes)$('agendaLinkedNote').append(new Option(item.title||'Sin título',item.id));$('agendaLinkedNote').value=p?.noteId||linkedNote||'';
  $('deleteAgendaEvent').classList.toggle('hidden',!p);$('exportAgendaIcs').classList.toggle('hidden',!p);$('agendaEditorStatus').textContent=p?.google?(p.google.signature===calendarSignature(p)?'Aviso enviado a Google Calendar.':'Actividad modificada: vuelve a activar en Google Calendar para actualizar su aviso.'):'Se guarda en tu cuenta y se sincroniza con tu Drive.';
  dialog.classList.remove('hidden');document.body.classList.add('has-modal');dialog.querySelector('.sheet').scrollTop=0;
 }
 function closeEvent(){if(eventBusy)return;dialog.classList.add('hidden');if(!document.querySelector('.modal-backdrop:not(.hidden)'))document.body.classList.remove('has-modal');}
 $('closeAgendaEvent').onclick=closeEvent;dialog.addEventListener('click',e=>{if(e.target===dialog)closeEvent();});
 function readEvent(){const date=$('agendaDate').value,time=$('agendaTime').value,local=new Date(date+'T'+time+':00');if(!Number.isFinite(local.getTime())||dateKey(local)!==date||local.getHours()!==Number(time.split(':')[0]))throw new Error('Revisa la fecha y la hora. Esa hora podría no existir por un cambio horario.');
  return {title:$('agendaTitle').value.trim(),date,time,start:local.getTime(),timeZone:Intl.DateTimeFormat().resolvedOptions().timeZone||'UTC',allDay:$('agendaAllDay').checked,duration:Number($('agendaDuration').value),reminder:Number($('agendaReminder').value),details:$('agendaDetails').value.trim(),noteId:$('agendaLinkedNote').value,done:editingRecord?.payload.done||false,google:editingRecord?.payload.google||null};}
 async function saveEvent(withGoogle=false){if(eventBusy)return;if(!$('agendaEventForm').reportValidity())return;
  let p,authorization;try{p=readEvent();if(withGoogle){if(p.reminder<0)throw new Error('Elige un recordatorio para enviarlo a Google Calendar.');authorization=window.MauziCalendarLink.authorize();authorization.catch(()=>{});}}catch(e){$('agendaEditorStatus').textContent=e.message;return;}
  eventBusy=true;$('saveAgendaEvent').disabled=true;$('sendAgendaGoogle').disabled=true;
  try{const id=await M.save('calendar',$('agendaEventId').value||undefined,p);$('agendaEventId').value=id;editingRecord=M.get(id);
   if(withGoogle){$('agendaEditorStatus').textContent='Esperando autorización de Google Calendar…';await authorization;await window.MauziCalendarLink.send(id);A.toast('Actividad guardada y aviso confirmado en Google Calendar.');}
   else A.toast(p.google?'Actividad guardada. Reenvía a Google para actualizar su aviso.':'Actividad guardada en este dispositivo. Se sincronizará con tu Drive.');
   selectedDate=p.date;month=new Date(p.date+'T12:00:00');month.setDate(1);eventBusy=false;closeEvent();renderCalendar();checkReminders();
  }catch(e){$('agendaEditorStatus').textContent=e.message||'No se pudo completar el guardado.';}finally{eventBusy=false;$('saveAgendaEvent').disabled=false;$('sendAgendaGoogle').disabled=false;}
 }
 $('agendaEventForm').onsubmit=e=>{e.preventDefault();saveEvent();};$('sendAgendaGoogle').onclick=()=>saveEvent(true);$('agendaAllDay').onchange=()=>{$('agendaTimeLabel').textContent=$('agendaAllDay').checked?'Hora del aviso':'Hora';};
 $('deleteAgendaEvent').onclick=async()=>{const r=M.get($('agendaEventId').value);if(!r)return;let authorization;
  if(r.payload.google){if(!confirm('Se cancelará también el aviso en Google Calendar. Se pedirá autorización si venció. ¿Continuar?'))return;authorization=window.MauziCalendarLink.authorize();authorization.catch(()=>{});}else if(!confirm('¿Eliminar esta actividad? La nota vinculada no se elimina.'))return;
  eventBusy=true;try{if(authorization){await authorization;await window.MauziCalendarLink.cancel(r);}await M.remove(r.id);eventBusy=false;closeEvent();renderCalendar();A.toast('Actividad eliminada. La nota sigue intacta.');}catch(e){$('agendaEditorStatus').textContent='No se eliminó la actividad: '+e.message;}finally{eventBusy=false;}};
 $('previousMonth').onclick=()=>{month.setMonth(month.getMonth()-1);renderCalendar();};$('nextMonth').onclick=()=>{month.setMonth(month.getMonth()+1);renderCalendar();};$('agendaToday').onclick=()=>{selectedDate=today();month=new Date(new Date().getFullYear(),new Date().getMonth(),1);allEvents=false;renderCalendar();};$('allAgendaEvents').onclick=()=>{allEvents=!allEvents;renderCalendar();};$('newAgendaEvent').onclick=()=>openEvent();
 const sendFromNote=document.createElement('button');sendFromNote.type='button';sendFromNote.id='agendaFromNoteBtn';sendFromNote.className='reader-tool';sendFromNote.innerHTML=I.calendar;sendFromNote.title='Agendar esta nota';sendFromNote.setAttribute('aria-label','Agendar esta nota');$('readFocusBtn').before(sendFromNote);sendFromNote.onclick=()=>{selectedDate=today();openEvent('',A.currentReadId());};
 function exportIcs(r){const p=r.payload,escape=s=>String(s||'').replace(/\\/g,'\\\\').replace(/\r?\n/g,'\\n').replace(/;/g,'\\;').replace(/,/g,'\\,'),stamp=ts=>new Date(ts).toISOString().replace(/[-:]/g,'').replace(/\.\d{3}Z$/,'Z');
  const lines=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//MAUZI NOTE//Agenda//ES','CALSCALE:GREGORIAN','BEGIN:VEVENT','UID:'+r.id+'@mauzi-note','DTSTAMP:'+stamp(Date.now()),'DTSTART:'+stamp(p.start),'DTEND:'+stamp(p.start+p.duration*60000),'SUMMARY:'+escape(p.title),'DESCRIPTION:'+escape(p.details+'\nActividad de MAUZI NOTE. La nota completa permanece privada.')];
  if(p.reminder>=0)lines.push('BEGIN:VALARM','TRIGGER:-PT'+p.reminder+'M','ACTION:DISPLAY','DESCRIPTION:'+escape(p.title),'END:VALARM');lines.push('END:VEVENT','END:VCALENDAR');
  const folded=lines.map(line=>{let s='',n=0;for(const c of line){const b=new TextEncoder().encode(c).length;if(n+b>72){s+='\r\n ';n=1;}s+=c;n+=b;}return s;}).join('\r\n')+'\r\n',url=URL.createObjectURL(new Blob([folded],{type:'text/calendar;charset=utf-8'})),a=document.createElement('a');a.href=url;a.download='MAUZI_NOTE_actividad.ics';a.click();setTimeout(()=>URL.revokeObjectURL(url),5000);
 }
 $('exportAgendaIcs').onclick=()=>{const r=M.get($('agendaEventId').value);if(r)exportIcs(r);};
 // Foreground-only notifications. There is NO fake background timer in the worker.
 const alert=document.createElement('div');alert.id='agendaReminderBanner';alert.className='reminder-banner hidden';alert.innerHTML='<div><strong>Recordatorio</strong><span id="agendaReminderText"></span></div><button id="openReminderEvent" type="button">Ver</button><button id="closeReminderBanner" type="button" aria-label="Cerrar recordatorio">×</button>';document.body.append(alert);let reminderId='',checking=false;
 $('closeReminderBanner').onclick=()=>alert.classList.add('hidden');$('openReminderEvent').onclick=()=>{alert.classList.add('hidden');selectSection('agenda');openEvent(reminderId);};
 async function enableNotifications(){if(!('Notification'in window)){A.toast('Este navegador no ofrece avisos. Usa Google Calendar para recibirlos.');return;}try{const permission=await Notification.requestPermission();A.toast(permission==='granted'?'Avisos activados mientras la app esté activa.':'Sin permiso. Puedes usar Google Calendar.');if(permission==='granted')checkReminders();}catch(_){A.toast('Activa las notificaciones desde los ajustes del navegador.');}}
 $('enableAgendaNotifications').onclick=enableNotifications;
 async function checkReminders(){const acc=M.account();if(!acc||checking||document.hidden)return;checking=true;const key='mauzi-agenda-notified:'+acc.key;let seen={};try{seen=JSON.parse(localStorage.getItem(key)||'{}');}catch(_){}
  try{let shown=0;for(const r of events()){const p=r.payload;if(p.done||p.reminder<0)continue;const due=p.start-p.reminder*60000,tag=r.id+':'+due;if(due>Date.now()||Date.now()-due>7*86400000||seen[tag])continue;
    if(M.account()?.key!==acc.key)break;reminderId=r.id;$('agendaReminderText').textContent=p.title+(Date.now()-due>60000?' · pendiente desde '+new Date(due).toLocaleString('es-GT'):'');alert.classList.remove('hidden');
    if('Notification'in window&&Notification.permission==='granted'){const options={body:p.title,tag:'mauzi-agenda-'+r.id,icon:'./icons/icon-192.png',badge:'./icons/favicon-32.png',data:{eventId:r.id,account:acc.key}};
     try{const reg=await navigator.serviceWorker?.getRegistration();if(reg)await reg.showNotification('MAUZI NOTE · Recordatorio',options);else {const n=new Notification('MAUZI NOTE · Recordatorio',options);n.onclick=()=>{window.focus();selectSection('agenda');openEvent(r.id);};}}catch(_){}
    }
    seen[tag]=Date.now();try{const entries=Object.entries(seen).slice(-1000);localStorage.setItem(key,JSON.stringify(Object.fromEntries(entries)));}catch(_){}if(++shown>=3)break;
   }
  }finally{checking=false;}
 }
 setInterval(checkReminders,10000);document.addEventListener('visibilitychange',()=>{if(!document.hidden)checkReminders();});
 window.addEventListener('mauzi:modules-changed',()=>{updateStars();if(section==='agenda')renderCalendar();checkDeepLink();});
 window.addEventListener('mauzi:cloud-state',e=>{if(!e.detail){alert.classList.add('hidden');closeEvent();} });
 document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!dialog.classList.contains('hidden')){e.preventDefault();e.stopImmediatePropagation();closeEvent();}},true);
 navigator.serviceWorker?.addEventListener('message',e=>{if(e.data?.type==='MAUZI_OPEN_EVENT'&&(!e.data.account||e.data.account===M.account()?.key)){selectSection('agenda');if(M.get(e.data.eventId))openEvent(e.data.eventId);}});
 let handledHash='';function checkDeepLink(){const hash=location.hash;if(hash===handledHash)return;const m=hash.match(/^#agenda=([\w-]+)$/);if(m&&M.get(m[1])){handledHash=hash;selectSection('agenda');openEvent(m[1]);}}
 window.addEventListener('hashchange',checkDeepLink);
 window.MauziSections={select:selectSection,openEvent,calendarSignature,exportIcs,checkReminders,loadChapter,icons:I};
 // Favorites work from a verse popup as well as from the full Bible.
 const popupHead=$('bibleModal')?.querySelector('.bible-head');if(popupHead){const star=document.createElement('button');star.id='favoritePopupVerse';star.type='button';star.className='module-icon';star.innerHTML=I.star;star.title='Guardar esta cita en favoritos';star.setAttribute('aria-label',star.title);popupHead.insertBefore(star,popupHead.lastElementChild);star.onclick=async()=>{try{const ref=$('biblePassageTitle').textContent,v=document.querySelector('#bibleModal .bible-version.active')?.dataset.bibleVersion||'RVR1960',p=B.parse(ref),numbers=[...p.wanted];const id='fav_'+v+'_'+p.usfm+'_'+p.chapter+'_'+numbers.join('_');if(M.get(id)&&!M.get(id).deleted){await M.remove(id);A.toast('Favorito retirado');}else{await M.save('favorite',id,{version:v,book:p.usfm,name:p.book,chapter:p.chapter,verses:numbers.join(',')});A.toast('Cita guardada en favoritos de Biblia');}}catch(e){A.toast(e.message);}};}
})();
