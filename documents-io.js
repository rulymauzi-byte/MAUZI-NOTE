/* MAUZI NOTE 4.9 — Importar y exportar documentos SIN bibliotecas remotas ni internet.
   Importa: Word .docx, página .html/.htm, texto .txt/.md conservando formato y contenido.
   Exporta: .docx (abre en Word/LibreOffice), .html (abre en cualquier navegador), .txt.
   Todo se procesa en el dispositivo: ningún documento sale a servidores de terceros. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

  /* ---------- ZIP: lectura (para importar .docx) ---------- */
  async function inflateRaw(bytes){
    if (typeof DecompressionStream === 'function'){
      try{
        const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
        return new Uint8Array(await new Response(stream).arrayBuffer());
      }catch(_){ /* pako incluido en la app responde en motores antiguos */ }
    }
    if (!window.pako?.inflateRaw) throw new Error('No se pudo abrir el archivo Word en este navegador.');
    return window.pako.inflateRaw(bytes);
  }

  async function readZipEntries(buffer){
    const view = new DataView(buffer);
    const bytes = new Uint8Array(buffer);
    // Localiza el directorio central desde el final del archivo.
    let eocd = -1;
    for (let i = bytes.length - 22; i >= 0 && i >= bytes.length - 66000; i--){
      if (view.getUint32(i, true) === 0x06054b50){ eocd = i; break; }
    }
    if (eocd < 0) throw new Error('Este archivo no es un documento Word válido.');
    const count = view.getUint16(eocd + 10, true);
    let offset = view.getUint32(eocd + 16, true);
    const entries = new Map();
    for (let i = 0; i < count; i++){
      if (view.getUint32(offset, true) !== 0x02014b50) break;
      const method = view.getUint16(offset + 10, true);
      const compressed = view.getUint32(offset + 20, true);
      const nameLen = view.getUint16(offset + 28, true);
      const extraLen = view.getUint16(offset + 30, true);
      const commentLen = view.getUint16(offset + 32, true);
      const localOffset = view.getUint32(offset + 42, true);
      const name = new TextDecoder().decode(bytes.subarray(offset + 46, offset + 46 + nameLen));
      entries.set(name, { method, compressed, localOffset });
      offset += 46 + nameLen + extraLen + commentLen;
    }
    return {
      async text(name){
        const entry = entries.get(name);
        if (!entry) return null;
        const nameLen = view.getUint16(entry.localOffset + 26, true);
        const extraLen = view.getUint16(entry.localOffset + 28, true);
        const start = entry.localOffset + 30 + nameLen + extraLen;
        const raw = bytes.subarray(start, start + entry.compressed);
        const data = entry.method === 0 ? raw : await inflateRaw(raw);
        return new TextDecoder('utf-8').decode(data);
      }
    };
  }

  /* ---------- Word (.docx) → HTML ---------- */
  const HIGHLIGHTS = {yellow:'#ffff00',green:'#00ff00',cyan:'#00ffff',magenta:'#ff00ff',blue:'#0000ff',red:'#ff0000',
    darkBlue:'#000080',darkCyan:'#008080',darkGreen:'#008000',darkMagenta:'#800080',darkRed:'#800000',darkYellow:'#808000',
    lightGray:'#d3d3d3',darkGray:'#808080',black:'#000000',white:'#ffffff'};
  const on = el => !!el && !['0','false','off','none'].includes(el.getAttribute('w:val') || '');

  function docxNumbering(dom){
    const map = new Map(); // numId -> 'bullet' | 'decimal' | ...
    const abstracts = new Map();
    for (const abs of dom.getElementsByTagNameNS(W_NS, 'abstractNum')){
      const absId = abs.getAttribute('w:abstractNumId');
      let fmt = 'decimal';
      for (const lvl of abs.getElementsByTagNameNS(W_NS, 'lvl')){
        if ((lvl.getAttribute('w:ilvl') || '0') !== '0') continue;
        fmt = lvl.getElementsByTagNameNS(W_NS, 'numFmt')[0]?.getAttribute('w:val') || 'decimal';
        break;
      }
      abstracts.set(absId, fmt);
    }
    for (const num of dom.getElementsByTagNameNS(W_NS, 'num')){
      const numId = num.getAttribute('w:numId');
      const absId = num.getElementsByTagNameNS(W_NS, 'abstractNumId')[0]?.getAttribute('w:val');
      if (numId) map.set(numId, abstracts.get(absId) || 'decimal');
    }
    return map;
  }

  function docxRun(run){
    let text = '';
    for (const node of run.childNodes){
      if (node.nodeType !== 1) continue;
      if (node.localName === 't' || node.localName === 'instrText') text += esc(node.textContent);
      else if (node.localName === 'tab') text += '&nbsp;&nbsp;&nbsp;&nbsp;';
      else if (node.localName === 'br' || node.localName === 'cr') text += '<br>';
    }
    if (!text) return '';
    const rpr = run.getElementsByTagNameNS(W_NS, 'rPr')[0];
    if (rpr){
      const first = (n) => { for (const c of rpr.childNodes) if (c.localName === n) return c; return null; };
      if (on(first('b'))) text = '<strong>' + text + '</strong>';
      if (on(first('i'))) text = '<em>' + text + '</em>';
      const u = first('u'); if (u && (u.getAttribute('w:val') || 'single') !== 'none') text = '<u>' + text + '</u>';
      if (on(first('strike')) || on(first('dstrike'))) text = '<s>' + text + '</s>';
      const va = first('vertAlign')?.getAttribute('w:val');
      if (va === 'superscript') text = '<sup>' + text + '</sup>';
      if (va === 'subscript') text = '<sub>' + text + '</sub>';
      const styles = [];
      const color = first('color')?.getAttribute('w:val');
      if (color && color !== 'auto') styles.push('color:#' + color.toLowerCase());
      const hl = first('highlight')?.getAttribute('w:val');
      if (hl && HIGHLIGHTS[hl]) styles.push('background-color:' + HIGHLIGHTS[hl]);
      const shd = first('shd')?.getAttribute('w:fill');
      if (!hl && shd && shd !== 'auto') styles.push('background-color:#' + shd);
      const sz = Number(first('sz')?.getAttribute('w:val'));
      if (sz > 0 && sz <= 200) styles.push('font-size:' + Math.round(sz / 2 * 4 / 3) + 'px');
      if (styles.length) text = '<span style="' + styles.join(';') + '">' + text + '</span>';
    }
    return text;
  }

  /* Listas cuya numeración viene del ESTILO de párrafo (List Bullet, List Number...). */
  function docxStyleLists(dom){
    const map = new Map(); // styleId -> numId
    for (const style of dom.getElementsByTagNameNS(W_NS, 'style')){
      const id = style.getAttribute('w:styleId');
      if (!id) continue;
      for (const child of style.childNodes){
        if (child.nodeType === 1 && child.localName === 'pPr'){
          const numId = child.getElementsByTagNameNS(W_NS, 'numId')[0]?.getAttribute('w:val');
          if (numId) map.set(id, numId);
        }
      }
    }
    return map;
  }

  function docxParagraph(p, numbering, styleLists){
    let inner = '';
    for (const node of p.childNodes){
      if (node.nodeType !== 1) continue;
      if (node.localName === 'r' || node.localName === 'hyperlink'){
        for (const r of node.localName === 'hyperlink' ? node.getElementsByTagNameNS(W_NS, 'r') : [node]) inner += docxRun(r);
      }
    }
    const ppr = p.getElementsByTagNameNS(W_NS, 'pPr')[0];
    let tag = 'p', align = '', list = null;
    if (ppr){
      const first = (n) => { for (const c of ppr.childNodes) if (c.localName === n) return c; return null; };
      const styleVal = first('pStyle')?.getAttribute('w:val') || '';
      const heading = styleVal.match(/heading\s*([1-6])/i) || (/^title$/i.test(styleVal) ? [null,'1'] : null);
      if (heading) tag = 'h' + heading[1];
      const jc = first('jc')?.getAttribute('w:val');
      if (jc === 'center') align = 'center';
      else if (jc === 'right' || jc === 'end') align = 'right';
      else if (jc === 'both') align = 'justify';
      const numPr = first('numPr');
      const styleNumId = styleLists?.get(styleVal);
      if (numPr || styleNumId){
        const numId = numPr?.getElementsByTagNameNS(W_NS, 'numId')[0]?.getAttribute('w:val') || styleNumId;
        const ilvl = Math.min(8, Number(numPr?.getElementsByTagNameNS(W_NS, 'ilvl')[0]?.getAttribute('w:val') || 0));
        const fmt = numbering.get(numId) || 'decimal';
        const ordered = !['bullet','none'].includes(fmt);
        list = { numId, ilvl, ordered, style: fmt === 'bullet' ? 'disc' : fmt };
      }
    }
    const styleAttr = align ? ' style="text-align:' + align + '"' : '';
    return { html: inner ? '<' + tag + styleAttr + '>' + inner + '</' + tag + '>' : '', list, tag };
  }

  function docxTable(tbl, numbering, styleLists){
    let html = '<table style="border-collapse:collapse;width:100%">';
    for (const tr of tbl.getElementsByTagNameNS(W_NS, 'tr')){
      html += '<tr>';
      for (const tc of tr.getElementsByTagNameNS(W_NS, 'tc')){
        let cell = '';
        for (const p of tc.getElementsByTagNameNS(W_NS, 'p')) cell += docxParagraph(p, numbering, styleLists).html;
        html += '<td style="border:1px solid #8a8a8a;padding:4px 8px">' + (cell || '&nbsp;') + '</td>';
      }
      html += '</tr>';
    }
    return html + '</table>';
  }

  async function docxToHtml(buffer){
    const zip = await readZipEntries(buffer);
    const xml = await zip.text('word/document.xml');
    if (!xml) throw new Error('Este .docx no contiene un documento legible.');
    const dom = new DOMParser().parseFromString(xml, 'application/xml');
    if (dom.querySelector('parsererror')) throw new Error('El contenido del documento Word está dañado.');
    let numbering = new Map();
    const numXml = await zip.text('word/numbering.xml');
    if (numXml){
      const numDom = new DOMParser().parseFromString(numXml, 'application/xml');
      if (!numDom.querySelector('parsererror')) numbering = docxNumbering(numDom);
    }
    let styleLists = new Map();
    const stylesXml = await zip.text('word/styles.xml');
    if (stylesXml){
      const stylesDom = new DOMParser().parseFromString(stylesXml, 'application/xml');
      if (!stylesDom.querySelector('parsererror')) styleLists = docxStyleLists(stylesDom);
    }
    const body = dom.getElementsByTagNameNS(W_NS, 'body')[0];
    if (!body) throw new Error('El documento Word está vacío.');
    const items = [];
    for (const node of body.childNodes){
      if (node.nodeType !== 1) continue;
      if (node.localName === 'p') items.push(docxParagraph(node, numbering, styleLists));
      else if (node.localName === 'tbl') items.push({ html: docxTable(node, numbering, styleLists), list: null });
    }
    // Agrupa párrafos con numeración en listas <ul>/<ol> conservando el nivel.
    let out = '';
    const stack = []; // {ilvl, ordered, tag}
    const closeTo = (level) => { while (stack.length > level) { out += stack.pop().tag === 'ol' ? '</ol>' : '</ul>'; } };
    for (const item of items){
      if (!item.list){ closeTo(0); out += item.html; continue; }
      const { ilvl, ordered, style } = item.list;
      const tag = ordered ? 'ol' : 'ul';
      const listStyle = ordered && style !== 'decimal'
        ? ({upperRoman:'upper-roman',lowerRoman:'lower-roman',upperLetter:'upper-alpha',lowerLetter:'lower-alpha'}[style] || 'decimal')
        : style === 'bullet' ? 'disc' : style;
      while (stack.length && stack[stack.length-1].ilvl > ilvl) out += stack.pop().tag === 'ol' ? '</ol>' : '</ul>';
      const top = stack[stack.length-1];
      if (!top || top.ilvl < ilvl || top.ordered !== ordered){
        if (top && top.ilvl === ilvl && top.ordered !== ordered) out += top.tag === 'ol' ? '</ol>' : '</ul>', stack.pop();
        out += '<' + tag + ' style="list-style-type:' + listStyle + '">';
        stack.push({ ilvl, ordered, tag });
      }
      out += '<li>' + item.html.replace(/^<(p|h[1-6])[^>]*>|<\/(p|h[1-6])>$/g, '') + '</li>';
    }
    closeTo(0);
    return out;
  }

  /* ---------- HTML / texto → contenido de la nota ---------- */
  function htmlFileToHtml(text){
    const dom = new DOMParser().parseFromString(text, 'text/html');
    if (dom.querySelector('parsererror')) throw new Error('No se pudo leer la página HTML.');
    return dom.body ? dom.body.innerHTML : '';
  }

  function markdownToHtml(text){
    const inline = s => esc(s)
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/\*([^*]+)\*/g, '<em>$1</em>')
      .replace(/`([^`]+)`/g, '<code>$1</code>');
    return text.split(/\r?\n/).map(line => {
      const h = line.match(/^(#{1,6})\s+(.*)$/);
      if (h) return '<h' + h[1].length + '>' + inline(h[2]) + '</h' + h[1].length + '>';
      if (/^\s*[-*•]\s+/.test(line)) return '<p>• ' + inline(line.replace(/^\s*[-*•]\s+/, '')) + '</p>';
      return '<p>' + (inline(line) || '<br>') + '</p>';
    }).join('');
  }

  function plainToHtml(text){
    return text.split(/\r?\n/).map(line => '<p>' + (esc(line) || '<br>') + '</p>').join('');
  }

  async function importFile(file){
    if (file.size > 20 * 1024 * 1024) throw new Error('El documento supera los 20 MB permitidos.');
    const ext = (file.name.match(/\.([a-z0-9]+)$/i)?.[1] || '').toLowerCase();
    const base = file.name.replace(/\.[a-z0-9]+$/i, '').replace(/[_-]+/g, ' ').trim().slice(0, 90);
    let html = '';
    if (ext === 'docx') html = await docxToHtml(await file.arrayBuffer());
    else if (ext === 'html' || ext === 'htm') html = htmlFileToHtml(await file.text());
    else if (ext === 'md' || ext === 'markdown') html = markdownToHtml(await file.text());
    else if (ext === 'txt' || ext === 'text' || ext === 'csv' || !ext) html = plainToHtml(await file.text());
    else throw new Error('Formato no admitido. Usa Word (.docx), página web (.html) o texto (.txt, .md).');
    if (!html || !html.replace(/<[^>]*>/g, '').trim()) throw new Error('El documento está vacío o no contiene texto legible.');
    return { title: base || 'Documento importado', html };
  }

  /* ---------- ZIP: escritura sin compresión (para exportar .docx) ---------- */
  const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n++){
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
    return table;
  })();
  function crc32(bytes){
    let c = 0xFFFFFFFF;
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }
  function zipStore(files){ // files: [{name, text}]
    const encoder = new TextEncoder();
    const chunks = [], central = [];
    let offset = 0;
    for (const file of files){
      const name = encoder.encode(file.name);
      const data = encoder.encode(file.text);
      const crc = crc32(data);
      const local = new DataView(new ArrayBuffer(30));
      local.setUint32(0, 0x04034b50, true); local.setUint16(4, 20, true);
      local.setUint16(8, 0, true); local.setUint32(14, crc, true);
      local.setUint32(18, data.length, true); local.setUint32(22, data.length, true);
      local.setUint16(26, name.length, true);
      chunks.push(local.buffer, name, data);
      central.push({ name, crc, size: data.length, offset });
      offset += 30 + name.length + data.length;
    }
    const dirStart = offset;
    for (const entry of central){
      const head = new DataView(new ArrayBuffer(46));
      head.setUint32(0, 0x02014b50, true); head.setUint16(4, 20, true); head.setUint16(6, 20, true);
      head.setUint32(16, entry.crc, true); head.setUint32(20, entry.size, true); head.setUint32(24, entry.size, true);
      head.setUint16(28, entry.name.length, true); head.setUint32(42, entry.offset, true);
      chunks.push(head.buffer, entry.name);
      offset += 46 + entry.name.length;
    }
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(8, central.length, true); end.setUint16(10, central.length, true);
    end.setUint32(12, offset - dirStart, true); end.setUint32(16, dirStart, true);
    chunks.push(end.buffer);
    return new Blob(chunks, { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
  }

  /* ---------- HTML → Word (.docx) ---------- */
  const cssColor = value => {
    const m = String(value || '').match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
    if (m) return [m[1], m[2], m[3]].map(n => Number(n).toString(16).padStart(2, '0')).join('');
    const h = String(value || '').match(/^#([0-9a-f]{6})$/i);
    return h ? h[1].toLowerCase() : '';
  };

  function htmlToWordML(rawHtml){
    const dom = new DOMParser().parseFromString('<div id="root">' + rawHtml + '</div>', 'text/html');
    const root = dom.getElementById('root') || dom.body;
    const nums = []; // {fmt, numId} — cada lista obtiene su propio numId para reiniciar el conteo
    const sizes = {H1: 48, H2: 36, H3: 30, H4: 26, H5: 24, H6: 22}; // medias puntas (w:sz)

    const mergeProps = (el, props) => {
      const next = { ...props };
      const tag = el.tagName;
      if (['B','STRONG'].includes(tag)) next.b = true;
      if (['I','EM'].includes(tag)) next.i = true;
      if (tag === 'U' || tag === 'INS') next.u = true;
      if (['S','STRIKE','DEL'].includes(tag)) next.strike = true;
      if (tag === 'SUP') next.sup = true;
      if (tag === 'SUB') next.sub = true;
      if (tag === 'A'){ next.u = true; next.color = next.color || '1a4f9c'; }
      const st = el.style || {};
      const weight = String(st.fontWeight || '');
      if (weight === 'bold' || Number(weight) >= 600) next.b = true;
      if (st.fontStyle === 'italic') next.i = true;
      if (/underline/.test(st.textDecoration || st.textDecorationLine || '')) next.u = true;
      if (/line-through/.test(st.textDecoration || st.textDecorationLine || '')) next.strike = true;
      const color = cssColor(st.color); if (color) next.color = color;
      const bgRaw = String(st.backgroundColor || '');
      const bg = cssColor(bgRaw);
      if (bg && !/rgba\(\s*\d+,\s*\d+,\s*\d+,\s*0\s*\)/.test(bgRaw)) next.shd = bg;
      const fs = String(st.fontSize || '').match(/^([\d.]+)(px|pt)$/);
      if (fs){
        const half = Math.round(Number(fs[1]) * (fs[2] === 'pt' ? 2 : 1.5));
        if (half >= 12 && half <= 192) next.sz = half;
      }
      return next;
    };
    const rprXml = p => {
      let x = '';
      if (p.b) x += '<w:b/>';
      if (p.i) x += '<w:i/>';
      if (p.u) x += '<w:u w:val="single"/>';
      if (p.strike) x += '<w:strike/>';
      if (p.sup) x += '<w:vertAlign w:val="superscript"/>';
      if (p.sub) x += '<w:vertAlign w:val="subscript"/>';
      if (p.color) x += '<w:color w:val="' + p.color + '"/>';
      if (p.shd) x += '<w:shd w:val="clear" w:color="auto" w:fill="' + p.shd + '"/>';
      if (p.sz) x += '<w:sz w:val="' + p.sz + '"/><w:szCs w:val="' + p.sz + '"/>';
      return x ? '<w:rPr>' + x + '</w:rPr>' : '';
    };
    const emitInline = (node, props) => {
      let out = '';
      if (node.nodeType === Node.TEXT_NODE){
        const text = node.nodeValue;
        if (text) out += '<w:r>' + rprXml(props) + '<w:t xml:space="preserve">' + esc(text) + '</w:t></w:r>';
        return out;
      }
      if (node.nodeType !== 1) return out;
      if (node.tagName === 'BR') return '<w:r><w:br/></w:r>';
      if (node.tagName === 'IMG') return '<w:r>' + rprXml(props) + '<w:t xml:space="preserve">[Imagen: ' + esc(node.getAttribute('alt') || 'adjunta') + ']</w:t></w:r>';
      const next = mergeProps(node, props);
      for (const child of node.childNodes) out += emitInline(child, next);
      return out;
    };
    const alignXml = el => {
      const align = (el.style?.textAlign || '').toLowerCase();
      const jc = {center:'center',right:'right',justify:'both',left:'left'}[align];
      return jc && jc !== 'left' ? '<w:jc w:val="' + jc + '"/>' : '';
    };
    const para = (content, ppr) => '<w:p>' + (ppr ? '<w:pPr>' + ppr + '</w:pPr>' : '') + (content || '<w:r><w:t xml:space="preserve"></w:t></w:r>') + '</w:p>';

    function emitBlock(node, out, listStack){
      if (node.nodeType === Node.TEXT_NODE){
        if (node.nodeValue.trim()) out.push(para(emitInline(node, {})));
        return;
      }
      if (node.nodeType !== 1) return;
      const tag = node.tagName;
      if (['SCRIPT','STYLE'].includes(tag)) return;
      if (/^H[1-6]$/.test(tag)){
        out.push(para(emitInline(node, {b: true, sz: sizes[tag]}), alignXml(node) + '<w:spacing w:before="160" w:after="80"/>'));
        return;
      }
      if (tag === 'BLOCKQUOTE'){
        out.push(para(emitInline(node, {i: true}), '<w:ind w:left="420"/>' + alignXml(node)));
        return;
      }
      if (tag === 'PRE'){
        for (const line of node.textContent.split('\n')) out.push(para(esc(line) ? '<w:r><w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/></w:rPr><w:t xml:space="preserve">' + esc(line) + '</w:t></w:r>' : ''));
        return;
      }
      if (tag === 'HR'){
        out.push(para('', '<w:pBdr><w:bottom w:val="single" w:sz="8" w:space="1" w:color="999999"/></w:pBdr>'));
        return;
      }
      if (tag === 'UL' || tag === 'OL'){
        const fmt = tag === 'UL' ? 'bullet' : ({I:'upperRoman',i:'lowerRoman',A:'upperLetter',a:'lowerLetter'}[node.getAttribute('type')] ||
          ({'upper-roman':'upperRoman','lower-roman':'lowerRoman','upper-alpha':'upperLetter','lower-alpha':'lowerLetter'}[node.style?.listStyleType]) || 'decimal');
        const numId = nums.length + 1;
        nums.push({ fmt, start: Number(node.getAttribute('start')) || 1 });
        listStack.push({ numId, ilvl: listStack.length });
        for (const li of node.children) if (li.tagName === 'LI') emitBlock(li, out, listStack);
        listStack.pop();
        return;
      }
      if (tag === 'LI'){
        const current = listStack[listStack.length - 1];
        const ppr = current ? '<w:numPr><w:ilvl w:val="' + Math.min(2, current.ilvl) + '"/><w:numId w:val="' + current.numId + '"/></w:numPr>' : '';
        let inner = '';
        for (const child of node.childNodes){
          if (child.nodeType === 1 && ['UL','OL'].includes(child.tagName)) continue;
          inner += emitInline(child, {});
        }
        out.push(para(inner, ppr + alignXml(node)));
        for (const child of node.children) if (['UL','OL'].includes(child.tagName)) emitBlock(child, out, listStack);
        return;
      }
      if (tag === 'TABLE'){
        const trs = [...node.querySelectorAll('tr')];
        const colCount = Math.max(1, ...trs.map(tr => [...tr.children].filter(c => ['TD','TH'].includes(c.tagName)).length));
        const colWidth = Math.floor(9360 / colCount);
        let rows = '';
        for (const tr of trs){
          let cells = '';
          for (const td of tr.children){
            if (!['TD','TH'].includes(td.tagName)) continue;
            let cellContent = '';
            for (const child of td.childNodes){
              if (child.nodeType === 1 && ['P','DIV','H1','H2','H3','H4','H5','H6','UL','OL','TABLE','BLOCKQUOTE'].includes(child.tagName)){
                const tmp = []; emitBlock(child, tmp, listStack.slice()); cellContent += tmp.join('');
              } else cellContent += para(emitInline(child, td.tagName === 'TH' ? {b: true} : {}));
            }
            if (!cellContent) cellContent = para('');
            cells += '<w:tc><w:tcPr><w:tcW w:w="' + colWidth + '" w:type="dxa"/></w:tcPr>' + cellContent + '</w:tc>';
          }
          rows += '<w:tr>' + cells + '</w:tr>';
        }
        out.push('<w:tbl><w:tblPr><w:tblW w:w="5000" w:type="pct"/><w:tblBorders>' +
          ['top','left','bottom','right','insideH','insideV'].map(b => '<w:' + b + ' w:val="single" w:sz="4" w:space="0" w:color="8a8a8a"/>').join('') +
          '</w:tblBorders></w:tblPr>' +
          '<w:tblGrid>' + '<w:gridCol w:w="' + colWidth + '"/>'.repeat(colCount) + '</w:tblGrid>' +
          rows + '</w:tbl>');
        // Word necesita un párrafo después de una tabla para seguir escribiendo.
        out.push(para(''));
        return;
      }
      if (['P','DIV'].includes(tag)){
        out.push(para(emitInline(node, {}), alignXml(node)));
        return;
      }
      // Otros contenedores (section, figure, etc.): procesa su interior como bloques.
      let treated = false;
      for (const child of node.childNodes){
        if (child.nodeType === 1 && ['P','DIV','UL','OL','TABLE','BLOCKQUOTE','PRE','H1','H2','H3','H4','H5','H6','HR'].includes(child.tagName)){ emitBlock(child, out, listStack); treated = true; }
      }
      if (!treated) out.push(para(emitInline(node, {})));
    }

    const blocks = [];
    for (const child of root.childNodes) emitBlock(child, blocks, []);
    const bodyXml = blocks.join('') || para('');
    return { bodyXml, nums };
  }

  function buildDocx(title, rawHtml){
    const { bodyXml, nums } = htmlToWordML(rawHtml);
    const bullet = '•';
    const abstracts = nums.map((n, i) => {
      const isBullet = n.fmt === 'bullet';
      const numFmt = isBullet ? 'bullet' : n.fmt;
      const lvls = [0, 1, 2].map(l =>
        '<w:lvl w:ilvl="' + l + '"><w:start w:val="1"/><w:numFmt w:val="' + numFmt + '"/>' +
        '<w:lvlText w:val="' + (isBullet ? bullet : '%' + (l + 1) + '.') + '"/><w:lvlJc w:val="left"/>' +
        '<w:pPr><w:ind w:left="' + (720 * (l + 1)) + '" w:hanging="360"/></w:pPr></w:lvl>').join('');
      return '<w:abstractNum w:abstractNumId="' + i + '">' + lvls + '</w:abstractNum>';
    }).join('');
    const numDefs = nums.map((n, i) =>
      '<w:num w:numId="' + (i + 1) + '"><w:abstractNumId w:val="' + i + '"/>' +
      (n.start !== 1 ? '<w:lvlOverride w:ilvl="0"><w:startOverride w:val="' + n.start + '"/></w:lvlOverride>' : '') +
      '</w:num>').join('');
    const numbering = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<w:numbering xmlns:w="' + W_NS + '">' + abstracts + numDefs + '</w:numbering>';
    const document = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<w:document xmlns:w="' + W_NS + '"><w:body>' + bodyXml +
      '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:body></w:document>';
    return zipStore([
      { name: '[Content_Types].xml', text: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/></Types>' },
      { name: '_rels/.rels', text: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>' },
      { name: 'word/_rels/document.xml.rels', text: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/></Relationships>' },
      { name: 'word/document.xml', text: document },
      { name: 'word/numbering.xml', text: numbering }
    ]);
  }

  function buildHtmlDocument(title, rawHtml){
    return '<!DOCTYPE html>\n<html lang="es">\n<head>\n<meta charset="UTF-8">\n' +
      '<meta name="viewport" content="width=device-width, initial-scale=1">\n' +
      '<title>' + esc(title) + '</title>\n' +
      '<style>body{font-family:Georgia,"Times New Roman",serif;max-width:760px;margin:32px auto;padding:0 18px;line-height:1.65;color:#1c1a15}' +
      'h1,h2,h3,h4,h5,h6{line-height:1.3}img{max-width:100%;height:auto}table{border-collapse:collapse}td,th{border:1px solid #8a8a8a;padding:4px 8px}</style>\n' +
      '</head>\n<body>\n<h1>' + esc(title) + '</h1>\n' + rawHtml + '\n<hr>\n<p><small>Exportado desde MAUZI NOTE</small></p>\n</body>\n</html>';
  }

  /* ---------- Descarga ---------- */
  function safeFileName(title, ext){
    const base = String(title || 'nota').normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^\p{L}\p{N} .-]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 60) || 'nota';
    return base + '.' + ext;
  }
  function download(name, blob){
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url; link.download = name;
    document.body.appendChild(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }

  function exportNote(title, html, plain, format){
    const cleanHtml = window.MauziApp?.sanitize ? window.MauziApp.sanitize(html) : html;
    if (format === 'docx') download(safeFileName(title, 'docx'), buildDocx(title, cleanHtml));
    else if (format === 'html') download(safeFileName(title, 'html'), new Blob([buildHtmlDocument(title, cleanHtml)], { type: 'text/html;charset=utf-8' }));
    else download(safeFileName(title, 'txt'), new Blob(['﻿' + (plain || '')], { type: 'text/plain;charset=utf-8' }));
  }

  window.MauziDocuments = { importFile, exportNote };

  /* ---------- Botones del editor ---------- */
  function wire(){
    const A = window.MauziApp;
    const importBtn = $('importDocBtn'), fileInput = $('importDocFile'), exportBtn = $('exportDocBtn');
    if (!A || !importBtn || !fileInput || !exportBtn) return;

    importBtn.addEventListener('click', () => { fileInput.value = ''; fileInput.click(); });
    fileInput.addEventListener('change', async event => {
      const file = event.target.files[0];
      if (!file) return;
      importBtn.disabled = true;
      try{
        const editor = $('noteContent');
        const hasContent = !!editor.textContent.trim() || !!editor.querySelector('img');
        const result = await importFile(file);
        if (hasContent && !confirm('¿Reemplazar el contenido actual de esta nota por «' + result.title + '»? El documento conservará su formato.')) return;
        editor.innerHTML = A.sanitize(result.html);
        const titleInput = $('noteTitle');
        if (titleInput && !titleInput.value.trim()) titleInput.value = result.title;
        editor.dataset.empty = String(!editor.textContent.trim());
        editor.dispatchEvent(new Event('input', { bubbles: true }));
        window.MauziRich?.refresh?.();
        A.toast('Documento importado con su formato. Revisa y toca Guardar nota.');
      }catch(error){
        A.toast(error.message || 'No se pudo importar el documento.');
      }finally{
        importBtn.disabled = false;
      }
    });

    exportBtn.addEventListener('click', () => A.open('docExportModal'));
    for (const [id, format] of [['exportDocxBtn','docx'],['exportHtmlBtn','html'],['exportTxtBtn','txt']]){
      $(id)?.addEventListener('click', () => {
        const title = $('noteTitle')?.value.trim() || 'Nota MAUZI';
        const editor = $('noteContent');
        const html = editor ? editor.innerHTML : '';
        const plain = window.MauziRich?.plain ? window.MauziRich.plain(html) : '';
        if (!plain.trim() && !html.includes('<img ')){ A.toast('Escribe contenido antes de exportar.'); return; }
        try{
          exportNote(title, html, plain, format);
          A.close('docExportModal');
          A.toast('Nota exportada. Ábrela con el programa correspondiente.');
        }catch(error){
          A.toast(error.message || 'No se pudo exportar la nota.');
        }
      });
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wire, { once: true });
  else wire();
})();
