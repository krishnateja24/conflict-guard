// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import { GitHubAuthService } from './auth/githubAuthService';
import { ConflictAnalysisService } from './git/conflictAnalysisService';
import { GitCli } from './git/gitCli';
import { AnalysisController } from './ui/analysisController';

export function activate(context: vscode.ExtensionContext) {
	const outputChannel = vscode.window.createOutputChannel('Conflict Guard');
	const authService = new GitHubAuthService();
	const analysisService = new ConflictAnalysisService(
		new GitCli(),
		() => authService.getToken(false),
	);
	const analysisController = new AnalysisController(analysisService, outputChannel);
	analysisController.initialize(context);

	// Automatically prompt for GitHub sign-in on first activation if not already signed in
	void authService.isSignedIn().then(signedIn => {
		if (!signedIn) {
			void vscode.window.showInformationMessage(
				'Conflict Guard: Sign in to GitHub for live conflict detection without needing a local fetch.',
				'Sign In',
			).then(choice => {
				if (choice === 'Sign In') {
					void authService.signIn().then(success => {
						if (success) {
							void analysisController.scanActiveEditor(false);
						}
					});
				}
			});
		}
	});

	const scanCurrentFile = vscode.commands.registerCommand('conflict-guard.scanCurrentFile', async () => {
		await analysisController.scanActiveEditor(true);
	});

	const refreshAnalysis = vscode.commands.registerCommand('conflict-guard.refreshAnalysis', async () => {
		await analysisController.refreshActiveEditor();
	});

	const signInGitHub = vscode.commands.registerCommand('conflict-guard.signInGitHub', async () => {
		const success = await authService.signIn();
		if (success) {
			void vscode.window.showInformationMessage(
				'Conflict Guard: Signed in to GitHub. Conflict risk data will now include PR links and enriched commit context.',
			);
			void analysisController.scanActiveEditor(false);
		} else {
			void vscode.window.showWarningMessage('Conflict Guard: GitHub sign-in was cancelled or failed.');
		}
	});

	const signOutGitHub = vscode.commands.registerCommand('conflict-guard.signOutGitHub', async () => {
		void vscode.window.showInformationMessage(
			'To sign out of GitHub, open the Accounts menu in the bottom-left of the activity bar and remove the Conflict Guard session.',
		);
	});

	context.subscriptions.push(
		outputChannel,
		analysisController,
		scanCurrentFile,
		refreshAnalysis,
		signInGitHub,
		signOutGitHub,
	);
}

export function deactivate() {}
