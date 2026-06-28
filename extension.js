function activate(context) {
    let disposable = vscode.commands.registerCommand('easy-to-vibe.copyContext', async function () {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) {
            vscode.window.showErrorMessage('ワークスペースが開かれていません。');
            return;
        }

        const rootPath = workspaceFolders[0].uri.fsPath;

        // vscode.window.withProgress を使ってプログレスバーを表示
        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification, // 画面右下に通知として表示
            title: "EasyToVibe 🌊",
            cancellable: false // 今回は手動キャンセルなし
        }, async (progress) => {
            // 1. 開始メッセージを設定
            progress.report({ message: "プロジェクトをスキャン中（.gitignore適用）..." });
            
            // 2. 重たい非同期処理（ファイルのスキャンと統合）を実行
            const markdownResult = await bundleCode(rootPath);
            
            // 3. 保存ディレクトリの作成
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
                // 4. ファイルへ書き込み
                await fsPromises.writeFile(outputFilePath, markdownResult, 'utf-8');
                
                // 5. エディタで開く
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