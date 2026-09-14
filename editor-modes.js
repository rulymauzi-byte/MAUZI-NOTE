/* MAUZI NOTE 4 — typing and selection-only formatting are separate.
   Formatting mode uses DOM Ranges in a NON-editable surface: it never focuses an
   editable host, so formatting is not coupled to a virtual keyboard. */
(()=>{'use strict';
 const $=id=>document.getElementById(id), A=window.MauziApp, editor=$('noteContent'),modal=$('noteModal'),title=$('noteTitle');
 const svg=p=>`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
 const icons={write:svg('<path d="m14 4 6 6M4 20l5-1L20 8a4 4 0 0 0-5-5L4 14z"/>'),format:svg('<path d="m4 19 5-14 5 14M6 14h6M17 5h5M19.5 5v14M3 22h18"/>'),save:svg('<path d="m4 12 5 5L20 6"/>')};
 function button(id,label,icon){const b=document.createElement('button');b.type='button';b.id=id;b.className='reader-tool';b.title=label;b.setAttribute('aria-label',label);b.innerHTML=icon;return b;}
 const head=modal.querySelector('.note-editor-head'),close=head.querySelector('[data-close]');
 const oldLabel=title.previousElementSibling;if(oldLabel?.tagName==='LABEL')oldLabel.remove();
 $('noteModalTitle').hidden=true;head.insertBefore(title,close);title.readOnly=true;title.title='Toca para cambiar el título';title.setAttribute('aria-label','Título de la nota. Toca para cambiarlo');title.classList.add('inline-note-title');title.placeholder='Sin título';
 const writeBtn=button('editorWriteMode','Escribir con teclado',icons.write),fmtBtn=button('editorFormatMode','Dar formato sin teclado',icons.format),saveBtn=button('editorQuickSave','Guardar nota',icons.save);
 head.insertBefore(writeBtn,close);head.insertBefore(fmtBtn,close);head.insertBefore(saveBtn,close);
 const hint=document.createElement('div');hint.id='formatModeHint';hint.textContent='Selecciona texto y toca un formato. Sin teclado.';head.after(hint);
 let mode='write',nextMode='write',range=null,baseline='',skipGuard=false;
 const snap=()=>JSON.stringify([title.value,editor.innerHTML,$('noteCategory').value,$('noteBgColorPicker').value]);
 function remember(){const s=getSelection();if(s?.rangeCount&&editor.contains(s.anchorNode)&&editor.contains(s.focusNode))range=s.getRangeAt(0).cloneRange();}
 function restore(){if(!range||!editor.contains(range.startContainer)||!editor.contains(range.endContainer))return false;const s=getSelection();s.removeAllRanges();s.addRange(range);return true;}
 function setMode(value,focus=false){remember();mode=value;modal.dataset.editorMode=value;editor.setAttribute('contenteditable',String(value==='write'));editor.setAttribute('inputmode',value==='write'?'text':'none');editor.tabIndex=0;
  if(value==='format'){if(editor.contains(document.activeElement)||document.activeElement===editor)document.activeElement.blur();modal.classList.remove('keyboard-open');restore();}
  else if(focus){editor.focus({preventScroll:true});if(!restore()){const r=document.createRange();r.selectNodeContents(editor);r.collapse(false);getSelection().removeAllRanges();getSelection().addRange(r);}}
  writeBtn.setAttribute('aria-pressed',String(value==='write'));fmtBtn.setAttribute('aria-pressed',String(value==='format'));hint.hidden=value!=='format';window.MauziRich?.refresh();window.updateAppViewport?.();
 }
 function opened(){range=null;title.readOnly=true;baseline=snap();skipGuard=false;setMode(nextMode);nextMode='write';
  if(mode==='write'){editor.focus({preventScroll:true});const r=document.createRange();r.selectNodeContents(editor);r.collapse(false);getSelection().removeAllRanges();getSelection().addRange(r);}else editor.blur();
 }
 title.addEventListener('click',()=>{title.readOnly=false;title.focus();});
 title.addEventListener('blur',()=>{title.readOnly=true;});title.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();title.readOnly=true;title.blur();if(mode==='write')editor.focus({preventScroll:true});}});
 writeBtn.onclick=()=>setMode('write',true);fmtBtn.onclick=()=>setMode('format');saveBtn.onclick=()=>$('saveNoteBtn').click();
 document.addEventListener('selectionchange',()=>{if(!modal.classList.contains('hidden'))remember();});
 // Intercept read-only focus before the old mobile viewport helper runs.
 editor.addEventListener('focus',()=>{if(mode==='format')modal.classList.remove('keyboard-open');});
 function changed(){editor.dispatchEvent(new Event('input',{bubbles:true}));window.MauziRich?.refresh();remember();}
 function selectedBlocks(r){const candidates=[...editor.querySelectorAll('p,div,h1,h2,h3,h4,h5,h6,li,blockquote')].filter(e=>{try{return r.intersectsNode(e)&&!e.querySelector('p,div,h1,h2,h3,li');}catch(_){return false;}});return candidates;}
 function selectNodeContents(node){const r=document.createRange();r.selectNodeContents(node);range=r;restore();}
 function apply(command,value){if(mode!=='format')return;remember();if(!restore()||range.collapsed){A.toast('Selecciona primero el texto que deseas cambiar.');return;}
  const r=range.cloneRange();
  try{
   if(['bold','foreColor','hiliteColor','backColor'].includes(command)){
    const frag=r.extractContents();let wrapper=document.createElement('span');
    if(command==='bold'){let parent=r.startContainer.nodeType===1?r.startContainer:r.startContainer.parentElement;const weight=parseInt(getComputedStyle(parent).fontWeight,10);wrapper.style.fontWeight=weight>=600?'400':'700';}
    else if(command==='foreColor')wrapper.style.color=value;
    else wrapper.style.backgroundColor=value;
    wrapper.append(frag);r.insertNode(wrapper);selectNodeContents(wrapper);
   }else if(command==='formatBlock'){
    const blocks=selectedBlocks(r);if(blocks.length){for(const el of blocks){const n=document.createElement(el.tagName==='H2'?'p':'h2');while(el.firstChild)n.append(el.firstChild);el.replaceWith(n);selectNodeContents(n);}}
    else {const el=document.createElement('h2');el.append(r.extractContents());r.insertNode(el);selectNodeContents(el);}
   }else if(['mauziList','insertOrderedList','insertUnorderedList'].includes(command)){
    const unordered=command==='insertUnorderedList',style=unordered?'disc':value==='alpha'?'lower-alpha':value==='roman'?'upper-roman':'decimal';
    const anchor=r.startContainer.nodeType===1?r.startContainer:r.startContainer.parentElement,existing=anchor.closest('ol,ul');
    if(existing&&editor.contains(existing)){
      const list=document.createElement(unordered?'ul':'ol');while(existing.firstChild)list.append(existing.firstChild);existing.replaceWith(list);setListStyle(list,style);selectNodeContents(list);
    }else{
      const blocks=selectedBlocks(r),list=document.createElement(unordered?'ul':'ol');setListStyle(list,style);
      if(blocks.length&&blocks.every(b=>b.parentNode===blocks[0].parentNode)){
       blocks[0].before(list);for(const b of blocks){const li=document.createElement('li');while(b.firstChild)li.append(b.firstChild);list.append(li);b.remove();}
      }else{const frag=r.extractContents(),holder=document.createElement('div');holder.append(frag);const children=[...holder.childNodes];let li=document.createElement('li');list.append(li);for(const child of children){if(child.nodeType===1&&['P','DIV','LI','BR'].includes(child.tagName)){if(li.textContent||li.querySelector('img')){li=document.createElement('li');list.append(li);}if(child.tagName!=='BR')while(child.firstChild)li.append(child.firstChild);}else li.append(child);}r.insertNode(list);}
      selectNodeContents(list);
    }
   }
   changed();
  }catch(e){A.toast('Selecciona una frase o párrafos completos y vuelve a aplicar el formato.');}
 }
 function setListStyle(list,style){list.style.listStyleType=style;list.dataset.mauziList=style;if(list.tagName==='OL')list.type=style==='upper-roman'?'I':style==='lower-alpha'?'a':'1';if(style==='lower-alpha')list.dataset.mauziSuffix=')';}
 const readFmt=button('formatFromReadBtn','Dar formato sin teclado',icons.format);$('editFromReadBtn').after(readFmt);
 readFmt.onclick=()=>{const id=A.currentReadId();if(!id)return;nextMode='format';A.close('noteReadModal');window.editNote(id);};
 for(const el of [$('readHeaderTitle'),$('readNoteTitle')]){
  el.title='Toca para cambiar el título';el.setAttribute('role','button');el.tabIndex=0;
  let old='',saving=false;
  const start=e=>{if(e?.target?.closest('.bible-link'))return;if(el.isContentEditable)return;old=A.note(A.currentReadId())?.title||'';el.textContent=old;el.contentEditable='true';el.setAttribute('inputmode','text');el.focus();const r=document.createRange();r.selectNodeContents(el);getSelection().removeAllRanges();getSelection().addRange(r);};
  el.addEventListener('click',start);el.addEventListener('keydown',e=>{if(!el.isContentEditable&&(e.key==='Enter'||e.key===' ')){e.preventDefault();start();}else if(el.isContentEditable&&e.key==='Enter'){e.preventDefault();el.blur();}else if(el.isContentEditable&&e.key==='Escape'){el.textContent=old;el.contentEditable='false';el.blur();e.stopPropagation();}});
  el.addEventListener('blur',async()=>{if(!el.isContentEditable||saving)return;const t=el.textContent.trim().slice(0,90),id=A.currentReadId();el.contentEditable='false';if(t===old)return;saving=true;try{await A.renameNote(id,t);A.toast('Título guardado');}catch(e){el.textContent=old;A.toast(e.message);}finally{saving=false;}});
 }
 window.MauziEditorModes={opened,isFormat:()=>mode==='format',restore,apply,markSaved:()=>{baseline=snap();skipGuard=true;},beforeClose:()=>{if(skipGuard){skipGuard=false;return true;}if(baseline&&baseline!==snap())return confirm('Hay cambios sin guardar. ¿Cerrar y descartarlos?');return true;}};
})();
