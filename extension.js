const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const ignore = require('ignore'); // インストールしたライブラリ

// ツリー構造には出すが、ファイルの中身を絶対に読み込まない（ソースコード出力から除外する）ディレクトリ
const CONTENT_SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.venv', 'venv', 'markdowns']);

// テキストとして読み込む対象の拡張子
const VALID_EXTENSIONS = new Set(['.py', '.c', '.h', '.java', '.js', '.ts', '.jsx', '.tsx', '.html', '.css', '.json', '.md', '.yml', '.yaml']);

/**
 * ワークスペースの .gitignore を読み込んで ignore インスタンスを返す
 */
function getGitignoreFilter(workspaceRoot) {
    const ig = ignore();
    // デフォルトで除外したい共通のメタフォルダを指定
    ig.add(['.git', 'markdowns']); 
    
    const gitignorePath = path.join(workspaceRoot, '.gitignore');
    if (fs.existsSync(gitignorePath)) {
        try {
            const gitignoreContent = fs.readFileSync(gitignorePath, 'utf-8');
            ig.add(gitignoreContent);
        } catch (e) {
            console.error('.gitignore の読み込みに失敗しました:', e);
        }
    }
    return ig;
}

/**
 * ディレクトリ構造（ツリー）を生成する（.gitignoreにヒットするものは除外）
 */
function generateTree(dirPath, workspaceRoot, ig, prefix = "") {
    let treeStr = "";
    if (!fs.existsSync(dirPath)) return treeStr;

    const files = fs.readdirSync(dirPath).sort();

    // .gitignore のルールに適合するものをフィルタリング
    const filtered = files.filter(file => {
        const fullPath = path.join(dirPath, file);
        const relativePath = path.relative(workspaceRoot, fullPath);
        
        // ignore ライブラリはディレクトリの場合末尾に '/' が必要
        const isDir = fs.statSync(fullPath).isDirectory();
        const checkPath = isDir ? `${relativePath}/` : relativePath;
        
        return !ig.ignores(checkPath);
    });

    filtered.forEach((file, i) => {
        const isLast = i === filtered.length - 1;
        const connector = isLast ? "└── " : "├── ";
        const fullPath = path.join(dirPath, file);
        const stats = fs.statSync(fullPath);

        if (stats.isDirectory()) {
            treeStr += `${prefix}${connector}${file}/\n`;
            // もし node_modules などであれば、ツリーには出すが配下の走査はスキップする（あるいは簡略化）
            if (CONTENT_SKIP_DIRS.has(file)) {
                treeStr += `${prefix}${isLast ? "    " : "│   "}└── (...contents skipped...)\n`;
            } else {
                const newPrefix = prefix + (isLast ? "    " : "│   ");
                treeStr += generateTree(fullPath, workspaceRoot, ig, newPrefix);
            }
        } else {
            if (VALID_EXTENSIONS.has(path.extname(file))) {
                treeStr += `${prefix}${connector}${file}\n`;
            }
        }
    });
    return treeStr;
}

/**
 * ソースコードの中身をまとめる（.gitignore対象、およびCONTENT_SKIP_DIRS対象は除外）
 */
function bundleCode(workspaceRoot) {
    const rootName = path.basename(workspaceRoot);
    const ig = getGitignoreFilter(workspaceRoot);

    let markdown = `# Project Context: ${rootName}\n\n## Directory Structure\n\`\`\`text\n${rootName}/\n`;
    markdown += generateTree(workspaceRoot, workspaceRoot, ig);
    markdown += `\`\`\`\n\n## Source Code Files\n\n`;

    function walk(currentDir) {
        if (!fs.existsSync(currentDir)) return;
        const files = fs.readdirSync(currentDir);

        files.forEach(file => {
            const fullPath = path.join(currentDir, file);
            const relativePath = path.relative(workspaceRoot, fullPath);
            const stats = fs.statSync(fullPath);
            
            const isDir = stats.isDirectory();
            const checkPath = isDir ? `${relativePath}/` : relativePath;

            // 1. .gitignore に該当する場合は完全にスキップ
            if (ig.ignores(checkPath)) {
                return;
            }

            if (isDir) {
                // 2. node_modules などの特定ディレクトリは中身のソースコード出力からは除外
                if (CONTENT_SKIP_DIRS.has(file)) {
                    return;
                }
                walk(fullPath);
            } else {
                // 3. 自分が作成した主要なソースコードファイルのみを対象にする
                if (VALID_EXTENSIONS.has(path.extname(file))) {
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
        vscode.window.showInformationMessage('プロジェクトをスキャン中（.gitignore適用）...');
        
        const markdownResult = bundleCode(rootPath);
        
        const outputDir = path.join(rootPath, 'markdowns');
        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
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
            fs.writeFileSync(outputFilePath, markdownResult, 'utf-8');
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