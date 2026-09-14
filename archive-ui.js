/* MAUZI NOTE 4.4 — years and nested folders, same account and existing journal.
   Empty selections are only local until a note is saved there; real folders are
   created in that user's Drive by drive-sync.js. No remote personal data here. */
(()=>{'use strict';
 const $=id=>document.getElementById(id),A=window.MauziApp,K=window.MauziArchiveCore;
 if(!A||!K)return;
 const svg=p=>`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
 const folderIcon=svg('<path d="M3 7V5a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z"/><path d="M3 9h18"/>');
 const chevron=svg('<path d="m8 10 4 4 4-4"/>');
 let key='',choice={year:'*',folder:'*'},draft={archiveYear:K.currentYear(),folderPath:''},extraYears=[],extraFolders={},inReader=false,readId='',selectionAccount='',raf=0;
 function accountKey(){return window.MauziCloud?.account()?.key||'';}
 function prefs(){if(!key)return;try{localStorage.setItem('mauzi-note:archive-view:'+key,JSON.stringify({choice,extraYears,extraFolders}));}catch(_){} }
 function ensureAccount(){const next=accountKey();if(next===key)return;key=next;choice={year:'*',folder:'*'};extraYears=[];extraFolders={};
  try{const p=JSON.parse(localStorage.getItem('mauzi-note:archive-view:'+key)||'{}');
   if(p.choice){choice.year=p.choice.year==='*'?'*':K.year(p.choice.year);choice.folder=p.choice.folder==='*'?'*':K.path(p.choice.folder);}
   extraYears=(p.extraYears||[]).map(K.year);for(const [y,paths]of Object.entries(p.extraFolders||{}))extraFolders[K.year(y)]=paths.map(K.path);
  }catch(_){choice={year:'*',folder:'*'};extraYears=[];extraFolders={};}
 }
 const entries=()=>A.archiveEntries?A.archiveEntries():A.snapshot().notes;
 const location=n=>K.location(n);
 function active(){return choice.year!=='*'||choice.folder!=='*';}
 function pathLabel(){return (choice.year==='*'?'Todos los años':choice.year)+(choice.folder==='*'?'':choice.folder?' / '+choice.folder:' / Sin carpeta');}
 const bar=document.createElement('div');bar.className='archive-bar';bar.id='archiveBar';
 bar.innerHTML=`<button type="button" id="archiveBrowseBtn" aria-haspopup="dialog" aria-controls="archiveBrowserModal">${folderIcon}<span id="archiveCurrentLocation">Todos los años</span>${chevron}</button><button type="button" id="archiveClearBtn" aria-label="Mostrar todos los años y carpetas" title="Quitar filtro de archivo" hidden>×</button>`;
 $('notesList').before(bar);
 const modal=document.createElement('div');modal.className='modal-backdrop hidden';modal.id='archiveBrowserModal';modal.setAttribute('role','dialog');modal.setAttribute('aria-modal','true');modal.setAttribute('aria-labelledby','archiveBrowserTitle');
 modal.innerHTML=`<div class="sheet archive-sheet"><div class="sheet-head"><div><small class="archive-eyebrow">ARCHIVO PERSONAL</small><h2 id="archiveBrowserTitle">Años y carpetas</h2></div><button type="button" class="close" data-close="archiveBrowserModal" aria-label="Cerrar archivo">×</button></div>
 <p class="archive-help">Encuentra tus notas por año, carpeta y categoría. No hay una lista de años que se termine.</p>
 <button type="button" id="archiveAllBtn" class="archive-all">Todas mis notas</button>
 <h3 class="archive-step">Año</h3><div id="archiveYearList" class="archive-year-list" role="group" aria-label="Años de las notas"></div>
 <form id="archiveYearForm" class="archive-input-row"><input id="archiveNewYear" inputmode="numeric" autocomplete="off" placeholder="Escribe otro año" aria-label="Otro año"><button type="submit">Usar año</button></form>
 <h3 class="archive-step">Carpeta</h3><div id="archiveFolderList" class="archive-folder-list" role="group" aria-label="Carpetas de las notas"></div>
 <form id="archiveFolderForm" class="archive-input-row"><input id="archiveNewFolder" autocomplete="off" placeholder="Ej.: Predicaciones / Jóvenes" aria-label="Carpeta o subcarpeta"><button type="submit">Usar carpeta</button></form>
 <p class="archive-help archive-fine">Las carpetas nuevas se crean en Drive al guardar su primera nota y sincronizar. Los años vacíos elegidos aquí se recuerdan solo en este dispositivo.</p>
 <button type="button" id="archiveShowBtn" class="primary-btn">Ver notas</button></div>`;
 document.body.append(modal);
 function refreshBar(){ensureAccount();$('archiveCurrentLocation').textContent=pathLabel();$('archiveBrowseBtn').title='Organizar: '+pathLabel();bar.classList.toggle('archive-filtered',active());$('archiveClearBtn').hidden=!active();}
 function choose(y,f){choice={year:y==='*'?'*':K.year(y),folder:f==='*'?'*':K.path(f)};prefs();refreshBar();A.refreshNotes();renderBrowser();}
 function choiceButton(label,selected,run,cls){const b=document.createElement('button');b.type='button';b.className=cls;b.textContent=label;b.setAttribute('aria-pressed',String(selected));b.onclick=run;return b;}
 function years(){return [...new Set([K.currentYear(),...extraYears,...entries().map(n=>location(n).archiveYear),...(choice.year==='*'?[]:[choice.year])])].sort((a,b)=>-K.compareYears(a,b));}
 function folders(y){const set=new Set(extraFolders[y]||[]);for(const n of entries()){const l=location(n);if(y!=='*'&&l.archiveYear!==y)continue;const parts=l.folderPath.split('/').filter(Boolean);for(let i=1;i<=parts.length;i++)set.add(parts.slice(0,i).join('/'));}if(choice.folder!=='*'&&choice.folder)set.add(choice.folder);return [...set].filter(Boolean).sort((a,b)=>a.localeCompare(b,'es',{numeric:true}));}
 function renderBrowser(){
  if(modal.classList.contains('hidden'))return;
  const yl=$('archiveYearList'),fl=$('archiveFolderList');yl.replaceChildren();fl.replaceChildren();
  yl.append(choiceButton('Todos',choice.year==='*',()=>choose('*','*'),'archive-year'));
  for(const y of years())yl.append(choiceButton(y,choice.year===y,()=>choose(y,'*'),'archive-year'));
  fl.append(choiceButton('Todas las carpetas',choice.folder==='*',()=>choose(choice.year,'*'),'archive-folder'));
  fl.append(choiceButton('Sin carpeta',choice.folder==='',()=>choose(choice.year,''),'archive-folder'));
  for(const f of folders(choice.year)){const b=choiceButton(f,choice.folder===f,()=>choose(choice.year,f),'archive-folder');b.prepend(document.createTextNode('📂 '));fl.append(b);}
  $('archiveAllBtn').setAttribute('aria-pressed',String(!active()));
 }
 function openBrowser(){ensureAccount();A.open('archiveBrowserModal');renderBrowser();}
 $('archiveBrowseBtn').onclick=openBrowser;
 $('archiveClearBtn').onclick=()=>choose('*','*');$('archiveAllBtn').onclick=()=>choose('*','*');
 $('archiveShowBtn').onclick=()=>A.close('archiveBrowserModal');
 modal.querySelector('[data-close]').onclick=()=>A.close('archiveBrowserModal');modal.addEventListener('click',e=>{if(e.target===modal)A.close('archiveBrowserModal');});
 $('archiveYearForm').onsubmit=e=>{e.preventDefault();try{const y=K.year($('archiveNewYear').value);if(!extraYears.includes(y))extraYears.push(y);choose(y,'*');$('archiveNewYear').value='';}catch(err){A.toast(err.message);}};
 $('archiveFolderForm').onsubmit=e=>{e.preventDefault();try{const f=K.path($('archiveNewFolder').value);if(!f)throw Error('Escribe un nombre para la carpeta.');const y=choice.year==='*'?K.currentYear():choice.year;extraFolders[y]=[...new Set([...(extraFolders[y]||[]),f])];choose(y,f);$('archiveNewFolder').value='';}catch(err){A.toast(err.message);}};
 // Location is in the upper properties popover, never at the bottom of the note.
 const prop=document.createElement('details');prop.id='archiveNoteProperties';prop.className='archive-note-properties';
 prop.innerHTML='<summary><span>Año y carpeta</span><small id="archiveNoteSummary"></small></summary><label for="archiveNoteYear">Año de esta nota</label><input id="archiveNoteYear" inputmode="numeric" autocomplete="off" class="field" list="archiveYearsHints"><datalist id="archiveYearsHints"></datalist><label for="archiveNotePath">Carpeta · / para subcarpetas</label><input id="archiveNotePath" autocomplete="off" class="field" list="archiveFoldersHints" placeholder="Sin carpeta"><datalist id="archiveFoldersHints"></datalist><button type="button" id="archiveApplyLocation" class="secondary-btn">Guardar ubicación</button><p id="archiveNoteLocationHint" class="archive-help"></p>';
 $('noteProperties').insertBefore(prop,$('deleteNoteBtn'));
 function updateSummary(){let text=$('archiveNoteYear').value.trim();const f=$('archiveNotePath').value.trim();if(f)text+=' / '+f;$('archiveNoteSummary').textContent=text;}
 function hints(y){const yh=$('archiveYearsHints'),fh=$('archiveFoldersHints');yh.replaceChildren();fh.replaceChildren();for(const a of years()){const o=document.createElement('option');o.value=a;yh.append(o);}for(const f of folders(y)){const o=document.createElement('option');o.value=f;fh.append(o);}}
 function properties(read){inReader=!!read;selectionAccount=accountKey();readId=A.currentReadId();const n=read?A.note(readId):null,loc=read?location(n||{}):draft;
  $('archiveNoteYear').value=loc.archiveYear;$('archiveNotePath').value=loc.folderPath;prop.open=false;
  $('archiveApplyLocation').textContent=read?'Mover nota':'Elegir ubicación';
  $('archiveNoteLocationHint').textContent=read?'Con internet y Google conectado también se moverá su carpeta en Drive.':'Guarda el contenido con ✓ para confirmar también esta ubicación.';
  updateSummary();hints(loc.archiveYear);
 }
 prop.addEventListener('toggle',()=>window.MauziStudio?.placeProperties());
 for(const id of ['archiveNoteYear','archiveNotePath'])$(id).addEventListener('input',()=>{if(!inReader)draft={archiveYear:$('archiveNoteYear').value,folderPath:$('archiveNotePath').value};updateSummary();});
 $('archiveApplyLocation').onclick=async()=>{
  const b=$('archiveApplyLocation');b.disabled=true;
  try{const loc={archiveYear:K.year($('archiveNoteYear').value),folderPath:K.path($('archiveNotePath').value)};
   if(selectionAccount!==accountKey())throw Error('La cuenta cambió. Abre de nuevo las opciones.');
   if(inReader){await A.updateNote(readId,loc);A.toast('Ubicación guardada. Se sincroniza con tu Drive cuando esté conectado.');}
   else{draft=loc;A.toast('Ubicación elegida. Guarda la nota con ✓.');}
   if(!extraYears.includes(loc.archiveYear))extraYears.push(loc.archiveYear);
   if(loc.folderPath)extraFolders[loc.archiveYear]=[...new Set([...(extraFolders[loc.archiveYear]||[]),loc.folderPath])];prefs();
   window.MauziStudio?.closeProperties();refreshBar();
  }catch(e){A.toast(e.message);}finally{b.disabled=false;}
 };
 const info=document.createElement('section');info.id='archiveAccountPanel';info.className='archive-account-section';info.innerHTML='<h3>Años y carpetas en tu Drive</h3><p>Las notas se organizan en MAUZI NOTE → año → carpeta → nota. Los textos e imágenes permanecen juntos y cada usuario utiliza su propio Drive.</p><p id="archiveSyncStatus" role="status"></p><button type="button" class="secondary-btn" id="archiveSyncBtn">Revisar organización</button><details class="archive-security"><summary>¿Se puede desconectar Google?</summary><p>Sí. El permiso es temporal: cuando venza, vuelve a tocar Conectar Google. Lo que ya llegó a Drive no se borra al vencer el permiso. Los cambios pendientes se quedan aquí hasta reconectar.</p><p>Antes de cambiar de teléfono confirma el guardado en Drive y conserva una copia independiente. Esta app no garantiza una conexión permanente.</p><a href="./AYUDA_GOOGLE_Y_CARPETAS.html" target="_blank" rel="noopener">Años, seguridad y los 100 usuarios de prueba</a></details>';
 $('driveFolderSection').after(info);
 function status(){const s=window.MauziCloud?.archiveState?.();if(!s)return;$('archiveSyncStatus').textContent=s.local?'Sin cuenta: la organización se guarda en este dispositivo.':s.error?'Notas conservadas. Falta terminar de organizar: '+s.error:s.pending?'Organización pendiente: '+s.pending+' notas. Se continúa al sincronizar con Google.':s.missing?'Carpetas revisadas. No se encontraron '+s.missing+' archivos antiguos: revisa tu copia de respaldo.':s.finishedAt?'Carpetas organizadas. Se conservan las versiones de las notas.':'Se crea la carpeta de cada nota al guardar y sincronizar.';}
 $('archiveSyncBtn').onclick=async()=>{const c=window.MauziCloud;if(!c?.account()?.authorized){A.toast('Conecta tu Google desde Mi cuenta para organizar Drive.');return;}try{await c.organizeNow();A.toast('Revisando años y carpetas en tu Drive.');}catch(e){A.toast(e.message);}};
 function refresh(){if(raf)return;raf=requestAnimationFrame(()=>{raf=0;refreshBar();status();if(!modal.classList.contains('hidden')&&!modal.contains(document.activeElement))renderBrowser();});}
 window.addEventListener('mauzi:notes-render',refresh);window.addEventListener('mauzi:cloud-state',refresh);window.addEventListener('mauzi:archive-status',status);
 window.MauziArchive={
  filterNotes(rows){ensureAccount();return rows.filter(n=>{const l=location(n);return (choice.year==='*'||l.archiveYear===choice.year)&&(choice.folder==='*'||l.folderPath===choice.folder||choice.folder!==''&&l.folderPath.startsWith(choice.folder+'/'));});},
  hasFilter:active,startEditor(n){ensureAccount();draft=n?.id?location(n):{archiveYear:choice.year==='*'?K.currentYear():choice.year,folderPath:choice.folder==='*'?'':choice.folder};},
  editorRaw:()=>({...draft}),editorLocation:()=>({archiveYear:K.year(draft.archiveYear),folderPath:K.path(draft.folderPath)}),openProperties:properties,openBrowser,selection:()=>({...choice}),choose
 };
 refreshBar();status();
})();
