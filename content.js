// Isolated-world content script: scrapes problem metadata and forwards the submission to the background worker.
// ===== GFG CONFIG: UNVERIFIED selectors — see docs/gfg-selectors.md =====
const SEL = {
  title: 'h1, h3[class*="problem" i], [class*="problems_header_content__title" i]',
  difficulty: '[class*="difficulty" i]',
  tags: '[class*="topic" i] a, [class*="tag" i] a',
  language: '[class*="language" i] select, [class*="language" i] [class*="selected" i], [class*="language-selector" i]',
};
const DIFF_RE = /\b(School|Basic|Easy|Medium|Hard)\b/i;
const DIFF_TEXT_RE = /Difficulty[:\s]*(School|Basic|Easy|Medium|Hard)/i; // fallback over body text
// ===== end GFG CONFIG =====

const capitalize = (s) => s[0].toUpperCase() + s.slice(1).toLowerCase();

let lastSent = 0;

function scrapeMeta(reqBody) {
  const path = location.pathname;
  const slug = (path.match(/\/problems\/([^/]+)/) || [])[1] || path.split('/').filter(Boolean).pop() || 'unknown';
  const contest = (path.match(/\/contest\/([^/]+)/) || [])[1] || null;

  let title = document.querySelector(SEL.title)?.textContent?.trim();
  if (!title) title = document.title.split('|')[0].trim() || slug;

  let difficulty = 'Unknown';
  for (const el of document.querySelectorAll(SEL.difficulty)) {
    const m = el.textContent.match(DIFF_RE);
    if (m) { difficulty = capitalize(m[1]); break; }
  }
  if (difficulty === 'Unknown') {
    const m = document.body.innerText.slice(0, 4000).match(DIFF_TEXT_RE);
    if (m) difficulty = capitalize(m[1]);
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
  try {
    chrome.runtime.sendMessage({ type: 'SUBMISSION', payload }).catch((e) => console.warn('[GFG Sync] send failed:', e.message));
  } catch (e) {
    console.warn('[GFG Sync] Extension was reloaded; refresh this tab to resume syncing.', e.message);
  }
});
