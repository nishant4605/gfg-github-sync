# GFG selectors & endpoints: verification log

Everything GFG-specific lives in these config blocks (marked `GFG CONFIG`):
- `inject.js` → `CONFIG` (submit URL regex, success regex)
- `content.js` → `SEL`, `DIFF_RE`, `DIFF_TEXT_RE`
- `lib/util.js` → `GFG_PROFILE_URL`, `STATS_PATTERNS`

## Status

| # | Item | Current guess | Verified? | Date | Notes |
|---|---|---|---|---|---|
| 1 | Submit endpoint URL | `/submit\|submission/i` | ❌ | | |
| 1 | Accepted-response marker | `/problem solved successfully/i` in body | ❌ | | |
| 2 | Editor | Ace → Monaco → CodeMirror | ❌ | | |
| 3 | Title selector | `h1, h3[class*=problem], [class*=problems_header_content__title]` | ❌ | | |
| 3 | Difficulty selector | `[class*=difficulty]` + regex | ❌ | | |
| 3 | Tags selector | `[class*=topic] a, [class*=tag] a` | ❌ | | |
| 3 | Language source | submit body `language/lang/langId`, else dropdown | ❌ | | |
| 4 | Contest URL/DOM | `/contest/<name>/` in path | ❌ | | |
| 5 | Profile stats keys | `total_problems_solved`, `score`, `institute_rank` | ❌ | | |
| 6 | POTD page | same as practice? | ❌ | | |

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
