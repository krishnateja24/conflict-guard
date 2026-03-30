import * as vscode from 'vscode';

const GITHUB_AUTH_PROVIDER_ID = 'github';
const SCOPES = ['repo'];
const PAT_SECRET_KEY = 'conflictGuard.githubPat';

export class GitHubAuthService {
	public constructor(private readonly context: vscode.ExtensionContext) {}

	/**
	 * Returns a GitHub token, preferring a stored fine-grained PAT over the
	 * VS Code OAuth session. The PAT path lets enterprise users supply a token
	 * with only `contents: read` permission instead of the broad `repo` scope.
	 */
	public async getToken(createIfNone = false): Promise<string | undefined> {
		const pat = await this.context.secrets.get(PAT_SECRET_KEY);
		if (pat) {
			return pat;
		}

		try {
			const session = await vscode.authentication.getSession(
				GITHUB_AUTH_PROVIDER_ID,
				SCOPES,
				{ createIfNone },
			);

			return session?.accessToken;
		} catch {
			return undefined;
		}
	}

	public async signIn(): Promise<boolean> {
		const token = await this.getToken(true);
		return token !== undefined;
	}

	public async isSignedIn(): Promise<boolean> {
		const token = await this.getToken(false);
		return token !== undefined;
	}

	public async storePersonalAccessToken(token: string): Promise<void> {
		await this.context.secrets.store(PAT_SECRET_KEY, token);
	}

	public async clearPersonalAccessToken(): Promise<void> {
		await this.context.secrets.delete(PAT_SECRET_KEY);
	}
}
