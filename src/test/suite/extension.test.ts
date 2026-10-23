import * as assert from 'assert';

// You can import and use all API from the 'vscode' module
// as well as import your extension to test it
import * as vscode from 'vscode';
import { parseFirestormResult } from '../../extension';

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
			'</map></llsd>'
		);

		assert.deepStrictEqual(result, {
			file: 'C:\\Scripts\\sample&test.lsl',
			success: false,
			errors: ['(2, 3) : bad <token>']
		});
	});

	test('rejects malformed Firestorm compile results', () => {
		assert.strictEqual(parseFirestormResult('<llsd><map/></llsd>'), undefined);
	});
});
