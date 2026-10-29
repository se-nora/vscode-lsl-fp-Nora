// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import * as http from 'http';
import * as path from 'path';
import * as fs from 'fs';

const FIRESTORM_BRIDGE_PORT = 39097;
const MAX_BRIDGE_REQUEST_BYTES = 1024 * 1024;

interface FirestormMappedError {
	file: string;
	message: string;
}

interface FirestormCompileResult {
	file: string;
	diagnosticFile?: string;
	success: boolean;
	errors: string[];
	mappedErrors: FirestormMappedError[];
}

interface FirestormDiagnosticLocation {
	line: number;
	character: number;
}

export function parseFirestormDiagnosticLocation(
	message: string,
	lineIsZeroBased = false
): FirestormDiagnosticLocation | undefined {
	const match = /^\s*\((\d+)\s*,\s*(\d+)\)\s*:\s*(.*)$/.exec(message.trim());
	if (!match) {
		return undefined;
	}

	const line = Number(match[1]);
	const column = Number(match[2]);
	if (!Number.isSafeInteger(line) || !Number.isSafeInteger(column) ||
		line < (lineIsZeroBased ? 0 : 1) || column < 1) {
		return undefined;
	}

	return { line: lineIsZeroBased ? line : line - 1, character: column - 1 };
}

export interface DeclaredVariable {
	name: string;
	type: string;
}

export interface DeclaredSymbol {
	name: string;
	kind: 'variable' | 'function' | 'define';
	type?: string;
	parameters?: string;
}

function stripCommentsAndStrings(text: string): string {
	return text.replace(/\/\*[\s\S]*?\*\/|\/\/[^\r\n]*|"(?:\\.|[^"\\])*"/g, match =>
		match.replace(/[^\r\n]/g, ' ')
	);
}

export function getDeclaredVariables(text: string): DeclaredVariable[] {
	const code = stripCommentsAndStrings(text);
	const variables = new Map<string, DeclaredVariable>();
	const declarationPattern = /\b(integer|float|string|key|vector|rotation|list)\s+([A-Za-z_]\w*)\b/g;
	let match: RegExpExecArray | null;
	while ((match = declarationPattern.exec(code)) !== null) {
		if (/^\s*\(/.test(code.slice(declarationPattern.lastIndex))) {
			continue;
		}
		variables.set(match[2], { name: match[2], type: match[1] });
	}

	return [...variables.values()];
}

export function getDeclaredSymbols(text: string): DeclaredSymbol[] {
	const code = stripCommentsAndStrings(text);
	const symbols = new Map<string, DeclaredSymbol>(
		getDeclaredVariables(text).map(variable => [
			variable.name,
			{ name: variable.name, kind: 'variable', type: variable.type }
		])
	);
	const functionPattern = /\b(integer|float|string|key|vector|rotation|list|void)\s+([A-Za-z_]\w*)\s*\(([^)]*)\)/g;
	let match: RegExpExecArray | null;
	while ((match = functionPattern.exec(code)) !== null) {
		symbols.set(match[2], {
			name: match[2],
			kind: 'function',
			type: match[1],
			parameters: match[3].trim()
		});
	}

	const definePattern = /^\s*#\s*define\s+([A-Za-z_]\w*)(?:\(([^)]*)\))?/gm;
	while ((match = definePattern.exec(code)) !== null) {
		symbols.set(match[1], {
			name: match[1],
			kind: 'define',
			...(match[2] !== undefined ? { parameters: match[2].trim() } : {})
		});
	}

	return [...symbols.values()];
}

function getIncludedFiles(text: string): string[] {
	const code = text.replace(/"(?:\\.|[^"\\])*"|\/\*[\s\S]*?\*\/|\/\/[^\r\n]*/g, match =>
		match.startsWith('"') ? match : match.replace(/[^\r\n]/g, ' ')
	);
	const includes: string[] = [];
	const includePattern = /^\s*#\s*(?:include|include_next|import)\s*(?:"([^"\r\n]+)"|<([^>\r\n]+)>)/gm;
	let match: RegExpExecArray | null;
	while ((match = includePattern.exec(code)) !== null) {
		includes.push(match[1] ?? match[2]);
	}

	return includes;
}

export async function collectDeclaredSymbols(
	uri: vscode.Uri,
	text: string,
	readDocument: (uri: vscode.Uri) => Promise<string>,
	workspaceFolders: readonly vscode.WorkspaceFolder[] = vscode.workspace.workspaceFolders ?? []
): Promise<DeclaredSymbol[]> {
	const symbols = new Map<string, DeclaredSymbol>();
	const visited = new Set<string>();

	const visit = async (documentUri: vscode.Uri, documentText: string): Promise<void> => {
		const documentKey = documentUri.toString();
		if (visited.has(documentKey)) {
			return;
		}
		visited.add(documentKey);

		for (const symbol of getDeclaredSymbols(documentText)) {
			if (!symbols.has(symbol.name)) {
				symbols.set(symbol.name, symbol);
			}
		}

		for (const includePath of getIncludedFiles(documentText)) {
			const candidates = [
				vscode.Uri.joinPath(documentUri, '..', includePath),
				...workspaceFolders.map(folder => vscode.Uri.joinPath(folder.uri, includePath))
			];
			const checkedCandidates = new Set<string>();
			for (const candidate of candidates) {
				const candidateKey = candidate.toString();
				if (checkedCandidates.has(candidateKey)) {
					continue;
				}
				checkedCandidates.add(candidateKey);
				try {
					await visit(candidate, await readDocument(candidate));
					break;
				} catch (error) {
					if (error instanceof vscode.FileSystemError && error.code === 'FileNotFound') {
						continue;
					}
					throw error;
				}
			}
		}
	};

	await visit(uri, text);
	return [...symbols.values()];
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

export function parseFirestormResult(xml: string): FirestormCompileResult | undefined {
	const file = readXmlString(xml, 'file');
	const diagnosticFile = readXmlString(xml, 'diagnostic_file');
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

	const mappedErrorsMatch = /<key>mapped_errors<\/key>\s*<array>([\s\S]*?)<\/array>/.exec(xml);
	const mappedErrors: FirestormMappedError[] = [];
	if (mappedErrorsMatch) {
		const mapPattern = /<map>([\s\S]*?)<\/map>/g;
		let mapMatch: RegExpExecArray | null;
		while ((mapMatch = mapPattern.exec(mappedErrorsMatch[1])) !== null) {
			const mappedFile = readXmlString(mapMatch[1], 'file');
			const messageMatch = /<key>message<\/key>\s*<string>([\s\S]*?)<\/string>/.exec(mapMatch[1]);
			if (mappedFile && messageMatch) {
				mappedErrors.push({ file: mappedFile, message: decodeXmlText(messageMatch[1]) });
			}
		}
	}

	return {
		file,
		...(diagnosticFile ? { diagnosticFile } : {}),
		success: successMatch[1] === '1' || successMatch[1].toLowerCase() === 'true',
		errors,
		mappedErrors
	};
}

function sendLlsdResponse(response: http.ServerResponse, statusCode: number): void {
	response.setHeader('Content-Type', 'application/llsd+xml');
	response.statusCode = statusCode;
	response.end('<?xml version="1.0"?><llsd><map/></llsd>');
}

function getOriginalDiagnosticUri(result: FirestormCompileResult): vscode.Uri {
	if (result.diagnosticFile && path.isAbsolute(result.diagnosticFile)) {
		return vscode.Uri.file(result.diagnosticFile);
	}

	const originalPath = path.parse(result.file);
	const preprocessedPath = path.join(originalPath.dir, `${originalPath.name}.preprocessed.lsl`);
	if (fs.existsSync(preprocessedPath)) {
		return vscode.Uri.file(preprocessedPath);
	}

	return vscode.Uri.file(result.file);
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
				const originalDiagnosticUri = getOriginalDiagnosticUri(result);
				bridgeOutputChannel.appendLine(
					`Original compiler diagnostics target: ${originalDiagnosticUri.fsPath}`
				);
				const addDiagnostic = (
					message: string,
					diagnosticUri: vscode.Uri,
					lineIsZeroBased = false
				): void => {
					const location = parseFirestormDiagnosticLocation(message, lineIsZeroBased);
					bridgeOutputChannel.appendLine(`Translating Firestorm diagnostic: ${message}`);
					let line = 0;
					let character = 0;
					if (!location) {
						bridgeOutputChannel.appendLine(
							'Could not parse a line and column; using the start of the target file.'
						);
					} else {
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
				};
				for (const message of errors) {
					addDiagnostic(message, originalDiagnosticUri, Boolean(result.diagnosticFile));
				}
				for (const mappedError of result.mappedErrors) {
					if (!path.isAbsolute(mappedError.file)) {
						bridgeOutputChannel.appendLine(
							`Rejected mapped Firestorm diagnostic with non-absolute path "${mappedError.file}".`
						);
						continue;
					}
					addDiagnostic(mappedError.message, vscode.Uri.file(mappedError.file));
				}
				const diagnosticUris: vscode.Uri[] = [];
				for (const { uri: targetUri, entries } of entriesByUri.values()) {
					diagnostics.set(targetUri, entries);
					diagnosticUris.push(targetUri);
				}
				diagnosticUrisByGeneratedFile.set(result.file, diagnosticUris);
				outputChannel.appendLine(
					`Firestorm compile failed (${errors.length} original, ${result.mappedErrors.length} mapped): ${result.file}`
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

class VariableCompletionProvider implements vscode.CompletionItemProvider {
	async provideCompletionItems(document: vscode.TextDocument): Promise<vscode.CompletionItem[]> {
		const symbols = await collectDeclaredSymbols(
			document.uri,
			document.getText(),
			async uri => {
				const openDocument = vscode.workspace.textDocuments.find(
					candidate => candidate.uri.toString() === uri.toString()
				);
				if (openDocument) {
					return openDocument.getText();
				}
				return new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
			}
		);
		return symbols.map(symbol => {
			const kind = symbol.kind === 'function'
				? vscode.CompletionItemKind.Function
				: symbol.kind === 'define'
					? vscode.CompletionItemKind.Constant
					: vscode.CompletionItemKind.Variable;
			const label = symbol.kind === 'function' ||
				(symbol.kind === 'define' && symbol.parameters !== undefined)
				? { label: symbol.name, detail: `(${symbol.parameters ?? ''})` }
				: symbol.name;
			const item = new vscode.CompletionItem(label, kind);
			item.detail = symbol.kind === 'define' ? '#define' : symbol.type;
			return item;
		});
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
	context.subscriptions.push(
		vscode.languages.registerCompletionItemProvider(
			{ scheme: 'file', language: 'lsl' },
			new VariableCompletionProvider()
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
