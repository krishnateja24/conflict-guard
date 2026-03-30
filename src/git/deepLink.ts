import type { RemoteRepositoryMetadata } from './types';

export function buildCommitUrl(metadata: RemoteRepositoryMetadata, commitHash: string): string | undefined {
	const { owner, repository, normalizedUrl, provider } = metadata;
	if (!owner || !repository) {
		return undefined;
	}

	switch (provider) {
		case 'github':
			return `${normalizedUrl}/commit/${commitHash}`;
		case 'gitlab':
			return `${normalizedUrl}/-/commit/${commitHash}`;
		case 'bitbucket':
			return `${normalizedUrl}/commits/${commitHash}`;
		default:
			return undefined;
	}
}

export function buildFileAtCommitUrl(
	metadata: RemoteRepositoryMetadata,
	relativeFilePath: string,
	commitHash: string,
): string | undefined {
	const { owner, repository, normalizedUrl, provider } = metadata;
	if (!owner || !repository) {
		return undefined;
	}

	switch (provider) {
		case 'github':
			return `${normalizedUrl}/blob/${commitHash}/${relativeFilePath}`;
		case 'gitlab':
			return `${normalizedUrl}/-/blob/${commitHash}/${relativeFilePath}`;
		default:
			return undefined;
	}
}
