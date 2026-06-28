const vscode = require('vscode');
const fs = require('fs');
const fsPromises = require('fs').promises; // 非同期処理用のプロミス API
const path = require('path');
const ignore = require('ignore'); // インストールしたライブラリ

// ツリー構造には出すが、ファイルの中身を絶対に読み込まない（ソースコード出力から除外する）ディレクトリ
const CONTENT_SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.venv', 'venv', 'markdowns']);

// テキストとして読み込む対象の拡張子
const VALID_EXTENSIONS = new Set(['.py', '.c', '.h', '.java', '.js', '.ts', '.jsx', '.tsx', '.html', '.css', '.json', '.md', '.yml', '.yaml']);

/**
 * ワークスペースの .gitignore を読み込んで ignore インスタンスを返す
 */
async function getGitignoreFilter(workspaceRoot) {
    const ig = ignore();
    // デフォルトで除外したい共通のメタフォルダを指定
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
 * ディレクトリ構造（ツリー）を生成する（.gitignoreにヒットするものは除外・非同期版）
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
        
        // 🛠️ 修正：ここを同期版の fs.statSync から await fsPromises.stat に修正！
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
            // もし node_modules などであれば、ツリーには出すが配下の走査はスキップする
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
 * ソースコードの中身をまとめる（.gitignore対象、およびCONTENT_SKIP_DIRS対象は除外・非同期版）
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
            
            // 🛠️ 修正：ここも念のため完全に fsPromises.stat に統一
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
                        // 一旦 Buffer（生データ）として読み込み、BOM(UTF-16LE) を自動チェック
                        const buffer = await fsPromises.readFile(fullPath);
                        if (buffer[0] === 0xFF && buffer[1] === 0xFE) {
                            markdown += buffer.toString('utf16le'); // UTF-16LE の README 対策
                        } else {
                            markdown += buffer.toString('utf-8');   // 通常の UTF-8 読み込み
                        }
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

        // vscode.window.withProgress を使って画面右下にプログレスバーを表示
        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: "EasyToVibe 🌊",
            cancellable: false
        }, async (progress) => {
            
            // 1. 進捗メッセージを設定
            progress.report({ message: "プロジェクトをスキャン中（.gitignore適用）..." });
            
            // 2. 非同期処理でスキャンとファイル結合を実行
            const markdownResult = await bundleCode(rootPath);
            
            // 3. 出力先 markdowns フォルダの作成
            progress.report({ message: "Markdown ファイルを生成中..." });
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
                // 4. ファイルへの非同期書き込み
                await fsPromises.writeFile(outputFilePath, markdownResult, 'utf-8');
                
                // 5. 生成した Markdown ファイルをエディタで自動オープン
                const document = await vscode.workspace.openTextDocument(outputFilePath);
                await vscode.window.showTextDocument(document);
                
                vscode.window.showInformationMessage(`ファイルを保存しました: markdowns/${outputFileName}`);
            } catch (error) {
                vscode.window.showErrorMessage(`ファイルの保存に失敗しました: ${error.message}`);
            }
        });
    });

    context.subscriptions.push(disposable);
}

function deactivate() {}

module.exports = { activate, deactivate };