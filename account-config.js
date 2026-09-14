/* MAUZI NOTE 4.1 — public OAuth client, never a secret or a user credential.
   google-config.js has priority when valid. An embedded backup prevents an empty
   stale/missing config file from blocking this specific MAUZI NOTE deployment.
   The selected ID is fixed for the lifetime of this page/account database keys. */
(()=>{
 'use strict';
 const valid=v=>/^\d+-[a-z0-9_-]+\.apps\.googleusercontent\.com$/i.test(String(v||'').trim());
 const external=String(window.MAUZI_GOOGLE_CLIENT_ID||'').trim();
 const embedded=String(document.querySelector('meta[name="mauzi-google-client-id"]')?.content||'').trim();
 const selected=valid(external)?external:valid(embedded)?embedded:'';
 window.MAUZI_GOOGLE_CLIENT_ID=selected;
 window.MauziGoogleConfig=Object.freeze({
   clientId:selected,configured:valid(selected),source:valid(external)?'archivo':valid(embedded)?'integrada':'no-disponible'
 });
})();
