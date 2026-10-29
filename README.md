# Noras-LSL-FP

This extension adds syntaxes Highlighting and Code Snippets for Firestorm LSL Preprocessor
It is a fork of https://github.com/dalghost/vscode-lsl-fp / https://marketplace.visualstudio.com/itemdetails?itemName=DalGhost.lsl-fp
With additional functionalities and updated consts/functions/events

## Features

Support for Firestorm LSL Preprocessor syntax highlighting, code snippets, and completion suggestions for variables, functions and function-like `#define` macros (including their parameters), and object-like `#define` names declared in the current script and its included files.

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


## Changelog

See [CHANGELOG.md](CHANGELOG.md) for the release history.

### For more information

* [Firestorm Viewer](https://www.firestormviewer.org/)
* [Firestorm LSL Preprocessor Reference](https://wiki.firestormviewer.org/fs_preprocessor)
* [LSL Potal](http://wiki.secondlife.com/wiki/LSL_Portal)
* [Github Repository](https://github.com/dalghost/vscode-lsl-fp)

**Enjoy Scripting!**
