/* MAUZI NOTE 3.3. Fullscreen is progressive enhancement: the reading-only layout
   remains usable if the browser refuses native fullscreen (for example iPhone).
   This module never touches notes, the active Google account, tokens or Drive. */
(() => {
  'use strict';
  const root=document.documentElement,modal=document.getElementById('noteReadModal');
  const enterButton=document.getElementById('readFocusBtn'),exitButton=document.getElementById('exitReadFocusBtn');
  const paper=document.getElementById('readNotePaper');
  let active=false,ownFullscreen=false,historyEntry=false,sequence=0,entering=false;
  const fullscreenElement=()=>document.fullscreenElement||document.webkitFullscreenElement;
  function repaint(){window.updateAppViewport?.();window.MauziRich?.refresh();}
  function setLayout(value){
    active=value;root.classList.toggle('mauzi-note-focus',value);
    enterButton.setAttribute('aria-pressed',String(value));exitButton.hidden=!value;
    requestAnimationFrame(repaint);
  }
  function closeNative(){
    if(!ownFullscreen)return;
    ownFullscreen=false;
    if(!fullscreenElement())return;
    try{
      const result=document.exitFullscreen?document.exitFullscreen():document.webkitExitFullscreen?.();
      result?.catch?.(()=>{});
    }catch(_){}
  }
  function exit({fromHistory=false}={}){
    if(!active&&!entering)return;
    const scroll=paper.scrollTop;sequence++;entering=false;
    setLayout(false);closeNative();
    if(historyEntry){
      historyEntry=false;
      if(!fromHistory&&history.state?.mauziReaderFocus){try{history.back();}catch(_){}}
    }
    requestAnimationFrame(()=>{paper.scrollTop=scroll;repaint();});
    if(!modal.classList.contains('hidden'))enterButton.focus({preventScroll:true});
  }
  function enter(){
    if(active||modal.classList.contains('hidden'))return;
    const seq=++sequence,scroll=paper.scrollTop;
    entering=true;setLayout(true);
    root.style.setProperty('--focus-bg',paper.style.getPropertyValue('--read-bg')||'#f8f5ed');
    if(!window.MauziNavigation){try{history.pushState({...history.state,mauziReaderFocus:true},'');historyEntry=true;}catch(_){}}
    const target=root;
    // Stay within the user gesture. Awaiting work before this call blocks it on mobile.
    try{
      if(!fullscreenElement()){
        const request=target.requestFullscreen||target.webkitRequestFullscreen;
        if(request){
          ownFullscreen=true;
          Promise.resolve(request.call(target)).then(()=>{
            if(seq!==sequence||!active){
              // A delayed grant after the user left must never trap the browser fullscreen.
              if(!active&&fullscreenElement()===root){ownFullscreen=true;closeNative();}
              return;
            }
            entering=false;repaint();
          }).catch(()=>{if(seq!==sequence)return;ownFullscreen=false;entering=false;repaint();});
        }else entering=false;
      }else entering=false;
    }catch(_){ownFullscreen=false;entering=false;}
    requestAnimationFrame(()=>{paper.scrollTop=scroll;repaint();exitButton.focus({preventScroll:true});});
  }
  function onNativeChange(){
    if(active&&ownFullscreen&&!fullscreenElement()&&!entering)exit();
    repaint();
  }
  enterButton.addEventListener('click',enter);
  exitButton.addEventListener('click',()=>exit());
  document.addEventListener('fullscreenchange',onNativeChange);
  document.addEventListener('webkitfullscreenchange',onNativeChange);
  window.addEventListener('popstate',()=>{if(active&&historyEntry&&!history.state?.mauziReaderFocus){historyEntry=false;exit({fromHistory:true});}});
  document.addEventListener('keydown',event=>{
    if(event.key!=='Escape'||!active||window.MauziImages?.isOpen())return;
    // A Bible passage may still open above the full-page note. Close it first.
    if(!document.getElementById('bibleModal').classList.contains('hidden'))return;
    event.preventDefault();event.stopImmediatePropagation();exit();
  },true);
  new MutationObserver(()=>{if(modal.classList.contains('hidden'))exit();}).observe(modal,{attributes:true,attributeFilter:['class']});
  window.addEventListener('orientationchange',()=>setTimeout(repaint,100));
  window.MauziReader={enter,exit,get active(){return active;}};
})();

/* 3.3 — one-row navigation. State is still managed by MauziApp/Drive.
   Existing IDs for account, history and editing remain unchanged. */
(() => {
  'use strict';
  const A=window.MauziApp,$=id=>document.getElementById(id);
  const view=$('cycleViewBtn'),search=$('toggleSearchBtn'),filter=$('filterCategoriesBtn');
  const panel=$('compactSearchPanel'),input=$('searchInput'),options=$('categoryFilterOptions');
  const svg=paths=>'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+paths+'</svg>';
  const icons={
    cards:svg('<rect x="3" y="3" width="18" height="7" rx="2"/><rect x="3" y="14" width="18" height="7" rx="2"/>'),
    grid:svg('<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>'),
    list:svg('<path d="M9 5h12M9 12h12M9 19h12"/><circle cx="4" cy="5" r=".9"/><circle cx="4" cy="12" r=".9"/><circle cx="4" cy="19" r=".9"/>')
  };
  const views=['cards','grid','list'],names={cards:'Normal',grid:'Cuadros',list:'Lista'};
  function updateView(){
    const current=A.view(),next=views[(views.indexOf(current)+1)%views.length];
    view.innerHTML=icons[current]||icons.cards;
    view.title=names[current]+' · tocar para '+names[next].toLowerCase();
    view.setAttribute('aria-label','Vista '+names[current]+'. Cambiar a '+names[next]);
    view.dataset.view=current;
  }
  view.addEventListener('click',()=>{A.setView(views[(views.indexOf(A.view())+1)%views.length]);updateView();});
  function toggleSearch(show){
    panel.classList.toggle('hidden',!show);search.setAttribute('aria-expanded',String(show));
    if(show){input.focus({preventScroll:true});}else{input.blur();search.focus({preventScroll:true});}
  }
  search.addEventListener('click',()=>toggleSearch(panel.classList.contains('hidden')));
  $('clearSearchBtn').addEventListener('click',()=>{input.value='';input.dispatchEvent(new Event('input',{bubbles:true}));toggleSearch(false);});
  input.addEventListener('input',()=>search.classList.toggle('has-query',!!input.value.trim()));
  input.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key==='Escape'){e.preventDefault();e.stopPropagation();toggleSearch(false);}});
  function updateFilter(){
    const selected=A.filter(),category=A.filterCategories().find(c=>c.id===selected);
    filter.classList.toggle('has-filter',selected!=='all');
    filter.title=category?'Filtro: '+category.name:'Filtrar categorías: todas';
    filter.setAttribute('aria-label',filter.title);
    filter.style.setProperty('--selected-category-color',category?.color||'#d3b16b');
  }
  function renderFilters(){
    options.replaceChildren();
    const rows=[{id:'all',name:'Todas las categorías',color:'#e4c783'},...A.filterCategories()];
    for(const cat of rows){
      const button=document.createElement('button');button.type='button';button.className='filter-category-option';
      button.dataset.category=cat.id;button.setAttribute('aria-pressed',String(A.filter()===cat.id));
      const dot=document.createElement('span');dot.className='filter-color';dot.style.backgroundColor=cat.color;
      const label=document.createElement('span');label.className='filter-label';label.textContent=cat.name;
      const check=document.createElement('span');check.className='filter-check';check.setAttribute('aria-hidden','true');check.innerHTML=svg('<path d="m5 12 4 4L19 6"/>');
      button.append(dot,label,check);
      button.addEventListener('click',()=>{A.setFilter(cat.id);updateFilter();A.close('categoryFilterModal');filter.focus({preventScroll:true});});
      options.append(button);
    }
  }
  filter.addEventListener('click',()=>{renderFilters();A.open('categoryFilterModal');});
  window.addEventListener('mauzi:notes-render',()=>{updateFilter();if(!$('categoryFilterModal').classList.contains('hidden'))renderFilters();});
  window.addEventListener('mauzi:view-change',updateView);
  // Compatibility with the already-published 3.1 Drive module. Do not replace
  // drive-sync.js just to change the header. Its authenticated status stays the
  // source of truth; the 3.2 module sets the light directly and never writes chip.
  const legacyStatus=$('cloudStatusChip');
  if(legacyStatus)new MutationObserver(()=>{
    const status=$('accountSyncStatus'),text=status.textContent||'',kind=status.dataset.state;
    const light=kind==='synced'?'online':kind==='error'?'error':/sincronizando|conectando con tu/i.test(text)?'syncing':'offline';
    $('accountBtn').dataset.driveState=light;
    $('accountBtn').setAttribute('aria-label','Mi cuenta y respaldo. '+(light==='online'?'Conectado a Google Drive':light==='syncing'?'Sincronizando':light==='error'?'Revisar sincronización':'Sin conexión activa'));
  }).observe(legacyStatus,{childList:true,characterData:true,subtree:true,attributes:true,attributeFilter:['data-state']});
  updateView();updateFilter();
})();

/* 3.3 — compact embedded raster images, no extra Google scopes.
   Optimized pixels are encoded in the note's contentHtml. The same validated JSON
   revision already used by Drive carries them, including history and backups.
   No external URLs/blobs survive saving; opening the note on another device is
   independent of the file picker, original website, and local file paths. */
(() => {
  'use strict';
  const A=window.MauziApp,$=id=>document.getElementById(id),editor=$('noteContent');
  const noteModal=$('noteModal'),reader=$('readNoteContent'),fileInput=$('noteImageFile');
  const insertBtn=$('insertImageBtn'),saveBtn=$('saveNoteBtn');
  const MAX_SOURCE_BYTES=24*1024*1024,MAX_NOTE_BYTES=1800000,MAX_PICTURE_BYTES=280000;
  const encoder=new TextEncoder();
  let busy=false,epoch=0;
  const toast=message=>A.toast(message);
  function sessionOpen(){return !noteModal.classList.contains('hidden');}
  function markBusy(value){busy=value;insertBtn.disabled=value;insertBtn.setAttribute('aria-busy',String(value));saveBtn.disabled=value;editor.contentEditable=String(!value&&!window.MauziEditorModes?.isFormat());}
  function cancelImport(){epoch++;if(busy)markBusy(false);}
  window.addEventListener('mauzi:editor-opened',()=>{cancelImport();fileInput.value='';});
  new MutationObserver(()=>{if(!sessionOpen())cancelImport();}).observe(noteModal,{attributes:true,attributeFilter:['class']});
  const fileToDataURL=blob=>new Promise((resolve,reject)=>{
    const r=new FileReader();r.onerror=()=>reject(new Error('No se pudo leer la imagen.'));r.onload=()=>resolve(String(r.result));r.readAsDataURL(blob);
  });
  function blobFromDataURL(src){
    const m=String(src).match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=\s]+)$/);
    if(!m || m[1]==='image/svg+xml')throw new Error('La imagen pegada no tiene un formato compatible.');
    if(m[2].length>MAX_SOURCE_BYTES*1.4)throw new Error('La imagen supera 24 MB. Elige una copia más pequeña.');
    const binary=atob(m[2].replace(/\s/g,'')),bytes=new Uint8Array(binary.length);
    for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);
    return new Blob([bytes],{type:m[1]});
  }
  async function optimize(blob,budget=MAX_PICTURE_BYTES){
    if(!blob || blob.size>MAX_SOURCE_BYTES)throw new Error('La imagen supera 24 MB. Elige una copia más pequeña.');
    if(/svg|xml|html/i.test(blob.type))throw new Error('Usa una foto JPG, PNG, WebP o GIF, no un archivo SVG.');
    const src=URL.createObjectURL(blob),image=new Image();
    try{
      await new Promise((resolve,reject)=>{image.onload=resolve;image.onerror=()=>reject(new Error('No se pudo abrir la imagen. Prueba con JPG o PNG.'));image.src=src;});
      if(!image.naturalWidth||!image.naturalHeight)throw new Error('La imagen está vacía.');
      const canvas=document.createElement('canvas');let scale=Math.min(1,2200/Math.max(image.naturalWidth,image.naturalHeight));
      const toBlob=(mime,q)=>new Promise((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(new Error('No se pudo preparar la imagen.')),mime,q));
      let encoded=null;
      for(let size=0;size<5;size++){
        canvas.width=Math.max(1,Math.round(image.naturalWidth*scale));canvas.height=Math.max(1,Math.round(image.naturalHeight*scale));
        const ctx=canvas.getContext('2d');if(!ctx)throw new Error('El navegador no pudo preparar la foto.');
        ctx.drawImage(image,0,0,canvas.width,canvas.height);
        // WebP preserves transparency and is self-contained. Fall back to JPEG
        // with a white background when a browser only supports PNG output here.
        for(const quality of [.88,.78,.66,.55]){
          encoded=await toBlob('image/webp',quality);
          if(encoded.type!=='image/webp' && encoded.size>budget){
            ctx.globalCompositeOperation='destination-over';ctx.fillStyle='#ffffff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.globalCompositeOperation='source-over';
            encoded=await toBlob('image/jpeg',quality);
          }
          if(encoded.size<=budget)break;
        }
        if(encoded.size<=budget)break;scale*=.75;
      }
      if(!encoded || encoded.size>budget)throw new Error('Esta imagen no cabe en la nota. Usa otra nota para guardarla.');
      const data=await fileToDataURL(encoded);
      if(!window.MauziRich.safeImageSource(data))throw new Error('No se pudo convertir la imagen a un formato seguro.');
      return {src:data,width:canvas.width,height:canvas.height};
    }finally{URL.revokeObjectURL(src);}
  }
  function pictureHTML(pic,name){
    const img=document.createElement('img');img.src=pic.src;img.alt=String(name||'Imagen adjunta').slice(0,180);
    img.className='note-inline-image';img.width=pic.width;img.height=pic.height;img.draggable=false;
    return img.outerHTML;
  }
  function rememberRange(){window.saveEditorSelection?.();}
  function currentRange(){
    const s=window.getSelection();
    if(s?.rangeCount&&editor.contains(s.getRangeAt(0).commonAncestorContainer))return s.getRangeAt(0).cloneRange();
    const r=document.createRange();r.selectNodeContents(editor);r.collapse(false);return r;
  }
  function putFragment(html,range){
    const formatOnly=window.MauziEditorModes?.isFormat();
    if(!formatOnly)editor.focus({preventScroll:true});
    if(!range || !editor.contains(range.startContainer)||!editor.contains(range.endContainer)){range=document.createRange();range.selectNodeContents(editor);range.collapse(false);}
    const selection=window.getSelection();selection.removeAllRanges();selection.addRange(range);
    let inserted=false;
    if(!formatOnly)try{inserted=document.execCommand('insertHTML',false,html);}catch(_){}
    if(!inserted){range.deleteContents();const frag=range.createContextualFragment(html),last=frag.lastChild;range.insertNode(frag);if(last){range.setStartAfter(last);range.collapse(true);selection.removeAllRanges();selection.addRange(range);}}
    editor.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertFromPaste'}));
    rememberRange();window.MauziRich.refresh();requestAnimationFrame(()=>window.keepEditorCaretVisible?.());
  }
  async function fetchRemotePicture(src){
    let url;try{url=new URL(src);}catch(_){throw new Error('La imagen tiene una dirección local o no válida.');}
    if(url.protocol!=='https:' || url.username || url.password)throw new Error('No se pudo incorporar una imagen de la página.');
    if(!navigator.onLine)throw new Error('Sin internet para incorporar la imagen de la página.');
    const c=new AbortController(),timer=setTimeout(()=>c.abort(),8000);
    try{
      const r=await fetch(url.href,{mode:'cors',credentials:'omit',referrerPolicy:'no-referrer',signal:c.signal});
      if(!r.ok)throw new Error('La página no permite copiar su imagen.');
      if(Number(r.headers.get('content-length'))>MAX_SOURCE_BYTES)throw new Error('La imagen supera 24 MB.');
      const b=await r.blob();if(!b.type.startsWith('image/'))throw new Error('La dirección no devolvió una imagen.');return b;
    }finally{clearTimeout(timer);}
  }
  async function importImages({files=[],html='',range=null}={}){
    if(busy||!sessionOpen())return;
    const seq=++epoch,position=range||currentRange();
    const previousHTML=A.sanitize(editor.innerHTML);
    const originalSize=encoder.encode(previousHTML).length+encoder.encode(A.plain(previousHTML)).length;
    const available=MAX_NOTE_BYTES-originalSize;
    let doc=null,externalNodes=[];
    if(html){doc=new DOMParser().parseFromString(html,'text/html');externalNodes=[...doc.body.querySelectorAll('img')];}
    const howMany=externalNodes.length||files.length;
    if(!howMany)return;
    if(howMany>12 || available<80000){toast('La nota tiene muchas imágenes. Guarda las siguientes en otra nota.');return;}
    const budget=Math.min(MAX_PICTURE_BYTES,Math.floor((available-20000)*.72/howMany));
    if(budget<30000){toast('Estas imágenes no caben juntas. Agrega menos imágenes o usa otra nota.');return;}
    markBusy(true);toast('Preparando imagen…');
    let fragment='',missing=0,fileIndex=0;
    try{
      if(doc){
        for(const img of externalNodes){
          if(epoch!==seq||!sessionOpen())return;
          try{
            const src=img.getAttribute('src')||'';let blob;
            if(src.startsWith('data:'))blob=blobFromDataURL(src);
            else if(files[fileIndex])blob=files[fileIndex++];
            else blob=await fetchRemotePicture(src);
            const pic=await optimize(blob,budget);
            const box=document.createElement('span');box.innerHTML=pictureHTML(pic,img.alt||'Imagen pegada');img.replaceWith(box.firstChild);
          }catch(error){
            // Do not leave a temporary/remote URL masquerading as a saved picture.
            missing++;const warning=doc.createElement('span');warning.textContent='[Imagen no incorporada'+(img.alt?': '+img.alt.slice(0,100):'')+']';img.replaceWith(warning);
          }
        }
        fragment=window.MauziRich.sanitize(doc.documentElement.outerHTML,true);
      }else{
        const pictures=[];
        for(const file of files){if(epoch!==seq||!sessionOpen())return;const pic=await optimize(file,budget);pictures.push(pictureHTML(pic,file.name||'Imagen pegada'));}
        fragment='<p>'+pictures.join(' ')+'</p><p><br></p>';
      }
      if(epoch!==seq||!sessionOpen())return;
      if(encoder.encode(fragment).length+encoder.encode(A.plain(fragment)).length+originalSize>MAX_NOTE_BYTES)throw new Error('La nota está muy llena. Guarda las imágenes en otra nota.');
      markBusy(false);putFragment(fragment,position);
      toast(missing?'Se pegó el texto. Una imagen no pudo incorporarse; agrégala desde un archivo.':'Imagen incorporada a la nota');
    }catch(error){if(epoch===seq)toast(error.message||'No se pudo incorporar la imagen. El contenido anterior se conserva.');}
    finally{if(epoch===seq)markBusy(false);}
  }
  insertBtn.addEventListener('pointerdown',rememberRange);
  insertBtn.addEventListener('click',()=>{if(busy)return;rememberRange();fileInput.value='';fileInput.click();});
  fileInput.addEventListener('change',()=>{
    if(!fileInput.files.length)return;
    window.restoreEditorSelection?.();const range=currentRange();
    importImages({files:[...fileInput.files],range});
  });
  // Capture before the rich-text paste handler. Mixed Office text stays formatted.
  editor.addEventListener('paste',event=>{
    const d=event.clipboardData;if(!d)return;
    const html=d.getData('text/html'),files=[...d.items].filter(i=>i.kind==='file'&&i.type.startsWith('image/')).map(i=>i.getAsFile()).filter(Boolean);
    if(!files.length && !/<img\b/i.test(html))return;
    event.preventDefault();event.stopImmediatePropagation();
    importImages({files,html:/<img\b/i.test(html)?html:'',range:currentRange()});
  },true);
  editor.addEventListener('dragover',e=>{if([...e.dataTransfer.types].includes('Files')){e.preventDefault();e.dataTransfer.dropEffect='copy';editor.classList.add('image-drop-target');}});
  editor.addEventListener('dragleave',()=>editor.classList.remove('image-drop-target'));
  editor.addEventListener('drop',e=>{
    editor.classList.remove('image-drop-target');const files=[...e.dataTransfer.files].filter(f=>f.type.startsWith('image/'));
    if(!files.length)return;e.preventDefault();e.stopImmediatePropagation();
    let range=null;
    if(document.caretRangeFromPoint)range=document.caretRangeFromPoint(e.clientX,e.clientY);
    else if(document.caretPositionFromPoint){const p=document.caretPositionFromPoint(e.clientX,e.clientY);if(p){range=document.createRange();range.setStart(p.offsetNode,p.offset);range.collapse(true);}}
    importImages({files,range:range&&editor.contains(range.startContainer)?range:currentRange()});
  },true);

  // Edge-to-edge image preview: never stretch or crop; pinch/drag and wheel zoom.
  const viewer=$('noteImageViewer'),stage=$('imageStage'),large=$('largeNoteImage'),closeBtn=$('closeNoteImage');
  let open=false,sourceImage=null,returnFocus=null,ownFullscreen=false,pushed=false;
  let scale=1,x=0,y=0,lastTap=0,pinch=null,pointers=new Map(),generation=0;
  function bounds(){const r=stage.getBoundingClientRect();return {w:r.width,h:r.height};}
  function draw(){
    const {w,h}=bounds(),ratio=large.naturalWidth/(large.naturalHeight||1);
    const bw=Math.min(w,h*ratio),bh=Math.min(h,w/ratio);
    const maxX=Math.max(0,(bw*scale-w)/2),maxY=Math.max(0,(bh*scale-h)/2);
    x=Math.max(-maxX,Math.min(maxX,x));y=Math.max(-maxY,Math.min(maxY,y));
    large.style.transform=`translate3d(${x}px,${y}px,0) scale(${scale})`;
    $('imageZoomOut').disabled=scale<=1;$('imageZoomIn').disabled=scale>=5;
    stage.classList.toggle('zoomed',scale>1);
  }
  function zoom(value){scale=Math.max(1,Math.min(5,value));if(scale===1){x=0;y=0;}draw();}
  function fit(){scale=1;x=0;y=0;draw();}
  function exitImage({fromHistory=false}={}){
    if(!open)return;open=false;generation++;viewer.classList.add('hidden');document.body.classList.remove('has-image-viewer');
    pointers.clear();pinch=null;
    if(ownFullscreen){ownFullscreen=false;try{(document.exitFullscreen?.()||document.webkitExitFullscreen?.())?.catch?.(()=>{});}catch(_){}}
    if(pushed){pushed=false;if(!fromHistory&&history.state?.mauziImagePreview){try{history.back();}catch(_){}}}
    large.removeAttribute('src');large.alt='';sourceImage=null;
    if(returnFocus?.isConnected)returnFocus.focus?.({preventScroll:true});
    window.MauziRich.refresh();
  }
  function showImage(img){
    const src=window.MauziRich.safeImageSource(img.getAttribute('src'));if(!src)return;
    if(busy)return;
    open=true;const seq=++generation;sourceImage=img;returnFocus=document.activeElement;
    large.src=src;large.alt=img.alt||'Imagen de la nota';fit();
    $('deletePreviewImageBtn').classList.remove('hidden');
    viewer.classList.remove('hidden');document.body.classList.add('has-image-viewer');
    if(!window.MauziNavigation){try{history.pushState({...history.state,mauziImagePreview:true},'');pushed=true;}catch(_){}}
    // Progressive fullscreen. CSS fallback covers the entire visible app on iOS.
    if(!(document.fullscreenElement||document.webkitFullscreenElement)){
      const fn=document.documentElement.requestFullscreen||document.documentElement.webkitRequestFullscreen;
      if(fn){ownFullscreen=true;try{Promise.resolve(fn.call(document.documentElement)).then(()=>{if(seq!==generation&&!open){try{document.exitFullscreen?.().catch(()=>{});}catch(_){}}}).catch(()=>{if(seq===generation)ownFullscreen=false;});}catch(_){ownFullscreen=false;}}
    }
    requestAnimationFrame(()=>{draw();closeBtn.focus({preventScroll:true});});
  }
  document.addEventListener('click',e=>{
    const img=e.target.closest?.('#readNoteContent img,#noteContent img');
    if(!img)return;e.preventDefault();e.stopImmediatePropagation();showImage(img);
  },true);
  function decorate(){
    reader.querySelectorAll('img').forEach(img=>{img.tabIndex=0;img.setAttribute('role','button');img.setAttribute('aria-label','Ampliar imagen: '+(img.alt||'adjunta'));});
  }
  new MutationObserver(decorate).observe(reader,{childList:true,subtree:true});
  reader.addEventListener('keydown',e=>{if(e.target.matches('img')&&(e.key==='Enter'||e.key===' ')){e.preventDefault();showImage(e.target);}});
  closeBtn.addEventListener('click',()=>exitImage());
  $('imageZoomIn').addEventListener('click',()=>zoom(scale*1.4));
  $('imageZoomOut').addEventListener('click',()=>zoom(scale/1.4));
  $('imageFit').addEventListener('click',fit);
  $('deletePreviewImageBtn').addEventListener('click',async()=>{
    const img=sourceImage;if(!img)return;
    if(!confirm('¿Eliminar esta imagen de la nota? Al guardar y sincronizar se quitará también de las versiones administradas por MAUZI NOTE en tu Drive. Las copias exportadas aparte no cambian.'))return;
    if(editor.contains(img)){
      exitImage();img.remove();editor.dispatchEvent(new Event('input',{bubbles:true}));window.MauziRich.refresh();
      toast('Imagen quitada. Guarda la nota para sincronizar la eliminación.');
    }else{
      const noteId=A.currentReadId(),source=img.getAttribute('src');
      const note=A.note(noteId);if(!note)return;
      const box=document.createElement('div');box.innerHTML=note.contentHtml||A.oldText(note.content||'');
      const found=[...box.querySelectorAll('img')].find(x=>x.getAttribute('src')===source);if(!found)return;
      found.remove();const button=$('deletePreviewImageBtn');button.disabled=true;
      try{await A.updateNote(noteId,{contentHtml:box.innerHTML});exitImage();toast('Imagen eliminada. La sincronización completará el cambio en Drive.');}
      catch(e){toast(e.message||'No se pudo guardar. La imagen no se eliminó.');}
      finally{button.disabled=false;}
    }
  });
  document.addEventListener('keydown',e=>{
    if(!open)return;
    if(e.key==='Escape'){e.preventDefault();e.stopImmediatePropagation();exitImage();return;}
    if(e.key==='Tab'){
      const buttons=[...viewer.querySelectorAll('button:not(.hidden):not(:disabled)')];const i=buttons.indexOf(document.activeElement);
      e.preventDefault();buttons[(i+(e.shiftKey?-1:1)+buttons.length)%buttons.length]?.focus();
    }
    if(['+','=','-','0'].includes(e.key)){e.preventDefault();e.key==='0'?fit():zoom(scale*(e.key==='-'?1/1.4:1.4));}
  },true);
  stage.addEventListener('wheel',e=>{e.preventDefault();zoom(scale*Math.exp(-e.deltaY*.002));},{passive:false});
  stage.addEventListener('dblclick',()=>zoom(scale>1?1:2.4));
  stage.addEventListener('pointerdown',e=>{
    if(e.pointerType==='mouse'&&e.button!==0)return;
    stage.setPointerCapture(e.pointerId);pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});
    if(pointers.size===2){const p=[...pointers.values()];pinch={distance:Math.hypot(p[1].x-p[0].x,p[1].y-p[0].y),scale};}
  });
  stage.addEventListener('pointermove',e=>{
    const old=pointers.get(e.pointerId);if(!old)return;
    pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});
    if(pointers.size===2){const p=[...pointers.values()];if(pinch?.distance)zoom(pinch.scale*Math.hypot(p[1].x-p[0].x,p[1].y-p[0].y)/pinch.distance);}
    else if(pointers.size===1&&scale>1){x+=e.clientX-old.x;y+=e.clientY-old.y;draw();}
  });
  function endPointer(e){pointers.delete(e.pointerId);if(pointers.size<2)pinch=null;}
  stage.addEventListener('pointerup',e=>{
    const count=pointers.size;endPointer(e);
    if(e.pointerType!=='mouse'&&count===1){const t=Date.now();if(t-lastTap<270){zoom(scale>1?1:2.4);lastTap=0;}else lastTap=t;}
  });
  stage.addEventListener('pointercancel',endPointer);
  large.addEventListener('load',()=>{if(open)draw();});
  window.addEventListener('resize',()=>{if(open)draw();});
  window.visualViewport?.addEventListener('resize',()=>{if(open)draw();});
  window.addEventListener('popstate',()=>{if(open&&pushed&&!history.state?.mauziImagePreview){pushed=false;exitImage({fromHistory:true});}});
  document.addEventListener('fullscreenchange',()=>{if(open&&ownFullscreen&&!document.fullscreenElement){ownFullscreen=false;exitImage();}});
  window.MauziImages={isOpen:()=>open,isImporting:()=>busy,close:exitImage};
})();
