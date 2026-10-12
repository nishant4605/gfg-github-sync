// Language table: every alias GFG (or the user) might send maps to one display name + file extension.
const LANGS = [
  { name: 'C++', ext: 'cpp', aliases: ['c++', 'cpp', 'cpp14', 'cpp17', 'cpp20', 'g++'] },
  { name: 'C', ext: 'c', aliases: ['c'] },
  { name: 'Java', ext: 'java', aliases: ['java', 'java8', 'java11', 'java17'] },
  { name: 'Python', ext: 'py', aliases: ['python', 'python3', 'py', 'py3', 'pypy', 'pypy3'] },
  { name: 'JavaScript', ext: 'js', aliases: ['javascript', 'js', 'node', 'nodejs'] },
  { name: 'TypeScript', ext: 'ts', aliases: ['typescript', 'ts'] },
  { name: 'C#', ext: 'cs', aliases: ['c#', 'csharp', 'cs'] },
  { name: 'Go', ext: 'go', aliases: ['go', 'golang'] },
  { name: 'Kotlin', ext: 'kt', aliases: ['kotlin', 'kt'] },
  { name: 'Swift', ext: 'swift', aliases: ['swift'] },
  { name: 'Rust', ext: 'rs', aliases: ['rust', 'rs'] },
  { name: 'PHP', ext: 'php', aliases: ['php'] },
  { name: 'Ruby', ext: 'rb', aliases: ['ruby', 'rb'] },
  { name: 'Scala', ext: 'scala', aliases: ['scala'] },
];
const BY_ALIAS = new Map(LANGS.flatMap((l) => l.aliases.map((a) => [a, l])));

/** Best-effort language guess from source code; returns an alias or ''. */
function guessLang(code) {
  if (/#include\s*</.test(code)) return 'c++';
  if (/public\s+class|System\.out/.test(code)) return 'java';
  if (/^\s*def\s+\w+\s*\(|^\s*class\s+Solution\s*:/m.test(code)) return 'python';
  return '';
}

/**
 * Normalize a language label (or guess it from code) to a display name + file extension.
 * @param {string|null|undefined} lang raw language from GFG (e.g. "cpp", "Python3")
 * @param {string} [code] source code used for guessing when `lang` is empty
 * @returns {{name: string, ext: string}} unknown languages keep their label and get ext "txt"
 */
export function normLang(lang, code = '') {
  const raw = String(lang ?? '').trim();
  const key = (raw || guessLang(code)).toLowerCase().replace(/\s+/g, '');
  // GFG labels carry versions, e.g. "C++ (17)", "Java (1.8)", "Python3"
  const hit = BY_ALIAS.get(key) || BY_ALIAS.get(key.replace(/\(.*?\)/g, '')) ||
    BY_ALIAS.get(key.replace(/\(.*?\)/g, '').replace(/[\d.]+$/, ''));
  if (hit) return { name: hit.name, ext: hit.ext };
  return { name: raw || 'Unknown', ext: 'txt' };
}

/**
 * Make a URL/path-safe slug.
 * @param {string} s
 * @returns {string} lowercase, hyphen-separated; "untitled" if nothing usable remains
 */
export const slugify = (s) =>
  String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'untitled';

/**
 * UTF-8 safe base64 encode.
 * @param {string} str
 * @returns {string}
 */
export function toBase64(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/**
 * UTF-8 safe base64 decode (tolerates the newlines GitHub inserts).
 * @param {string} b64
 * @returns {string}
 */
export function fromBase64(b64) {
  const bin = atob(b64.replace(/\s/g, ''));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

/**
 * Local-time calendar date.
 * @param {Date} [d]
 * @returns {string} YYYY-MM-DD
 */
export function localDate(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// ===== GFG CONFIG: profile stats API. Verified 2026-10-12 — see docs/gfg-selectors.md =====
// Public JSON endpoint (no login needed); response shape: { data: { score, total_problems_solved, ... } }
export const GFG_STATS_URL = (handle) =>
  `https://authapi.geeksforgeeks.org/api-get/user-profile-info/?handle=${encodeURIComponent(handle)}&article_count=false&redirect=true`;
export const STATS_FIELDS = {
  solved: 'total_problems_solved',
  score: 'score',
  monthlyScore: 'monthly_score',
  rank: 'institute_rank',
  potdStreak: 'pod_solved_current_streak',
  potdLongest: 'pod_solved_longest_streak',
};
// ===== end GFG CONFIG =====

/**
 * Map the GFG profile API response to our stats shape. Missing/non-numeric values become null.
 * @param {any} json parsed API response
 * @returns {Record<keyof typeof STATS_FIELDS, number|null>}
 */
export function parseGfgStats(json) {
  const data = json?.data || {};
  return Object.fromEntries(Object.entries(STATS_FIELDS).map(([k, src]) => {
    const n = data[src] === null || data[src] === '' ? NaN : Number(data[src]);
    return [k, Number.isFinite(n) ? n : null];
  }));
}

/**
 * Fetch a GFG user's public profile stats.
 * @param {string} handle GFG username (e.g. from geeksforgeeks.org/user/<handle>/)
 * @returns {Promise<Record<keyof typeof STATS_FIELDS, number|null> & {fetchedAt: string}>}
 */
export async function fetchGfgStats(handle) {
  const res = await fetch(GFG_STATS_URL(handle.trim()), { credentials: 'omit' });
  let json = null;
  try { json = await res.json(); } catch { /* handled below */ }
  if (!res.ok || !json?.data) {
    throw new Error(`GFG stats for "${handle}" failed (${res.status}${json?.message ? `: ${json.message}` : ''})`);
  }
  return { ...parseGfgStats(json), fetchedAt: new Date().toISOString() };
}
