# Conflict Guard

**Catch merge conflicts before they happen.** Conflict Guard continuously compares your local edits against an upstream Git branch and highlights lines at risk — directly in the editor, as you type.

No merge required. No manual commands. Just open a file and start coding.

![Status bar showing conflict risk count](https://raw.githubusercontent.com/krishnateja24/conflict-guard/main/images/statusbar.png)

## Features

- **Real-time conflict detection** — scans on every keystroke (debounced 500 ms) and on save
- **Smart branch detection** — automatically resolves the upstream branch from your Git tracking config (`@{upstream}`), branch mapping rules, the GitHub API, or your settings — in that order
- **GitHub API mode** — when signed in, the merge base is computed server-side; no `git fetch` ever needed
- **Upstream diff caching** — the expensive upstream fetch is cached per file and HEAD SHA; only the cheap local diff runs on each keystroke
- **Line-level diagnostics and decorations** — risky lines appear in the Problems panel and as full-line orange highlights in the editor
- **Status bar indicator** — shows live conflict count for the active file
- **Upstream commit context** — hover cards show the conflicting commit's author, date, subject, commit URL, and associated PR link
- **Multi-provider support** — works with GitHub, GitLab, Bitbucket, and Azure DevOps remotes (SSH and HTTPS)
- **GitHub Enterprise Server** — configurable API base URL

## Quick Start

1. Install the extension
2. Open any Git repository
3. Click **Sign In** on the first-time prompt (or via Command Palette → `Conflict Guard: Sign in to GitHub`)
4. Start editing — conflict risks are highlighted automatically

> **Without signing in:** the extension falls back to local git. It requires `origin/main` (or your configured branch) to be fetched locally.

## Commands

| Command | Description |
|---|---|
| `Conflict Guard: Scan Current File for Conflict Risk` | Manually scan the active file |
| `Conflict Guard: Refresh Conflict Analysis` | Force-fetch upstream and rescan |
| `Conflict Guard: Sign in to GitHub` | Enable GitHub API mode (no local fetch needed) |
| `Conflict Guard: Sign out of GitHub` | Remove the active GitHub session |
| `Conflict Guard: Set GitHub Personal Access Token` | Use a PAT instead of OAuth |
| `Conflict Guard: Clear GitHub Personal Access Token` | Remove a stored PAT |

## Settings

| Setting | Default | Description |
|---|---|---|
| `conflictGuard.defaultBaseBranch` | `main` | Fallback upstream branch when no Git tracking branch is configured |
| `conflictGuard.defaultRemote` | `origin` | Remote name for the upstream branch reference |
| `conflictGuard.branchMappings` | `{}` | Map branch glob patterns to upstream branches, e.g. `{ "feature/*": "develop" }` |
| `conflictGuard.fetchIntervalMinutes` | `5` | Background upstream refresh interval in minutes (1–60) |
| `conflictGuard.autoScan` | `true` | Enable background periodic refresh |
| `conflictGuard.fetchBeforeScan` | `false` | Run `git fetch` before each manual scan |
| `conflictGuard.enableDecorations` | `true` | Show orange line decorations for risky ranges |
| `conflictGuard.githubApiUrl` | `https://api.github.com` | GitHub API base URL (change for GitHub Enterprise Server) |

## How It Works

1. **Branch resolution** — resolves the upstream target in priority order: Git tracking branch → branch mapping rules → GitHub API default branch → configured fallback
2. **Upstream diff (cached)** — fetches the diff between the merge base and the upstream branch once per HEAD SHA; reused on subsequent keystrokes until you commit or force-refresh
3. **Local diff (live)** — diffs your current buffer (including unsaved changes) against the merge base on every edit
4. **Overlap detection** — cross-checks local and upstream hunk ranges against the shared ancestor; overlapping ranges are flagged as conflict risks

## Requirements

- VS Code 1.110 or later
- Git installed and available on `PATH`
- A Git repository open in the workspace

## Development

```bash
npm install
npm run compile      # type-check, lint, and bundle
npm run watch        # incremental type-check + esbuild watchers
npm test             # run the VS Code extension test suite
```

## Packaging

```bash
npm run package:vsix  # build a distributable .vsix
npm run verify        # run tests and build .vsix in one pass
```
