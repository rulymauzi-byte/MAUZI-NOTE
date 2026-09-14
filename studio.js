/* MAUZI NOTE 4.2 — compact note properties, account benefits, desktop panels. */
(()=>{'use strict';
 const $=id=>document.getElementById(id),A=window.MauziApp,editor=$('noteModal');
 const svg=p=>`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
 const icon=svg('<path d="M12 3a9 9 0 1 0 0 18h1a2 2 0 0 0 1.4-3.4 1.5 1.5 0 0 1 1.1-2.6h2A4.5 4.5 0 0 0 22 10.5 9 9 0 0 0 12 3z"/><circle cx="7.5" cy="10" r=".9"/><circle cx="11" cy="6.5" r=".9"/><circle cx="16" cy="7" r=".9"/>');
 function btn(id){const b=document.createElement('button');b.type='button';b.id=id;b.className='reader-tool';b.innerHTML=icon;b.title='Fondo y categoría';b.setAttribute('aria-label','Fondo y categoría');b.setAttribute('aria-haspopup','dialog');b.setAttribute('aria-expanded','false');return b;}
 const propBtn=btn('notePropertiesButton'),readBtn=btn('readPropertiesButton');
 $('editorQuickSave').before(propBtn);$('readFocusBtn').before(readBtn);
 const pop=document.createElement('aside');pop.id='noteProperties';pop.className='studio-popover';pop.hidden=true;pop.setAttribute('role','dialog');pop.setAttribute('aria-label','Fondo y categoría de la nota');
 pop.innerHTML='<div class="studio-popover-head"><strong>Fondo y categoría</strong><button type="button" class="popup-close" aria-label="Cerrar opciones">×</button></div>';
 const options=editor.querySelector('.note-options-row'),cat=$('noteCategory'),label=cat.previousElementSibling;
 pop.append(options);if(label?.tagName==='LABEL')pop.append(label);pop.append(cat);pop.append($('deleteNoteBtn'));document.body.append(pop);
 let fromReader=false,positionButton=null,editorRange=null,bgBefore='',catBefore='';
 const name=()=>A.note(A.currentReadId());
 function place(){if(pop.hidden||!positionButton)return;const r=positionButton.getBoundingClientRect(),v=window.visualViewport,left=v?.offsetLeft||0,top=v?.offsetTop||0,w=v?.width||innerWidth,h=v?.height||innerHeight,s=pop.getBoundingClientRect();pop.style.left=Math.max(left+10,Math.min(r.right-s.width,left+w-s.width-10))+'px';pop.style.top=Math.max(top+8,Math.min(r.bottom+9,top+h-s.height-10))+'px';}
 function close(){if(pop.hidden)return;pop.hidden=true;propBtn.setAttribute('aria-expanded','false');readBtn.setAttribute('aria-expanded','false');positionButton=null;if(editorRange&&editor.contains(editorRange.commonAncestorContainer)){const s=getSelection();s.removeAllRanges();s.addRange(editorRange);}editorRange=null;}
 function open(read,b){if(!pop.hidden&&positionButton===b){close();return;}fromReader=read;positionButton=b;
  if(read){const n=name();if(!n)return;window.setNoteBackground?.(n.bgColor||'#f8f5ed');$('noteCategory').value=n.categoryId;$('deleteNoteBtn').classList.add('hidden');}
  else {const s=getSelection();if(s?.rangeCount&&editor.contains(s.anchorNode))editorRange=s.getRangeAt(0).cloneRange();$('deleteNoteBtn').classList.toggle('hidden',!$('editingId').value);}
  window.MauziArchive?.openProperties(read);
  bgBefore=$('noteBgColorPicker').value;catBefore=cat.value;pop.hidden=false;b.setAttribute('aria-expanded','true');place();
 }
 propBtn.onclick=()=>open(false,propBtn);readBtn.onclick=()=>open(true,readBtn);
 pop.querySelector('.popup-close').onclick=close;
 async function persistRead(){if(!fromReader||pop.hidden)return;const n=name();if(!n)return;const bg=$('noteBgColorPicker').value,c=cat.value;if(bg===bgBefore&&c===catBefore)return;try{await A.updateNote(n.id,{bgColor:bg,categoryId:c});bgBefore=bg;catBefore=c;}catch(e){A.toast(e.message);}}
 pop.addEventListener('click',e=>{if(e.target.closest('.bg-swatch[data-bg]'))setTimeout(persistRead,0);});
 cat.addEventListener('change',persistRead);$('noteBgColorPicker').addEventListener('change',persistRead);
 document.addEventListener('pointerdown',e=>{if(!pop.hidden&&!pop.contains(e.target)&&!propBtn.contains(e.target)&&!readBtn.contains(e.target))close();},true);
 window.addEventListener('resize',place);window.visualViewport?.addEventListener('resize',place);
 window.addEventListener('mauzi:editor-opened',()=>{close();fromReader=false;});
 window.addEventListener('mauzi:modal',e=>{if(['noteModal','noteReadModal'].includes(e.detail.id)&&!e.detail.open)close();});
 // Non-blocking explanation, entirely inside the account panel.
 const benefit=document.createElement('section');benefit.className='google-benefits';benefit.id='googleBenefits';
 benefit.innerHTML='<h3>Tu correo, tu respaldo</h3><p><strong>Recupera tus notas al cambiar de celular.</strong> Conecta la misma cuenta Google en el nuevo dispositivo.</p><p>También se guardan tus imágenes, favoritos de la Biblia y agenda. Puedes seguir escribiendo sin internet y sincronizar después.</p><p>Los datos van a <strong>tu propio Google Drive</strong>, no al del creador. MAUZI NOTE nunca recibe tu contraseña.</p><small>Conectar es opcional. Antes de cambiar de dispositivo, espera la confirmación de Drive. Lo pendiente de subir todavía está solo aquí. Conserva también una copia independiente.</small>';
 $('googleActions').before(benefit);
 function accountState(){const a=window.MauziCloud?.account(),needs=!a||!a.authorized;$('accountBtn').dataset.attention=String(needs);$('syncNowBtn').classList.toggle('needs-google',needs);benefit.hidden=!!a?.authorized;}
 window.addEventListener('mauzi:cloud-state',accountState);accountState();
 function layout(){const reading=!$('noteReadModal').classList.contains('hidden'),writing=!editor.classList.contains('hidden');document.body.classList.toggle('desktop-note-open',reading||writing);const current=writing?$('editingId').value:A.currentReadId();for(const card of document.querySelectorAll('#notesList .note-card'))card.classList.toggle('is-selected',(card.getAttribute('onclick')||'').includes("'"+current+"'")&&!!current);window.MauziRich?.refresh();}
 new MutationObserver(layout).observe(editor,{attributes:true,attributeFilter:['class']});new MutationObserver(layout).observe($('noteReadModal'),{attributes:true,attributeFilter:['class']});
 new MutationObserver(layout).observe($('notesList'),{childList:true});window.addEventListener('resize',layout);layout();
 // Moving a note to another desktop panel never silently discards writing.
 document.addEventListener('click',e=>{const target=e.target.closest('#notesList .note-card,#addNoteBtn,.module-nav button,#accountBtn');if(!target)return;if(editor.classList.contains('hidden')){if(target.matches('.module-nav button,#addNoteBtn')&&!$('noteReadModal').classList.contains('hidden'))A.close('noteReadModal');return;}
  if(window.MauziEditorModes?.isDirty()){e.preventDefault();e.stopImmediatePropagation();A.toast('Guarda la nota con ✓ o vuelve con Atrás antes de cambiar.');return;}
  A.close('noteModal');if(target.matches('.module-nav button'))A.close('noteReadModal');
 },true);
 window.MauziStudio={placeProperties:place,propertiesOpen:()=>!pop.hidden,closeProperties:close,refresh:layout};
})();
