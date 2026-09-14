/* MAUZI NOTE 4.8 — durable deletion markers, containing no note text or images.
   Permanent removal always wins against an old offline revision of the same ID.
   The marker is retained; other notes, accounts and external backups are untouched. */
(()=>{'use strict';
  const valid=id=>typeof id==='string'&&/^[a-zA-Z0-9_-]{1,160}$/.test(id);
  const isPurged=n=>!!n&&n.deleted===true&&n.purged===true;
  function tombstone(id,at){
    if(!valid(id))throw Error('La nota no tiene un identificador válido.');
    at=Number(at);if(!Number.isFinite(at)||at<=0)at=Date.now();
    return {id,title:'Nota eliminada',content:'',contentHtml:'',categoryId:'important',bgColor:'#f8f5ed',createdAt:at,updatedAt:at,deleted:true,purged:true};
  }
  function enforce(s){
    const rules=s.notePurges||={};
    function mark(n,op,remote){
      if(!isPurged(n)||!valid(n.id))return;
      const j=rules[n.id]||={at:n.updatedAt,pending:!s.local,confirmed:false};
      j.opId=op.opId||j.opId;
      if(remote&&op.fileId){j.confirmed=true;j.markerFile=op.fileId;}
    }
    for(const e of Object.values(s.events||{}))if(e.kind==='note')mark(e.data,e,true);
    for(const e of s.queue||[])if(e.kind==='note')mark(e.data,e,false);
    for(const [nid,j]of Object.entries(rules)){
      if(!valid(nid))continue;
      for(const [eid,e]of Object.entries(s.events||{}))if(e.kind==='note'&&e.entityId===nid&&!isPurged(e.data)){
        // A late/stale device can upload an old revision; remove that file too.
        if(e.fileId){j.pending=!s.local;(j.hintFiles||=[]).includes(e.fileId)||j.hintFiles.push(e.fileId);}
        delete s.events[eid];
      }
      s.queue=(s.queue||[]).filter(o=>o.kind!=='note'||o.entityId!==nid||isPurged(o.data));
      if(s.notes)s.notes[nid]={...tombstone(nid,j.at),rev:j.opId||''};
      for(const [key,rows]of Object.entries(s.localHistory||{})){
        if(key===nid||key==='note:'+nid)delete s.localHistory[key];
        else s.localHistory[key]=rows.filter(n=>n.id!==nid);
      }
      if(s.archivePlacement)delete s.archivePlacement[nid];
      s.mediaQueue=(s.mediaQueue||[]).filter(o=>o.noteId!==nid);
      if(s.mediaRedactions)delete s.mediaRedactions[nid];
    }
    if(!Object.keys(s.mediaRedactions||{}).length&&!s.mediaQueue?.length)s.mediaPurgePending=false;
    return s;
  }
  const pending=s=>!s||s.local?0:Object.values(s.notePurges||{}).filter(j=>!j.confirmed||j.pending).length;
  window.MauziNoteDeletionCore={valid,isPurged,tombstone,enforce,pending};
})();
