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
  const hit = BY_ALIAS.get(key);
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

// ===== GFG CONFIG: profile page scraping. UNVERIFIED guesses — see docs/gfg-selectors.md =====
export const GFG_PROFILE_URL = (handle) => `https://www.geeksforgeeks.org/user/${encodeURIComponent(handle)}/`;
export const STATS_PATTERNS = {
  solved: /"total_problems_solved"\s*:\s*"?(\d+)/,
  score: /"score"\s*:\s*"?(\d+)/,
  rank: /"institute_rank"\s*:\s*"?(\d+)/,
};
// ===== end GFG CONFIG =====

/**
 * Extract stats from GFG profile HTML. Missing values become null.
 * @param {string} html
 * @returns {{solved: number|null, score: number|null, rank: number|null}}
 */
export function parseGfgStats(html) {
  const pick = (re) => { const m = html.match(re); return m ? Number(m[1]) : null; };
  return { solved: pick(STATS_PATTERNS.solved), score: pick(STATS_PATTERNS.score), rank: pick(STATS_PATTERNS.rank) };
}

/**
 * Fetch and parse a GFG user's public profile stats.
 * @param {string} handle GFG username
 * @returns {Promise<{solved: number|null, score: number|null, rank: number|null, fetchedAt: string}>}
 */
export async function fetchGfgStats(handle) {
  const res = await fetch(GFG_PROFILE_URL(handle), { credentials: 'include' });
  if (!res.ok) throw new Error(`GFG profile fetch failed (${res.status})`);
  return { ...parseGfgStats(await res.text()), fetchedAt: new Date().toISOString() };
}
