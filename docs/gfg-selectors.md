# GFG selectors & endpoints: verification log

Everything GFG-specific lives in these config blocks (marked `GFG CONFIG`):
- `inject.js` → `CONFIG` (submit URL regex, success regex)
- `content.js` → `SEL`, `DIFF_RE`, `DIFF_TEXT_RE`, `TITLE_BADGE_RE`
- `lib/util.js` → `GFG_STATS_URL`, `STATS_FIELDS`

## Status

| # | Item | Current implementation | Verified? | Date | Notes |
|---|---|---|---|---|---|
| 1 | Accepted-submission detection | fetch/XHR hook on `/submit|submission/i` + DOM text `/problem solved successfully/i` | ✅ works | 2026-10-12 | Two practice problems synced end-to-end. Which of the 3 signals fires first not yet recorded |
| 2 | Editor code | Ace → Monaco → CodeMirror | ✅ works | 2026-10-12 | Full C++ source captured. Exact editor not yet recorded |
| 3 | Title | `SEL.title`, prefer `document.title` prefix | ✅ fixed | 2026-10-12 | Title element gains a "Solved" badge after the first solve ("…Full CutsSolved") |
| 3 | Difficulty | `[class*=difficulty]` + regex | ✅ works | 2026-10-12 | "Medium", "Easy" scraped correctly |
| 3 | Language | submit body / dropdown | ✅ fixed | 2026-10-12 | GFG label is "C++ (17)"; `normLang` strips the version |
| 3 | Tags | `[class*=topic] a, [class*=tag] a` | ⚠️ partial | 2026-10-12 | Mixes **company** tags (Amazon, Microsoft…) with topics; also matched the problem's own title (now filtered). Need hrefs to split |
| 4 | Contest URL/DOM | `/contest/<name>/` in path | ❌ | | |
| 5 | Profile stats | `GET authapi.geeksforgeeks.org/api-get/user-profile-info/?handle=<h>&article_count=false&redirect=true` | ✅ | 2026-10-12 | Public JSON, no login. `data.{score, monthly_score, total_problems_solved, institute_rank, pod_solved_current_streak, pod_solved_longest_streak}`. Unknown handle → 400 `{"message":"User not found!"}`. The profile HTML (Next.js app router, `self.__next_f`) does **not** contain stats. `utilapi…/api/user/profile/` is session/geo info only |
| 6 | POTD page | same as practice? | ❌ | | |

### Other endpoints seen (not used yet)
- `POST practiceapi.geeksforgeeks.org/api/v1/user/problems/submissions/` body `{"handle":"<h>","requestType":"","year":"","month":""}` → `result.{Easy,Medium,…}.{id}.{slug,pname,lang,user_subtime}`. Public. Candidate for a future "import my past solved problems" feature (metadata only, no code).

## Recon snippet

Paste into the DevTools console on a GFG problem page **before** clicking Submit, then submit an accepted solution. Copy the console output back.

```js
(() => {
  const log = (...a) => console.log('%c[recon]', 'color:#2f8d46;font-weight:bold', ...a);
  const peek = (s) => (typeof s === 'string' ? s.slice(0, 600) : s);
  const of = window.fetch;
  window.fetch = async (...args) => {
    const res = await of(...args);
    const url = args[0] instanceof Request ? args[0].url : String(args[0]);
    if (!/\.(js|css|png|svg|woff2?)(\?|$)|analytics|google|doubleclick/i.test(url)) {
      res.clone().text().then((t) => log('FETCH', args[1]?.method || 'GET', url, res.status,
        '\n  req:', peek(args[1]?.body), '\n  res:', peek(t))).catch(() => {});
    }
    return res;
  };
  const oo = XMLHttpRequest.prototype.open, os = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (m, u, ...r) { this.__r = [m, u]; return oo.call(this, m, u, ...r); };
  XMLHttpRequest.prototype.send = function (b) {
    this.addEventListener('load', () => log('XHR', ...this.__r, this.status, '\n  req:', peek(b), '\n  res:', peek(this.responseText)));
    return os.call(this, b);
  };
  log('editor:', {
    ace: !!document.querySelector('.ace_editor')?.env?.editor,
    monaco: !!window.monaco?.editor?.getModels?.().length,
    codemirror5: !!document.querySelector('.CodeMirror')?.CodeMirror,
    codemirror6: !!document.querySelector('.cm-editor'),
  });
  log('title candidates:', [...document.querySelectorAll('h1,h2,h3')].map((e) => `${e.tagName}.${e.className} => ${e.textContent.trim().slice(0, 60)}`));
  log('difficulty candidates:', [...document.querySelectorAll('[class*="difficulty" i], [class*="Difficulty"]')].map((e) => `${e.className} => ${e.textContent.trim().slice(0, 40)}`));
  log('tag-ish links:', [...document.querySelectorAll('a[href*="tag" i], a[href*="topic" i], a[href*="category" i]')].slice(0, 20).map((a) => `${a.closest('[class]')?.className} => ${a.textContent.trim()} (${a.getAttribute('href')})`));
  log('language controls:', [...document.querySelectorAll('select, [class*="lang" i]')].slice(0, 10).map((e) => `${e.tagName}.${e.className} => ${(e.value || e.textContent).trim().slice(0, 40)}`));
  log('path:', location.pathname);
})();
```

For the profile page (item 5), open `https://www.geeksforgeeks.org/user/<handle>/` and run:

```js
const nd = document.getElementById('__NEXT_DATA__')?.textContent || document.documentElement.outerHTML;
console.log([...nd.matchAll(/"([a-zA-Z_]*(solved|score|rank)[a-zA-Z_]*)"\s*:\s*("?[\w.]+"?)/gi)].map((m) => `${m[1]} = ${m[3]}`).join('\n'));
```
