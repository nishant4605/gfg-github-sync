import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normLang, slugify, toBase64, fromBase64, localDate, parseGfgStats } from '../lib/util.js';

test('normLang maps GFG aliases to display name + ext', () => {
  assert.deepEqual(normLang('cpp'), { name: 'C++', ext: 'cpp' });
  assert.deepEqual(normLang('Python3'), { name: 'Python', ext: 'py' });
  assert.deepEqual(normLang('C#'), { name: 'C#', ext: 'cs' });
  assert.deepEqual(normLang('golang'), { name: 'Go', ext: 'go' });
  assert.deepEqual(normLang(' JavaScript '), { name: 'JavaScript', ext: 'js' });
});

test('normLang guesses from code when language missing', () => {
  assert.equal(normLang(null, '#include <bits/stdc++.h>').ext, 'cpp');
  assert.equal(normLang('', 'public class Main {}').ext, 'java');
  assert.equal(normLang(undefined, 'class Solution:\n    def f(self): pass').ext, 'py');
  assert.equal(normLang(undefined, 'def solve(a):\n  return a').ext, 'py');
  assert.deepEqual(normLang(null, 'random text'), { name: 'Unknown', ext: 'txt' });
});

test('normLang keeps unknown labels but uses txt', () => {
  assert.deepEqual(normLang('Brainfuck'), { name: 'Brainfuck', ext: 'txt' });
});

test('slugify', () => {
  assert.equal(slugify('Reverse a String!'), 'reverse-a-string');
  assert.equal(slugify('  --GFG Weekly #123--  '), 'gfg-weekly-123');
  assert.equal(slugify('???'), 'untitled');
  assert.equal(slugify(null), 'untitled');
});

test('base64 round-trips ASCII, Unicode and emoji', () => {
  for (const s of ['', 'hello', 'héllo wörld', 'नमस्ते', '🚀 code 😀', 'a\nb\tc']) {
    assert.equal(fromBase64(toBase64(s)), s);
  }
  assert.equal(toBase64('✓'), Buffer.from('✓', 'utf8').toString('base64'));
});

test('fromBase64 tolerates GitHub line breaks', () => {
  const b64 = Buffer.from('x'.repeat(200)).toString('base64');
  assert.equal(fromBase64(b64.replace(/(.{60})/g, '$1\n')), 'x'.repeat(200));
});

test('toBase64 handles large input', () => {
  const big = '€'.repeat(100_000);
  assert.equal(fromBase64(toBase64(big)), big);
});

test('localDate pads month/day', () => {
  assert.equal(localDate(new Date(2026, 0, 5)), '2026-01-05');
});

test('parseGfgStats returns nulls for missing keys', () => {
  assert.deepEqual(parseGfgStats('<html></html>'), { solved: null, score: null, rank: null });
  assert.deepEqual(
    parseGfgStats('{"total_problems_solved":250,"score":"900","institute_rank":1234}'),
    { solved: 250, score: 900, rank: 1234 },
  );
});
