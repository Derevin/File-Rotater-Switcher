import * as vscode from 'vscode';
import * as path from "path";
import * as fs from 'fs';
import { Config } from './config';

function normalizePath(p: string): string {
    let normalized = path.normalize(p);
    // Lowercase drive letter on Windows
    if (process.platform === 'win32' && /^[a-zA-Z]:/.test(normalized)) {
        normalized = normalized.charAt(0).toLowerCase() + normalized.slice(1);
    }
    return normalized;
}

function isFilePathBlacklisted(fPath : string) : boolean {
    const normPath = normalizePath(fPath);
    return Config.getBlacklistedFilePaths().some((bFilePath) => {
        return normPath === normalizePath(bFilePath); 
    });
}

function isDirectoryBlacklisted(fPath : string) : boolean {
    const normPath = normalizePath(fPath);
    return Config.getBlacklistedDirectories().some((directory) => { 
        const normBlacklist = normalizePath(directory);

        // Exact match of directory
        if (normPath === normBlacklist) {return true; };

        // Check for directory in the middle of path: /some/path/build/foo -> includes \build\
        if (normPath.includes(path.sep + normBlacklist + path.sep)) {return true; };

        // Check for directory at end of path: /some/path/build -> ends with \build
        if (normPath.endsWith(path.sep + normBlacklist)) {return true; };

        // Check for directory at start of path: build/foo -> starts with build\
        if (normPath.startsWith(normBlacklist + path.sep)) {return true; };

        return false;
    });
}

async function getCorresponding(allowedExtension : Array<string>, baseName: string, currentFileInfo : path.ParsedPath) : Promise<(string|undefined)>{
    // 1. Current Directory Search
    if (!isDirectoryBlacklisted(currentFileInfo.dir)){
        const curDirFiles = await fs.promises.readdir(currentFileInfo.dir);
        const result = curDirFiles.find((file) => {
            if (isFilePathBlacklisted(path.join(currentFileInfo.dir, file))){
                return false;
            }
            return allowedExtension.some(suffix => file === baseName + suffix);
        });

        if (result){
            return path.join(currentFileInfo.dir, result);
        }
    }

    if (!Config.getSearchOtherDirectiories()) { 
        return undefined;
    }

    // 2. Workspace Search
    const joinedAllowedExtensions = allowedExtension.join(',');
    const foundFiles = await vscode.workspace.findFiles(`**/${baseName}{${joinedAllowedExtensions}}`, undefined, undefined, undefined)
        .then((foundFiles) => { 
            return foundFiles.filter((fileUri) => {
                const fsPath = normalizePath(fileUri.fsPath);
                const fileInfo = path.parse(fsPath);
                
                // Pass the directory part to isDirectoryBlacklisted
                if (isDirectoryBlacklisted(fileInfo.dir) || isFilePathBlacklisted(fsPath)) {
                    return false;
                }
                return allowedExtension.some(suffix => fileInfo.base === baseName + suffix);
            }); 
        });

    if (foundFiles.length <= 0){ 
        return undefined;
    }

    if (foundFiles.length === 1){
        return foundFiles[0].fsPath;
    }

    // 3. Heuristics
    if (Config.getCommonPathSearch()){ 
        const commonLengths = foundFiles.map((fileUri) => {
            function splitPathSegments(dir: string): string[] {
                return dir.split(/[\\\/]+/).filter(segment => segment.length > 0);
            }
            
            function commonPathSegmentCount(dir1: string, dir2: string): number {
                const parts1 = splitPathSegments(normalizePath(dir1));
                const parts2 = splitPathSegments(normalizePath(dir2));
            
                let count = 0;
                for (let i = 0; i < Math.min(parts1.length, parts2.length); i++) {
                    if (parts1[i].toLowerCase() === parts2[i].toLowerCase()) {
                        count++;
                    } else {
                        break;
                    }
                }
                return count;
            }
            const fileInfo = path.parse(fileUri.fsPath);
            return commonPathSegmentCount(fileInfo.dir, currentFileInfo.dir);
        });
    
        function getIndicesOfHighestNumber(arr: number[]): number[] {
            if (arr.length === 0) {return []; };
            let maxNumber = arr[0];
            let indices = [0];
            for (let i = 1; i < arr.length; i++) {
                if (arr[i] > maxNumber) {
                    maxNumber = arr[i];
                    indices = [i];
                } else if (arr[i] === maxNumber) {
                    indices.push(i);
                }
            }
            return indices;
        }
    
        const highestIndices = getIndicesOfHighestNumber(commonLengths);
    
        if (highestIndices.length === 1){
            return foundFiles[highestIndices[0]].fsPath;
        }
        
        // Tie-breaker 1: Suffix Length
        const suffixLengths = highestIndices.map((idx) => {
            const fileUri = foundFiles[idx];
            function longestCommonSuffix(str1: string, str2: string): number {
                str1 = normalizePath(str1);
                str2 = normalizePath(str2);
                while (str1.endsWith(path.sep)) {str1 = str1.slice(0, -1); };
                while (str2.endsWith(path.sep)) {str2 = str2.slice(0, -1); };
                const minLength = Math.min(str1.length, str2.length);
                let commonSuffix = '';
                for (let i = 1; i <= minLength; i++) {
                    if (str1[str1.length - i].toLowerCase() !== str2[str2.length - i].toLowerCase()) {
                        break;
                    }
                    commonSuffix = str1[str1.length - i] + commonSuffix;
                }
                return commonSuffix.length;
            }
            const fileInfo = path.parse(fileUri.fsPath);
            return longestCommonSuffix(fileInfo.dir, currentFileInfo.dir);
        });

        function getIndexOfUniqueHighestNumber(arr: number[]): number | null {
            if (arr.length === 0) {return null; };
            let maxIndex = 0;
            let maxNumber = arr[0];
            let isUnique = true;
            for (let i = 1; i < arr.length; i++) {
                if (arr[i] > maxNumber) {
                    maxNumber = arr[i];
                    maxIndex = i;
                    isUnique = true;
                } else if (arr[i] === maxNumber) {
                    isUnique = false;
                }
            }
            return isUnique ? maxIndex : null;
        }

        const indexOfMaxSuffixLength = getIndexOfUniqueHighestNumber(suffixLengths);
        if (indexOfMaxSuffixLength !== null) {
            const highestSuffixIdx = highestIndices[indexOfMaxSuffixLength];
            return foundFiles[highestSuffixIdx].fsPath;
        }

        // Tie-breaker 2: Fewest Segments
        if (Config.getCommonPathSearchTiebreakerFewestSegments()){
            let finalCandidates: { idx: number; segmentCount: number }[] = [];
            for (let idx of highestIndices) {
                const fileUri = foundFiles[idx];
                const fileInfo = path.parse(fileUri.fsPath);
                const dirSegments = fileInfo.dir.split(/[\\/]+/).filter(s => s.length > 0).length;
                finalCandidates.push({ idx, segmentCount: dirSegments });
            }
        
            const minSegments = Math.min(...finalCandidates.map(c => c.segmentCount));
            const filtered = finalCandidates.filter(c => c.segmentCount === minSegments);
        
            if (filtered.length === 1) {
                return foundFiles[filtered[0].idx].fsPath;
            }
        }
    }

    const options = foundFiles.map((item) => {
        return {
            label: path.basename(item.fsPath),
            description: normalizePath(item.fsPath)
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

async function getCurrentRotationInfo(rotations: Array<Array<(string|Array<string>)>>, currentFileName : string) : Promise<(CurrentRotationInfo|undefined)>{
    let bestMatch: CurrentRotationInfo | undefined = undefined;
    let maxSuffixLength = -1;

    for (let rotation of rotations){
        for(let i in rotation){
            const index : number = Number(i);
            const step = rotation[index];
            
            let matchedSuffix: string | undefined = undefined;
            if (typeof(step) === 'string'){
                if (currentFileName.endsWith(step)){
                    matchedSuffix = step;
                }
            } else {
                matchedSuffix = step.find(sfx => currentFileName.endsWith(sfx));
            }

            if (matchedSuffix) {
                if (matchedSuffix.length > maxSuffixLength) {
                    maxSuffixLength = matchedSuffix.length;
                    bestMatch = { rotation, stepIdx: index };
                }
            }
        }
    }   
    return bestMatch;
}

// Fixed: Previous direction math
async function getDesiredRotationStep(currentRotationInfo: CurrentRotationInfo, dir : Direction, offset: number) : Promise<(string|Array<string>)>{
    const {rotation, stepIdx} = currentRotationInfo;
    const len = rotation.length;
    
    if (dir === Direction.next){
        return rotation[(stepIdx + offset) % len];
    } else { 
        let target = (stepIdx - offset) % len;
        if (target < 0) {target += len; };
        return rotation[target];
    }
}

async function rotate(dir : Direction) {
    if (!vscode.window.activeTextEditor) {
        return;
    }
    const currentFile : string = vscode.window.activeTextEditor.document.fileName;
    const currentFileInfo = path.parse(currentFile);
    const currentFileName = path.basename(currentFile);

    const rotations = Config.getExtensionRotations();
    if (!rotations){
        showError("Rotations are empty");
        return;
    }

    const currentRotationInfo = await getCurrentRotationInfo(rotations, currentFileName);
    if (!currentRotationInfo){
        showError(`Undefined rotation for ${currentFileName}`);
        return;
    }

    const matchedStep = currentRotationInfo.rotation[currentRotationInfo.stepIdx];
    const possibleSuffixes = (typeof matchedStep === 'string') ? [matchedStep] : matchedStep;
    
    let usedSuffix = '';
    for (const sf of possibleSuffixes) {
        if (currentFileName.endsWith(sf)) {
             if (sf.length > usedSuffix.length) {
                 usedSuffix = sf;
             }
        }
    }
    
    if (!usedSuffix){
        showError(`Unable to detect which suffix matched for ${currentFileName}`);
        return;
    }

    const baseName = currentFileName.slice(0, -usedSuffix.length);

    for(let i = 1; i < currentRotationInfo.rotation.length; ++i){
        const desiredStep : (string|Array<string>) = await getDesiredRotationStep(currentRotationInfo, dir, i);
        const desiredExtensions : Array<string> = typeof(desiredStep) === 'string' ? [desiredStep] : desiredStep;

        const correspondingFilePath : (string|undefined) = await getCorresponding(desiredExtensions, baseName, currentFileInfo);
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
