import * as assert from 'assert';
import { buildCommitUrl, buildFileAtCommitUrl } from '../git/deepLink';
import { doBaseRangesOverlap, parseUnifiedDiffHunks } from '../git/diffParser';
import { parseRemoteRepositoryMetadata } from '../git/remoteMetadata';

suite('Git Core', () => {
	test('parseUnifiedDiffHunks identifies insert modify and delete hunks', () => {
		const diff = [
			'diff --git a/sample.ts b/sample.ts',
			'@@ -4,2 +4,3 @@',
			'@@ -10,0 +12,2 @@',
			'@@ -20,3 +21,0 @@',
		].join('\n');

		const hunks = parseUnifiedDiffHunks(diff);

		assert.strictEqual(hunks.length, 3);
		assert.strictEqual(hunks[0].kind, 'modify');
		assert.strictEqual(hunks[1].kind, 'insert');
		assert.strictEqual(hunks[2].kind, 'delete');
	});

	test('doBaseRangesOverlap treats insertion points inside ranges as overlap', () => {
		assert.strictEqual(doBaseRangesOverlap({ start: 10, count: 0 }, { start: 8, count: 3 }), true);
		assert.strictEqual(doBaseRangesOverlap({ start: 20, count: 0 }, { start: 8, count: 3 }), false);
		assert.strictEqual(doBaseRangesOverlap({ start: 12, count: 2 }, { start: 13, count: 1 }), true);
	});

	test('parseRemoteRepositoryMetadata normalizes ssh remotes', () => {
		const metadata = parseRemoteRepositoryMetadata('origin', 'git@github.com:octocat/conflict-guard.git');

		assert.strictEqual(metadata.provider, 'github');
		assert.strictEqual(metadata.owner, 'octocat');
		assert.strictEqual(metadata.repository, 'conflict-guard');
		assert.strictEqual(metadata.normalizedUrl, 'https://github.com/octocat/conflict-guard');
	});

	test('buildCommitUrl generates correct GitHub and GitLab links', () => {
		const githubMeta = parseRemoteRepositoryMetadata('origin', 'git@github.com:octocat/conflict-guard.git');
		const gitlabMeta = parseRemoteRepositoryMetadata('origin', 'https://gitlab.com/octocat/conflict-guard.git');
		const sha = 'abc1234';

		assert.strictEqual(buildCommitUrl(githubMeta, sha), 'https://github.com/octocat/conflict-guard/commit/abc1234');
		assert.strictEqual(buildCommitUrl(gitlabMeta, sha), 'https://gitlab.com/octocat/conflict-guard/-/commit/abc1234');
	});

	test('buildFileAtCommitUrl generates correct file-at-commit URLs', () => {
		const githubMeta = parseRemoteRepositoryMetadata('origin', 'https://github.com/octocat/conflict-guard.git');
		const sha = 'abc1234';

		assert.strictEqual(
			buildFileAtCommitUrl(githubMeta, 'src/extension.ts', sha),
			'https://github.com/octocat/conflict-guard/blob/abc1234/src/extension.ts',
		);
	});
});
