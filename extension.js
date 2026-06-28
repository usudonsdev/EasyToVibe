const vscode = require('vscode');
const fs = require('fs');
const fsPromises = require('fs').promises; // 非同期用のプロミス API を導入
const path = require('path');
const ignore = require('ignore');

const CONTENT_SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.venv', 'venv', 'markdowns']);
const VALID_EXTENSIONS = new Set(['.py', '.c', '.h', '.java', '.js', '.ts', '.jsx', '.tsx', '.html', '.css', '.json', '.md', '.yml', '.yaml']);

/**
 * ワークスペースの .gitignore を読み込んで ignore インスタンスを返す
 * (ここは起動時に一度だけ、または同期でも軽量なため、呼び出しをスムーズにするため今回はそのままか、あるいは非同期化します)
 */
async function getGitignoreFilter(workspaceRoot) {
    const ig = ignore();
    ig.add(['.git', 'markdowns']); 
    
    const gitignorePath = path.join(workspaceRoot, '.gitignore');
    if (fs.existsSync(gitignorePath)) {
        try {
            // 非同期読み込みに変更
            const gitignoreContent = await fsPromises.readFile(gitignorePath, 'utf-8');
            ig.add(gitignoreContent);
        } catch (e) {
            console.error('.gitignore の読み込みに失敗しました:', e);
        }
    }
    return ig;
}

/**
 * ディレクトリ構造（ツリー）を生成する（非同期版）
 */
async function generateTree(dirPath, workspaceRoot, ig, prefix = "") {
    let treeStr = "";
    if (!fs.existsSync(dirPath)) return treeStr;

    // 非同期でディレクトリを読み込み
    const files = await fsPromises.readdir(dirPath);
    files.sort();

    // フィルタリング処理の非同期対応
    const filtered = [];
    for (const file of files) {
        const fullPath = path.join(dirPath, file);
        const relativePath = path.relative(workspaceRoot, fullPath);
        
        const stats = await fsPromises.stat(fullPath);
        const isDir = stats.isDirectory();
        const checkPath = isDir ? `${relativePath}/` : relativePath;
        
        if (!ig.ignores(checkPath)) {
            filtered.push({ file, fullPath, isDir });
        }
    }

    for (let i = 0; i < filtered.length; i++) {
        const item = filtered[i];
        const isLast = i === filtered.length - 1;
        const connector = isLast ? "└── " : "├── ";

        if (item.isDir) {
            treeStr += `${prefix}${connector}${item.file}/\n`;
            if (CONTENT_SKIP_DIRS.has(item.file)) {
                treeStr += `${prefix}${isLast ? "    " : "│   "}└── (...contents skipped...)\n`;
            } else {
                const newPrefix = prefix + (isLast ? "    " : "│   ");
                // 再帰呼び出しも await
                treeStr += await generateTree(item.fullPath, workspaceRoot, ig, newPrefix);
            }
        } else {
            if (VALID_EXTENSIONS.has(path.extname(item.file))) {
                treeStr += `${prefix}${connector}${item.file}\n`;
            }
        }
    }
    return treeStr;
}

/**
 * ソースコードの中身をまとめる（非同期版）
 */
async function bundleCode(workspaceRoot) {
    const rootName = path.basename(workspaceRoot);
    const ig = await getGitignoreFilter(workspaceRoot);

    let markdown = `# Project Context: ${rootName}\n\n## Directory Structure\n\`\`\`text\n${rootName}/\n`;
    markdown += await generateTree(workspaceRoot, workspaceRoot, ig);
    markdown += `\`\`\`\n\n## Source Code Files\n\n`;

    async function walk(currentDir) {
        if (!fs.existsSync(currentDir)) return;
        const files = await fsPromises.readdir(currentDir);

        for (const file of files) {
            const fullPath = path.join(currentDir, file);
            const relativePath = path.relative(workspaceRoot, fullPath);
            
            const stats = await fsPromises.stat(fullPath); 
            const isDir = stats.isDirectory();
            const checkPath = isDir ? `${relativePath}/` : relativePath;

            if (ig.ignores(checkPath)) continue;

            if (isDir) {
                if (CONTENT_SKIP_DIRS.has(file)) continue;
                await walk(fullPath);
            } else {
                if (VALID_EXTENSIONS.has(path.extname(file))) {
                    const lang = path.extname(file).slice(1);
                    markdown += `### File: \`${relativePath}\`\n\`\`\`${lang}\n`;
                    try {
                        // 非同期読み込みに変更
                        markdown += await fsPromises.readFile(fullPath, 'utf-8');
                    } catch (e) {
                        markdown += `// Error reading file: ${e.message}\n`;
                    }
                    markdown += `\n\`\`\`\n\n`;
                }
            }
        }
    }

    await walk(workspaceRoot);
    return markdown;
}

function activate(context) {
    let disposable = vscode.commands.registerCommand('easy-to-vibe.copyContext', async function () {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) {
            vscode.window.showErrorMessage('ワークスペースが開かれていません。');
            return;
        }

        const rootPath = workspaceFolders[0].uri.fsPath;
        vscode.window.showInformationMessage('プロジェクトをスキャン中（.gitignore適用・非同期モード）...');
        
        // 非同期処理を await で受ける
        const markdownResult = await bundleCode(rootPath);
        
        const outputDir = path.join(rootPath, 'markdowns');
        if (!fs.existsSync(outputDir)) {
            await fsPromises.mkdir(outputDir, { recursive: true });
        }
        
        const now = new Date();
        const timestamp = now.getFullYear() + 
            String(now.getMonth() + 1).padStart(2, '0') + 
            String(now.getDate()).padStart(2, '0') + '_' + 
            String(now.getHours()).padStart(2, '0') + 
            String(now.getMinutes()).padStart(2, '0') + 
            String(now.getSeconds()).padStart(2, '0');
        
        const outputFileName = `project_context_${timestamp}.md`;
        const outputFilePath = path.join(outputDir, outputFileName);
        
        try {
            // 非同期書き込みに変更
            await fsPromises.writeFile(outputFilePath, markdownResult, 'utf-8');
            vscode.window.showInformationMessage(`ファイルを保存しました: markdowns/${outputFileName}`);
            
            const document = await vscode.workspace.openTextDocument(outputFilePath);
            await vscode.window.showTextDocument(document);
        } catch (error) {
            vscode.window.showErrorMessage(`ファイルの保存に失敗しました: ${error.message}`);
        }
    });

    context.subscriptions.push(disposable);
}

function deactivate() {}

module.exports = { activate, deactivate };