# Conflict Guard

Conflict Guard is a VS Code extension that aims to warn you before local edits drift into an upstream merge conflict. The finished product will periodically compare local work against a configured base branch, score risky overlaps, and surface conflict risk directly in the editor.

## Current status

The workspace is scaffolded and ready for feature development. The Git analysis engine, diagnostics, decorations, and remote host metadata integration are the next implementation steps.

## Planned capabilities

- Periodic upstream refresh against a configurable base branch
- Line-level and hunk-level overlap detection for active files
- Editor commands to scan the current file and refresh analysis
- Visual decorations and diagnostics for elevated conflict risk
- Commit and author context for upstream edits

## Current command behavior

- `Conflict Guard: Scan Current File for Conflict Risk` compares the active file against the merge base shared by `HEAD` and the configured upstream reference.
- `Conflict Guard: Refresh Conflict Analysis` fetches the configured upstream branch and reruns the same base analysis.
- Scan details are written to the `Conflict Guard` output channel.
- Visible editors are rescanned automatically after edits and on a scheduled refresh interval.
- Risky ranges surface as diagnostics, full-line highlights, and a status bar warning on the active editor.
- Remote host metadata and the latest upstream file commit are included in warnings when they can be resolved from Git.

## Extension settings

The scaffold currently contributes these settings:

- `conflictGuard.defaultBaseBranch`: Base branch used for upstream comparisons. Default: `master`
- `conflictGuard.defaultRemote`: Remote name used for upstream comparisons. Default: `origin`
- `conflictGuard.fetchIntervalMinutes`: Refresh interval for upstream metadata. Default: `5`
- `conflictGuard.autoScan`: Continuously analyze visible editors and background refreshes. Default: `true`
- `conflictGuard.fetchBeforeScan`: Fetch the configured upstream branch before a manual scan. Default: `false`
- `conflictGuard.enableDecorations`: Enables editor decorations for risky ranges. Default: `true`

## Development

- `npm run compile`: Type-check, lint, and bundle the extension
- `npm run watch`: Run the type-check and esbuild watchers
- `npm test`: Run the VS Code extension test suite

## Packaging

The project is scaffolded for VS Code Marketplace packaging with esbuild bundling and `.vscodeignore` support. Before publishing, replace the temporary `publisher` value in `package.json` with your Marketplace publisher ID.

- `npm run package:vsix`: Build a distributable `.vsix` package
- `npm run verify`: Run tests and produce the `.vsix` package in one pass

## Known gaps

- Remote provider-specific deep links are not implemented yet
