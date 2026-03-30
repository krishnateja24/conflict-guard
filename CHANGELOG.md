# Change Log

All notable changes to Conflict Guard are documented in this file.
This project adheres to [Keep a Changelog](https://keepachangelog.com/en/1.0.0/) and [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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