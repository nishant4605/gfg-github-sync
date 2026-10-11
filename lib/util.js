export const EXT = {
  'c++': 'cpp', cpp: 'cpp', c: 'c', java: 'java', python: 'py', python3: 'py', py: 'py',
  javascript: 'js', js: 'js', typescript: 'ts', csharp: 'cs', 'c#': 'cs', go: 'go',
  golang: 'go', kotlin: 'kt', swift: 'swift', rust: 'rs', php: 'php', ruby: 'rb', scala: 'scala',
};

export function normLang(lang, code = '') {
  let l = String(lang || '').trim().toLowerCase();
  if (!l) {
    if (/#include\s*</.test(code)) l = 'c++';
    else if (/public\s+class|System\.out/.test(code)) l = 'java';
    else if (/^\s*def\s+\w+\(|^\s*import\s+\w+|^\s*class\s+Solution:/m.test(code)) l = 'python';
    else l = 'txt';
  }
  const display = { cpp: 'C++', 'c++': 'C++', java: 'Java', python: 'Python', python3: 'Python', py: 'Python', javascript: 'JavaScript', js: 'JavaScript' };
  return { ext: EXT[l] || 'txt', name: display[l] || (l[0].toUpperCase() + l.slice(1)) };
}

export const slugify = (s) =>
  String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'untitled';

export function toBase64(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin);
}
export function fromBase64(b64) {
  const bin = atob(b64.replace(/\n/g, ''));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

export function localDate(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// GFG profile scraping patterns. Best-effort guesses: adjust if GFG changes its page data.
export const STATS_PATTERNS = {
  solved: /"total_problems_solved"\s*:\s*(\d+)/,
  score: /"score"\s*:\s*(\d+)/,
  rank: /"institute_rank"\s*:\s*(\d+)/,
};

export async function fetchGfgStats(handle) {
  const res = await fetch(`https://www.geeksforgeeks.org/user/${encodeURIComponent(handle)}/`, { credentials: 'include' });
  if (!res.ok) throw new Error(`GFG profile fetch failed (${res.status})`);
  const html = await res.text();
  const pick = (re) => { const m = html.match(re); return m ? Number(m[1]) : null; };
  return { solved: pick(STATS_PATTERNS.solved), score: pick(STATS_PATTERNS.score), rank: pick(STATS_PATTERNS.rank), fetchedAt: new Date().toISOString() };
}
