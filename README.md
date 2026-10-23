# LSL-FP

This extension adds syntaxes Highlighting and Code Snippets for Firestorm LSL Preprocessor

## Features

Support for Firestorm LSL Preprocessor syntaxes Highlighting and Code Snippets

Image Sample:

![sample](images/sample.png)


## Requirements

1. install LSL-FP in VSCode (Visual Studio Code)
2. Install Firestorm Viewer
3. Enable LSL Preprocessor in Firestorm Viewer
4. Enable '#includes from local disk' in Firestorm Viewer
5. Open 'External Script Editor' in Firestorm Viewer
6. Enjoy Scripting

## Firestorm compile diagnostics in VS Code

The Nora LSL-FP extension can receive compile results from a Firestorm build containing the matching viewer change. Open a script with Firestorm's External Script Editor configured to launch VS Code, then compile it in Firestorm. Errors are published as VS Code diagnostics on that external-editor file; a successful compile clears the previous diagnostics.

The extension listens only on `127.0.0.1:39097`. Firestorm sends the compile result to that loopback address only when the script is open in an external editor. Keep the external editor file open in VS Code so diagnostics refer to the right script. Preprocessor-generated line numbers may not correspond to the original source file.

The Firestorm bridge change is in `indra/newview/llpreviewscript.cpp`; rebuild Firestorm from that checkout to enable the viewer side. If the bridge port is already in use, check the **Noras LSL-FP** output channel for the startup error.


## Known Issues

- Code Snippets for LSL All Constants Description.


## Release Notes


### 1.2.1 (2019-04-29)
- Fixed switch scope in Code Snippets

### 1.2.0 (2019-04-29)
- Added Code Snippets for "pragma once" implement

### 1.1.3 (2019-04-19)
- Added Code Snippets for Missing Constants

### 1.1.2 (2019-04-19)
- Fixed listen parameter in Code Snippets

### 1.1.1 (2019-04-10)
- Added Syntax Highlight for 'state' keyword
- Remove Syntax Highlight for junk keywords

### 1.1.0 (2019-04-10)
- Added Code Snippets for LSL Event
- Added Code Snippets for XP Constants
- Added Code Snippets for llTransfer* Function Error Tag Constants

### 1.0.0 (2019-04-10)

- Initial release
- Added syntax Highlighting for LSL Flow Control.
- Added syntax Highlighting for LSL Types.
- Added syntax Highlighting for Firestorm LSL Preprocesser.
- Added Code Snippets for LSL Flow Control.
- Added Code Snippets for switch of Firestorm LSL Preprocesser.
- Added Code Snippets for LSL All Function.
- Added Code Snippets for LSL All Constants except Description.

-----------------------------------------------------------------------------------------------------------

### For more information

* [Firestorm Viewer](https://www.firestormviewer.org/)
* [Firestorm LSL Preprocessor Reference](https://wiki.phoenixviewer.com/fs_preprocessor)
* [LSL Potal](http://wiki.secondlife.com/wiki/LSL_Portal)
* [Github Repository](https://github.com/dalghost/vscode-lsl-fp)

**Enjoy Scripting!**
