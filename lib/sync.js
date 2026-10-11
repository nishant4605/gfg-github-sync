// Pure sync logic (no chrome.*, no network) so it can be unit-tested in Node.
import { slugify } from './util.js';

export const DIFFICULTIES = ['School', 'Basic', 'Easy', 'Medium', 'Hard'];

/** @returns {{problems: Object, dates: string[], stats: Object|null}} */
export const emptyIndex = () => ({ problems: {}, dates: [], stats: null });

/**
 * Normalize difficulty text to one of DIFFICULTIES or "Unknown".
 * @param {string|null|undefined} d
 * @returns {string}
 */
export function normDifficulty(d) {
  const hit = DIFFICULTIES.find((x) => x.toLowerCase() === String(d ?? '').trim().toLowerCase());
  return hit || 'Unknown';
}

/**
 * Compute repo folder and index key for a submission.
 * @param {{slug: string, contest?: string|null, difficulty?: string}} sub
 * @returns {{base: string, key: string}}
 */
export function buildTarget(sub) {
  const slug = slugify(sub.slug);
  const contest = sub.contest ? slugify(sub.contest) : null;
  return {
    base: contest ? `Contests/${contest}/${slug}` : `Problems/${normDifficulty(sub.difficulty)}/${slug}`,
    key: `${contest || 'practice'}/${slug}`,
  };
}

/**
 * Like buildTarget, but if the scraped difficulty is Unknown and the index already
 * knows this problem, reuse its difficulty so files don't land in Problems/Unknown.
 * @param {ReturnType<typeof emptyIndex>} index
 * @param {{slug: string, contest?: string|null, difficulty?: string}} sub
 * @returns {{base: string, key: string, difficulty: string}}
 */
export function resolveTarget(index, sub) {
  let difficulty = normDifficulty(sub.difficulty);
  if (difficulty === 'Unknown') difficulty = normDifficulty(index.problems[buildTarget(sub).key]?.difficulty);
  return { ...buildTarget({ ...sub, difficulty }), difficulty };
}

/**
 * Fill a commit message template. Placeholders: {title} {difficulty} {language} {slug}.
 * @param {string} template
 * @param {Record<string, string>} vars
 * @returns {string}
 */
export function commitMessage(template, vars) {
  return template.replace(/\{(title|difficulty|language|slug)\}/g, (_, k) => vars[k] ?? '');
}

/**
 * Insert or update a problem entry in the index (mutates and returns `index`).
 * Merges languages, keeps firstSolved, never downgrades a known difficulty to Unknown,
 * and records `today` in the sorted, de-duplicated `dates` list.
 * @param {ReturnType<typeof emptyIndex>} index
 * @param {{slug: string, title: string, difficulty?: string, contest?: string|null, tags?: string[], link: string}} sub
 * @param {{name: string}} lang normalized language
 * @param {string} base repo folder for this problem
 * @param {string} today YYYY-MM-DD
 * @returns {{index: Object, key: string, entry: Object}}
 */
export function upsertEntry(index, sub, lang, base, today) {
  const { key } = buildTarget(sub);
  const diff = normDifficulty(sub.difficulty);
  const prev = index.problems[key];
  const entry = prev ? { ...prev, languages: [...prev.languages] } : {
    slug: slugify(sub.slug), title: sub.title, difficulty: diff, contest: sub.contest || null,
    tags: [], languages: [], firstSolved: today, lastSolved: today, path: base, link: sub.link,
  };
  if (sub.title) entry.title = sub.title;
  if (diff !== 'Unknown') entry.difficulty = diff;
  if (sub.tags?.length) entry.tags = [...sub.tags];
  if (!entry.languages.includes(lang.name)) entry.languages.push(lang.name);
  if (!entry.firstSolved || today < entry.firstSolved) entry.firstSolved = today;
  if (!entry.lastSolved || today > entry.lastSolved) entry.lastSolved = today;
  entry.path = base;
  if (sub.link) entry.link = sub.link;

  index.problems[key] = entry;
  index.dates = [...new Set([...(index.dates || []), today])].sort();
  return { index, key, entry };
}
