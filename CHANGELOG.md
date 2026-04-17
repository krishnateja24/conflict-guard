# Change Log

All notable changes to Conflict Guard are documented in this file.
This project adheres to [Keep a Changelog](https://keepachangelog.com/en/1.0.0/) and [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0] - 2026-04-17

### Added

- **View upstream changes (diff)** — new `Conflict Guard: View Upstream Changes (Diff)` command opens a side-by-side diff editor showing the merge base version ↔ the upstream branch version of the current file, so you can see exactly what changed upstream before deciding how to resolve it.
- **Code actions on conflict lines** — a lightbulb appears on every highlighted conflict line with two quick actions: **View upstream changes** and **Ignore conflict warnings for this file**. No need to go to the Command Palette.
- **Ignore file** — new `Conflict Guard: Ignore Conflict Warnings for This File` command (also accessible as a code action) adds the file to `conflictGuard.ignoredFiles` in workspace settings and immediately clears all decorations and diagnostics for it.
- **`conflictGuard.ignoredFiles` setting** — array of workspace-relative paths or glob patterns to exclude from conflict analysis entirely.
- **`ConflictRefContentProvider`** — internal virtual document provider (`conflict-guard-ref://`) that serves file content at a specific git ref to the VS Code diff editor.
- **`mocha` types** — added `"mocha"` to `tsconfig.json` `types` array so test files type-check cleanly without installing additional packages.

### Changed

- Ignored files are skipped before analysis begins, so no git processes are spawned for them.
- `getFileAtRef` public method added to `ConflictAnalysisService` for use by the diff viewer.

### Added

- **Smart branch auto-detection** — resolves the upstream branch in priority order: Git tracking branch (`@{upstream}`), branch mapping rules, GitHub API `default_branch`, configured fallback. No more hardcoded `master`.
- **`conflictGuard.branchMappings` setting** — map branch glob patterns (supports `*` and `**`) to upstream branches, e.g. `{ "feature/*": "develop", "hotfix/*": "main" }`.
- **Upstream diff caching** — upstream hunks are cached per file and HEAD SHA. Keystroke and save scans reuse the cache; only one cheap local `git diff` runs per edit. Network calls reserved for timer-based and manual refreshes.
- **`forceUpstreamRefresh` option** — background timer and manual Refresh command bypass the cache to pick up new upstream commits.
- **`getRepoDefaultBranch` GitHub API method** — queries `GET /repos/{owner}/{repo}` to detect whether a repo uses `main`, `master`, or any other default branch name automatically.
- **`getTrackingBranch` git method** — reads `@{upstream}` to resolve the exact remote and branch the current HEAD is tracking.
- **Per-workspace-folder settings scope** — configuration is now resolved relative to each file's workspace folder, so multi-root workspaces can use different remotes and branches per repo.
- **Extension icon** — 128×128 PNG icon matching the extension's brand orange colour.
- **PAT commands** — `Set GitHub Personal Access Token` and `Clear GitHub Personal Access Token` for environments where OAuth is not available.

### Changed

- `conflictGuard.defaultBaseBranch` default changed from `master` to `main`.
- `getConfiguration()` now accepts a resource URI for workspace-folder-scoped settings resolution.
- `analyzeFile` refactored into `analyzeFileWithGitHubApi` and `analyzeFileWithLocalGit` for clarity.
- `.vscodeignore` updated to exclude `.github/` and `generate-icon.js` from the packaged VSIX.
- `tsconfig.json` — added `"types": ["node"]` to resolve Node built-in type definitions correctly.

## [0.0.1] - 2026-03-30

### Added

- Git merge-base overlap analysis with line-level conflict hunk detection
- Automatic scanning of visible editors with debounce on document changes
- Scheduled background refresh with configurable interval (1–60 minutes)
- Editor line decorations and Problems panel diagnostics for conflict-risk ranges
- Status bar item showing conflict count for the active file
- GitHub API integration — merge-base computation is done server-side when signed in (no local `git fetch` required)
- Remote URL parsing for GitHub, GitLab, Bitbucket, and Azure DevOps (SSH and HTTPS)
- Upstream commit context in conflict warnings: author, relative date, subject, commit URL, and associated PR link
- Commands: Scan Current File, Refresh Analysis, Sign in to GitHub, Sign out of GitHub
- Settings: `defaultBaseBranch`, `defaultRemote`, `fetchIntervalMinutes`, `autoScan`, `fetchBeforeScan`, `enableDecorations`