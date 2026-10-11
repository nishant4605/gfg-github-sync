# GFG GitHub Sync

Chrome extension (Manifest V3) that commits your accepted GeeksforGeeks solutions to a GitHub repo and keeps a stats README updated.

## Load in Chrome
1. `chrome://extensions` -> enable Developer mode -> Load unpacked -> pick this folder.
2. Create an empty GitHub repo, then a fine-grained token (Contents: Read and write on that repo only).
3. Open the extension popup, fill token + repo + GFG username, click Test connection.
4. Solve a problem on GFG; check the browser console for `[GFG Sync] Submission detected`.

## If nothing syncs
GFG may have changed its site. Fix these in one place each:
- `inject.js` CONFIG: success text and submit URL regex
- `content.js` SEL: title / difficulty / tags / language selectors
- `lib/util.js` STATS_PATTERNS: rank/score patterns
