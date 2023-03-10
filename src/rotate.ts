import * as vscode from 'vscode';
import * as path from "path";
import * as fs from 'fs';
import { Config } from './config';

function isFilePathBlacklisted(fPath : string) : boolean {
	return Config.getBlacklistedFilePaths().some((bFilePath) => {
		return path.normalize(fPath) === path.normalize(bFilePath); 
	});
}

function isDirectoryBlacklisted(fPath : string) : boolean {
	const fPathInfo = path.parse(path.normalize(fPath));
	const dirPath = fPathInfo.ext ? fPathInfo.dir : path.join(fPathInfo.dir, fPathInfo.base);
	return Config.getBlacklistedDirectories().some((directory) => { 
		return dirPath.includes(path.normalize(directory)); 
	});
}

async function getCorresponding(allowedExtension : Array<string>, currentFileInfo : path.ParsedPath) : Promise<(string|undefined)>{
	if (!isDirectoryBlacklisted(currentFileInfo.dir)){
		const curDirFiles = await fs.promises.readdir(currentFileInfo.dir);
		const result = curDirFiles.find((file) => {
			if (isFilePathBlacklisted(path.join(currentFileInfo.dir, file))){
				return false;
			}
			const fileInfo = path.parse(file);
			return fileInfo.name === currentFileInfo.name && allowedExtension.includes(fileInfo.ext);
		});

		if (result){
			return path.join(currentFileInfo.dir, result);
		}
	}

	if (!Config.getSearchOtherDirectiories()) { // nowhere else to search
		return undefined;
	}

	const joinedAllowedExtensions = allowedExtension.join(',');
	const foundFiles = await vscode.workspace.findFiles(`**/${currentFileInfo.name}{${joinedAllowedExtensions}}`, undefined, undefined, undefined)
						.then((foundFiles) => { 
							return foundFiles.filter((fileUri) => {
								const fileInfo = path.parse(path.normalize(fileUri.path.substring(1)));
								return !isDirectoryBlacklisted(fileInfo.dir) && !isFilePathBlacklisted(path.join(fileInfo.dir, fileInfo.base));
							}); 
						}
	);

	if (foundFiles.length <= 0){ // found nothing
		return undefined;
	}

	if (foundFiles.length === 1){
		return foundFiles[0].path.substring(1);
	}

	const options = foundFiles.map((item) => {
		return {
			label: path.basename(item.path),
			description: path.normalize(item.path.substring(1)) // Uri path variable has a leading '/' that we need to remove
		};
	});

	const pickedFile = await vscode.window.showQuickPick(options, {
		placeHolder: "Choose file to rotate to"
	});

	if (pickedFile){
		return pickedFile.description;
	}

	

	return undefined;
}

function showError(msg : string){
	if (Config.getShowMessages()){
		vscode.window.showErrorMessage(msg);
	}	
}

function showWarning(msg : string){
	if (Config.getShowMessages()){
		vscode.window.showWarningMessage(msg);
	}	
}

function showInfo(msg : string){
	if (Config.getShowMessages()){
		vscode.window.showInformationMessage(msg);
	}	
}


enum Direction {
	next, previous
}

interface CurrentRotationInfo{
	rotation : Array<(string|Array<string>)>;
	stepIdx : number;
}

async function getCurrentRotationInfo(rotations: Array<Array<(string|Array<string>)>>, currentExt : string) : Promise<(CurrentRotationInfo|undefined)>{
	for (let rotation of rotations){
		for(let i in rotation){
			const index : number = Number(i);
			const step = rotation[index];
			if ((typeof(step) === 'string' && step === currentExt) || (Array.isArray(step) && step.includes(currentExt))){
				return {rotation: rotation, stepIdx: index};
			} 
		}
	}	

	return undefined;
}

async function getDesiredRotationStep(currentRotationInfo: CurrentRotationInfo, dir : Direction, offset: number) : Promise<(string|Array<string>)>{
	const {rotation, stepIdx} = currentRotationInfo;
	if (dir === Direction.next){
		if (stepIdx + offset >= rotation.length){ // last index
			return rotation[stepIdx + offset - rotation.length];
		} else {
			return rotation[stepIdx + offset];
		}
	} else { // previous
		if (stepIdx - offset <= 0){
			return rotation[rotation.length - stepIdx - offset];
		} else {
			return rotation[stepIdx - offset];
		}
	}
}

async function rotate(dir : Direction) {
	if (!vscode.window.activeTextEditor) {
        return;
    }
	const currentFile : string = vscode.window.activeTextEditor.document.fileName;
    const currentFileInfo = path.parse(currentFile);
	if (!currentFileInfo.ext){
		showError("File has no extension");
		return;
	}

	const rotations = Config.getExtensionRotations();
	if (!rotations){
		showError("Rotations are empty");
		return;
	}

	const currentRotationInfo = await getCurrentRotationInfo(rotations, currentFileInfo.ext);
	if (!currentRotationInfo){
		showError(`Undefined rotation for ${currentFileInfo.ext}`);
		return;
	}

	for(let i = 1; i < currentRotationInfo.rotation.length; ++i){
		const desiredStep : (string|Array<string>) = await getDesiredRotationStep(currentRotationInfo, dir, i);		
		const desiredExtensions : Array<string> = typeof(desiredStep) === 'string' ? [desiredStep] : desiredStep;
		const correspondingFilePath : (string|undefined) = await getCorresponding(desiredExtensions, currentFileInfo);
		if (!correspondingFilePath){
			if (Config.getAllowStepPassing()){
				continue;
			} else {
				break;
			}
		}
	
		const uri = vscode.Uri.file(correspondingFilePath);
		const document = await vscode.workspace.openTextDocument(uri);
		await vscode.window.showTextDocument(document);
		return;
	}
	showWarning("No file to rotate to");
}

export async function rotateNext(){
	rotate(Direction.next);
}

export async function rotatePrevious(){
	rotate(Direction.previous);
}
