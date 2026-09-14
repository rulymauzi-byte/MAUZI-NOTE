/* MAUZI NOTE 4.6 — Sincronice, junto a Año/Carpeta.
   Reuses the existing validated Google flow and synchronization engine.
   Never stores tokens, changes scopes, or opens Google without a user gesture. */
(() => {
  'use strict';
  const A = window.MauziApp;
  const C = window.MauziCloud;
  const bar = document.getElementById('archiveBar');
  const existing = document.getElementById('syncNowBtn');
  if (!A || !C || !bar || !existing || document.getElementById('quickSyncBtn')) return;

  const button = document.createElement('button');
  button.type = 'button';
  button.id = 'quickSyncBtn';
  button.className = 'quick-sync';
  button.innerHTML = '<svg class="quick-sync-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 7v5h-5M4 17v-5h5"/><path d="M5.7 8a7 7 0 0 1 11.6-2L20 9M4 15l2.7 3A7 7 0 0 0 18.3 16"/></svg><span>Sincronice</span><span class="quick-sync-dot" aria-hidden="true"></span>';
  const live = document.createElement('span');
  live.className = 'quick-sync-live';
  live.id = 'quickSyncStatus';
  live.setAttribute('role', 'status');
  live.setAttribute('aria-live', 'polite');
  button.setAttribute('aria-describedby', live.id);
  bar.classList.add('has-quick-sync');
  bar.append(button, live);
  let frame = 0;
  let pressUntil = 0;
  let previousDescription = '';
  let recentAuthAttempt = 0;
  let shownAuthError = '';
  const authMessage = document.getElementById('authMessage');

  function render() {
    frame = 0;
    const state = C.syncState();
    const account = C.account();
    const modules = window.MauziModules;
    const moduleState = modules?.syncState?.() || {};
    const moduleBusy = !!modules?.isSyncing?.();
    const pending = (state.pending || 0) + (state.deletePending || 0) + (state.mediaPending || 0) + (moduleState.pending || 0);
    const preparing = state.authPending || state.googleLoading;
    if (recentAuthAttempt && !state.authPending && Date.now() - recentAuthAttempt < 120000) {
      const message = authMessage?.dataset.state === 'error' ? authMessage.textContent.trim() : '';
      if (message && message !== shownAuthError) {
        shownAuthError = message;
        A.toast(message);
      }
    }
    const inProgress = state.busy || moduleBusy || Date.now() < pressUntil;
    let mode = 'local';
    let description = 'Vincular tu correo para guardar las notas en tu Google Drive.';

    if (!state.ready) {
      mode = 'loading';
      description = 'Abriendo la copia guardada de este dispositivo.';
    } else if (!navigator.onLine) {
      mode = 'offline';
      description = 'Sin internet. Las notas guardadas siguen en este dispositivo.';
    } else if (preparing) {
      mode = 'syncing';
      description = state.authPending ? 'Termina la conexión en la ventana de Google.' : 'Preparando la conexión con Google.';
    } else if (account && !account.local && state.requiresConnection) {
      mode = 'reconnect';
      description = 'Toca Sincronice para renovar Google y subir o recibir tus notas.';
    } else if (state.error || (account && !account.local && moduleState.error)) {
      mode = 'error';
      description = 'No se confirmó toda la sincronización. Toca Sincronice para reintentar; detalles en Mi cuenta.';
    } else if (state.authorized) {
      if (inProgress) {
        mode = 'syncing';
        description = 'Sincronizando con tu Google Drive.';
      } else if (pending) {
        mode = 'pending';
        description = 'Hay cambios pendientes de confirmar en Google Drive. Toca Sincronice para intentarlo ahora.';
      } else if (!state.lastCheckedAt) {
        mode = 'pending';
        description = 'Google conectado. Falta confirmar la primera sincronización.';
      } else {
        mode = 'connected';
        description = 'Google conectado y sin cambios guardados pendientes. Toca Sincronice para revisar ahora.';
      }
    }
    button.dataset.state = mode;
    button.setAttribute('aria-label', 'Sincronice. ' + description);
    button.setAttribute('aria-busy', String(mode === 'syncing' || mode === 'loading'));
    button.title = description;
    // A loading script cannot open a popup later: wait until the tap can stay
    // synchronous. First-link users still use the existing validation screen.
    button.disabled = !state.ready || !!preparing || !!state.transferBusy || !!inProgress;
    if (description !== previousDescription) {
      previousDescription = description;
      live.textContent = description;
    }
  }
  function queueRender() {
    if (!frame) frame = requestAnimationFrame(render);
  }
  button.addEventListener('click', () => {
    if (button.disabled) return;
    if (!navigator.onLine) {
      A.toast('Sin internet. Tus cambios guardados se conservan aquí hasta poder sincronizar.');
      return;
    }
    if (!C.config().configured) {
      A.toast('No se cargó la configuración de Google. Revisa Mi cuenta; tus notas siguen aquí.');
      return;
    }
    const account = C.account();
    // If the script was removed by the browser or failed, prepare it, but do not
    // open a later, unrequested popup or claim a successful connection.
    if (account && !account.local && !C.syncState().authorized && !window.google?.accounts?.oauth2) {
      C.prepareConnection?.();
      A.toast('Preparando Google. Toca Sincronice cuando termine de cargar.');
      queueRender();
      return;
    }
    if (existing.disabled) {
      queueRender();
      return;
    }
    const authorized = C.syncState().authorized;
    if (account && !account.local && !authorized) {
      recentAuthAttempt = Date.now();
      shownAuthError = authMessage?.dataset.state === 'error' ? authMessage.textContent.trim() : '';
    }
    // Reuse the exact existing click path. This keeps the first-access validation
    // and account guards, and does not open Mi cuenta for an ordinary renewal.
    existing.click();
    if (authorized) {
      pressUntil = Date.now() + 500;
      setTimeout(queueRender, 520);
    }
    queueRender();
  });
  for (const type of ['mauzi:sync-status', 'mauzi:cloud-state', 'mauzi:modules-changed', 'online', 'offline', 'focus', 'pageshow']) {
    window.addEventListener(type, queueRender);
  }
  document.addEventListener('visibilitychange', queueRender);
  const observer = new MutationObserver(queueRender);
  observer.observe(existing, {attributes: true, childList: true, subtree: true, characterData: true});
  if (authMessage) observer.observe(authMessage, {attributes: true, childList: true, subtree: true, characterData: true});
  const moduleStatus = document.getElementById('modulesSyncStatus');
  if (moduleStatus) observer.observe(moduleStatus, {childList: true, subtree: true, characterData: true});
  Promise.resolve(C.ready).then(queueRender, queueRender);
  render();
})();
