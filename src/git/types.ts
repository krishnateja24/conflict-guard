export type GitChangeKind = 'insert' | 'delete' | 'modify';

export interface GitChangeRange {
	readonly start: number;
	readonly count: number;
}

export interface DiffHunk {
	readonly kind: GitChangeKind;
	readonly baseRange: GitChangeRange;
	readonly currentRange: GitChangeRange;
	readonly header: string;
}

export interface OverlapMatch {
	readonly local: DiffHunk;
	readonly upstream: DiffHunk;
	readonly reason: string;
}

export interface RemoteRepositoryMetadata {
	readonly remoteName: string;
	readonly provider: 'github' | 'gitlab' | 'bitbucket' | 'azure-devops' | 'unknown';
	readonly owner: string | undefined;
	readonly repository: string | undefined;
	readonly normalizedUrl: string;
}

export interface UpstreamCommitSummary {
	readonly commitHash: string;
	readonly authorName: string;
	readonly relativeDate: string;
	readonly subject: string;
	readonly commitUrl: string | undefined;
	readonly prUrl: string | undefined;
}

export interface ConflictAnalysisResult {
	readonly repoRoot: string;
	readonly filePath: string;
	readonly filePathRelativeToRepo: string;
	readonly baseRef: string;
	readonly mergeBase: string;
	readonly localHunks: readonly DiffHunk[];
	readonly upstreamHunks: readonly DiffHunk[];
	readonly overlaps: readonly OverlapMatch[];
	readonly remoteMetadata: RemoteRepositoryMetadata | undefined;
	readonly upstreamCommit: UpstreamCommitSummary | undefined;
	readonly fileAtCommitUrl: string | undefined;
	readonly fetched: boolean;
}
