import * as vscode from 'vscode';
import { ConflictAnalysisService } from '../git/conflictAnalysisService';
import type { ConflictAnalysisResult, OverlapMatch } from '../git/types';

interface ScanRequestOptions {
	readonly fetchBeforeScan: boolean;
	readonly interactive: boolean;
	readonly reason: string;
}

function getConfiguration(): {
	remoteName: string;
	branchName: string;
	fetchBeforeScan: boolean;
	fetchIntervalMinutes: number;
	autoScan: boolean;
	enableDecorations: boolean;
	githubApiUrl: string;
} {
	const config = vscode.workspace.getConfiguration('conflictGuard');
	return {
		remoteName: config.get<string>('defaultRemote', 'origin'),
		branchName: config.get<string>('defaultBaseBranch', 'master'),
		fetchBeforeScan: config.get<boolean>('fetchBeforeScan', false),
		fetchIntervalMinutes: config.get<number>('fetchIntervalMinutes', 5),
		autoScan: config.get<boolean>('autoScan', true),
		enableDecorations: config.get<boolean>('enableDecorations', true),
		githubApiUrl: config.get<string>('githubApiUrl', 'https://api.github.com'),
	};
}

function createDocumentRange(document: vscode.TextDocument, overlap: OverlapMatch): vscode.Range {
	const maxLine = Math.max(document.lineCount - 1, 0);
	const startLine = Math.min(Math.max(overlap.local.currentRange.start - 1, 0), maxLine);
	const endLine = overlap.local.currentRange.count <= 1
		? startLine
		: Math.min(startLine + overlap.local.currentRange.count - 1, maxLine);

	return new vscode.Range(startLine, 0, endLine, document.lineAt(endLine).range.end.character);
}

function formatRangeLabel(range: vscode.Range): string {
	const startLine = range.start.line + 1;
	const endLine = range.end.line + 1;
	return startLine === endLine ? `line ${startLine}` : `lines ${startLine}-${endLine}`;
}

export class AnalysisController implements vscode.Disposable {
	private readonly diagnostics = vscode.languages.createDiagnosticCollection('conflictGuard');
	private readonly decorationType = vscode.window.createTextEditorDecorationType({
		isWholeLine: true,
		backgroundColor: 'rgba(214, 93, 14, 0.22)',
		borderColor: 'rgba(214, 93, 14, 0.95)',
		borderWidth: '0 0 0 4px',
		borderStyle: 'solid',
		overviewRulerColor: 'rgba(214, 93, 14, 0.95)',
		overviewRulerLane: vscode.OverviewRulerLane.Right,
		after: {
			contentText: ' Conflict risk',
			color: '#b54708',
			margin: '0 0 0 1.25rem',
			fontWeight: 'bold',
		},
		light: {
			backgroundColor: 'rgba(214, 93, 14, 0.18)',
			borderColor: 'rgba(180, 83, 9, 0.95)',
			after: {
				contentText: ' Conflict risk',
				color: '#9a3412',
				margin: '0 0 0 1.25rem',
				fontWeight: 'bold',
			},
		},
		dark: {
			backgroundColor: 'rgba(249, 115, 22, 0.2)',
			borderColor: 'rgba(251, 146, 60, 0.98)',
			after: {
				contentText: ' Conflict risk',
				color: '#fdba74',
				margin: '0 0 0 1.25rem',
				fontWeight: 'bold',
			},
		},
	});
	private readonly statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
	private readonly changeDebounceTimers = new Map<string, NodeJS.Timeout>();
	private readonly documentVersions = new Map<string, number>();
	private readonly overlapSignatures = new Map<string, string>();
	private refreshTimer: NodeJS.Timeout | undefined;

	public constructor(
		private readonly analysisService: ConflictAnalysisService,
		private readonly outputChannel: vscode.OutputChannel,
	) {
		this.statusBarItem.command = 'conflict-guard.scanCurrentFile';
		this.statusBarItem.name = 'Conflict Guard';
		this.statusBarItem.hide();
	}

	public initialize(context: vscode.ExtensionContext): void {
		context.subscriptions.push(
			this,
			this.diagnostics,
			this.decorationType,
			this.statusBarItem,
			vscode.window.onDidChangeActiveTextEditor(editor => {
				if (!editor) {
					this.statusBarItem.hide();
					return;
				}

				void this.scanEditor(editor, { fetchBeforeScan: false, interactive: false, reason: 'active-editor-change' });
			}),
			vscode.window.onDidChangeVisibleTextEditors(editors => {
				for (const editor of editors) {
					void this.scanEditor(editor, { fetchBeforeScan: false, interactive: false, reason: 'visible-editors-change' });
				}
			}),
			vscode.workspace.onDidChangeTextDocument(event => {
				this.scheduleDocumentScan(event.document);
			}),
			vscode.workspace.onDidSaveTextDocument(document => {
				this.scheduleDocumentScan(document, 0);
			}),
			vscode.workspace.onDidChangeConfiguration(event => {
				if (!event.affectsConfiguration('conflictGuard')) {
					return;
				}

				this.restartRefreshTimer();
				void this.scanVisibleEditors({ fetchBeforeScan: false, interactive: false, reason: 'configuration-change' });
			}),
		);

		this.restartRefreshTimer();
		void this.scanVisibleEditors({ fetchBeforeScan: false, interactive: false, reason: 'activation' });
	}

	public async scanActiveEditor(interactive = true): Promise<void> {
		const editor = vscode.window.activeTextEditor;
		if (!editor) {
			if (interactive) {
				void vscode.window.showWarningMessage('Conflict Guard requires an active editor to analyze a file.');
			}
			return;
		}

		const configuration = getConfiguration();
		await this.scanEditor(editor, {
			fetchBeforeScan: configuration.fetchBeforeScan,
			interactive,
			reason: 'manual-scan',
		});
	}

	public async refreshActiveEditor(): Promise<void> {
		const editor = vscode.window.activeTextEditor;
		if (!editor) {
			void vscode.window.showWarningMessage('Conflict Guard requires an active editor to refresh Git metadata for a repository.');
			return;
		}

		await this.scanEditor(editor, {
			fetchBeforeScan: true,
			interactive: true,
			reason: 'manual-refresh',
		});
	}

	public dispose(): void {
		for (const timer of this.changeDebounceTimers.values()) {
			clearTimeout(timer);
		}

		this.changeDebounceTimers.clear();
		this.documentVersions.clear();
		this.overlapSignatures.clear();

		if (this.refreshTimer) {
			clearInterval(this.refreshTimer);
			this.refreshTimer = undefined;
		}
	}

	private restartRefreshTimer(): void {
		if (this.refreshTimer) {
			clearInterval(this.refreshTimer);
		}

		const configuration = getConfiguration();
		if (!configuration.autoScan) {
			this.refreshTimer = undefined;
			return;
		}

		this.refreshTimer = setInterval(() => {
			void this.scanVisibleEditors({
				fetchBeforeScan: true,
				interactive: false,
				reason: 'scheduled-refresh',
			});
		}, Math.max(configuration.fetchIntervalMinutes, 1) * 60_000);
	}

	private scheduleDocumentScan(document: vscode.TextDocument, delayMs = 500): void {
		if (document.uri.scheme !== 'file') {
			return;
		}

		const key = document.uri.toString();
		const existingTimer = this.changeDebounceTimers.get(key);
		if (existingTimer) {
			clearTimeout(existingTimer);
		}

		const timer = setTimeout(() => {
			this.changeDebounceTimers.delete(key);
			for (const editor of vscode.window.visibleTextEditors) {
				if (editor.document.uri.toString() === key) {
					void this.scanEditor(editor, {
						fetchBeforeScan: false,
						interactive: false,
						reason: 'document-change',
					});
				}
			}
		}, delayMs);

		this.changeDebounceTimers.set(key, timer);
	}

	private async scanVisibleEditors(options: ScanRequestOptions): Promise<void> {
		for (const editor of vscode.window.visibleTextEditors) {
			await this.scanEditor(editor, options);
		}
	}

	private async scanEditor(editor: vscode.TextEditor, options: ScanRequestOptions): Promise<void> {
		if (editor.document.uri.scheme !== 'file') {
			return;
		}

		const requestKey = editor.document.uri.toString();
		const version = (this.documentVersions.get(requestKey) ?? 0) + 1;
		this.documentVersions.set(requestKey, version);

		const configuration = getConfiguration();
		try {
			const result = await this.analysisService.analyzeFile({
				filePath: editor.document.uri.fsPath,
				documentText: editor.document.getText(),
				remoteName: configuration.remoteName,
				branchName: configuration.branchName,
				fetchBeforeScan: options.fetchBeforeScan,
				githubApiUrl: configuration.githubApiUrl,
			});

			if (this.documentVersions.get(requestKey) !== version) {
				return;
			}

			this.applyAnalysis(editor, result, options, configuration.enableDecorations);
		} catch (error) {
			if (this.documentVersions.get(requestKey) !== version) {
				return;
			}

			this.clearEditorState(editor);

			const message = error instanceof Error ? error.message : 'Conflict analysis failed.';
			this.outputChannel.appendLine(`[${options.reason}] error: ${message}`);
			if (options.interactive) {
				this.outputChannel.show(true);
				void vscode.window.showErrorMessage(`Conflict Guard ${options.reason} failed: ${message}`);
			}
		}
	}

	private applyAnalysis(
		editor: vscode.TextEditor,
		result: ConflictAnalysisResult,
		options: ScanRequestOptions,
		enableDecorations: boolean,
	): void {
		const documentKey = editor.document.uri.toString();
		const previousOverlapSignature = this.overlapSignatures.get(documentKey) ?? '';
		const overlapEntries = result.overlaps.map(overlap => ({
			overlap,
			range: createDocumentRange(editor.document, overlap),
		}));
		const overlapSignature = overlapEntries
			.map(entry => `${entry.range.start.line}:${entry.range.end.line}:${entry.overlap.local.header}:${entry.overlap.upstream.header}`)
			.join('|');

		const diagnostics = overlapEntries.map(entry => (
			new vscode.Diagnostic(
				entry.range,
				`${entry.overlap.reason} Base ref: ${result.baseRef}.`,
				vscode.DiagnosticSeverity.Warning,
			)
		));

		for (const diagnostic of diagnostics) {
			diagnostic.source = 'Conflict Guard';
		}

		this.diagnostics.set(editor.document.uri, diagnostics);

		if (enableDecorations) {
			const decorations = overlapEntries.map(entry => ({
				range: entry.range,
				hoverMessage: this.createHoverMessage(result, entry.overlap),
			}));
			editor.setDecorations(this.decorationType, decorations);
		} else {
			editor.setDecorations(this.decorationType, []);
		}

		this.overlapSignatures.set(documentKey, overlapSignature);
		this.updateStatusBar(editor.document, result);

		if (!options.interactive) {
			return;
		}

		this.outputChannel.clear();
		this.outputChannel.appendLine(`Conflict Guard ${options.reason} for ${result.filePathRelativeToRepo}`);
		this.outputChannel.appendLine(`Base ref: ${result.baseRef}`);
		this.outputChannel.appendLine(`Merge base: ${result.mergeBase}`);
		if (result.remoteMetadata) {
			this.outputChannel.appendLine(`Remote: ${result.remoteMetadata.remoteName} (${result.remoteMetadata.provider}) ${result.remoteMetadata.normalizedUrl}`);
		}
		if (result.upstreamCommit) {
			this.outputChannel.appendLine(`Latest upstream file change: ${result.upstreamCommit.authorName} ${result.upstreamCommit.relativeDate} - ${result.upstreamCommit.subject}`);
			if (result.upstreamCommit.commitUrl) {
				this.outputChannel.appendLine(`  Commit: ${result.upstreamCommit.commitUrl}`);
			}
			if (result.upstreamCommit.prUrl) {
				this.outputChannel.appendLine(`  Associated PR: ${result.upstreamCommit.prUrl}`);
			}
			if (result.fileAtCommitUrl) {
				this.outputChannel.appendLine(`  File at commit: ${result.fileAtCommitUrl}`);
			}
		}
		this.outputChannel.appendLine(`Local change hunks: ${result.localHunks.length}`);
		this.outputChannel.appendLine(`Upstream change hunks: ${result.upstreamHunks.length}`);
		this.outputChannel.appendLine(`Overlap count: ${result.overlaps.length}`);

		for (const [index, overlap] of result.overlaps.entries()) {
			const range = overlapEntries[index]?.range;
			this.outputChannel.appendLine('');
			this.outputChannel.appendLine(`Overlap ${index + 1}`);
			if (range) {
				this.outputChannel.appendLine(`  Range: ${formatRangeLabel(range)}`);
			}
			this.outputChannel.appendLine(`  Local: ${overlap.local.header}`);
			this.outputChannel.appendLine(`  Upstream: ${overlap.upstream.header}`);
			this.outputChannel.appendLine(`  Reason: ${overlap.reason}`);
		}

		if (result.overlaps.length > 0) {
			const firstRange = overlapEntries[0]?.range;
			if (firstRange && (options.interactive || overlapSignature !== previousOverlapSignature)) {
				editor.revealRange(firstRange, vscode.TextEditorRevealType.InCenter);
				editor.selection = new vscode.Selection(firstRange.start, firstRange.end);
			}

			this.outputChannel.show(true);
			const shouldNotify = options.interactive || overlapSignature !== previousOverlapSignature;
			if (!shouldNotify) {
				return;
			}

			if (!options.interactive && firstRange) {
				void vscode.window.setStatusBarMessage(
					`Conflict Guard: risk detected at ${formatRangeLabel(firstRange)} in ${result.filePathRelativeToRepo}`,
					5000,
				);
			}

			void vscode.window.showWarningMessage(
				`${result.overlaps.length} potential conflict overlap${result.overlaps.length === 1 ? '' : 's'} detected against ${result.baseRef}${firstRange ? ` at ${formatRangeLabel(firstRange)}` : ''}.`,
				'Go To Risk',
				'Show Details',
			).then(selection => {
				if (selection === 'Go To Risk' && firstRange) {
					editor.revealRange(firstRange, vscode.TextEditorRevealType.InCenter);
					editor.selection = new vscode.Selection(firstRange.start, firstRange.end);
				} else if (selection === 'Show Details') {
					this.outputChannel.show(true);
				}
			});
			return;
		}

		this.overlapSignatures.set(documentKey, '');

		if (options.interactive) {
			void vscode.window.showInformationMessage(`No overlapping upstream edits detected against ${result.baseRef}.`);
		}
	}

	private updateStatusBar(document: vscode.TextDocument, result: ConflictAnalysisResult): void {
		if (vscode.window.activeTextEditor?.document.uri.toString() !== document.uri.toString()) {
			return;
		}

		if (result.overlaps.length === 0) {
			this.statusBarItem.text = '$(shield) Conflict Guard: clear';
			this.statusBarItem.tooltip = this.createStatusTooltip(result, 'No overlapping upstream edits detected.');
			this.statusBarItem.backgroundColor = undefined;
			this.statusBarItem.show();
			return;
		}

		this.statusBarItem.text = `$(warning) Conflict Guard: ${result.overlaps.length} risk${result.overlaps.length === 1 ? '' : 's'}`;
		this.statusBarItem.tooltip = this.createStatusTooltip(
			result,
			`${result.overlaps.length} potential overlap${result.overlaps.length === 1 ? '' : 's'} detected.`,
		);
		this.statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
		this.statusBarItem.show();
	}

	private createHoverMessage(result: ConflictAnalysisResult, overlap: OverlapMatch): vscode.MarkdownString {
		const md = new vscode.MarkdownString('', true);
		md.appendMarkdown(`**⚠ Conflict Guard**\n\n`);
		md.appendMarkdown(`${overlap.reason}\n\n`);
		md.appendMarkdown(`**Base ref:** \`${result.baseRef}\`\n\n`);

		if (result.remoteMetadata) {
			md.appendMarkdown(`**Remote:** ${result.remoteMetadata.remoteName} (${result.remoteMetadata.provider})\n\n`);
		}

		if (result.upstreamCommit) {
			md.appendMarkdown(`**Latest upstream change:** ${result.upstreamCommit.authorName} — ${result.upstreamCommit.relativeDate}\n\n`);
			md.appendMarkdown(`${result.upstreamCommit.subject}\n\n`);

			const links: string[] = [];
			if (result.upstreamCommit.commitUrl) {
				links.push(`[View commit](${result.upstreamCommit.commitUrl})`);
			}
			if (result.fileAtCommitUrl) {
				links.push(`[View file at this commit](${result.fileAtCommitUrl})`);
			}
			if (result.upstreamCommit.prUrl) {
				links.push(`[View associated PR](${result.upstreamCommit.prUrl})`);
			}

			if (links.length > 0) {
				md.appendMarkdown(links.join('  |  '));
			}
		} else if (!result.upstreamCommit) {
			md.appendMarkdown(`_Sign in to GitHub (Command Palette → Conflict Guard: Sign in to GitHub) for PR links and enriched commit context._`);
		}

		return md;
	}

	private createStatusTooltip(result: ConflictAnalysisResult, summary: string): vscode.MarkdownString {
		const md = new vscode.MarkdownString('', true);
		md.appendMarkdown(`${summary} Base ref: \`${result.baseRef}\`.`);
		if (result.remoteMetadata) {
			md.appendMarkdown(`\n\nRemote: ${result.remoteMetadata.remoteName} (${result.remoteMetadata.provider})`);
		}
		if (result.upstreamCommit) {
			md.appendMarkdown(`\n\nLatest upstream change: ${result.upstreamCommit.authorName} ${result.upstreamCommit.relativeDate}`);
			if (result.upstreamCommit.commitUrl) {
				md.appendMarkdown(`\n\n[View commit](${result.upstreamCommit.commitUrl})`);
			}
		}

		return md;
	}

	private clearEditorState(editor: vscode.TextEditor): void {
		this.overlapSignatures.delete(editor.document.uri.toString());
		this.diagnostics.delete(editor.document.uri);
		editor.setDecorations(this.decorationType, []);
		if (vscode.window.activeTextEditor?.document.uri.toString() === editor.document.uri.toString()) {
			this.statusBarItem.hide();
		}
	}
}
