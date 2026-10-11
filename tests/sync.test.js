import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyIndex, buildTarget, resolveTarget, commitMessage, upsertEntry, normDifficulty } from '../lib/sync.js';

const sub = (o = {}) => ({
  slug: 'reverse-a-string', contest: null, title: 'Reverse a String', difficulty: 'Easy',
  tags: ['Strings'], link: 'https://www.geeksforgeeks.org/problems/reverse-a-string/1', ...o,
});
const CPP = { name: 'C++', ext: 'cpp' };
const PY = { name: 'Python', ext: 'py' };

test('normDifficulty', () => {
  assert.equal(normDifficulty('easy'), 'Easy');
  assert.equal(normDifficulty(' HARD '), 'Hard');
  assert.equal(normDifficulty('Expert'), 'Unknown');
  assert.equal(normDifficulty(null), 'Unknown');
});

test('buildTarget: practice vs contest', () => {
  assert.deepEqual(buildTarget(sub()), { base: 'Problems/Easy/reverse-a-string', key: 'practice/reverse-a-string' });
  assert.deepEqual(buildTarget(sub({ contest: 'GFG Weekly 123' })), {
    base: 'Contests/gfg-weekly-123/reverse-a-string', key: 'gfg-weekly-123/reverse-a-string',
  });
});

test('resolveTarget reuses known difficulty when scrape says Unknown', () => {
  const index = emptyIndex();
  upsertEntry(index, sub(), CPP, 'Problems/Easy/reverse-a-string', '2026-10-10');
  const t = resolveTarget(index, sub({ difficulty: 'Unknown' }));
  assert.equal(t.base, 'Problems/Easy/reverse-a-string');
  assert.equal(t.difficulty, 'Easy');
  assert.equal(resolveTarget(emptyIndex(), sub({ difficulty: '' })).base, 'Problems/Unknown/reverse-a-string');
});

test('commitMessage replaces all placeholders, safely', () => {
  assert.equal(
    commitMessage('{title} [{difficulty}] {language} {slug} {title}', { title: 'A $& B', difficulty: 'Easy', language: 'C++', slug: 'a-b' }),
    'A $& B [Easy] C++ a-b A $& B',
  );
  assert.equal(commitMessage('{unknown} {title}', { title: 'X' }), '{unknown} X');
});

test('upsertEntry creates a new entry', () => {
  const index = emptyIndex();
  const { key, entry } = upsertEntry(index, sub(), CPP, 'Problems/Easy/reverse-a-string', '2026-10-11');
  assert.equal(key, 'practice/reverse-a-string');
  assert.deepEqual(entry, {
    slug: 'reverse-a-string', title: 'Reverse a String', difficulty: 'Easy', contest: null, tags: ['Strings'],
    languages: ['C++'], firstSolved: '2026-10-11', lastSolved: '2026-10-11',
    path: 'Problems/Easy/reverse-a-string', link: 'https://www.geeksforgeeks.org/problems/reverse-a-string/1',
  });
  assert.deepEqual(index.dates, ['2026-10-11']);
});

test('upsertEntry merges languages, keeps firstSolved, bumps lastSolved', () => {
  const index = emptyIndex();
  upsertEntry(index, sub(), CPP, 'P', '2026-10-09');
  upsertEntry(index, sub(), PY, 'P', '2026-10-11');
  const { entry } = upsertEntry(index, sub(), CPP, 'P', '2026-10-11');
  assert.deepEqual(entry.languages, ['C++', 'Python']);
  assert.equal(entry.firstSolved, '2026-10-09');
  assert.equal(entry.lastSolved, '2026-10-11');
  assert.deepEqual(index.dates, ['2026-10-09', '2026-10-11']);
});

test('upsertEntry never downgrades difficulty to Unknown and keeps tags if none scraped', () => {
  const index = emptyIndex();
  upsertEntry(index, sub(), CPP, 'P', '2026-10-10');
  const { entry } = upsertEntry(index, sub({ difficulty: 'Unknown', tags: [] }), CPP, 'P', '2026-10-11');
  assert.equal(entry.difficulty, 'Easy');
  assert.deepEqual(entry.tags, ['Strings']);
});

test('upsertEntry: queued older submission does not move lastSolved backwards', () => {
  const index = emptyIndex();
  upsertEntry(index, sub(), CPP, 'P', '2026-10-11');
  const { entry } = upsertEntry(index, sub(), PY, 'P', '2026-10-08');
  assert.equal(entry.firstSolved, '2026-10-08');
  assert.equal(entry.lastSolved, '2026-10-11');
  assert.deepEqual(index.dates, ['2026-10-08', '2026-10-11']);
});

test('upsertEntry keeps contest and practice entries separate', () => {
  const index = emptyIndex();
  upsertEntry(index, sub(), CPP, 'P', '2026-10-11');
  upsertEntry(index, sub({ contest: 'weekly-1' }), CPP, 'C', '2026-10-11');
  assert.deepEqual(Object.keys(index.problems).sort(), ['practice/reverse-a-string', 'weekly-1/reverse-a-string']);
});
