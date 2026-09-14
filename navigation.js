/* MAUZI NOTE 4.2 — browser/Android Back unwinds the app before leaving.
   One guard entry, no growing synthetic history. Closing OS windows remains under
   the browser/OS. Unsaved edits have a beforeunload safety prompt where supported. */
(()=>{'use strict';
 const A=window.MauziApp,$=id=>document.getElementById(id);let busy=false,leaving=false,exitUntil=0,noticeTimer=null;
 const notice=document.createElement('div');notice.id='navigationNotice';notice.hidden=true;notice.setAttribute('role','status');document.body.append(notice);
 const visible=id=>{const e=$(id);return e&&!e.hidden&&!e.classList.contains('hidden');};
 function tell(s){notice.textContent=s;notice.hidden=false;clearTimeout(noticeTimer);noticeTimer=setTimeout(()=>{notice.hidden=true;},2600);}
 function guard(){try{history.pushState({mauzi42:'guard'},'',location.href);}catch(_){}}
 // Reopening/reloading replaces the current app entry, never duplicates a guard.
 try{if(history.state?.mauzi42!=='guard'){history.replaceState({mauzi42:'base'},'',location.href);guard();}}catch(_){}
 function topModal(){return [...document.querySelectorAll('.modal-backdrop:not(.hidden)')].filter(e=>getComputedStyle(e).display!=='none').sort((a,b)=>(parseInt(getComputedStyle(b).zIndex)||50)-(parseInt(getComputedStyle(a).zIndex)||50)).find(e=>e.id!=='noteReadModal'&&e.id!=='noteModal');}
 function hasSurface(){return window.MauziImages?.isOpen()||window.MauziStudio?.propertiesOpen()||window.MauziDictionary?.isOpen?.()||window.MauziReader?.active||visible('noteModal')||visible('noteReadModal')||topModal()||($('mainApp').dataset.section||'notes')!=='notes'||visible('compactSearchPanel');}
 async function backInside(){
  if(window.MauziAccess?.isOpen()){window.MauziAccess.goBack();return;}
  if(window.MauziDictionary?.isOpen?.()){window.MauziDictionary.hide();return;}
  if(window.MauziStudio?.propertiesOpen()){window.MauziStudio.closeProperties();return;}
  if(window.MauziImages?.isOpen()){window.MauziImages.close({fromHistory:true});return;}
  const m=topModal();if(m){const close=m.querySelector('[data-close],.module-dialog-head button[aria-label*="Cerrar"],.module-dialog-head .module-icon,.close');if(close)close.click();else A.close(m.id);return;}
  if(window.MauziReader?.active){window.MauziReader.exit({fromHistory:true});return;}
  if(visible('noteModal')){
   if(window.MauziImages?.isImporting()){tell('Espera a que termine de prepararse la imagen.');return;}
   if(window.MauziEditorModes?.isDirty()){
    const html=$('noteContent').innerHTML,hasContent=$('noteTitle').value.trim()||A.plain(html)||/<img\b/i.test(html);
    if(hasContent){tell('Guardando la nota antes de volver…');if(!(await A.saveEditor())){tell('No se pudo guardar. La nota sigue abierta.');return;}}
    else{window.MauziEditorModes.markSaved();A.close('noteModal');}
   }else A.close('noteModal');
   if(visible('noteReadModal'))A.close('noteReadModal');window.MauziSections?.select('notes');return;
  }
  if(visible('noteReadModal')){A.close('noteReadModal');window.MauziSections?.select('notes');return;}
  if(visible('compactSearchPanel')){$('closeSearchBtn')?.click();$('compactSearchPanel').classList.add('hidden');return;}
  if(($('mainApp').dataset.section||'notes')!=='notes'){window.MauziSections?.select('notes');return;}
 }
 async function onBack(e){
  if(leaving)return;
  e?.stopImmediatePropagation?.();
  if(busy){guard();return;}
  if(hasSurface()){
   guard();exitUntil=0;busy=true;try{await backInside();}catch(error){tell(error.message||'No se cerró la nota. Guarda tus cambios.');}finally{busy=false;}return;
  }
  if(Date.now()<exitUntil){leaving=true;notice.hidden=true;
   // Return to the preceding page, or let a standalone browser leave the app.
   try{history.back();}catch(_){}
   // Some standalone hosts have no preceding page and cannot be closed by script.
   // If we are still here, restore the guard instead of leaving future notes unprotected.
   setTimeout(()=>{if(!document.hidden&&leaving){leaving=false;exitUntil=0;guard();tell('Para cerrar esta ventana, usa el control de tu navegador o dispositivo.');}},850);return;
  }
  guard();exitUntil=Date.now()+2600;tell('Pulsa Atrás otra vez para salir de MAUZI NOTE.');
 }
 window.addEventListener('popstate',onBack,true);
 // The on-screen Back of an editor follows the same safe save-and-return flow.
 document.addEventListener('click',e=>{const close=e.target.closest('[data-close="noteModal"]');if(!close)return;e.preventDefault();e.stopImmediatePropagation();if(busy)return;busy=true;backInside().catch(err=>tell(err.message)).finally(()=>busy=false);},true);
 document.addEventListener('keydown',e=>{
  if(e.key==='Escape'&&hasSurface()) {e.preventDefault();e.stopImmediatePropagation();if(!busy){busy=true;backInside().catch(err=>tell(err.message)).finally(()=>busy=false);}}
 },true);
 window.addEventListener('beforeunload',e=>{if(!leaving&&visible('noteModal')&&window.MauziEditorModes?.isDirty()){e.preventDefault();e.returnValue='';}});
 document.addEventListener('pointerdown',()=>{exitUntil=0;},true);
 window.MauziNavigation={back:()=>{try{history.back();}catch(_){onBack();}},inAppBack:backInside,notice:tell};
})();
