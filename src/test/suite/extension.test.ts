import * as assert from 'assert';

// You can import and use all API from the 'vscode' module
// as well as import your extension to test it
import * as vscode from 'vscode';
import { parseFirestormDiagnosticLocation, parseFirestormResult } from '../../extension';

suite('Extension Test Suite', () => {
	vscode.window.showInformationMessage('Start all tests.');

	test('Sample test', () => {
		assert.strictEqual(-1, [1, 2, 3].indexOf(5));
		assert.strictEqual(-1, [1, 2, 3].indexOf(0));
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
