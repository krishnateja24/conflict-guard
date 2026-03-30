import type { RemoteRepositoryMetadata } from './types';

function normalizeRemoteUrl(remoteUrl: string): string {
	const trimmed = remoteUrl.trim();
	if (trimmed.startsWith('git@')) {
		const withoutPrefix = trimmed.slice('git@'.length);
		const separatorIndex = withoutPrefix.indexOf(':');
		if (separatorIndex >= 0) {
			const host = withoutPrefix.slice(0, separatorIndex);
			const repoPath = withoutPrefix.slice(separatorIndex + 1).replace(/\.git$/u, '');
			return `https://${host}/${repoPath}`;
		}
	}

	return trimmed.replace(/\.git$/u, '');
}

function parseProvider(hostname: string): RemoteRepositoryMetadata['provider'] {
	if (hostname.includes('github.')) {
		return 'github';
	}

	if (hostname.includes('gitlab.')) {
		return 'gitlab';
	}

	if (hostname.includes('bitbucket.')) {
		return 'bitbucket';
	}

	if (hostname.includes('dev.azure.')) {
		return 'azure-devops';
	}

	return 'unknown';
}

export function parseRemoteRepositoryMetadata(remoteName: string, remoteUrl: string): RemoteRepositoryMetadata {
	const normalizedUrl = normalizeRemoteUrl(remoteUrl);

	try {
		const parsedUrl = new URL(normalizedUrl);
		const segments = parsedUrl.pathname.split('/').filter(Boolean);
		return {
			remoteName,
			provider: parseProvider(parsedUrl.hostname),
			owner: segments.at(0),
			repository: segments.at(1),
			normalizedUrl,
		};
	} catch {
		return {
			remoteName,
			provider: 'unknown',
			owner: undefined,
			repository: undefined,
			normalizedUrl,
		};
	}
}
