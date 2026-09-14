/* MAUZI NOTE 4.7 — selección nativa para dar formato.
   No consulta palabras ni abre ventanas de diccionario. Las posiciones de texto
   conservan la selección al pasar de lectura a formato sin modificar la nota. */
(() => {
  'use strict';
  const $=id=>document.getElementById(id);
  const reader=$('readNoteContent'),editor=$('noteContent');
  let readerSelection=null;
  function capture(root,range=null){
    const sel=getSelection();const r=range||(sel?.rangeCount?sel.getRangeAt(0):null);
    if(!r||!root.contains(r.startContainer)||!root.contains(r.endContainer))return null;
    const prefix=document.createRange();prefix.selectNodeContents(root);prefix.setEnd(r.startContainer,r.startOffset);
    const start=prefix.toString().length;prefix.setEnd(r.endContainer,r.endOffset);
    return {start,end:prefix.toString().length};
  }
  function textNodes(root){const all=[],walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);let n,offset=0;
    while((n=walker.nextNode())){all.push({node:n,start:offset,end:offset+n.length});offset+=n.length;}return all;}
  function makeRange(root,pos){
    if(!pos)return null;const nodes=textNodes(root),length=nodes.at(-1)?.end||0;
    const start=Math.max(0,Math.min(length,pos.start)),end=Math.max(start,Math.min(length,pos.end));
    if(!nodes.length){const r=document.createRange();r.selectNodeContents(root);r.collapse(true);return r;}
    function point(offset,isEnd){for(const n of nodes)if(offset<n.end||(isEnd&&offset===n.end))return [n.node,Math.max(0,offset-n.start)];const last=nodes.at(-1);return [last.node,last.node.length];}
    const a=point(start,false),b=point(end,true),r=document.createRange();r.setStart(...a);r.setEnd(...b);return r;
  }
  function select(root,pos){const r=makeRange(root,pos);if(!r)return null;const s=getSelection();s.removeAllRanges();s.addRange(r);return r;}
  function selectedParts(root,pos){return textNodes(root).filter(n=>n.end>pos.start&&n.start<pos.end).map(n=>({...n,from:Math.max(0,pos.start-n.start),to:Math.min(n.node.length,pos.end-n.start)})).filter(n=>n.to>n.from);}
  function isBold(root,r){const pos=capture(root,r);if(!pos||pos.start===pos.end)return false;const parts=selectedParts(root,pos);
    return !!parts.length&&parts.every(x=>parseInt(getComputedStyle(x.node.parentElement).fontWeight,10)>=600);}
  function applyInline(root,r,command,value){
    const pos=capture(root,r);if(!pos||pos.start===pos.end)return null;
    const parts=selectedParts(root,pos),weight=isBold(root,r)?'400':'700';
    if(!parts.length)return null;
    for(const part of parts.reverse()){
      let n=part.node;
      if(part.to<n.length)n.splitText(part.to);
      if(part.from>0)n=n.splitText(part.from);
      const span=document.createElement('span');
      if(command==='bold')span.style.fontWeight=weight;
      else if(command==='foreColor')span.style.color=value;
      else span.style.backgroundColor=value;
      n.replaceWith(span);span.append(n);
    }
    return select(root,pos);
  }
  function rememberReader(){
    const pos=capture(reader);
    if(pos&&pos.end>pos.start){readerSelection={...pos,id:window.MauziApp?.currentReadId(),text:reader.textContent};}
    const active=!!pos&&pos.end>pos.start;
    $('formatFromReadBtn')?.classList.toggle('has-text-selection',active);
  }
  function takeReader(){
    rememberReader();
    return readerSelection&&readerSelection.id===window.MauziApp?.currentReadId()&&readerSelection.text===reader.textContent?{start:readerSelection.start,end:readerSelection.end}:null;
  }
  document.addEventListener('selectionchange',rememberReader);
  reader.addEventListener('pointerdown',()=>{readerSelection=null;});
  window.addEventListener('mauzi:note-refreshed',()=>{readerSelection=null;});
  window.addEventListener('mauzi:modal',e=>{if(e.detail?.id==='noteReadModal'&&e.detail.open)readerSelection=null;});

  function wordAt(root,x,y){
    const existing=getSelection();if(existing?.rangeCount&&!existing.isCollapsed&&root.contains(existing.anchorNode)&&root.contains(existing.focusNode))return;
    let node,offset;
    if(document.caretPositionFromPoint){const p=document.caretPositionFromPoint(x,y);node=p?.offsetNode;offset=p?.offset;}
    else if(document.caretRangeFromPoint){const p=document.caretRangeFromPoint(x,y);node=p?.startContainer;offset=p?.startOffset;}
    if(!node||node.nodeType!==Node.TEXT_NODE||!root.contains(node))return;
    const probe=document.createRange();probe.setStart(node,offset);probe.collapse(true);
    const absolute=capture(root,probe)?.start;if(absolute==null)return;
    const text=root.textContent;let from=-1,to=-1;
    if(typeof Intl.Segmenter==='function'){
      for(const part of new Intl.Segmenter('es',{granularity:'word'}).segment(text)){
        if(part.isWordLike&&absolute>=part.index&&absolute<=part.index+part.segment.length){from=part.index;to=from+part.segment.length;break;}
      }
    } else {
      const rx=/[\p{L}\p{N}\p{M}]+(?:[’'-][\p{L}\p{N}\p{M}]+)*/gu;let m;
      while((m=rx.exec(text)))if(absolute>=m.index&&absolute<=m.index+m[0].length){from=m.index;to=from+m[0].length;break;}
    }
    if(from>=0){select(root,{start:from,end:to});window.saveEditorSelection?.();rememberReader();}
  }
  for(const root of [reader,editor]){
    root.style.setProperty('-webkit-user-select','text');root.style.userSelect='text';
    // Native mouse selection and mobile handles are never cancelled.
    root.addEventListener('dblclick',e=>{if(e.target.closest('button,a,img'))return;setTimeout(()=>wordAt(root,e.clientX,e.clientY),0);});
    let down=null,last=null;
    root.addEventListener('pointerdown',e=>{if(e.pointerType==='touch')down={x:e.clientX,y:e.clientY,t:e.timeStamp};},{passive:true});
    root.addEventListener('pointerup',e=>{
      if(e.pointerType!=='touch'||!down)return;
      const tap=Math.hypot(e.clientX-down.x,e.clientY-down.y)<12&&e.timeStamp-down.t<250;down=null;
      if(!tap){last=null;return;}
      if(last&&e.timeStamp-last.t<360&&Math.hypot(e.clientX-last.x,e.clientY-last.y)<22&&!e.target.closest('button,a,img')){
        last=null;setTimeout(()=>wordAt(root,e.clientX,e.clientY),0);
      }else last={x:e.clientX,y:e.clientY,t:e.timeStamp};
    },{passive:true});
    root.addEventListener('pointercancel',()=>{down=null;last=null;},{passive:true});
  }
  window.MauziTextSelection=Object.freeze({capture,makeRange,select,isBold,applyInline,takeReader});
})();
