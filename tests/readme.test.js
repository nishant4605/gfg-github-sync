import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeStreak, problemReadme, rootReadme } from '../lib/readme.js';

const NOW = new Date(2026, 9, 11, 12); // 2026-10-11 local

test('computeStreak: empty', () => {
  assert.deepEqual(computeStreak([], NOW), { current: 0, longest: 0 });
});

test('computeStreak: ends today', () => {
  assert.deepEqual(computeStreak(['2026-10-09', '2026-10-10', '2026-10-11'], NOW), { current: 3, longest: 3 });
});

test('computeStreak: today missing counts from yesterday', () => {
  assert.deepEqual(computeStreak(['2026-10-09', '2026-10-10'], NOW), { current: 2, longest: 2 });
});

test('computeStreak: gap breaks current, longest found elsewhere', () => {
  const dates = ['2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04', '2026-10-08', '2026-10-11'];
  assert.deepEqual(computeStreak(dates, NOW), { current: 1, longest: 4 });
});

test('computeStreak: last solve 2 days ago => current 0', () => {
  assert.deepEqual(computeStreak(['2026-10-09'], NOW), { current: 0, longest: 1 });
});

test('computeStreak: crosses month/year boundaries and ignores duplicates/order', () => {
  const dates = ['2026-01-01', '2025-12-31', '2025-12-30', '2026-01-01'];
  assert.equal(computeStreak(dates, NOW).longest, 3);
  assert.equal(computeStreak(['2026-09-30', '2026-10-01'], new Date(2026, 9, 1)).current, 2);
});

const entry = (o = {}) => ({
  slug: 'reverse-a-string', title: 'Reverse a String', difficulty: 'Easy', contest: null, tags: ['Strings'],
  languages: ['C++', 'Python'], firstSolved: '2026-10-09', lastSolved: '2026-10-11',
  path: 'Problems/Easy/reverse-a-string', link: 'https://www.geeksforgeeks.org/problems/reverse-a-string/1', ...o,
});

test('problemReadme renders table and link', () => {
  assert.equal(problemReadme(entry()), `# Reverse a String

| | |
|---|---|
| **Difficulty** | Easy |
| **Source** | Practice |
| **Languages** | C++, Python |
| **First solved** | 2026-10-09 |
| **Last solved** | 2026-10-11 |
| **Topics** | Strings |

🔗 [Open problem on GeeksforGeeks](https://www.geeksforgeeks.org/problems/reverse-a-string/1)
`);
});

test('problemReadme: contest source, no topics row, escapes pipes', () => {
  const md = problemReadme(entry({ contest: 'weekly-1', tags: [], title: 'A | B' }));
  assert.match(md, /^# A \\\| B/);
  assert.match(md, /\| \*\*Source\*\* \| Contest: weekly-1 \|/);
  assert.doesNotMatch(md, /Topics/);
});

const index = {
  problems: {
    'practice/reverse-a-string': entry(),
    'practice/two-sum': entry({ slug: 'two-sum', title: 'Two Sum | Pairs', difficulty: 'Medium', tags: ['Arrays', 'Hashing'], languages: ['C++'], lastSolved: '2026-10-10', path: 'Problems/Medium/two-sum' }),
    'weekly-1/odd-one': entry({ slug: 'odd-one', title: 'Odd One', difficulty: 'Unknown', contest: 'weekly-1', tags: [], languages: ['Java'], lastSolved: '2026-10-11', path: 'Contests/weekly-1/odd-one' }),
  },
  dates: ['2026-10-10', '2026-10-11'],
  stats: { solved: 250, score: 900, rank: null, fetchedAt: 'x' },
};

test('rootReadme: badges, stats rows, omits null rank', () => {
  const md = rootReadme(structuredClone(index), NOW);
  assert.match(md, /img\.shields\.io\/badge\/Solved-3-brightgreen/);
  assert.match(md, /badge\/Streak-2%20days-orange/);
  assert.match(md, /badge\/Score-900-purple/);
  assert.doesNotMatch(md, /badge\/Rank/);
  assert.doesNotMatch(md, /\| Rank \|/);
  assert.match(md, /\| Problems solved on GFG \| 250 \|/);
  assert.match(md, /\| Current streak \| 2 days \|\n\| Longest streak \| 2 days \|/);
});

test('rootReadme: section order and tables', () => {
  const md = rootReadme(structuredClone(index), NOW);
  const order = ['## Stats', '## Difficulty', '## Languages', '## Topics', '## Contests', '## Problems'].map((h) => md.indexOf(h));
  assert.ok(order.every((v, i) => v > 0 && (i === 0 || v > order[i - 1])), `bad order: ${order}`);
  assert.match(md, /\| Easy \| 1 \|\n\| Medium \| 1 \|\n\| Other \| 1 \|/);
  assert.doesNotMatch(md, /\| Hard \|/);
  assert.match(md, /\| C\+\+ \| 2 \|\n\| Java \| 1 \|\n\| Python \| 1 \|/);
  assert.match(md, /\| weekly-1 \| 1 \| 2026-10-11 \|/);
  assert.match(md, /Last updated 2026-10-11/);
});

test('rootReadme: problems sorted by lastSolved desc with escaped titles and relative links', () => {
  const md = rootReadme(structuredClone(index), NOW);
  const rows = md.split('## Problems')[1].split('\n').filter((l) => /^\| \d/.test(l));
  assert.equal(rows.length, 3);
  assert.match(rows[0], /^\| 1 \| \[Odd One\]\(Contests\/weekly-1\/odd-one\)/);
  assert.match(rows[1], /^\| 2 \| \[Reverse a String\]/);
  assert.match(rows[2], /^\| 3 \| \[Two Sum \\\| Pairs\]\(Problems\/Medium\/two-sum\) \| Medium/);
});

test('rootReadme: no Topics/Contests sections when empty', () => {
  const md = rootReadme({ problems: { a: entry({ tags: [] }) }, dates: [], stats: null }, NOW);
  assert.doesNotMatch(md, /## Topics|## Contests/);
});

test('rootReadme does not mutate the index', () => {
  const copy = structuredClone(index);
  rootReadme(copy, NOW);
  assert.deepEqual(copy, index);
});
