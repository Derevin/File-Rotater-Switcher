import * as assert from 'assert';
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

const sleep = (ms: number) => new Promise(res => setTimeout(res, ms));

function assertPathsEqual(actual: string, expected: string, message?: string) {
    const normActual = path.resolve(path.normalize(actual)).toLowerCase();
    const normExpected = path.resolve(path.normalize(expected)).toLowerCase();
    assert.strictEqual(normActual, normExpected, message);
}

class TestEnv {
    public rootDir: string;

    constructor() {
        // We use the first open workspace folder (configured in runTest.ts)
        if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
            this.rootDir = vscode.workspace.workspaceFolders[0].uri.fsPath;
        } else {
            // Fallback (shouldn't happen if runTest.ts is correct)
            this.rootDir = path.join(__dirname, 'test-workspace');
        }
    }

    async setup() {
        // Clean the workspace before every test
        this.cleanDir(this.rootDir);
    }

    async teardown() {
        // Clean the workspace after every test
        this.cleanDir(this.rootDir);
        
        // Reset Config
        const config = vscode.workspace.getConfiguration('file-rs');
        await config.update('extensionRotations', undefined, vscode.ConfigurationTarget.Global);
        await config.update('blacklistedFilePaths', undefined, vscode.ConfigurationTarget.Global);
        await config.update('blacklistedDirectories', undefined, vscode.ConfigurationTarget.Global);
        await config.update('searchOtherDirectiories', undefined, vscode.ConfigurationTarget.Global);
        await config.update('commonPathSearch', undefined, vscode.ConfigurationTarget.Global);
        await config.update('commonPathSearchTiebreakerFewestSegments', undefined, vscode.ConfigurationTarget.Global);
    }

    private cleanDir(dirPath: string) {
        if (fs.existsSync(dirPath)) {
            const files = fs.readdirSync(dirPath);
            for (const file of files) {
                const curPath = path.join(dirPath, file);
                if (fs.lstatSync(curPath).isDirectory()) {
                    fs.rmSync(curPath, { recursive: true, force: true });
                } else {
                    fs.unlinkSync(curPath);
                }
            }
        }
    }

    createFile(relativePath: string, content: string = '// test'): string {
        const fullPath = path.join(this.rootDir, relativePath);
        const dir = path.dirname(fullPath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(fullPath, content);
        return fullPath;
    }

    async setConfig(key: string, value: any) {
        await vscode.workspace.getConfiguration('file-rs').update(key, value, vscode.ConfigurationTarget.Global);
        await sleep(200); 
    }

    async waitForIndexer(baseName: string, extension: string) {
        // Because we now have a real workspace open, findFiles will work correctly
        const pattern = `**/${baseName}${extension}`;
        let retries = 0;
        while (retries < 20) { // Wait up to 5 seconds (20 * 250ms)
            const files = await vscode.workspace.findFiles(pattern, null, 1);
            if (files.length > 0) {
                return; 
            }
            await sleep(250);
            retries++;
        }
        console.warn(`[WARN] Indexer did not find ${pattern} in time.`);
    }
}

suite('File Rotation Advanced Test Suite', () => {
    const env = new TestEnv();

    setup(async () => {
        await env.setup();
    });

    teardown(async () => {
        await env.teardown();
    });

    test('Basic Rotation: Simple .h to .cpp', async () => {
        const hFile = env.createFile('main.h');
        const cppFile = env.createFile('main.cpp');

        await env.setConfig('extensionRotations', [[".h", ".cpp"]]);

        const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(hFile));
        await vscode.window.showTextDocument(doc);
        await vscode.commands.executeCommand('file-rs.rotateNext');
        await sleep(500);

        assertPathsEqual(vscode.window.activeTextEditor!.document.fileName, cppFile);
    });

    test('Bug Fix: Longest Suffix Match (_private.h vs .h)', async () => {
        const privateH = env.createFile('component_private.h');
        const cppFile = env.createFile('component.cpp');

        const rotations = [[
            [".h", ".hh"],      
            ["_private.h"],     
            [".cpp", ".cc"]     
        ]];
        await env.setConfig('extensionRotations', rotations);

        const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(privateH));
        await vscode.window.showTextDocument(doc);
        await vscode.commands.executeCommand('file-rs.rotateNext');
        await sleep(500);

        assertPathsEqual(vscode.window.activeTextEditor!.document.fileName, cppFile);
    });

    test('Logic: Reverse Rotation (Previous)', async () => {
        const fileA = env.createFile('view.xml');
        const fileB = env.createFile('view.ts');
        const fileC = env.createFile('view.css');

        await env.setConfig('extensionRotations', [[".xml", ".ts", ".css"]]);

        const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(fileB));
        await vscode.window.showTextDocument(doc);
        await vscode.commands.executeCommand('file-rs.rotatePrevious');
        await sleep(500);

        assertPathsEqual(vscode.window.activeTextEditor!.document.fileName, fileA);
    });

    test('Blacklist: Directory Exclusion', async () => {
        const fileTs = env.createFile('app.ts');
        env.createFile('build/app.css'); // Junk
        const fileCssReal = env.createFile('styles/app.css'); // Real

        await env.setConfig('extensionRotations', [[".ts", ".css"]]);
        await env.setConfig('blacklistedDirectories', ["build"]);
        await env.setConfig('searchOtherDirectiories', true);

        await env.waitForIndexer('app', '.css');

        const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(fileTs));
        await vscode.window.showTextDocument(doc);
        
        await vscode.commands.executeCommand('file-rs.rotateNext');
        await sleep(500);

        assertPathsEqual(vscode.window.activeTextEditor!.document.fileName, fileCssReal);
    });

    test('Blacklist: Specific File Path Exclusion', async () => {
        const startFile = env.createFile('foo.js');
        const badFile = env.createFile('old/foo.test.js');
        const goodFile = env.createFile('new/foo.test.js');

        await env.setConfig('extensionRotations', [[".js", ".test.js"]]);
        await env.setConfig('blacklistedFilePaths', [badFile]); 
        await env.setConfig('searchOtherDirectiories', true);
        
        await env.waitForIndexer('foo', '.test.js');

        const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(startFile));
        await vscode.window.showTextDocument(doc);
        await vscode.commands.executeCommand('file-rs.rotateNext');
        await sleep(500);

        assertPathsEqual(vscode.window.activeTextEditor!.document.fileName, goodFile);
    });

    test('Heuristic: Tie-breaker with Fewest Segments', async () => {
        const startFile = env.createFile('src/a.ts');
        env.createFile('src/deep/nested/folder/a.html');
        const shallowFile = env.createFile('src/shallow/a.html');

        await env.setConfig('extensionRotations', [[".ts", ".html"]]);
        await env.setConfig('commonPathSearch', true);
        await env.setConfig('commonPathSearchTiebreakerFewestSegments', true);
        await env.setConfig('searchOtherDirectiories', true);

        await env.waitForIndexer('a', '.html');

        const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(startFile));
        await vscode.window.showTextDocument(doc);
        await vscode.commands.executeCommand('file-rs.rotateNext');
        await sleep(500);

        assertPathsEqual(vscode.window.activeTextEditor!.document.fileName, shallowFile);
    });
});