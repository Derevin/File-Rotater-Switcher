import * as vscode from 'vscode';


export namespace Config {
	function getConfig() {
		return vscode.workspace.getConfiguration('file-rs');
	}
	
	export function getExtensionRotations() : Array<Array<(string|Array<string>)>>  {
		return getConfig().get('extensionRotations') || [];
	}
	
	export function getBlacklistedFilePaths() : Array<string>  {
		return getConfig().get('blacklistedFilePaths') || [];
	}
	
	export function getBlacklistedDirectories() : Array<string>  {
		return getConfig().get('blacklistedDirectories') || [];
	}
	
	export function getShowMessages(): boolean {
		return getConfig().get('showMessages') || false;
	}

	export function getSearchOtherDirectiories(): boolean {
		return getConfig().get('searchOtherDirectiories') || false;
	}

	export function getAllowStepPassing(): boolean {
		return getConfig().get('allowStepPassing') || false;
	}
}