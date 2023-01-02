// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import { rotateNext, rotatePrevious } from "./rotate";

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
	context.subscriptions.push(vscode.commands.registerCommand('file-rs.rotateNext', rotateNext));
	context.subscriptions.push(vscode.commands.registerCommand('file-rs.rotatePrevious', rotatePrevious));
}

// This method is called when your extension is deactivated
export function deactivate() {}
