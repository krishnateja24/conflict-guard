# Conflict Guard — Copilot Instructions

## Project

VS Code extension (TypeScript + esbuild) that detects merge conflict risk between local edits and an upstream Git branch.

## Key conventions

- All source files live under `src/`. The entry point is `src/extension.ts`.
- Git operations go through `GitCli` (`src/git/gitCli.ts`). Never shell out to git outside that class.
- GitHub API calls go through `GitHubApiClient` (`src/git/githubApiClient.ts`) using the Node.js built-in `https` module — no external HTTP libraries.
- UI concerns (decorations, diagnostics, status bar, commands) belong in `src/ui/analysisController.ts`.
- Auth is handled exclusively via the VS Code built-in GitHub auth provider in `src/auth/githubAuthService.ts`.
- Compile with `npm run compile`; package with `npm run package:vsix`.
- Run tests with `npm test`.
- The publisher ID is `krishnateja24`. Do not change it.
