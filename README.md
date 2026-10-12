# GFG GitHub Sync

Free, open-source Chrome extension (Manifest V3) that commits your accepted GeeksforGeeks solutions to a GitHub repo, organized by difficulty/contest, and keeps a stats README (solved count, difficulty split, streak, rank, score) up to date. Like LeetHub, but for GFG.

No servers, no analytics. See [PRIVACY.md](PRIVACY.md). Found a bug or GFG changed its site? [Open an issue](https://github.com/nishant4605/gfg-github-sync/issues).

## Setup
1. Install the extension (for now: `chrome://extensions` → **Developer mode** → **Load unpacked** → this folder).
2. Create a GitHub repo for your solutions (tick "Add a README" so the branch exists).
3. Click the extension icon → **Connect GitHub** → **Copy code & open GitHub** → paste the code → **Authorize**.
4. Paste the repo URL and your GFG username → **Save** → **Test connection**.
5. Solve a problem on GFG. The badge turns green ✓ and a commit appears.

Prefer not to use OAuth? Open **Advanced** in the popup and paste a [fine-grained token](https://github.com/settings/personal-access-tokens/new) (that repo only, **Contents: Read and write**).

### Maintainers: OAuth App registration (one time)
[New OAuth App](https://github.com/settings/applications/new): name `GFG GitHub Sync`, homepage = this repo, callback URL = this repo (unused by device flow), tick **Enable Device Flow**. Put the **Client ID** (not a secret) in `lib/auth.js` → `GITHUB_CLIENT_ID`. Never create or commit a client secret; device flow doesn't need one.

## What gets committed
```
README.md                          # stats, badges, tables
problems.json                      # index (source of truth)
Problems/<Difficulty>/<slug>/solution.<ext> + README.md
Contests/<contest>/<slug>/solution.<ext> + README.md
```
The same language overwrites the file (git keeps history). A new language adds a file. Identical code makes no commit.

## Development
```
npm test        # node --test, no dependencies (Node 20+)
```
- `inject.js`: page world. Hooks fetch/XHR, watches the DOM, reads the editor.
- `content.js`: isolated world. Scrapes metadata and forwards it to the worker.
- `background.js`: service worker. Serialized GitHub sync, retry queue, stats.
- `lib/sync.js`: pure index/path logic. `lib/readme.js` generates the READMEs. `lib/github.js` wraps the Contents API. `lib/util.js` has helpers and GFG stats.

After editing, click ↻ on the extension in `chrome://extensions` **and refresh the GFG tab**.

## If nothing syncs
GFG changes its site. Every guess lives in one marked `GFG CONFIG` block. See [docs/gfg-selectors.md](docs/gfg-selectors.md) for the list and a DevTools recon snippet.
- Service worker logs: `chrome://extensions` → GFG GitHub Sync → "service worker" link.
- Page logs: DevTools console on the GFG tab, filter `[GFG Sync]`.

## Manual test checklist
- [ ] Load unpacked; no errors on `chrome://extensions`
- [ ] Popup: paste `https://github.com/me/repo.git` as the repo, Save, and it normalizes to `me/repo`
- [ ] Test connection: bad token → "Invalid token"; wrong repo → "Repo not found"; correct → "Connected to …"
- [ ] Solve an Easy practice problem: a commit appears within seconds at `Problems/Easy/<slug>/solution.<ext>`
- [ ] Per-problem README shows difficulty, languages, dates, topics and link
- [ ] Root README shows Solved/Streak badges and the problem in the table; `problems.json` has the entry
- [ ] Resubmit identical code: no new commit for the solution (only README if the date changed)
- [ ] Submit the same problem in another language: a new `solution.<ext>` appears and Languages lists both
- [ ] DevTools → Network → Offline, submit → badge `!` and popup shows "Retry queue (1)"
- [ ] Back online → wait ≤5 min or click Retry: the queue drains and the commit appears
- [ ] Contest problem → `Contests/<contest>/<slug>/`, and the root README has a Contests table
- [ ] Refresh GFG stats → Score/Rank badges and rows appear
- [ ] Disable toggle → submit → nothing is committed
