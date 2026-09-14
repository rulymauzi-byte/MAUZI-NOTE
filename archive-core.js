/* MAUZI NOTE 4.4 — archive metadata. Does not derive years from last edit dates.
   Years are decimal strings (not a finite dropdown or JavaScript Date range).
   Input-size guards prevent malformed remote records; there is no preset final year.
   Existing notes without archive metadata keep their original wire representation. */
(()=>{'use strict';
 const currentYear=()=>String(new Date().getFullYear());
 function year(value){
  const s=String(value??'').trim().replace(/^0+(?=\d)/,'');
  if(!/^[1-9]\d*$/.test(s)||s.length>64)throw Error('Escribe un año positivo usando solo números.');
  return s;
 }
 function path(value){
  const s=String(value??'').normalize('NFC').replace(/\\/g,'/').trim();
  if(!s)return '';
  const parts=s.split('/').map(p=>p.trim()).filter(Boolean);
  if(parts.length>20||parts.some(p=>p==='.'||p==='..'||/[\u0000-\u001f\u007f]/.test(p)||p.length>120))throw Error('Revisa la carpeta: usa nombres de hasta 120 caracteres, sin puntos sueltos.');
  if(parts.join('/').length>1800)throw Error('La ruta de carpetas es demasiado larga.');
  return parts.join('/');
 }
 function location(n={}){
  let y=n.archiveYear;
  if(y===undefined||y===null||y===''){
   const d=new Date(Number(n.createdAt));y=Number.isFinite(d.getTime())&&d.getFullYear()>0?String(d.getFullYear()):currentYear();
  }
  return {archiveYear:year(y),folderPath:path(n.folderPath)};
 }
 function fields(n={}){
  const out={};
  if(n.archiveYear!==undefined&&n.archiveYear!==null&&n.archiveYear!=='')out.archiveYear=year(n.archiveYear);
  if(n.folderPath!==undefined)out.folderPath=path(n.folderPath);
  return out;
 }
 const compareYears=(a,b)=>a.length-b.length||a.localeCompare(b);
 const signature=n=>JSON.stringify([location(n).archiveYear,location(n).folderPath,String(n.title||'').trim()]);
 const label=n=>{const p=location(n);return p.archiveYear+(p.folderPath?' / '+p.folderPath:' / Sin carpeta');};
 window.MauziArchiveCore={year,path,location,fields,currentYear,compareYears,signature,label};
})();
