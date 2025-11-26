import * as path from 'path';
import * as fs from 'fs';
import { runTests } from '@vscode/test-electron';

async function main() {
    try {
        const extensionDevelopmentPath = path.resolve(__dirname, '../../');
        const extensionTestsPath = path.resolve(__dirname, './suite/index');

        // 1. Create a dedicated test workspace folder in your project root
        const testWorkspacePath = path.resolve(__dirname, '../../test-workspace');
        if (!fs.existsSync(testWorkspacePath)) {
            fs.mkdirSync(testWorkspacePath);
        }

        // Download VS Code, unzip it and run the integration test
        await runTests({ 
            version: '1.93.1', // Keep this pinned
            extensionDevelopmentPath, 
            extensionTestsPath,
            // 2. Tell VS Code to OPEN this folder on launch
            launchArgs: [testWorkspacePath] 
        });
    } catch (err) {
        console.error('Failed to run tests');
        process.exit(1);
    }
}

main();