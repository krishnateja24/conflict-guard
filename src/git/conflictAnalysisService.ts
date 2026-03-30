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
}

export class ConflictAnalysisService {
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

		const baseRef = `${options.remoteName}/${options.branchName}`;

		// Resolve remote metadata early so we can decide whether to use GitHub API
		const remoteUrl = await this.gitCli.getRemoteUrl(repoRoot, options.remoteName);
		const remoteMetadata = parseRemoteRepositoryMetadata(options.remoteName, remoteUrl);

		let mergeBase: string;
		let upstreamDiff: string;
		let usedGitHubApi = false;
		let apiClient: GitHubApiClient | undefined;

		const token = await this.getGitHubToken?.();

		if (
			token &&
			remoteMetadata.provider === 'github' &&
			remoteMetadata.owner &&
			remoteMetadata.repository
		) {
			// Use GitHub API: no local fetch required — merge base is computed server-side
			apiClient = new GitHubApiClient(token, options.githubApiUrl);
			const headSha = await this.gitCli.getHeadSha(repoRoot);
			const compareResult = await apiClient.compareRefs(
				remoteMetadata.owner,
				remoteMetadata.repository,
				headSha,
				options.branchName,
				relativeFilePath,
			);
			mergeBase = compareResult.mergeBase;
			upstreamDiff = compareResult.filePatch;
			usedGitHubApi = true;
		} else {
			// Fall back to local git — requires origin/branch to be fetched locally
			if (options.fetchBeforeScan) {
				await this.gitCli.fetchRef(repoRoot, options.remoteName, options.branchName);
			}

			const hasBaseRef = await this.gitCli.verifyRef(repoRoot, baseRef);
			if (!hasBaseRef) {
				throw new Error(
					`Base reference ${baseRef} was not found locally. Sign in to GitHub (Conflict Guard: Sign In to GitHub) for live checks, or enable fetch-before-scan.`,
				);
			}

			mergeBase = await this.gitCli.resolveMergeBase(repoRoot, 'HEAD', baseRef);
			upstreamDiff = await this.gitCli.diffRefs(repoRoot, mergeBase, baseRef, relativeFilePath);
		}

		const localDiff = options.documentText === undefined
			? await this.gitCli.diffWorkingTreeAgainstRef(repoRoot, mergeBase, relativeFilePath)
			: await this.gitCli.diffTextAgainstRef(repoRoot, mergeBase, relativeFilePath, options.documentText);
		const latestCommitSummary = await this.gitCli.getLatestCommitSummary(repoRoot, usedGitHubApi ? mergeBase : baseRef, relativeFilePath);

		const localHunks = parseUnifiedDiffHunks(localDiff);
		const upstreamHunks = parseUnifiedDiffHunks(upstreamDiff);
		const overlaps = this.findOverlaps(localHunks, upstreamHunks);

		const parsedCommit = this.parseRawCommit(latestCommitSummary);
		const commitUrl = parsedCommit ? buildCommitUrl(remoteMetadata, parsedCommit.commitHash) : undefined;
		const fileAtCommitUrl = parsedCommit ? buildFileAtCommitUrl(remoteMetadata, relativeFilePath, parsedCommit.commitHash) : undefined;

		let prUrl: string | undefined;
		if (parsedCommit && apiClient && remoteMetadata.owner && remoteMetadata.repository) {
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

		return {
			repoRoot,
			filePath: options.filePath,
			filePathRelativeToRepo: relativeFilePath,
			baseRef,
			mergeBase,
			localHunks,
			upstreamHunks,
			overlaps,
			remoteMetadata,
			upstreamCommit,
			fileAtCommitUrl,
			fetched: usedGitHubApi || options.fetchBeforeScan,
		};
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
