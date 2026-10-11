// Isolated-world content script: scrapes problem metadata and forwards the submission to the background worker.
const SEL = {
  title: 'h1, h3[class*="problem" i], [class*="problems_header_content__title" i]',
  difficulty: '[class*="difficulty" i]',
  tags: '[class*="topic" i] a, [class*="tag" i] a',
  language: '[class*="language" i] select, [class*="language" i] [class*="selected" i], [class*="language-selector" i]',
};

let lastSent = 0;

function scrapeMeta(reqBody) {
  const path = location.pathname;
  const slug = (path.match(/\/problems\/([^/]+)/) || [])[1] || path.split('/').filter(Boolean).pop() || 'unknown';
  const contest = (path.match(/\/contest\/([^/]+)/) || [])[1] || null;

  let title = document.querySelector(SEL.title)?.textContent?.trim();
  if (!title) title = document.title.split('|')[0].trim() || slug;

  let difficulty = 'Unknown';
  const dRe = /\b(School|Basic|Easy|Medium|Hard)\b/i;
  for (const el of document.querySelectorAll(SEL.difficulty)) {
    const m = el.textContent.match(dRe);
    if (m) { difficulty = m[1][0].toUpperCase() + m[1].slice(1).toLowerCase(); break; }
  }
  if (difficulty === 'Unknown') {
    const m = document.body.innerText.slice(0, 4000).match(/Difficulty[:\s]*(School|Basic|Easy|Medium|Hard)/i);
    if (m) difficulty = m[1][0].toUpperCase() + m[1].slice(1).toLowerCase();
  }

  const tags = [...new Set([...document.querySelectorAll(SEL.tags)].map((a) => a.textContent.trim()).filter(Boolean))].slice(0, 15);

  let language = null;
  if (reqBody) {
    try { const j = JSON.parse(reqBody); language = j.language || j.lang || j.langId || null; } catch {}
  }
  if (!language) {
    const el = document.querySelector(SEL.language);
    language = el?.value || el?.textContent?.trim() || null;
  }

  return { slug, contest, title, difficulty, tags, language, link: location.origin + location.pathname };
}

window.addEventListener('message', (ev) => {
  if (ev.source !== window || ev.data?.source !== 'gfg-sync' || ev.data.type !== 'SUCCESS') return;
  const now = Date.now();
  if (now - lastSent < 8000) return; // dedupe fetch + XHR + DOM firing together
  lastSent = now;

  const { code, reqBody } = ev.data.payload || {};
  if (!code) { console.warn('[GFG Sync] Success detected but editor code not found.'); return; }
  const payload = { ...scrapeMeta(reqBody), code, solvedAt: new Date().toISOString() };
  console.log('[GFG Sync] Submission detected:', payload.title, payload.difficulty, payload.language);
  chrome.runtime.sendMessage({ type: 'SUBMISSION', payload });
});
