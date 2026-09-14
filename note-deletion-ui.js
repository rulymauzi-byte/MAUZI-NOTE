/* MAUZI NOTE 4.8 — visible, confirmed single-note deletion. */
(()=>{'use strict';
 const A=window.MauziApp,C=window.MauziCloud,$=id=>document.getElementById(id);
 if(!A||!C)return;
 const trash='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/></svg>';
 function tool(id,label){const b=document.createElement('button');b.id=id;b.type='button';b.className='reader-tool note-delete-tool';b.title=label;b.setAttribute('aria-label',label);b.innerHTML=trash;return b;}
 const readButton=tool('deleteReadNoteBtn','Eliminar esta nota'),editButton=tool('deleteEditorNoteBtn','Eliminar esta nota');
 $('historyNoteBtn').before(readButton);
 $('noteModal').querySelector('.note-editor-head [data-close]').before(editButton);
 // The old control had been moved into a panel and hidden in reading mode.
 $('deleteNoteBtn').classList.add('legacy-delete-control');
 const modal=document.createElement('div');modal.id='noteDeleteModal';modal.className='modal-backdrop hidden';modal.setAttribute('role','dialog');modal.setAttribute('aria-modal','true');modal.setAttribute('aria-labelledby','deleteDialogTitle');
 modal.innerHTML=`<div class="delete-dialog sheet"><div class="delete-dialog-head"><span class="delete-symbol">${trash}</span><h2 id="deleteDialogTitle">Eliminar nota</h2><button class="close" type="button" data-close="noteDeleteModal" aria-label="Cancelar eliminación">×</button></div><p class="delete-note-name" id="deleteNoteName"></p><p class="delete-account-hint" id="deleteAccountHint"></p><label class="delete-choice"><input type="radio" name="deleteMode" value="trash" checked><span><strong>Mover a la papelera</strong><small>Se oculta en tus dispositivos al sincronizar. Puedes recuperarla.</small></span></label><label class="delete-choice"><input type="radio" name="deleteMode" value="permanent"><span><strong>Eliminar definitivamente</strong><small>Borra esta nota, imágenes e historial de MAUZI NOTE y de Drive al sincronizar. No se puede recuperar.</small></span></label><p class="delete-warning" id="deleteWarning" hidden>Se eliminará únicamente esta nota. Los respaldos exportados y las fotografías originales no se modifican.</p><p class="delete-error" id="deleteError" role="alert"></p><div class="delete-dialog-actions"><button id="cancelDeleteBtn" class="secondary-btn" type="button" data-close="noteDeleteModal">Cancelar</button><button id="confirmDeleteBtn" class="danger-btn" type="button">Mover a papelera</button></div></div>`;
 document.body.append(modal);
 let target=null,busy=false,origin=null;
 function mode(){return modal.querySelector('input[name="deleteMode"]:checked')?.value||'trash';}
 function updateMode(){const forever=mode()==='permanent';$('confirmDeleteBtn').textContent=forever?'Eliminar definitivamente':'Mover a papelera';$('deleteWarning').hidden=!forever;}
 function close(){if(busy)return;A.close(modal.id);target=null;if(origin?.isConnected&&origin.getClientRects().length)origin.focus({preventScroll:true});}
 function open(nid,{permanent=false,title}={}){
  if(busy||!nid)return;
  const account=C.account();const note=A.note(nid)||C.getExport()?.trash?.find(n=>n.id===nid);
  if(!note){A.toast('Esta nota ya no está disponible.');return;}
  origin=document.activeElement;target={id:nid,key:account?.key,title:note.title||title||'Sin título'};
  window.MauziStudio?.closeProperties();
  $('deleteNoteName').textContent=target.title;
  $('deleteAccountHint').textContent=account?.local?'Sin cuenta: esta acción afecta la copia de este dispositivo.':('Cuenta: '+account?.email+'. La eliminación se enviará a tu Drive y llegará a los otros dispositivos al sincronizar.');
  if(!$('noteModal').classList.contains('hidden')&&window.MauziEditorModes?.isDirty())$('deleteAccountHint').textContent+=' Hay cambios sin guardar en el editor; se descartarán si eliminas esta nota.';
  modal.querySelector('input[value="'+(permanent?'permanent':'trash')+'"]').checked=true;
  $('deleteError').textContent='';updateMode();A.open(modal.id);requestAnimationFrame(()=>$('cancelDeleteBtn').focus({preventScroll:true}));
 }
 modal.querySelectorAll('input[name="deleteMode"]').forEach(n=>n.addEventListener('change',updateMode));
 modal.querySelectorAll('[data-close]').forEach(b=>b.addEventListener('click',e=>{e.stopPropagation();close();}));
 modal.addEventListener('click',e=>{if(e.target===modal)close();});
 modal.addEventListener('keydown',e=>{
  if(e.key==='Tab'){const items=[...modal.querySelectorAll('button,input')].filter(x=>!x.disabled&&!x.hidden);const i=items.indexOf(document.activeElement);if(e.shiftKey&&i<=0){e.preventDefault();items.at(-1).focus();}else if(!e.shiftKey&&i===items.length-1){e.preventDefault();items[0].focus();}}
 });
 async function confirmRemoval(){
  if(busy||!target)return;const chosen={...target},permanent=mode()==='permanent';
  busy=true;modal.setAttribute('aria-busy','true');modal.querySelectorAll('button,input').forEach(b=>b.disabled=true);$('deleteError').textContent='';
  try{
   const result=await C.removeNote(chosen.id,{permanent,accountKey:chosen.key});
   if($('editingId').value===chosen.id&&!$('noteModal').classList.contains('hidden')){window.MauziEditorModes?.markSaved();A.close('noteModal');}
   if(A.currentReadId()===chosen.id&&!$('noteReadModal').classList.contains('hidden'))A.close('noteReadModal');
   const wasTrash=!$('cloudRecoveryModal').classList.contains('hidden');
   A.close(modal.id);target=null;window.MauziSections?.select('notes');
   if(wasTrash)await C.showTrash();
   A.toast(result.local?(permanent?'Nota eliminada de este dispositivo.':'Nota movida a la papelera.'):(permanent?'Eliminada aquí. Pendiente de confirmar en Drive.':'Nota en la papelera. Se sincroniza con Google.'));
  }catch(error){$('deleteError').textContent=error.message||'No se pudo eliminar. Tu nota se conserva.';}
  finally{busy=false;modal.removeAttribute('aria-busy');modal.querySelectorAll('button,input').forEach(b=>b.disabled=false);updateMode();updateStatus();}
 }
 $('confirmDeleteBtn').addEventListener('click',confirmRemoval);
 readButton.onclick=()=>open(A.currentReadId());editButton.onclick=()=>open($('editingId').value);
 window.addEventListener('mauzi:editor-opened',()=>{editButton.hidden=!$('editingId').value;});
 editButton.hidden=true;
 const info=document.createElement('p');info.id='noteDeletionStatus';info.className='delete-status';info.setAttribute('role','status');$('accountSyncStatus').after(info);
 function updateStatus(){const s=C.deletionState();for(const el of document.querySelectorAll('.delete-pending-summary')){el.hidden=!s.pending;el.textContent=s.pending+' eliminación(es) definitiva(s) pendientes de confirmar en Drive. Conecta Google y sincroniza.';}info.hidden=!s.pending&&!s.lastCompleted;info.textContent=s.pending?s.pending+' eliminación(es) definitiva(s) pendientes de confirmar en Drive. Mantén internet y Google conectado; se reintentará automáticamente.':s.lastCompleted?'Última eliminación definitiva confirmada en Drive: '+new Date(s.lastCompleted).toLocaleString('es-GT'):'';}
 window.addEventListener('mauzi:sync-status',updateStatus);updateStatus();
 window.MauziNoteDeletionUI={open,close,isDeleting:id=>busy&&target?.id===id};
})();
