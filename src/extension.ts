// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import * as http from 'http';
import * as path from 'path';
import * as fs from 'fs';

const FIRESTORM_BRIDGE_PORT = 39097;
const MAX_BRIDGE_REQUEST_BYTES = 1024 * 1024;

interface FirestormCompileResult {
	file: string;
	success: boolean;
	errors: string[];
	sourceMap: FirestormSourceLocation[];
	sourceMapComplete: boolean;
}

interface FirestormSourceLocation {
	generatedLine: number;
	sourceFile: string;
	sourceLine: number;
}

interface FirestormDiagnosticLocation {
	line: number;
	character: number;
}

export function parseFirestormDiagnosticLocation(message: string): FirestormDiagnosticLocation | undefined {
	const match = /^\s*\((\d+)\s*,\s*(\d+)\)\s*:\s*(.*)$/.exec(message.trim());
	if (!match) {
		return undefined;
	}

	const line = Number(match[1]);
	const column = Number(match[2]);
	if (!Number.isSafeInteger(line) || !Number.isSafeInteger(column) || line < 1 || column < 1) {
		return undefined;
	}

	return { line: line - 1, character: column - 1 };
}

function resolveFirestormSourceUri(sourceFile: string, generatedFile: string): vscode.Uri | undefined {
	if (path.isAbsolute(sourceFile)) {
		return vscode.Uri.file(sourceFile);
	}

	const matchingDocuments = vscode.workspace.textDocuments.filter(
		document => path.basename(document.uri.fsPath).toLowerCase() === path.basename(sourceFile).toLowerCase()
	);
	if (matchingDocuments.length === 1) {
		return matchingDocuments[0].uri;
	}

	const resolvedPath = path.resolve(path.dirname(generatedFile), sourceFile);
	return fs.existsSync(resolvedPath) ? vscode.Uri.file(resolvedPath) : undefined;
}

function decodeXmlText(value: string): string {
	return value
		.replace(/&#x([0-9a-f]+);/gi, (entity, hex: string) => {
			const codePoint = parseInt(hex, 16);
			return codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : entity;
		})
		.replace(/&#([0-9]+);/g, (entity, decimal: string) => {
			const codePoint = parseInt(decimal, 10);
			return codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : entity;
		})
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"')
		.replace(/&apos;/g, '\'')
		.replace(/&amp;/g, '&');
}

function readXmlString(xml: string, key: string): string | undefined {
	const match = new RegExp(`<key>${key}</key>\\s*<string>([\\s\\S]*?)</string>`).exec(xml);
	return match ? decodeXmlText(match[1]) : undefined;
}

function readXmlInteger(xml: string, key: string): number | undefined {
	const match = new RegExp(`<key>${key}</key>\\s*<integer>(\\d+)</integer>`).exec(xml);
	return match ? Number(match[1]) : undefined;
}

export function parseFirestormResult(xml: string): FirestormCompileResult | undefined {
	const file = readXmlString(xml, 'file');
	const successMatch = /<key>success<\/key>\s*<boolean>(1|0|true|false)<\/boolean>/i.exec(xml);
	const errorsMatch = /<key>errors<\/key>\s*(?:<array>([\s\S]*?)<\/array>|<array\s*\/>)/.exec(xml);

	if (!file || !successMatch || !errorsMatch) {
		return undefined;
	}

	const errors: string[] = [];
	const errorPattern = /<string>([\s\S]*?)<\/string>/g;
	let errorMatch: RegExpExecArray | null;
	while ((errorMatch = errorPattern.exec(errorsMatch[1] ?? '')) !== null) {
		errors.push(decodeXmlText(errorMatch[1]));
	}

	const sourceMapMatch = /<key>source_map<\/key>\s*<array>([\s\S]*?)<\/array>/.exec(xml);
	const sourceMap: FirestormSourceLocation[] = [];
	if (sourceMapMatch) {
		const mapPattern = /<map>([\s\S]*?)<\/map>/g;
		let mapMatch: RegExpExecArray | null;
		while ((mapMatch = mapPattern.exec(sourceMapMatch[1])) !== null) {
			const generatedLine = readXmlInteger(mapMatch[1], 'generated_line');
			const sourceFile = readXmlString(mapMatch[1], 'source_file');
			const sourceLine = readXmlInteger(mapMatch[1], 'source_line');
			if (generatedLine && generatedLine > 0 && sourceFile && sourceLine && sourceLine > 0) {
				sourceMap.push({ generatedLine, sourceFile, sourceLine });
			}
		}
	}
	const sourceMapCompleteMatch =
		/<key>source_map_complete<\/key>\s*<boolean>(1|0|true|false)<\/boolean>/i.exec(xml);

	return {
		file,
		success: successMatch[1] === '1' || successMatch[1].toLowerCase() === 'true',
		errors,
		sourceMap,
		sourceMapComplete: sourceMapCompleteMatch !== null &&
			(sourceMapCompleteMatch[1] === '1' || sourceMapCompleteMatch[1].toLowerCase() === 'true')
	};
}

function sendLlsdResponse(response: http.ServerResponse, statusCode: number): void {
	response.setHeader('Content-Type', 'application/llsd+xml');
	response.statusCode = statusCode;
	response.end('<?xml version="1.0"?><llsd><map/></llsd>');
}

function startFirestormBridge(
	context: vscode.ExtensionContext,
	diagnostics: vscode.DiagnosticCollection,
	outputChannel: vscode.OutputChannel,
	bridgeOutputChannel: vscode.OutputChannel
): void {
	const diagnosticUrisByGeneratedFile = new Map<string, vscode.Uri[]>();
	const server = http.createServer((request, response) => {
		if (request.method !== 'POST' || request.url !== '/compile') {
			sendLlsdResponse(response, 404);
			return;
		}

		let requestSize = 0;
		let tooLarge = false;
		const chunks: string[] = [];
		request.setEncoding('utf8');
		request.on('data', (chunk: string) => {
			if (tooLarge) {
				return;
			}
			requestSize += Buffer.byteLength(chunk, 'utf8');
			if (requestSize > MAX_BRIDGE_REQUEST_BYTES) {
				tooLarge = true;
				bridgeOutputChannel.appendLine(
					`Rejected Firestorm bridge request larger than ${MAX_BRIDGE_REQUEST_BYTES} bytes.`
				);
				sendLlsdResponse(response, 413);
				return;
			}
			chunks.push(chunk);
		});

		request.on('end', () => {
			if (tooLarge) {
				return;
			}
			const rawMessage = chunks.join('');
			bridgeOutputChannel.appendLine('Received Firestorm bridge message:');
			bridgeOutputChannel.append(rawMessage);
			bridgeOutputChannel.appendLine('\n--- End Firestorm bridge message ---');
			const result = parseFirestormResult(rawMessage);
			if (!result || !path.isAbsolute(result.file)) {
				outputChannel.appendLine('Rejected malformed Firestorm compile result.');
				sendLlsdResponse(response, 400);
				return;
			}

			const uri = vscode.Uri.file(result.file);
			for (const previousUri of diagnosticUrisByGeneratedFile.get(result.file) ?? []) {
				diagnostics.delete(previousUri);
			}
			diagnosticUrisByGeneratedFile.delete(result.file);
			if (result.success) {
				diagnostics.delete(uri);
				outputChannel.appendLine(`Firestorm compile succeeded: ${result.file}`);
			} else {
				const errors = result.errors.length > 0
					? result.errors
					: ['Firestorm reported a compile failure without diagnostic text.'];
				const entriesByUri = new Map<string, { uri: vscode.Uri; entries: vscode.Diagnostic[] }>();
				for (const message of errors) {
					const location = parseFirestormDiagnosticLocation(message);
					bridgeOutputChannel.appendLine(`Translating Firestorm diagnostic: ${message}`);
					let line = 0;
					let character = 0;
					let diagnosticUri = uri;
					let hasSourceMapping = false;
					if (!location) {
						bridgeOutputChannel.appendLine(
							'Could not parse a line and column; using the start of the generated file.'
						);
					} else {
						bridgeOutputChannel.appendLine(
							`Parsed generated location: line ${location.line + 1}, column ${location.character + 1}.`
						);
					}
					bridgeOutputChannel.appendLine(
						`Source map complete: ${result.sourceMapComplete}; entries: ${result.sourceMap.length}.`
					);
					if (location) {
						const sourceLocation = result.sourceMap.find(
							entry => entry.generatedLine === location.line + 1
						);
						if (sourceLocation) {
							bridgeOutputChannel.appendLine(
								`Matched source-map entry: generated line ${sourceLocation.generatedLine} -> ` +
								`${sourceLocation.sourceFile}:${sourceLocation.sourceLine} ` +
								`(map complete: ${result.sourceMapComplete}).`
							);
							const sourceUri = resolveFirestormSourceUri(sourceLocation.sourceFile, result.file);
							if (sourceUri) {
								diagnosticUri = sourceUri;
								line = sourceLocation.sourceLine - 1;
								character = location.character;
								hasSourceMapping = true;
								bridgeOutputChannel.appendLine(`Resolved mapped source URI: ${diagnosticUri.toString()}`);
							} else {
								bridgeOutputChannel.appendLine(
									`Could not resolve mapped source file "${sourceLocation.sourceFile}"; ` +
									'keeping the generated-file location.'
								);
							}
						} else {
							bridgeOutputChannel.appendLine(
								`No source-map entry found for generated line ${location.line + 1}; ` +
								`keeping the generated-file location (map complete: ${result.sourceMapComplete}).`
							);
						}
					}
					if (location && !hasSourceMapping) {
						line = location.line;
						character = location.character;
					}
					bridgeOutputChannel.appendLine(
						`Final VS Code diagnostic: ${diagnosticUri.toString()} ` +
						`at zero-based line ${line}, character ${character} ` +
						`(displayed line ${line + 1}, column ${character + 1}).`
					);
					const position = new vscode.Position(line, character);
					const diagnostic = new vscode.Diagnostic(
						new vscode.Range(position, new vscode.Position(line, character + 1)),
						message,
						vscode.DiagnosticSeverity.Error
					);
					diagnostic.source = 'Firestorm';
					const key = diagnosticUri.toString();
					let grouped = entriesByUri.get(key);
					if (!grouped) {
						grouped = { uri: diagnosticUri, entries: [] };
						entriesByUri.set(key, grouped);
					}
					grouped.entries.push(diagnostic);
				}
				const diagnosticUris: vscode.Uri[] = [];
				for (const { uri: targetUri, entries } of entriesByUri.values()) {
					diagnostics.set(targetUri, entries);
					diagnosticUris.push(targetUri);
				}
				diagnosticUrisByGeneratedFile.set(result.file, diagnosticUris);
				outputChannel.appendLine(
					`Firestorm compile failed (${errors.length} error(s)): ${result.file}`
				);
			}

			sendLlsdResponse(response, 200);
		});
	});

	server.on('error', error => {
		outputChannel.appendLine(`Firestorm diagnostics bridge failed: ${error.message}`);
		vscode.window.showErrorMessage(`Could not start the Firestorm diagnostics bridge: ${error.message}`);
	});
	server.listen(FIRESTORM_BRIDGE_PORT, '127.0.0.1', () => {
		outputChannel.appendLine(`Firestorm diagnostics bridge listening on 127.0.0.1:${FIRESTORM_BRIDGE_PORT}`);
	});
	context.subscriptions.push({ dispose: () => server.close() });
	context.subscriptions.push(vscode.workspace.onDidCloseTextDocument(document => {
		diagnostics.delete(document.uri);
	}));
}

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
				this.outputChannel.appendLine("Loaded " + String(Object.keys(this.snippets).length) + " snippets.");
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
	let outputChannel = vscode.window.createOutputChannel('Noras LSL-FP');
	context.subscriptions.push(outputChannel);
	const diagnostics = vscode.languages.createDiagnosticCollection('firestorm-lsl');
	context.subscriptions.push(diagnostics);
	const bridgeOutputChannel = vscode.window.createOutputChannel('Firestorm Bridge');
	context.subscriptions.push(bridgeOutputChannel);
	startFirestormBridge(context, diagnostics, outputChannel, bridgeOutputChannel);
	context.subscriptions.push(vscode.commands.registerCommand('noras-lsl-fp.showFirestormBridgeOutput', () => {
		bridgeOutputChannel.show();
	}));

	const hoverProvider = new SnippetHoverProvider(outputChannel);
	context.subscriptions.push(
		vscode.languages.registerHoverProvider(
			{ scheme: 'file', language: 'lsl' },
			hoverProvider
		)
	);

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
