import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export class GitCli {
	public async getRemoteUrl(repoRoot: string, remoteName: string): Promise<string> {
		const { stdout } = await this.runGit(['remote', 'get-url', remoteName], repoRoot);
		return stdout.trim();
	}

	public async findRepoRoot(filePath: string): Promise<string> {
		const cwd = path.dirname(filePath);
		const { stdout } = await this.runGit(['rev-parse', '--show-toplevel'], cwd);
		return stdout.trim();
	}

	public async resolveMergeBase(repoRoot: string, leftRef: string, rightRef: string): Promise<string> {
		const { stdout } = await this.runGit(['merge-base', leftRef, rightRef], repoRoot);
		return stdout.trim();
	}

	public async fetchRef(repoRoot: string, remote: string, branch: string): Promise<void> {
		await this.runGit(['fetch', remote, branch], repoRoot);
	}

	public async verifyRef(repoRoot: string, ref: string): Promise<boolean> {
		try {
			await this.runGit(['rev-parse', '--verify', ref], repoRoot);
			return true;
		} catch {
			return false;
		}
	}

	public async diffWorkingTreeAgainstRef(repoRoot: string, ref: string, relativeFilePath: string): Promise<string> {
		const { stdout } = await this.runGit([
			'diff',
			'--no-color',
			'--unified=0',
			ref,
			'--',
			relativeFilePath,
		], repoRoot);

		return stdout;
	}

	public async diffTextAgainstRef(repoRoot: string, ref: string, relativeFilePath: string, currentText: string): Promise<string> {
		const baseText = await this.getFileContentAtRef(repoRoot, ref, relativeFilePath);

		if (baseText === currentText) {
			return '';
		}

		const tempDir = await mkdtemp(path.join(os.tmpdir(), 'conflict-guard-'));
		const beforePath = path.join(tempDir, 'before');
		const afterPath = path.join(tempDir, 'after');

		try {
			await writeFile(beforePath, baseText, 'utf8');
			await writeFile(afterPath, currentText, 'utf8');

			return await this.runDiffNoIndex(beforePath, afterPath, tempDir);
		} finally {
			await rm(tempDir, { recursive: true, force: true });
		}
	}

	public async diffRefs(repoRoot: string, fromRef: string, toRef: string, relativeFilePath: string): Promise<string> {
		const { stdout } = await this.runGit([
			'diff',
			'--no-color',
			'--unified=0',
			fromRef,
			toRef,
			'--',
			relativeFilePath,
		], repoRoot);

		return stdout;
	}

	public async getCurrentBranch(repoRoot: string): Promise<string> {
		const { stdout } = await this.runGit(['rev-parse', '--abbrev-ref', 'HEAD'], repoRoot);
		return stdout.trim();
	}

	/**
	 * Returns the tracking (upstream) remote and branch for the current HEAD,
	 * e.g. `{ remote: 'origin', branch: 'main' }`. Returns `undefined` when no
	 * upstream is configured or HEAD is detached.
	 */
	public async getTrackingBranch(repoRoot: string): Promise<{ remote: string; branch: string } | undefined> {
		try {
			const { stdout } = await this.runGit(['rev-parse', '--abbrev-ref', '@{upstream}'], repoRoot);
			const tracking = stdout.trim();
			const slashIndex = tracking.indexOf('/');
			if (slashIndex < 0) {
				return undefined;
			}
			return {
				remote: tracking.slice(0, slashIndex),
				branch: tracking.slice(slashIndex + 1),
			};
		} catch {
			return undefined;
		}
	}

	public async getHeadSha(repoRoot: string): Promise<string> {
		const { stdout } = await this.runGit(['rev-parse', 'HEAD'], repoRoot);
		return stdout.trim();
	}

	public async getLatestCommitSummary(repoRoot: string, ref: string, relativeFilePath: string): Promise<string | undefined> {
		const { stdout } = await this.runGit([
			'log',
			'-1',
			'--format=%H%x09%an%x09%ar%x09%s',
			ref,
			'--',
			relativeFilePath,
		], repoRoot);

		const trimmed = stdout.trim();
		return trimmed.length > 0 ? trimmed : undefined;
	}

	public async getFileContentAtRef(repoRoot: string, ref: string, relativeFilePath: string): Promise<string> {
		try {
			const { stdout } = await this.runGit(['show', `${ref}:${relativeFilePath}`], repoRoot);
			return stdout;
		} catch {
			return '';
		}
	}

	private async runDiffNoIndex(leftPath: string, rightPath: string, cwd: string): Promise<string> {
		try {
			const { stdout } = await execFileAsync('git', [
				'diff',
				'--no-index',
				'--no-color',
				'--unified=0',
				'--',
				leftPath,
				rightPath,
			], {
				cwd,
				windowsHide: true,
				maxBuffer: 1024 * 1024,
			});

			return stdout;
		} catch (error) {
			const diffError = error as NodeJS.ErrnoException & { stdout?: string; code?: number };
			if (diffError.code === 1) {
				return diffError.stdout ?? '';
			}

			throw error;
		}
	}

	private async runGit(args: readonly string[], cwd: string): Promise<{ stdout: string; stderr: string }> {
		return execFileAsync('git', [...args], {
			cwd,
			windowsHide: true,
			maxBuffer: 1024 * 1024,
		});
	}
}
