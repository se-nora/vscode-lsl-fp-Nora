import * as assert from 'assert';

// You can import and use all API from the 'vscode' module
// as well as import your extension to test it
import * as vscode from 'vscode';
import {
	collectDeclaredSymbols,
	getDeclaredSymbols,
	getDeclaredVariables,
	parseFirestormDiagnosticLocation,
	parseFirestormResult
} from '../../extension';

suite('Extension Test Suite', () => {
	vscode.window.showInformationMessage('Start all tests.');

	test('Sample test', () => {
		assert.strictEqual(-1, [1, 2, 3].indexOf(5));
		assert.strictEqual(-1, [1, 2, 3].indexOf(0));
	});

	test('finds declared variables for completion and ignores comments and strings', () => {
		assert.deepStrictEqual(
			getDeclaredVariables(
				'float blablabla;\n' +
				'integer count = 0;\n' +
				'string message = "float notAVariable;";\n' +
				'// key alsoNotAVariable;\n' +
				'/* vector neitherIsThis; */\n' +
				'list items;\n' +
				'float getValue(integer parameter) { return parameter; }'
			),
			[
				{ name: 'blablabla', type: 'float' },
				{ name: 'count', type: 'integer' },
				{ name: 'message', type: 'string' },
				{ name: 'items', type: 'list' },
				{ name: 'parameter', type: 'integer' }
			]
		);
	});

	test('finds declared functions and preprocessor defines for completion', () => {
		assert.deepStrictEqual(
			getDeclaredSymbols(
				'#define MAX_COUNT 10\n' +
				'# define FORMAT(value) value\n' +
				'// #define COMMENTED_OUT 1\n' +
				'/* integer hiddenFunction() { } */\n' +
				'integer getCount() { return MAX_COUNT; }\n' +
				'float calculate(float input);\n' +
				'string message = "integer fakeFunction()";'
			),
			[
				{ name: 'input', kind: 'variable', type: 'float' },
				{ name: 'message', kind: 'variable', type: 'string' },
				{ name: 'getCount', kind: 'function', type: 'integer', parameters: '' },
				{ name: 'calculate', kind: 'function', type: 'float', parameters: 'float input' },
				{ name: 'MAX_COUNT', kind: 'define' },
				{ name: 'FORMAT', kind: 'define', parameters: 'value' }
			]
		);
	});

	test('preserves function-like define parameters without mistaking replacements for parameters', () => {
		assert.deepStrictEqual(
			getDeclaredSymbols(
				'#define WRAP(value, ...) ((value) + __VA_ARGS__)\n' +
				'#define CONSTANT (1 + 2)'
			).filter(symbol => symbol.kind === 'define'),
			[
				{ name: 'WRAP', kind: 'define', parameters: 'value, ...' },
				{ name: 'CONSTANT', kind: 'define' }
			]
		);
	});

	test('preserves all function parameters for completion labels', () => {
		assert.deepStrictEqual(
			getDeclaredSymbols('list makeVector(vector start, vector end, float amount) { }')
				.find(symbol => symbol.name === 'makeVector'),
			{
				name: 'makeVector',
				kind: 'function',
				type: 'list',
				parameters: 'vector start, vector end, float amount'
			}
		);
	});

	test('collects symbols recursively from included files and avoids include cycles', async () => {
		const mainUri = vscode.Uri.file('C:\\lsl-project\\scripts\\main.lsl');
		const workspaceUri = vscode.Uri.file('C:\\lsl-project');
		const headerUri = vscode.Uri.file('C:\\lsl-project\\includes\\common.lsl');
		const nestedUri = vscode.Uri.file('C:\\lsl-project\\includes\\nested.lsl');
		const files = new Map<string, string>([
			[mainUri.toString(), '#include "includes/common.lsl"\nfloat localValue;'],
			[headerUri.toString(), '#include "nested.lsl"\ninteger localValue;\nfloat sharedValue;'],
			[nestedUri.toString(), '#include "../scripts/main.lsl"\n#define SHARED_LIMIT 5\ninteger sharedFunction() { }']
		]);

		const symbols = await collectDeclaredSymbols(
			mainUri,
			'#include "includes/common.lsl"\nfloat localValue;',
			async uri => {
				const content = files.get(uri.toString());
				if (content === undefined) {
					throw vscode.FileSystemError.FileNotFound(uri);
				}
				return content;
			},
			[{ uri: workspaceUri, name: 'lsl-project', index: 0 }]
		);

		assert.deepStrictEqual(symbols, [
			{ name: 'localValue', kind: 'variable', type: 'float' },
			{ name: 'sharedValue', kind: 'variable', type: 'float' },
			{ name: 'sharedFunction', kind: 'function', type: 'integer' },
			{ name: 'SHARED_LIMIT', kind: 'define' }
		]);
	});

	test('parses Firestorm compile results', () => {
		const result = parseFirestormResult(
			'<llsd><map>' +
			'<key>file</key><string>C:\\Scripts\\sample&amp;test.lsl</string>' +
			'<key>diagnostic_file</key><string>C:\\Scripts\\sample.preprocessed.lsl</string>' +
			'<key>success</key><boolean>0</boolean>' +
			'<key>errors</key><array><string>(2, 3) : bad &lt;token&gt;</string></array>' +
			'<key>mapped_errors</key><array><map>' +
			'<key>file</key><string>C:\\Scripts\\source&amp;test.lsl</string>' +
			'<key>message</key><string>(17, 3) : bad &lt;token&gt;</string>' +
			'</map></array>' +
			'</map></llsd>'
		);

		assert.deepStrictEqual(result, {
			file: 'C:\\Scripts\\sample&test.lsl',
			diagnosticFile: 'C:\\Scripts\\sample.preprocessed.lsl',
			success: false,
			errors: ['(2, 3) : bad <token>'],
			mappedErrors: [{
				file: 'C:\\Scripts\\source&test.lsl',
				message: '(17, 3) : bad <token>'
			}]
		});
	});

	test('parses successful Firestorm results with an empty self-closing errors array', () => {
		assert.deepStrictEqual(
			parseFirestormResult(
				'<llsd><map>' +
				'<key>errors</key><array />' +
				'<key>file</key><string>C:\\Scripts\\sample.lsl</string>' +
				'<key>success</key><boolean>1</boolean>' +
				'</map></llsd>'
			),
			{
				file: 'C:\\Scripts\\sample.lsl',
				success: true,
				errors: [],
				mappedErrors: []
			}
		);
	});

	test('parses Firestorm one-based error line and column', () => {
		assert.deepStrictEqual(
			parseFirestormDiagnosticLocation('(23, 4) : ERROR : Syntax error'),
			{ line: 22, character: 3 }
		);
	});

	test('preserves zero-based Firestorm lines for preprocessed diagnostics', () => {
		assert.deepStrictEqual(
			parseFirestormDiagnosticLocation('(22, 22) : ERROR : Name not defined within scope', true),
			{ line: 22, character: 21 }
		);
		assert.deepStrictEqual(
			parseFirestormDiagnosticLocation('(0, 1) : ERROR : Syntax error', true),
			{ line: 0, character: 0 }
		);
	});

	test('parses Firestorm diagnostic locations with trailing newlines', () => {
		assert.deepStrictEqual(
			parseFirestormDiagnosticLocation('(23, 4) : ERROR : Syntax error\r\n'),
			{ line: 22, character: 3 }
		);
	});

	test('rejects malformed Firestorm compile results', () => {
		assert.strictEqual(parseFirestormResult('<llsd><map/></llsd>'), undefined);
	});

	test('rejects invalid Firestorm diagnostic locations', () => {
		assert.strictEqual(parseFirestormDiagnosticLocation('ERROR : Syntax error'), undefined);
		assert.strictEqual(parseFirestormDiagnosticLocation('(0, 4) : ERROR : Syntax error'), undefined);
	});
});
