const vscode = require('vscode');
const fs = require('fs');
const path = require('path');

// 除外設定
const EXCLUDE_DIRS = new Set(['.git', '__pycache__', 'node_modules', '.venv', 'venv', 'dist', 'build', '.vscode']);
const EXCLUDE_FILES = new Set(['.DS_Store', 'package-lock.json', 'yarn.lock']);
const VALID_EXTENSIONS = new Set(['.py', '.c', '.h', '.java', '.js', '.ts', '.jsx', '.tsx', '.html', '.css', '.json', '.md', '.yml', '.yaml']);

function generateTree(dirPath, prefix = "") {
    let treeStr = "";
    const files = fs.readdirSync(dirPath).sort();
    const filtered = files.filter(f => !EXCLUDE_DIRS.has(f) && !EXCLUDE_FILES.has(f));

    filtered.forEach((file, i) => {
        const isLast = i === filtered.length - 1;
        const connector = isLast ? "└── " : "├── ";
        const fullPath = path.join(dirPath, file);
        const stats = fs.statSync(fullPath);

        if (stats.isDirectory()) {
            treeStr += `${prefix}${connector}${file}/\n`;
            const newPrefix = prefix + (isLast ? "    " : "│   ");
            treeStr += generateTree(fullPath, newPrefix);
        } else {
            if (VALID_EXTENSIONS.has(path.extname(file))) {
                treeStr += `${prefix}${connector}${file}\n`;
            }
        }
    });
    return treeStr;
}

function bundleCode(workspaceRoot) {
    const rootName = path.basename(workspaceRoot);
    let markdown = `# Project Context: ${rootName}\n\n## Directory Structure\n\`\`\`text\n${rootName}/\n`;
    markdown += generateTree(workspaceRoot);
    markdown += `\`\`\`\n\n## Source Code Files\n\n`;

    function walk(currentDir) {
        const files = fs.readdirSync(currentDir);
        files.forEach(file => {
            const fullPath = path.join(currentDir, file);
            const stats = fs.statSync(fullPath);
            const relativePath = path.relative(workspaceRoot, fullPath);

            if (stats.isDirectory()) {
                if (!EXCLUDE_DIRS.has(file)) walk(fullPath);
            } else {
                if (!EXCLUDE_FILES.has(file) && VALID_EXTENSIONS.has(path.extname(file))) {
                    const lang = path.extname(file).slice(1);
                    markdown += `### File: \`${relativePath}\`\n\`\`\`${lang}\n`;
                    try {
                        markdown += fs.readFileSync(fullPath, 'utf-8');
                    } catch (e) {
                        markdown += `// Error reading file: ${e.message}\n`;
                    }
                    markdown += `\n\`\`\`\n\n`;
                }
            }
        });
    }

    walk(workspaceRoot);
    return markdown;
}

function activate(context) {
    let disposable = vscode.commands.registerCommand('code-bundler.copyContext', async function () {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) {
            vscode.window.showErrorMessage('ワークスペースが開かれていません。');
            return;
        }

        const rootPath = workspaceFolders[0].uri.fsPath;
        vscode.window.showInformationMessage('プロジェクトをスキャン中...');
        
        const markdownResult = bundleCode(rootPath);
        
        // クリップボードにコピー
        await vscode.env.clipboard.writeText(markdownResult);
        vscode.window.showInformationMessage('Markdownをクリップボードにコピーしました！Geminiに貼り付けてください。');
    });

    context.subscriptions.push(disposable);
}

function deactivate() {}

module.exports = { activate, deactivate };