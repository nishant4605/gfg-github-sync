# Privacy Policy: GFG GitHub Sync

_Last updated: 2026-10-11_

GFG GitHub Sync is a free, open-source browser extension. It has no servers, no analytics, and no tracking.

## What the extension stores
Everything is stored only in your browser via `chrome.storage.local`:
- Your GitHub access token (from "Connect GitHub", or a personal access token you paste), repository name, branch and commit message template
- Your GeeksforGeeks username (optional)
- A small retry queue of submissions that failed to upload, plus the last sync status and cached GFG stats

## Where data goes
- **GitHub (`api.github.com`)**: your accepted solution code, the problem's title, difficulty, tags and link are committed to **the repository you configure**, using your token. The token is sent only to `api.github.com`.
- **GeeksforGeeks (`geeksforgeeks.org`)**: the extension reads the problem page you are on and, if you set a username, your public profile page to read your score, rank and solved count.

Nothing is sent to the developer or to any third party. The extension never logs your token.

## Permissions
| Permission | Why |
|---|---|
| `storage` | Save your settings and the retry queue locally |
| `alarms` | Retry failed uploads every 5 minutes |
| `https://*.geeksforgeeks.org/*` | Detect accepted submissions and read problem details |
| `https://api.github.com/*` | Commit solutions to your repository |
| `https://github.com/login/*` | "Connect GitHub" sign-in (OAuth device flow) |

## Removing your data
Uninstalling the extension deletes all locally stored data. To revoke access, click Disconnect in the popup and remove "GFG GitHub Sync" at <https://github.com/settings/applications> (or delete your personal access token at <https://github.com/settings/tokens>). Files already committed to your repository stay there until you delete them.

## Contact
Open an issue at <https://github.com/nishant4605/gfg-github-sync/issues>.
