import * as path from 'node:path';
import { doBaseRangesOverlap, parseUnifiedDiffHunks } from './diffParser';
import { buildCommitUrl, buildFileAtCommitUrl } from './deepLink';
import { GitCli } from './gitCli';
import { GitHubApiClient } from './githubApiClient';
import { parseRemoteRepositoryMetadata } from './remoteMetadata';
import type { ConflictAnalysisResult, DiffHunk, OverlapMatch, UpstreamCommitSummary } from './types';

interface ParsedCommit {
	readonly commitHash: string;
	readonly authorName: string;
	readonly relativeDate: string;
	readonly subject: string;
}

export interface ConflictAnalysisOptions {
	readonly filePath: string;
	readonly documentText?: string;
	readonly remoteName: string;
	readonly branchName: string;
	readonly fetchBeforeScan: boolean;
	readonly githubApiUrl: string;
	/** Map of current-branch glob patterns → upstream branch names. */
	readonly branchMappings: Record<string, string>;
	/**
	 * When `true`, bypass the upstream diff cache and fetch fresh data from the
	 * GitHub API / local git. Set on timer-based refreshes and manual scans.
	 * When `false` (default, used for keystroke/save scans), the cached upstream
	 * diff is reused if HEAD hasn't changed, avoiding an API call per keystroke.
	 */
	readonly forceUpstreamRefresh?: boolean;
}

interface UpstreamCache {
	/** The HEAD SHA that was current when this entry was populated. */
	readonly headSha: string;
	readonly mergeBase: string;
	readonly upstreamHunks: readonly DiffHunk[];
	readonly baseRef: string;
	readonly remoteMetadata: import('./types').RemoteRepositoryMetadata;
	readonly upstreamCommit: UpstreamCommitSummary | undefined;
	readonly fileAtCommitUrl: string | undefined;
	/** Whether this entry was populated via the GitHub API (affects fetched flag). */
	readonly usedGitHubApi: boolean;
}

/**
 * Matches a string against a glob pattern that supports `*` (any chars
 * except `/`) and `**` (any chars including `/`).
 */
export function matchesGlob(pattern: string, value: string): boolean {
	const regexSource = pattern
		.split('**')
		.map(seg => seg.split('*').map(s => s.replace(/[.+^${}()|[\]\\]/gu, '\\$&')).join('[^/]*'))
		.join('.*');
	return new RegExp(`^${regexSource}$`, 'u').test(value);
}

export class ConflictAnalysisService {
	/**
	 * Cache keyed by `repoRoot:relativeFilePath:baseRef`. Invalidated when the
	 * current HEAD SHA changes or `forceUpstreamRefresh` is set.
	 */
	private readonly upstreamCache = new Map<string, UpstreamCache>();

	public constructor(
		private readonly gitCli: GitCli = new GitCli(),
		private readonly getGitHubToken: (() => Promise<string | undefined>) | undefined = undefined,
	) {}

	public async analyzeFile(options: ConflictAnalysisOptions): Promise<ConflictAnalysisResult> {
		const repoRoot = await this.gitCli.findRepoRoot(options.filePath);
		const relativeFilePath = path.relative(repoRoot, options.filePath).split(path.sep).join('/');

		// Guard against path traversal — relative path must not escape the repo root
		if (relativeFilePath.startsWith('..')) {
			throw new Error('File is outside the repository root and cannot be analyzed.');
		}

		// ── Branch resolution (4 layers) ─────────────────────────────────────────
		// 1. Git tracking branch (@{upstream}) — most accurate, covers main/master
		//    automatically per-repo.
		// 2. branchMappings config  (team branching strategies)
		// 3. GitHub API default_branch  (authoritative for the repo)
		// 4. Configured remoteName / branchName  (explicit user setting / fallback)
		let effectiveRemote = options.remoteName;
		let effectiveBranch = options.branchName;
		let branchWasResolved = false;

		const tracking = await this.gitCli.getTrackingBranch(repoRoot);
		if (tracking) {
			effectiveRemote = tracking.remote;
			effectiveBranch = tracking.branch;
			branchWasResolved = true;
		} else {
			const mapped = await this.resolveBranchFromMapping(repoRoot, options.branchMappings);
			if (mapped !== undefined) {
				effectiveBranch = mapped;
				branchWasResolved = true;
			}
			// Layer 3 (API default branch) is applied below once apiClient is available.
		}

		// Resolve remote metadata early so we can decide whether to use GitHub API
		const remoteUrl = await this.gitCli.getRemoteUrl(repoRoot, effectiveRemote);
		const remoteMetadata = parseRemoteRepositoryMetadata(effectiveRemote, remoteUrl);

		const token = await this.getGitHubToken?.();

		if (
			token &&
			remoteMetadata.provider === 'github' &&
			remoteMetadata.owner &&
			remoteMetadata.repository
		) {
			return this.analyzeFileWithGitHubApi(
				options, repoRoot, relativeFilePath, effectiveRemote, effectiveBranch,
				branchWasResolved, remoteMetadata, token,
			);
		}

		return this.analyzeFileWithLocalGit(
			options, repoRoot, relativeFilePath, effectiveRemote, effectiveBranch, remoteMetadata,
		);
	}

	/**
	 * GitHub API path: merge base computed server-side, upstream diff cached per
	 * HEAD SHA so keystroke scans reuse the last fetch rather than hitting the API
	 * every 500 ms.
	 */
	private async analyzeFileWithGitHubApi(
		options: ConflictAnalysisOptions,
		repoRoot: string,
		relativeFilePath: string,
		effectiveRemote: string,
		effectiveBranch: string,
		branchWasResolved: boolean,
		remoteMetadata: import('./types').RemoteRepositoryMetadata,
		token: string,
	): Promise<ConflictAnalysisResult> {
		const apiClient = new GitHubApiClient(token, options.githubApiUrl);

		// Layer 3: if no tracking or mapping resolved the branch yet, ask the API
		// for the repo's actual default branch (handles main vs master automatically).
		if (!branchWasResolved && remoteMetadata.owner && remoteMetadata.repository) {
			try {
				effectiveBranch = await apiClient.getRepoDefaultBranch(
					remoteMetadata.owner,
					remoteMetadata.repository,
				);
			} catch {
				// API unavailable — fall through to configured branch
			}
		}

		const baseRef = `${effectiveRemote}/${effectiveBranch}`;
		const headSha = await this.gitCli.getHeadSha(repoRoot);
		const cacheKey = `${repoRoot}:${relativeFilePath}:${baseRef}`;
		const cached = this.upstreamCache.get(cacheKey);

		let upstream: UpstreamCache;

		if (cached && cached.headSha === headSha && !options.forceUpstreamRefresh) {
			// Cache hit — upstream hasn't changed, skip the API call
			upstream = cached;
		} else {
			// Cache miss or forced refresh — fetch from GitHub API
			const compareResult = await apiClient.compareRefs(
				remoteMetadata.owner!,
				remoteMetadata.repository!,
				headSha,
				effectiveBranch,
				relativeFilePath,
			);

			const upstreamHunks = parseUnifiedDiffHunks(compareResult.filePatch);
			const latestCommitSummary = await this.gitCli.getLatestCommitSummary(
				repoRoot, compareResult.mergeBase, relativeFilePath,
			);
			const parsedCommit = this.parseRawCommit(latestCommitSummary);
			const commitUrl = parsedCommit ? buildCommitUrl(remoteMetadata, parsedCommit.commitHash) : undefined;
			const fileAtCommitUrl = parsedCommit
				? buildFileAtCommitUrl(remoteMetadata, relativeFilePath, parsedCommit.commitHash)
				: undefined;

			let prUrl: string | undefined;
			if (parsedCommit && remoteMetadata.owner && remoteMetadata.repository) {
				try {
					const prs = await apiClient.getAssociatedPullRequests(
						remoteMetadata.owner,
						remoteMetadata.repository,
						parsedCommit.commitHash,
					);
					prUrl = prs.at(0)?.htmlUrl;
				} catch {
					// PR enrichment is optional — silently ignore API errors
				}
			}

			const upstreamCommit: UpstreamCommitSummary | undefined = parsedCommit
				? { ...parsedCommit, commitUrl, prUrl }
				: undefined;

			upstream = {
				headSha,
				mergeBase: compareResult.mergeBase,
				upstreamHunks,
				baseRef,
				remoteMetadata,
				upstreamCommit,
				fileAtCommitUrl,
				usedGitHubApi: true,
			};
			this.upstreamCache.set(cacheKey, upstream);
		}

		// Local diff is always recomputed — it reflects the current buffer state
		const localDiff = options.documentText === undefined
			? await this.gitCli.diffWorkingTreeAgainstRef(repoRoot, upstream.mergeBase, relativeFilePath)
			: await this.gitCli.diffTextAgainstRef(repoRoot, upstream.mergeBase, relativeFilePath, options.documentText);

		const localHunks = parseUnifiedDiffHunks(localDiff);
		const overlaps = this.findOverlaps(localHunks, upstream.upstreamHunks);

		return {
			repoRoot,
			filePath: options.filePath,
			filePathRelativeToRepo: relativeFilePath,
			baseRef: upstream.baseRef,
			mergeBase: upstream.mergeBase,
			localHunks,
			upstreamHunks: upstream.upstreamHunks,
			overlaps,
			remoteMetadata: upstream.remoteMetadata,
			upstreamCommit: upstream.upstreamCommit,
			fileAtCommitUrl: upstream.fileAtCommitUrl,
			fetched: upstream.usedGitHubApi,
		};
	}

	/**
	 * Local git fallback path: used when no GitHub token is available or the remote
	 * is not GitHub. Upstream diff is cached the same way to avoid redundant git
	 * subprocess calls on every keystroke.
	 */
	private async analyzeFileWithLocalGit(
		options: ConflictAnalysisOptions,
		repoRoot: string,
		relativeFilePath: string,
		effectiveRemote: string,
		effectiveBranch: string,
		remoteMetadata: import('./types').RemoteRepositoryMetadata,
	): Promise<ConflictAnalysisResult> {
		const baseRef = `${effectiveRemote}/${effectiveBranch}`;

		if (options.fetchBeforeScan) {
			await this.gitCli.fetchRef(repoRoot, effectiveRemote, effectiveBranch);
		}

		const hasBaseRef = await this.gitCli.verifyRef(repoRoot, baseRef);
		if (!hasBaseRef) {
			throw new Error(
				`Base reference ${baseRef} was not found locally. Sign in to GitHub (Conflict Guard: Sign In to GitHub) for live checks, or enable fetch-before-scan.`,
			);
		}

		const headSha = await this.gitCli.getHeadSha(repoRoot);
		const cacheKey = `${repoRoot}:${relativeFilePath}:${baseRef}`;
		const cached = this.upstreamCache.get(cacheKey);

		let upstream: UpstreamCache;

		if (cached && cached.headSha === headSha && !options.forceUpstreamRefresh && !options.fetchBeforeScan) {
			upstream = cached;
		} else {
			const mergeBase = await this.gitCli.resolveMergeBase(repoRoot, 'HEAD', baseRef);
			const upstreamDiff = await this.gitCli.diffRefs(repoRoot, mergeBase, baseRef, relativeFilePath);
			const upstreamHunks = parseUnifiedDiffHunks(upstreamDiff);

			const latestCommitSummary = await this.gitCli.getLatestCommitSummary(repoRoot, baseRef, relativeFilePath);
			const parsedCommit = this.parseRawCommit(latestCommitSummary);
			const commitUrl = parsedCommit ? buildCommitUrl(remoteMetadata, parsedCommit.commitHash) : undefined;
			const fileAtCommitUrl = parsedCommit
				? buildFileAtCommitUrl(remoteMetadata, relativeFilePath, parsedCommit.commitHash)
				: undefined;
			const upstreamCommit: UpstreamCommitSummary | undefined = parsedCommit
				? { ...parsedCommit, commitUrl, prUrl: undefined }
				: undefined;

			upstream = {
				headSha,
				mergeBase,
				upstreamHunks,
				baseRef,
				remoteMetadata,
				upstreamCommit,
				fileAtCommitUrl,
				usedGitHubApi: false,
			};
			this.upstreamCache.set(cacheKey, upstream);
		}

		const localDiff = options.documentText === undefined
			? await this.gitCli.diffWorkingTreeAgainstRef(repoRoot, upstream.mergeBase, relativeFilePath)
			: await this.gitCli.diffTextAgainstRef(repoRoot, upstream.mergeBase, relativeFilePath, options.documentText);

		const localHunks = parseUnifiedDiffHunks(localDiff);
		const overlaps = this.findOverlaps(localHunks, upstream.upstreamHunks);

		return {
			repoRoot,
			filePath: options.filePath,
			filePathRelativeToRepo: relativeFilePath,
			baseRef: upstream.baseRef,
			mergeBase: upstream.mergeBase,
			localHunks,
			upstreamHunks: upstream.upstreamHunks,
			overlaps,
			remoteMetadata: upstream.remoteMetadata,
			upstreamCommit: upstream.upstreamCommit,
			fileAtCommitUrl: upstream.fileAtCommitUrl,
			fetched: options.fetchBeforeScan,
		};
	}

	/** Fetches raw file content at the given git ref for display in a diff editor. */
	public async getFileAtRef(repoRoot: string, ref: string, relativeFilePath: string): Promise<string> {
		return this.gitCli.getFileContentAtRef(repoRoot, ref, relativeFilePath);
	}

	private async resolveBranchFromMapping(
		repoRoot: string,
		branchMappings: Record<string, string>,
	): Promise<string | undefined> {
		if (Object.keys(branchMappings).length === 0) {
			return undefined;
		}
		try {
			const currentBranch = await this.gitCli.getCurrentBranch(repoRoot);
			for (const [pattern, targetBranch] of Object.entries(branchMappings)) {
				if (matchesGlob(pattern, currentBranch)) {
					return targetBranch;
				}
			}
		} catch {
			// Detached HEAD or other error — skip mapping
		}
		return undefined;
	}

	private findOverlaps(localHunks: readonly DiffHunk[], upstreamHunks: readonly DiffHunk[]): OverlapMatch[] {
		const overlaps: OverlapMatch[] = [];

		for (const local of localHunks) {
			for (const upstream of upstreamHunks) {
				if (!doBaseRangesOverlap(local.baseRange, upstream.baseRange)) {
					continue;
				}

				overlaps.push({
					local,
					upstream,
					reason: this.describeOverlap(local, upstream),
				});
			}
		}

		return overlaps;
	}

	private describeOverlap(local: DiffHunk, upstream: DiffHunk): string {
		if (local.kind === 'insert' && upstream.kind === 'insert') {
			return `Both sides inserted content at ancestor line ${local.baseRange.start}.`;
		}

		if (local.kind === 'delete' || upstream.kind === 'delete') {
			return `One side deleted lines touched by the other around ancestor line ${Math.max(local.baseRange.start, upstream.baseRange.start)}.`;
		}

		return `Both sides modified overlapping ancestor lines near ${Math.max(local.baseRange.start, upstream.baseRange.start)}.`;
	}

	private parseRawCommit(summary: string | undefined): ParsedCommit | undefined {
		if (!summary) {
			return undefined;
		}

		const [commitHash, authorName, relativeDate, subject] = summary.split('\t');
		if (!commitHash || !authorName || !relativeDate || !subject) {
			return undefined;
		}

		return {
			commitHash,
			authorName,
			relativeDate,
			subject,
		};
	}
}
