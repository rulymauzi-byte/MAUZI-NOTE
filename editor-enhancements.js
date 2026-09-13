/* MAUZI NOTE 3.1 — texto enriquecido y renglones vinculados al texto real.
   Sin bibliotecas remotas. No se solicita acceso general al portapapeles.
   Solo se procesa lo entregado por el navegador durante el gesto de pegar. */
(() => {
  'use strict';
  const DROP = new Set(['SCRIPT','STYLE','IFRAME','OBJECT','EMBED','FORM','INPUT','BUTTON','TEXTAREA','SELECT','IMG','SVG','MATH','VIDEO','AUDIO','LINK','META','BASE','TEMPLATE','NOSCRIPT','CANVAS']);
  const KEEP = new Set(['DIV','P','BR','B','STRONG','I','EM','U','S','STRIKE','DEL','INS','UL','OL','LI','H1','H2','H3','H4','H5','H6','SPAN','FONT','SUB','SUP','BLOCKQUOTE','PRE','CODE','A','TABLE','THEAD','TBODY','TFOOT','TR','TD','TH','CAPTION','COLGROUP','COL','HR']);
  const LIST = new Set(['decimal','decimal-leading-zero','upper-roman','lower-roman','upper-alpha','lower-alpha','upper-latin','lower-latin','disc','circle','square','none']);
  const STYLE = ['color','background-color','font-weight','font-style','font-family','font-size','text-decoration','text-decoration-line','text-decoration-color','text-align','vertical-align','line-height','letter-spacing','white-space','list-style-type','list-style-position','margin-top','margin-bottom','margin-left','margin-right','padding-top','padding-bottom','padding-left','padding-right','text-indent','border-collapse','border-spacing','border-top','border-bottom','border-left','border-right','width','max-width'];
  const BLOCKS = new Set(['DIV','P','H1','H2','H3','H4','H5','H6','BLOCKQUOTE','PRE','LI','TR','UL','OL','TABLE']);
  const cap = (n,a,b) => Math.min(b,Math.max(a,n));
  const number = value => /^-?\d{1,6}$/.test(value||'') ? cap(Number(value),-99999,99999) : null;

  function safeValue(prop,value) {
    value=String(value||'').trim();
    if(!value || value.length>240 || /url\s*\(|expression\s*\(|@import|javascript:|data:|var\s*\(|[<>\\]/i.test(value)) return '';
    if(prop==='list-style-type'&&!LIST.has(value))return '';
    if(prop==='list-style-position'&&!['inside','outside'].includes(value))return '';
    if(prop==='white-space'&&!['normal','pre','pre-wrap','pre-line','break-spaces'].includes(value))return '';
    // Keep document typography, but do not allow invisible or enormous pasted text.
    if(prop==='font-size'){
      const m=value.match(/^([\d.]+)(px|pt|em|rem|%)$/);
      if(m){let px=Number(m[1])*({px:1,pt:4/3,em:18,rem:16,'%':.18}[m[2]]);if(px<6||px>96)value=cap(px,6,96)+'px';}
      else if(!/^(xx-small|x-small|small|medium|large|x-large|xx-large|smaller|larger)$/.test(value))return '';
    }
    if(/^(margin|padding)/.test(prop)&&(/-/.test(value)||parseFloat(value)>120))return '';
    if(prop==='text-indent'&&Math.abs(parseFloat(value))>120)return '';
    return value;
  }
  function copyStyles(from,to){
    for(const prop of STYLE){const v=safeValue(prop,from.style.getPropertyValue(prop));if(v)to.style.setProperty(prop,v);}
    const bg=from.style.backgroundColor;if(bg&&!to.style.backgroundColor)to.style.backgroundColor=bg;
    return to;
  }
  function inlineClipboardStyles(doc){
    // Word and Office web may place formatting in classes rather than inline styles.
    const rules=[];
    for(const el of [...doc.querySelectorAll('style')].slice(0,12)){
      const text=el.textContent.slice(0,180000);
      if(typeof CSSStyleSheet==='function'){
        try{const sheet=new CSSStyleSheet();sheet.replaceSync(text.replace(/@import[^;]*;/gi,''));for(const r of sheet.cssRules)if(r.selectorText&&r.style)rules.push(r);continue;}catch(_){}
      }
      const rx=/([^{}@]+)\{([^{}]*)\}/g;let m;
      while((m=rx.exec(text))){const e=doc.createElement('span');e.setAttribute('style',m[2]);rules.push({selectorText:m[1].trim(),style:e.style});}
    }
    const merged=new Map();
    for(const rule of rules.slice(0,350)){
      if(rule.selectorText.length>300||/::|:(?:has|visited|active|hover)|\*/.test(rule.selectorText))continue;
      let nodes=[];try{nodes=[...doc.body.querySelectorAll(rule.selectorText)].slice(0,7000);}catch(_){continue;}
      for(const node of nodes){let temp=merged.get(node);if(!temp){temp=doc.createElement('span');merged.set(node,temp);}copyStyles(rule,temp);}
    }
    for(const [node,style] of merged){copyStyles(node,style);const original=node.getAttribute('style')||'';node.setAttribute('style',style.getAttribute('style')||'');if(original)node.setAttribute('style',(node.getAttribute('style')||'')+';'+original);}
    // Google Docs uses a b element as a clipboard wrapper with font-weight:normal.
    // Retain its explicit font weight rather than turning the entire paste bold.
  }
  function romanValue(s){const vals={I:1,V:5,X:10,L:50,C:100,D:500,M:1000};s=s.toUpperCase();let n=0;for(let i=0;i<s.length;i++)n+=(vals[s[i]]<(vals[s[i+1]]||0)?-1:1)*vals[s[i]];return n||1;}
  function markerInfo(marker,hint=''){
    const t=marker.trim().replace(/[\u00a0\s\u200b]+/g,'');
    let style=({'roman-upper':'upper-roman','roman-lower':'lower-roman','alpha-upper':'upper-alpha','alpha-lower':'lower-alpha','arabic':'decimal','bullet':'disc'}[hint]||hint);
    if(!LIST.has(style))style='';
    let m=t.match(/^\(?([IVXLCDM]+|[ivxlcdm]+|\d+|[A-Za-z])[.)]?$/);
    let value=1;
    if(m){const label=m[1];
      if(!style)style=/^\d+$/.test(label)?'decimal':/^[IVXLCDM]+$/.test(label)?'upper-roman':/^[ivxlcdm]+$/.test(label)?'lower-roman':/^[A-Z]$/.test(label)?'upper-alpha':'lower-alpha';
      value=style.includes('roman')?romanValue(label):style.includes('alpha')||style.includes('latin')?label.toUpperCase().charCodeAt(0)-64:Number(label)||1;
    }else if(!style){style=/[■▪]/.test(t)?'square':/[○◦o]/.test(t)?'circle':'disc';}
    return {style,value,suffix:t.endsWith(')')?')':'.',prefix:t.startsWith('(')?'(':''};
  }
  function wordLists(doc,raw){
    const definitions=new Map();let m;const def=/@list\s+(l\d+):level(\d+)\s*\{([\s\S]*?)\}/gi;
    while((m=def.exec(raw))){const num=m[3].match(/mso-level-number-format\s*:\s*([\w-]+)/i);if(num)definitions.set(m[1]+':'+m[2],num[1]);}
    const parents=new Set([...doc.body.querySelectorAll('p,div')].filter(p=>/mso-list\s*:\s*(?!Ignore|none)/i.test(p.getAttribute('style')||'')).map(p=>p.parentNode));
    for(const parent of parents){let stack=[],group='';
      for(const p of [...parent.children]){
        const s=p.getAttribute('style')||'',m=s.match(/mso-list\s*:\s*(l\d+)\s+level(\d+)\s+(lfo\d+)/i);
        if(!m){if(!['STYLE','META'].includes(p.tagName)){stack=[];group='';}continue;}
        const level=cap(+m[2],1,9),id=m[1]+':'+m[3];
        const markerNodes=[...p.querySelectorAll('span')].filter(e=>/mso-list\s*:\s*Ignore/i.test(e.getAttribute('style')||''));
        let marker=markerNodes.map(e=>e.textContent).join('');
        if(!marker){const t=p.textContent.match(/^\s*([IVXLCDMivxlcdm]+[.)]|\d+[.)]|[A-Za-z][.)]|[•·●○■▪◦])\s+/);if(t){marker=t[1];let remaining=t[0].length;const w=doc.createTreeWalker(p,NodeFilter.SHOW_TEXT);let n;while(remaining&&(n=w.nextNode())){const len=Math.min(n.length,remaining);n.deleteData(0,len);remaining-=len;}}}
        markerNodes.forEach(n=>n.remove());
        const info=markerInfo(marker,definitions.get(m[1]+':'+m[2])||'');
        if(group!==id){stack=[];group=id;}
        while(stack.length&&stack[stack.length-1].level>level)stack.pop();
        let entry=stack[stack.length-1];
        if(!entry||entry.level!==level||entry.style!==info.style){
          const ordered=!['disc','circle','square','none'].includes(info.style),list=doc.createElement(ordered?'ol':'ul');
          list.style.listStyleType=info.style;
          if(ordered){list.setAttribute('type',({'upper-roman':'I','lower-roman':'i','upper-alpha':'A','lower-alpha':'a'}[info.style]||'1'));if(info.value!==1)list.start=info.value;if(info.suffix===')')list.dataset.mauziSuffix=')';if(info.prefix)list.dataset.mauziPrefix=info.prefix;}
          if(entry&&entry.level<level&&entry.last)entry.last.appendChild(list);else parent.insertBefore(list,p);
          entry={level,list,style:info.style,last:null,next:info.value};stack.push(entry);
        }
        const li=doc.createElement('li');copyStyles(p,li);
        li.style.removeProperty('margin-left');li.style.removeProperty('text-indent');li.style.removeProperty('padding-left');
        if(entry.list.tagName==='OL'&&info.value!==entry.next)li.value=info.value;
        while(p.firstChild)li.appendChild(p.firstChild);
        entry.list.appendChild(li);entry.last=li;entry.next=info.value+1;p.remove();
      }
    }
  }
  function sanitize(raw='',clipboard=false){
    raw=String(raw||'');if(raw.length>3000000)throw new Error('El texto es demasiado extenso. Divídelo en varias notas.');
    const doc=new DOMParser().parseFromString(raw.replace(/<!--\[if !supportLists\]>([\s\S]*?)<!\[endif\]-->/gi,'$1'),'text/html');
    if(clipboard){inlineClipboardStyles(doc);wordLists(doc,raw);}
    const out=document.createElement('div');let count=0;
    function convert(node,parent){
      if(++count>60000)throw new Error('El formato contiene demasiados elementos. Divide el documento en varias notas.');
      if(node.nodeType===Node.TEXT_NODE){parent.appendChild(document.createTextNode(node.nodeValue));return;}
      if(node.nodeType!==Node.ELEMENT_NODE)return;
      if(DROP.has(node.tagName))return;
      let tag=node.tagName;
      if(!KEEP.has(tag)){for(const child of node.childNodes)convert(child,parent);return;}
      if(tag==='FONT')tag='SPAN';if(tag==='STRIKE')tag='S';
      const e=document.createElement(tag.toLowerCase());copyStyles(node,e);
      if(node.tagName==='FONT'){
        if(node.hasAttribute('color')&&!e.style.color)e.style.color=safeValue('color',node.getAttribute('color'));
        if(node.hasAttribute('face')&&!e.style.fontFamily)e.style.fontFamily=safeValue('font-family',node.getAttribute('face'));
        const sizes=[0,10,13,16,18,24,32,48],fs=+node.getAttribute('size');if(fs>0&&fs<8&&!e.style.fontSize)e.style.fontSize=sizes[fs]+'px';
      }
      const dir=node.getAttribute('dir');if(['rtl','ltr','auto'].includes(dir))e.dir=dir;
      if(tag==='OL'){
        const type=node.getAttribute('type');if(['1','a','A','i','I'].includes(type))e.setAttribute('type',type);
        const start=number(node.getAttribute('start'));if(start!==null)e.start=start;
        if(node.hasAttribute('reversed'))e.reversed=true;
        const typeStyle={I:'upper-roman',i:'lower-roman',A:'upper-alpha',a:'lower-alpha','1':'decimal'};
        const ls=e.style.listStyleType||typeStyle[type]||'decimal';e.setAttribute('data-mauzi-list',ls);
        if(node.getAttribute('data-mauzi-suffix')===')')e.setAttribute('data-mauzi-suffix',')');
        if(node.getAttribute('data-mauzi-prefix')==='(')e.setAttribute('data-mauzi-prefix','(');
      }
      if(tag==='LI'){const v=number(node.getAttribute('value'));if(v!==null)e.value=v;}
      if(['TD','TH','COL'].includes(tag))for(const attr of ['colspan','rowspan','span']){const v=number(node.getAttribute(attr));if(v>0)e.setAttribute(attr,String(cap(v,1,100)));}
      if(tag==='A'){
        const href=node.getAttribute('href')||'';
        if(/^(https?:\/\/|mailto:|tel:|#)/i.test(href)&&!/[\u0000-\u001f]/.test(href)){e.setAttribute('href',href);e.setAttribute('target','_blank');e.setAttribute('rel','noopener noreferrer');}
        const title=node.getAttribute('title');if(title)e.title=title.slice(0,300);
      }
      if(!e.getAttribute('style'))e.removeAttribute('style');
      for(const child of node.childNodes)convert(child,e);
      parent.appendChild(e);
    }
    for(const child of doc.body.childNodes)convert(child,out);
    return out.innerHTML;
  }
  function plain(raw=''){
    const host=document.createElement('div');host.innerHTML=raw;let value='';
    function walk(n){if(n.nodeType===Node.TEXT_NODE){value+=n.nodeValue;return;}if(n.nodeType!==1)return;if(n.tagName==='BR'){value+='\n';return;}const b=BLOCKS.has(n.tagName);if(b&&value&&!value.endsWith('\n'))value+='\n';for(const c of n.childNodes)walk(c);if(b&&!value.endsWith('\n'))value+='\n';}
    walk(host);return value.replace(/\u00a0/g,' ').trim();
  }

  /* Paper rules follow each REAL visual text row, not a fixed repeating gradient.
     Range.getClientRects measures wraps, fonts, lists and large headings without
     changing the editable DOM or moving the caret. Lines stay below descenders. */
  function paperEngine(root){
    let frame=0,lastImage='',lastWidth=0;
    function request(){if(!frame)frame=requestAnimationFrame(draw);}
    function draw(){
      frame=0;if(!root.isConnected||!root.getClientRects().length)return;
      const rect=root.getBoundingClientRect(),width=Math.round(rect.width),height=Math.ceil(root.scrollHeight);
      if(!width||!height)return;
      const style=getComputedStyle(root),padT=parseFloat(style.paddingTop)||0,padB=parseFloat(style.paddingBottom)||0;
      const baseLine=parseFloat(style.lineHeight)||parseFloat(style.fontSize)*1.65;
      const fragments=[],exclusions=[],walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);let n,nodes=0;
      for(const table of root.querySelectorAll('table,pre')){const r=table.getBoundingClientRect();exclusions.push({top:r.top-rect.top,bottom:r.bottom-rect.top});}
      while((n=walker.nextNode())){
        if(++nodes>40000)break;
        if(!n.nodeValue.trim()||n.parentElement.closest('table,pre'))continue;
        const range=document.createRange();range.selectNodeContents(n);
        for(const r of range.getClientRects())if(r.width>0&&r.height>0)fragments.push({top:r.top-rect.top,bottom:r.bottom-rect.top});
      }
      // Blank paragraphs are writable rows too.
      for(const e of root.querySelectorAll('p,div,li'))if(!e.textContent.trim()&&!e.querySelector('p,div,li,table')){const r=e.getBoundingClientRect(),s=getComputedStyle(e);if(r.height){const font=parseFloat(s.fontSize)||18,lh=parseFloat(s.lineHeight)||baseLine;fragments.push({top:r.top-rect.top+(lh-font)/2,bottom:r.top-rect.top+(lh+font)/2});}}
      fragments.sort((a,b)=>a.top-b.top||b.bottom-a.bottom);
      const rows=[];
      for(const f of fragments){const prev=rows[rows.length-1];if(prev&&Math.min(prev.bottom,f.bottom)-Math.max(prev.top,f.top)>Math.min(prev.bottom-prev.top,f.bottom-f.top)*.22){prev.top=Math.min(prev.top,f.top);prev.bottom=Math.max(prev.bottom,f.bottom);}else rows.push({...f});}
      const ys=[];let prevY=padT-1;
      const blocked=(a,b)=>exclusions.some(r=>a<r.bottom+3&&b>r.top-3);
      for(let i=0;i<rows.length;i++){
        const row=rows[i],next=rows[i+1];
        for(let y=prevY+baseLine;y<row.top-4;y+=baseLine)if(y>padT&&!blocked(y-2,y+2))ys.push(y);
        const y=row.bottom+2;
        if((!next||y<next.top-1)&&!blocked(row.top,y))ys.push(y);
        prevY=Math.max(prevY,y);
      }
      if(!rows.length)prevY=padT+(baseLine+(parseFloat(style.fontSize)||18))/2+2-baseLine;
      for(let y=prevY+baseLine;y<height-2;y+=baseLine)if(y>padT&&!blocked(y-2,y+2))ys.push(y);
      const path=ys.slice(0,20000).map(y=>'M0 '+(Math.round(y*2)/2)+'H'+width).join('');
      const svg='<svg xmlns="http://www.w3.org/2000/svg" width="'+width+'" height="'+height+'" viewBox="0 0 '+width+' '+height+'"><path d="'+path+'" fill="none" stroke="#b3914b" stroke-opacity=".23" stroke-width=".8"/></svg>';
      const image='url("data:image/svg+xml,'+encodeURIComponent(svg)+'")';
      if(image!==lastImage){lastImage=image;root.style.setProperty('--note-rules',image);}
      root.dataset.ruledRows=String(ys.length); // non-content diagnostics; never saved with a note.
      lastWidth=width;
    }
    new MutationObserver(records=>{if(records.some(r=>r.target!==root||r.type!=='attributes'||!['style','data-ruled-rows'].includes(r.attributeName)))request();}).observe(root,{childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:['style','class','type','start','value','data-ruled-rows']});
    if('ResizeObserver' in window)new ResizeObserver(request).observe(root);
    window.addEventListener('resize',request,{passive:true});
    window.visualViewport?.addEventListener('resize',request,{passive:true});
    root.addEventListener('input',request);
    document.fonts?.ready.then(request);request();return {refresh:request};
  }
  function bind(){
    const editor=document.getElementById('noteContent'),reader=document.getElementById('readNoteContent');if(!editor||!reader)return;
    const paper=[paperEngine(editor),paperEngine(reader)];
    for(const id of ['noteModal','noteReadModal'])new MutationObserver(()=>paper.forEach(p=>p.refresh())).observe(document.getElementById(id),{attributes:true,attributeFilter:['class']});
    editor.addEventListener('paste',event=>{
      const data=event.clipboardData;if(!data)return;
      const html=data.getData('text/html'),text=data.getData('text/plain');if(!html&&!text)return;
      event.preventDefault();
      try{
        const fragment=html?sanitize(html,true):text.split(/\r?\n/).map(line=>'<p>'+line.replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]))+'</p>').join('');
        editor.focus({preventScroll:true});const selection=window.getSelection();
        if(!selection.rangeCount||!editor.contains(selection.anchorNode)){const r=document.createRange();r.selectNodeContents(editor);r.collapse(false);selection.removeAllRanges();selection.addRange(r);}
        let inserted=false;
        // An empty editor can retain a browser's previous H2/bold typing state.
        // Insert a clean fragment at the root in that case, rather than inheriting it.
        if(!editor.textContent.trim()){
          const r=document.createRange();r.selectNodeContents(editor);r.deleteContents();
          const f=r.createContextualFragment(fragment),last=f.lastChild;r.insertNode(f);
          if(last){r.setStartAfter(last);r.collapse(true);selection.removeAllRanges();selection.addRange(r);}inserted=true;
        }else{try{inserted=document.execCommand('insertHTML',false,fragment);}catch(_){}}
        if(!inserted){const r=selection.getRangeAt(0);r.deleteContents();const f=r.createContextualFragment(fragment),last=f.lastChild;r.insertNode(f);if(last){r.setStartAfter(last);r.collapse(true);selection.removeAllRanges();selection.addRange(r);}}
        editor.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertFromPaste'}));
        window.saveEditorSelection?.();paper.forEach(p=>p.refresh());
        requestAnimationFrame(()=>window.keepEditorCaretVisible?.());
      }catch(error){window.MauziApp?.toast(error.message||'No se pudo pegar el contenido. La nota anterior no se ha borrado.');}
    });
    // External links never replace the application; Bible references keep their modal.
    reader.addEventListener('click',e=>{const a=e.target.closest('a');if(a&&!a.getAttribute('href'))e.preventDefault();});
    window.MauziRich.refresh=()=>paper.forEach(p=>p.refresh());
  }
  window.MauziRich={sanitize,plain,refresh:()=>{}};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',bind,{once:true});else bind();
})();
