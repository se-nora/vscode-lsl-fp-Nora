// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

class SnippetHoverProvider implements vscode.HoverProvider {
	snippets: any;
	outputChannel: vscode.OutputChannel;

	constructor(outputChannel: vscode.OutputChannel) {

		this.outputChannel = outputChannel;
		this.outputChannel.appendLine("SnippetHoverProvider instantiated");
		try {
			const extensionPath = vscode.extensions.getExtension('Nora.noras-lsl-fp')?.extensionPath;
			if (extensionPath === undefined)
			{
				outputChannel.appendLine("wtf? cant use snippet hover provider due to extension not being found");

				return;
			}

			const snippetsPath = path.join(extensionPath, "snippets", 'snippets.json'); // Update the path accordingly
			
			vscode.workspace.openTextDocument(snippetsPath).then((document) => {
				let snippetText = document.getText();
				this.outputChannel.appendLine(String(snippetText.length));
				snippetText =snippetText.replaceAll('\\n', '  \\n');
				this.outputChannel.appendLine(String(snippetText.length));
				this.snippets = JSON.parse(snippetText);
				this.outputChannel.appendLine("Loaded " + String(Object.keys(this.snippets).length) + " snippets.")
			});
		} catch (error) {
			console.error('Error reading snippets.json:', error);
		}
	}

	provideHover(
		document: vscode.TextDocument,
		position: vscode.Position,
		token: vscode.CancellationToken
	): vscode.ProviderResult<vscode.Hover> {
		const wordRange = document.getWordRangeAtPosition(position);
		if (!wordRange) {
			return;
		}

		const word = document.getText(wordRange);

		if (this.snippets[word] && this.snippets[word].description) {
			const description = this.snippets[word].description;
			return new vscode.Hover(description);
		}

		return;
	}
}

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
	let outputChannel = vscode.window.createOutputChannel('Noras LSL-FP Debug Output');
	context.subscriptions.push(outputChannel);
	outputChannel.show();
	outputChannel.appendLine("Noras LSL-FP instantiated");
	console.log('Congratulations, your extension "star-rod" is now active!');
	vscode.window.showInformationMessage('Hello World from Noras LSL-FP!');

	const hoverProvider = new SnippetHoverProvider(outputChannel);
	context.subscriptions.push(
		vscode.languages.registerHoverProvider(
			{ scheme: 'file', language: 'lsl' },
			hoverProvider
		)
	);

	// Use the console to output diagnostic information (console.log) and errors (console.error)
	// This line of code will only be executed once when your extension is activated
	console.log('Congratulations, your extension "noras-lsl-fp" is now active!');

	// The command has been defined in the package.json file
	// Now provide the implementation of the command with registerCommand
	// The commandId parameter must match the command field in package.json
	let disposable = vscode.commands.registerCommand('noras-lsl-fp.helloWorld', () => {
		// The code you place here will be executed every time your command is executed
		// Display a message box to the user
		vscode.window.showInformationMessage('Hello World from Noras LSL-FP!');
	});

	context.subscriptions.push(disposable);
}


// This method is called when your extension is deactivated
export function deactivate() { }
