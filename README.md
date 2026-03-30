# Conflict Guard

Conflict Guard is a VS Code extension that warns you **before** your local edits drift into a merge conflict. It continuously compares your working changes against a configured upstream branch, detects overlapping hunks, and surfaces conflict risk directly in the editor — without requiring a merge attempt.

## Features

- **Live conflict detection** — visible editors are scanned automatically on every save and on a configurable refresh interval
- **GitHub API mode** — when signed in, merge-base computation is done server-side; no `git fetch` required
- **Line-level diagnostics and decorations** — risky ranges appear as Problems panel entries and full-line editor highlights
- **Status bar indicator** — shows conflict count for the active file at a glance
- **Upstream commit context** — warnings include the author, date, subject, commit URL, and any associated pull request link
- **Multi-provider support** — remote URL parsing for GitHub, GitLab, Bitbucket, and Azure DevOps

## Commands

| Command | Description |
|---|---|
| `Conflict Guard: Scan Current File for Conflict Risk` | Compares the active file against the upstream merge base |
| `Conflict Guard: Refresh Conflict Analysis` | Fetches the upstream branch and reruns the analysis |
| `Conflict Guard: Sign in to GitHub` | Enables GitHub API mode for network-free merge-base lookups |
| `Conflict Guard: Sign out of GitHub` | Revokes the active GitHub session |

## Settings

| Setting | Default | Description |
|---|---|---|
| `conflictGuard.defaultBaseBranch` | `master` | Upstream branch used for conflict comparisons |
| `conflictGuard.defaultRemote` | `origin` | Remote name for the upstream branch reference |
| `conflictGuard.fetchIntervalMinutes` | `5` | Background refresh interval (1–60 minutes) |
| `conflictGuard.autoScan` | `true` | Continuously analyze visible editors in the background |
| `conflictGuard.fetchBeforeScan` | `false` | Fetch the upstream branch before a manual scan |
| `conflictGuard.enableDecorations` | `true` | Show editor line decorations for risky ranges |

## Requirements

- VS Code 1.110 or later
- Git installed and available on `PATH`
- A Git repository open in the workspace

## How it works

1. On activation and on each edit, Conflict Guard resolves the merge base between `HEAD` and the configured upstream branch.
2. It diffs both `HEAD → upstream` and `working tree → merge base` to obtain change hunks for the current file.
3. Hunks that overlap on the shared ancestor are flagged as conflict risks and shown as diagnostics and decorations.
4. When signed in to GitHub, step 1–2 use the GitHub Repos API — no local fetch is needed.

## Development

```bash
npm run compile      # type-check, lint, and bundle
npm run watch        # incremental type-check + esbuild watchers
npm test             # run the VS Code extension test suite
```

## Packaging

```bash
npm run package:vsix  # build a distributable .vsix package
npm run verify        # run tests and produce the .vsix in one pass
```
