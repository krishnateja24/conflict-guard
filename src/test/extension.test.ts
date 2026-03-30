import * as assert from 'assert';
import * as vscode from 'vscode';

suite('Extension Test Suite', () => {
	vscode.window.showInformationMessage('Start all tests.');

	test('extension commands are registered', async () => {
		const extension = vscode.extensions.getExtension('personal.conflict-guard');
		assert.ok(extension);
		await extension?.activate();

		const commands = await vscode.commands.getCommands(true);
		assert.ok(commands.includes('conflict-guard.scanCurrentFile'));
		assert.ok(commands.includes('conflict-guard.refreshAnalysis'));
	});
});
