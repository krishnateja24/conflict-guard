import * as https from 'node:https';

export interface GitHubPullRequest {
	readonly htmlUrl: string;
	readonly number: number;
	readonly title: string;
	readonly state: string;
}

interface RawPullRequest {
	html_url: string;
	number: number;
	title: string;
	state: string;
}

interface RawCompareFile {
	filename: string;
	patch?: string;
}

interface RawCompareResponse {
	merge_base_commit: { sha: string };
	files?: RawCompareFile[];
}

export interface CompareResult {
	readonly mergeBase: string;
	readonly filePatch: string;
}

const MAX_RESPONSE_BYTES = 10 * 1024 * 1024; // 10 MB — prevents unbounded memory growth
const REQUEST_TIMEOUT_MS = 15_000;

export class GitHubApiClient {
	private readonly hostname: string;
	private readonly port: number;
	private readonly basePath: string;

	public constructor(private readonly token: string, apiBaseUrl = 'https://api.github.com') {
		try {
			const parsed = new URL(apiBaseUrl);
			this.hostname = parsed.hostname;
			this.port = parsed.port ? Number.parseInt(parsed.port, 10) : 443;
			this.basePath = parsed.pathname.replace(/\/$/u, '');
		} catch {
			throw new Error(`conflictGuard.githubApiUrl is not a valid URL: "${apiBaseUrl}"`);
		}
	}

	/**
	 * Returns open pull requests associated with the given commit SHA.
	 * Silently returns an empty array on API errors.
	 */
	public async getAssociatedPullRequests(owner: string, repo: string, commitSha: string): Promise<GitHubPullRequest[]> {
		const data = await this.request<RawPullRequest[]>(
			`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/commits/${encodeURIComponent(commitSha)}/pulls`,
		);

		return data.map(pr => ({
			htmlUrl: pr.html_url,
			number: pr.number,
			title: pr.title,
			state: pr.state,
		}));
	}

	/**
	 * Compares base...head on GitHub and returns the merge base SHA and the
	 * unified-diff patch for the given file. Uses GitHub's three-dot compare so
	 * the merge base is computed server-side — no local `git fetch` required.
	 */
	public async compareRefs(
		owner: string,
		repo: string,
		base: string,
		head: string,
		filePath: string,
	): Promise<CompareResult> {
		const data = await this.request<RawCompareResponse>(
			`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/compare/${encodeURIComponent(base)}...${encodeURIComponent(head)}`,
		);

		const file = data.files?.find(f => f.filename === filePath);
		return {
			mergeBase: data.merge_base_commit.sha,
			filePatch: file?.patch ?? '',
		};
	}

	private request<T>(apiPath: string): Promise<T> {
		return new Promise((resolve, reject) => {
			const req = https.get(
				{
					hostname: this.hostname,
					port: this.port,
					path: this.basePath + apiPath,
					headers: {
						'Accept': 'application/vnd.github+json',
						'Authorization': `Bearer ${this.token}`,
						'User-Agent': 'conflict-guard-vscode',
						'X-GitHub-Api-Version': '2022-11-28',
					},
				},
				res => {
					let body = '';
					let bytesReceived = 0;

					res.on('data', (chunk: Buffer) => {
						bytesReceived += chunk.length;
						if (bytesReceived > MAX_RESPONSE_BYTES) {
							req.destroy(new Error('GitHub API response exceeded size limit'));
							return;
						}
						body += chunk.toString();
					});
					res.on('end', () => {
						if (res.statusCode !== undefined && res.statusCode >= 400) {
							// Truncate body to avoid leaking large/sensitive API error payloads
							const preview = body.slice(0, 200);
							reject(new Error(`GitHub API ${res.statusCode}: ${preview}`));
							return;
						}

						try {
							resolve(JSON.parse(body) as T);
						} catch (parseError) {
							reject(parseError);
						}
					});
				},
			);

			req.setTimeout(REQUEST_TIMEOUT_MS, () => {
				req.destroy(new Error(`GitHub API request timed out after ${REQUEST_TIMEOUT_MS}ms`));
			});

			req.on('error', reject);
		});
	}
}
