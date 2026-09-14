/* MAUZI NOTE 4.2 — image-removal fingerprints. No image bytes in removal markers.
   Deletions are scoped to the note and account, not to other notes or original photos. */
(()=>{'use strict';
 const cache=new Map(),encoder=new TextEncoder();
 const K=new Uint32Array(64),H=new Uint32Array(8);let found=0,n=2;
 while(found<64){let prime=true;for(let d=2;d*d<=n;d++)if(n%d===0){prime=false;break;}if(prime){K[found]=((Math.cbrt(n)%1)*4294967296)>>>0;if(found<8)H[found]=((Math.sqrt(n)%1)*4294967296)>>>0;found++;}n++;}
 const rotate=(v,b)=>(v>>>b)|(v<<(32-b));
 function hash(text){if(cache.has(text))return cache.get(text);const input=encoder.encode(text),length=input.length,bytes=new Uint8Array(((length+9+63)>>6)<<6);bytes.set(input);bytes[length]=128;const view=new DataView(bytes.buffer);view.setUint32(bytes.length-8,Math.floor(length/536870912));view.setUint32(bytes.length-4,(length*8)>>>0);const h=new Uint32Array(H),w=new Uint32Array(64);
  for(let at=0;at<bytes.length;at+=64){for(let i=0;i<16;i++)w[i]=view.getUint32(at+i*4);for(let i=16;i<64;i++){const a=w[i-15],b=w[i-2];w[i]=(w[i-16]+(rotate(a,7)^rotate(a,18)^(a>>>3))+w[i-7]+(rotate(b,17)^rotate(b,19)^(b>>>10)))>>>0;}let[a,b,c,d,e,f,g,j]=h;
   for(let i=0;i<64;i++){const t1=(j+(rotate(e,6)^rotate(e,11)^rotate(e,25))+((e&f)^(~e&g))+K[i]+w[i])>>>0,t2=((rotate(a,2)^rotate(a,13)^rotate(a,22))+((a&b)^(a&c)^(b&c)))>>>0;j=g;g=f;f=e;e=(d+t1)>>>0;d=c;c=b;b=a;a=(t1+t2)>>>0;}const vals=[a,b,c,d,e,f,g,j];for(let i=0;i<8;i++)h[i]=(h[i]+vals[i])>>>0;
  }const result=Array.from(h,v=>v.toString(16).padStart(8,'0')).join('');cache.set(text,result);if(cache.size>90)cache.delete(cache.keys().next().value);return result;
 }
 function imageHashes(note){const el=document.createElement('div');el.innerHTML=note?.contentHtml||'';return new Set([...el.querySelectorAll('img[src]')].map(i=>hash(i.getAttribute('src'))));}
 function redactNote(note,rules){const denied=rules?.[note?.id];if(!denied?.length||!note.contentHtml?.includes('<img'))return note;const el=document.createElement('div');el.innerHTML=note.contentHtml;let changed=false;for(const img of el.querySelectorAll('img[src]'))if(denied.includes(hash(img.getAttribute('src')))){img.remove();changed=true;}return changed?{...note,contentHtml:el.innerHTML,content:window.MauziApp.plain(el.innerHTML)}:note;}
 function scrub(s){if(!s.mediaRedactions)return;for(const [id,n]of Object.entries(s.notes||{}))s.notes[id]=redactNote(n,s.mediaRedactions);for(const op of s.queue||[])if(op.kind==='note')op.data=redactNote(op.data,s.mediaRedactions);for(const op of Object.values(s.events||{}))if(op.kind==='note')op.data=redactNote(op.data,s.mediaRedactions);for(const [id,rows]of Object.entries(s.localHistory||{}))s.localHistory[id]=rows.map(n=>redactNote(n,s.mediaRedactions));}
 function merge(s,noteId,hashes){s.mediaRedactions||={};s.mediaRedactions[noteId]=[...new Set([...(s.mediaRedactions[noteId]||[]),...hashes])];}
 function trackChanges(s,before,notes){for(const note of notes){if(!before[note.id])continue;const a=imageHashes(before[note.id]),b=imageHashes(note),removed=[...a].filter(x=>!b.has(x)&&!s.mediaRedactions?.[note.id]?.includes(x));if(!removed.length)continue;merge(s,note.id,removed);if(!s.local){(s.mediaQueue||=[]).push({id:crypto.randomUUID(),noteId:note.id,hashes:removed,at:Date.now()});s.mediaPurgePending=true;}}scrub(s);}
 window.MauziMedia={hash,imageHashes,redactNote,merge,scrub,trackChanges};
})();
