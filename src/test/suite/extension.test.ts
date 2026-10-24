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
			'<key>success</key><boolean>0</boolean>' +
			'<key>errors</key><array><string>(2, 3) : bad &lt;token&gt;</string></array>' +
			'<key>source_map_complete</key><boolean>true</boolean>' +
			'<key>source_map</key><array><map>' +
			'<key>generated_line</key><integer>2</integer>' +
			'<key>source_file</key><string>C:\\Scripts\\source.lsl</string>' +
			'<key>source_line</key><integer>17</integer>' +
			'</map></array>' +
			'</map></llsd>'
		);

		assert.deepStrictEqual(result, {
			file: 'C:\\Scripts\\sample&test.lsl',
			success: false,
			errors: ['(2, 3) : bad <token>'],
			sourceMap: [{
				generatedLine: 2,
				sourceFile: 'C:\\Scripts\\source.lsl',
				sourceLine: 17
			}],
			sourceMapComplete: true
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
				sourceMap: [],
				sourceMapComplete: false
			}
		);
	});

	test('parses Firestorm one-based error line and column', () => {
		assert.deepStrictEqual(
			parseFirestormDiagnosticLocation('(23, 4) : ERROR : Syntax error'),
			{ line: 22, character: 3 }
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
