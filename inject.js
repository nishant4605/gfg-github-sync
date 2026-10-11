// Runs in the PAGE context (world: MAIN) so it can hook fetch/XHR and read the code editor.
// All GFG-specific guesses live in CONFIG so they are easy to fix when GFG changes its site.
(() => {
  if (window.__gfgSyncHooked) return;
  window.__gfgSyncHooked = true;

  const CONFIG = {
    successRe: /problem solved successfully/i,   // text GFG shows/returns on an accepted submission
    submitUrlRe: /submit|submission/i,           // network calls worth inspecting
  };

  let lastReqBody = null;
  const post = (type, payload) =>
    window.postMessage({ source: 'gfg-sync', type, payload }, '*');

  function getCode() {
    try {
      const a = document.querySelector('.ace_editor');
      if (a && a.env && a.env.editor) return a.env.editor.getValue();
    } catch {}
    try {
      if (window.monaco) {
        const models = window.monaco.editor.getModels();
        if (models.length) return models[0].getValue();
      }
    } catch {}
    try {
      const c = document.querySelector('.CodeMirror');
      if (c && c.CodeMirror) return c.CodeMirror.getValue();
    } catch {}
    return null;
  }

  function success(via) {
    post('SUCCESS', { via, code: getCode(), reqBody: lastReqBody });
  }

  // --- fetch hook ---
  const origFetch = window.fetch;
  window.fetch = async function (...args) {
    const res = await origFetch.apply(this, args);
    try {
      const url = typeof args[0] === 'string' ? args[0] : args[0]?.url || '';
      if (CONFIG.submitUrlRe.test(url)) {
        const body = args[1]?.body;
        if (typeof body === 'string') lastReqBody = body;
        res.clone().text().then((t) => { if (CONFIG.successRe.test(t)) success('fetch'); }).catch(() => {});
      }
    } catch {}
    return res;
  };

  // --- XHR hook ---
  const origOpen = XMLHttpRequest.prototype.open;
  const origSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (m, url, ...rest) {
    this.__gfgUrl = String(url);
    return origOpen.call(this, m, url, ...rest);
  };
  XMLHttpRequest.prototype.send = function (body) {
    if (CONFIG.submitUrlRe.test(this.__gfgUrl || '')) {
      if (typeof body === 'string') lastReqBody = body;
      this.addEventListener('load', () => {
        try { if (CONFIG.successRe.test(this.responseText || '')) success('xhr'); } catch {}
      });
    }
    return origSend.call(this, body);
  };

  // --- DOM fallback: watch for the success popup text ---
  const start = () => {
    new MutationObserver((muts) => {
      for (const m of muts) {
        for (const n of m.addedNodes) {
          if (n.nodeType === 1 && CONFIG.successRe.test(n.textContent || '')) { success('dom'); return; }
        }
      }
    }).observe(document.documentElement, { childList: true, subtree: true });
  };
  start();
})();
