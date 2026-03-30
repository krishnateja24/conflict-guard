import * as vscode from 'vscode';

const GITHUB_AUTH_PROVIDER_ID = 'github';
const SCOPES = ['repo'];

export class GitHubAuthService {
	/**
	 * Returns the current GitHub OAuth token without prompting the user.
	 * Returns undefined if the user has not yet signed in.
	 */
	public async getToken(createIfNone = false): Promise<string | undefined> {
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

	/**
	 * Prompts the user to sign in with GitHub if not already signed in.
	 * Returns true if a valid session was obtained.
	 */
	public async signIn(): Promise<boolean> {
		const token = await this.getToken(true);
		return token !== undefined;
	}

	public async isSignedIn(): Promise<boolean> {
		const token = await this.getToken(false);
		return token !== undefined;
	}
}
