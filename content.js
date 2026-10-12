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
// Verified 2026-10-12: after a solve the title element gains a badge, e.g. "Minimum Squares with Full CutsSolved"
const TITLE_BADGE_RE = /\s*(Solved|Attempted)\s*$/;
// ===== end GFG CONFIG =====

const capitalize = (s) => s[0].toUpperCase() + s.slice(1).toLowerCase();

let lastSent = 0;

function scrapeTitle(slug) {
  const docTitle = document.title.split('|')[0].trim();
  const heading = document.querySelector(SEL.title)?.textContent?.trim() || '';
  if (docTitle && heading.startsWith(docTitle)) return docTitle;
  return heading.replace(TITLE_BADGE_RE, '').trim() || docTitle || slug;
}

function scrapeMeta(reqBody) {
  const path = location.pathname;
  const slug = (path.match(/\/problems\/([^/]+)/) || [])[1] || path.split('/').filter(Boolean).pop() || 'unknown';
  const contest = (path.match(/\/contest\/([^/]+)/) || [])[1] || null;

  const title = scrapeTitle(slug);

  let difficulty = 'Unknown';
  for (const el of document.querySelectorAll(SEL.difficulty)) {
    const m = el.textContent.match(DIFF_RE);
    if (m) { difficulty = capitalize(m[1]); break; }
  }
  if (difficulty === 'Unknown') {
    const m = document.body.innerText.slice(0, 4000).match(DIFF_TEXT_RE);
    if (m) difficulty = capitalize(m[1]);
  }

  const tags = [...new Set([...document.querySelectorAll(SEL.tags)].map((a) => a.textContent.trim()))]
    .filter((t) => t && t.toLowerCase() !== title.toLowerCase())
    .slice(0, 15);

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
  if (ev.source !== window || ev.data?.source !== 'geeksync' || ev.data.type !== 'SUCCESS') return;
  const now = Date.now();
  if (now - lastSent < 8000) return; // dedupe fetch + XHR + DOM firing together
  lastSent = now;

  const { code, reqBody } = ev.data.payload || {};
  if (!code) { console.warn('[GeekSync] Success detected but editor code not found.'); return; }
  const payload = { ...scrapeMeta(reqBody), code, solvedAt: new Date().toISOString() };
  console.log('[GeekSync] Submission detected:', payload.title, payload.difficulty, payload.language);
  // After the extension is reloaded, scripts in already-open tabs lose chrome.runtime. Expected, not an error.
  if (!chrome.runtime?.id) {
    console.info('[GeekSync] Extension was reloaded; refresh this tab (F5) to resume syncing.');
    return;
  }
  chrome.runtime.sendMessage({ type: 'SUBMISSION', payload })
    .catch((e) => console.info('[GeekSync] Could not reach the extension; refresh this tab (F5).', e.message));
});
