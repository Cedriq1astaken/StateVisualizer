import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

export function activate(context: vscode.ExtensionContext) {
    console.log('Qsphere extension active for .qs files!');

    let activeTargetOp: { name: string, startLine: number, endLine: number } | undefined;
    let activePanel: vscode.WebviewPanel | undefined;
    let pendingInspectPayload: {
        fileName: string;
        code: string;
        targetLine: number;
        lineText: string;
        targetOp?: { name: string; startLine: number; endLine: number };
    } | null = null;

    const openVisualizerDisposable = vscode.commands.registerCommand('qsphere.openVisualizer', (targetOp?: { name: string, startLine: number, endLine: number }) => {
        if (targetOp) {
            activeTargetOp = targetOp;
        }

        const activeEditor = vscode.window.activeTextEditor;
        const sourceDocument = activeEditor?.document;
        const defaultSamplePath = path.join(context.extensionPath, 'samples', 'test.qs');
        const fileName = sourceDocument?.fileName || defaultSamplePath;
        let codeContent = sourceDocument?.getText() || '';

        if (!codeContent && fs.existsSync(defaultSamplePath)) {
            codeContent = fs.readFileSync(defaultSamplePath, 'utf8');
        }

        const titleName = 'StateVisualizer';

        const panel = vscode.window.createWebviewPanel(
            'qsphereVisualizer',
            titleName,
            vscode.ViewColumn.Beside,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [vscode.Uri.file(context.extensionPath)]
            }
        );
        activePanel = panel;

        panel.webview.html = getWebviewContent(context, panel.webview);

        const postSource = (command: 'init' | 'update', code: string, sourceName: string) => {
            panel.webview.postMessage({ command, data: { fileName: sourceName, code, targetOp: activeTargetOp } });
        };

        const readyDisposable = panel.webview.onDidReceiveMessage(async message => {
            if (message.command === 'ready') {
                if (pendingInspectPayload) {
                    panel.webview.postMessage({
                        command: 'inspectLine',
                        data: pendingInspectPayload
                    });
                    pendingInspectPayload = null;
                    return;
                }
                const currentEditor = vscode.window.activeTextEditor;
                postSource(
                    'init',
                    currentEditor?.document.getText() || codeContent,
                    currentEditor?.document.fileName || fileName
                );
                return;
            }

            if (message.command === 'exportFiles') {
                try {
                    const payload = message.data || {};
                    const items: Array<{ name?: string; pngDataUrl?: string; svgContent?: string }> =
                        Array.isArray(payload.files) && payload.files.length > 0
                            ? payload.files
                            : [{ name: payload.name, pngDataUrl: payload.pngDataUrl, svgContent: payload.svgContent }];

                    // Generate timestamp formatted as YYYY-MM-DD_HH-mm-ss
                    const now = new Date();
                    const pad = (n: number) => String(n).padStart(2, '0');
                    const timestamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;

                    // Determine target directory (active .qs file dir -> workspace root -> cwd)
                    const activeDoc = vscode.window.activeTextEditor?.document;
                    let targetDir = '';
                    if (activeDoc && !activeDoc.isUntitled && activeDoc.fileName) {
                        targetDir = path.dirname(activeDoc.fileName);
                    } else if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
                        targetDir = vscode.workspace.workspaceFolders[0].uri.fsPath;
                    } else {
                        targetDir = process.cwd();
                    }

                    const exportedNames: string[] = [];

                    for (const item of items) {
                        const vizName = item.name || 'visualization';
                        const pngFileName = `${vizName}_${timestamp}.png`;
                        const pngFilePath = path.join(targetDir, pngFileName);

                        // SVG export disabled for now
                        // const svgFileName = `${vizName}_${timestamp}.svg`;
                        // const svgFilePath = path.join(targetDir, svgFileName);

                        if (item.pngDataUrl) {
                            const base64Data = item.pngDataUrl.replace(/^data:image\/png;base64,/, '');
                            await fs.promises.writeFile(pngFilePath, Buffer.from(base64Data, 'base64'));
                            exportedNames.push(pngFileName);
                        }

                        // if (item.svgContent) {
                        //     await fs.promises.writeFile(svgFilePath, item.svgContent, 'utf8');
                        //     exportedNames.push(svgFileName);
                        // }
                    }

                    if (exportedNames.length > 0) {
                        vscode.window.showInformationMessage(
                            `StateVisualizer: Exported ${exportedNames.join(', ')}`
                        );
                    }
                } catch (err) {
                    console.error('Error exporting visualization files:', err);
                    vscode.window.showErrorMessage(`StateVisualizer export failed: ${String(err)}`);
                }
            }

            if (message.command === 'copyToClipboard') {
                if (typeof message.text === 'string') {
                    await vscode.env.clipboard.writeText(message.text);
                    vscode.window.setStatusBarMessage('StateVisualizer: Copied quantum state LaTeX to clipboard', 2500);
                }
            }
        });

        postSource('init', codeContent, fileName);

        let updateTimer: ReturnType<typeof setTimeout> | undefined;
        const trackedUri = sourceDocument?.uri.toString();
        const changeDisposable = vscode.workspace.onDidChangeTextDocument(event => {
            if (!event.document.fileName.endsWith('.qs')) return;
            if (trackedUri && event.document.uri.toString() !== trackedUri) return;

            // Clear any previous line inspection decoration when text is edited / newlines inserted
            vscode.window.visibleTextEditors.forEach(editor => {
                if (editor.document.uri.toString() === event.document.uri.toString()) {
                    editor.setDecorations(lineHighlightDecoration, []);
                }
            });

            if (updateTimer) clearTimeout(updateTimer);
            updateTimer = setTimeout(() => {
                postSource('update', event.document.getText(), event.document.fileName);
            }, 150);
        });

        panel.onDidDispose(() => {
            if (updateTimer) clearTimeout(updateTimer);
            if (activePanel === panel) activePanel = undefined;
            readyDisposable.dispose();
            changeDisposable.dispose();
            vscode.window.visibleTextEditors.forEach(editor => {
                editor.setDecorations(lineHighlightDecoration, []);
            });
        });
    });

    const lineHighlightDecoration = vscode.window.createTextEditorDecorationType({
        isWholeLine: true,
        rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
        backgroundColor: 'rgba(56, 189, 248, 0.22)',
        border: '1px solid rgba(56, 189, 248, 0.60)',
        borderRadius: '3px',
        overviewRulerColor: '#38bdf8',
        overviewRulerLane: vscode.OverviewRulerLane.Full,
        after: {
            contentText: '  ◀ Visualized State',
            color: 'rgba(56, 189, 248, 0.85)',
            fontStyle: 'italic',
            fontWeight: '600'
        }
    });

    function findMainOperation(doc: vscode.TextDocument): { name: string, startLine: number, endLine: number } | null {
        const operationPattern = /^\s*operation\s+([A-Za-z_][A-Za-z0-9_]*)/;
        let mainOp: { name: string, startLine: number, endLine: number } | null = null;
        let firstOp: { name: string, startLine: number, endLine: number } | null = null;

        for (let line = 0; line < doc.lineCount; line++) {
            const lineText = doc.lineAt(line).text;
            const match = lineText.match(operationPattern);
            if (!match) continue;
            const opName = match[1];

            let braceCount = 0;
            let foundOpenBrace = false;
            let endLine = line;
            for (let l = line; l < doc.lineCount; l++) {
                const currentText = doc.lineAt(l).text;
                for (const char of currentText) {
                    if (char === '{') {
                        braceCount++;
                        foundOpenBrace = true;
                    } else if (char === '}') {
                        braceCount--;
                        if (foundOpenBrace && braceCount === 0) {
                            endLine = l;
                            break;
                        }
                    }
                }
                if (foundOpenBrace && braceCount === 0) break;
                endLine = l;
            }

            const opInfo = { name: opName, startLine: line, endLine };
            if (!firstOp) firstOp = opInfo;

            const isEntryPoint = (line > 0 && doc.lineAt(line - 1).text.includes('@EntryPoint')) || opName === 'Main';
            if (isEntryPoint) {
                mainOp = opInfo;
                break;
            }
        }

        return mainOp || firstOp;
    }

    const inspectCurrentLineDisposable = vscode.commands.registerCommand('qsphere.inspectCurrentLine', () => {
        const activeEditor = vscode.window.activeTextEditor;
        if (!activeEditor) return;

        const document = activeEditor.document;
        if (!document.fileName.endsWith('.qs') && document.languageId !== 'qsharp') return;

        const mainOp = findMainOperation(document);
        const cursorLine = activeEditor.selection.active.line;

        // Shift + Enter only activates when inside Main
        if (!mainOp || cursorLine < mainOp.startLine || cursorLine > mainOp.endLine) {
            return;
        }

        // If on an empty line, find the nearest preceding code line within Main
        let effectiveLine = cursorLine;
        while (effectiveLine > mainOp.startLine && document.lineAt(effectiveLine).text.trim().length === 0) {
            effectiveLine--;
        }

        const lineText = document.lineAt(effectiveLine).text.trim();

        // Highlight the single line being visualized
        const lineRange = document.lineAt(effectiveLine).range;
        activeEditor.setDecorations(lineHighlightDecoration, [lineRange]);


        // Advance cursor to the next non-empty code line within Main
        let nextLine = cursorLine + 1;
        while (nextLine < mainOp.endLine && document.lineAt(nextLine).text.trim().length === 0) {
            nextLine++;
        }
        if (nextLine <= mainOp.endLine) {
            const nextLineEnd = document.lineAt(nextLine).range.end;
            activeEditor.selection = new vscode.Selection(nextLineEnd, nextLineEnd);
            activeEditor.revealRange(new vscode.Range(nextLineEnd, nextLineEnd), vscode.TextEditorRevealType.Default);
        }

        const payload = {
            fileName: document.fileName,
            code: document.getText(),
            targetLine: effectiveLine,
            lineText,
            targetOp: mainOp
        };

        if (!activePanel) {
            pendingInspectPayload = payload;
            vscode.commands.executeCommand('qsphere.openVisualizer', mainOp);
        } else {
            activePanel.webview.postMessage({
                command: 'inspectLine',
                data: payload
            });
        }
    });

    const replayAnimationDisposable = vscode.commands.registerCommand('qsphere.replayAnimation', () => {
        activePanel?.webview.postMessage({ command: 'replayAnimation' });
    });

    const codeLensProvider = vscode.languages.registerCodeLensProvider(
        [{ pattern: '**/*.qs' }, { language: 'qsharp' }],
        {
            provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
                if (!document.fileName.endsWith('.qs') && document.languageId !== 'qsharp') return [];
                const mainOp = findMainOperation(document);
                if (!mainOp) return [];

                return [
                    new vscode.CodeLens(new vscode.Range(mainOp.startLine, 0, mainOp.startLine, 0), {
                        title: 'State',
                        command: 'qsphere.openVisualizer',
                        arguments: [mainOp],
                        tooltip: 'Open Qsphere visualizer for Main'
                    })
                ];
            }
        }
    );

    context.subscriptions.push(
        openVisualizerDisposable,
        inspectCurrentLineDisposable,
        replayAnimationDisposable,
        codeLensProvider,
        lineHighlightDecoration
    );
}




export function deactivate() { }

function getWebviewContent(context: vscode.ExtensionContext, webview: vscode.Webview): string {
    const extRoot = context.extensionPath;

    const templatePath = path.join(extRoot, 'src', 'webview', 'index.html');
    const cssPath = path.join(extRoot, 'src', 'webview', 'styles.css');
    const katexCssPath = path.join(extRoot, 'dist', 'katex', 'katex.min.css');
    const runtimePath = path.join(extRoot, 'dist', 'qsharpRuntime.bundle.js');
    const runtimeUiPath = path.join(extRoot, 'src', 'webview', 'runtime', 'qsharpRuntimeUi.js');
    const webviewBundlePath = path.join(extRoot, 'dist', 'webview.bundle.js');
    const wasmPath = path.join(extRoot, 'assets', 'wasm', 'qsc_wasm_bg.wasm');
    const testQsPath = path.join(extRoot, 'samples', 'test.qs');
    const template = fs.readFileSync(templatePath, 'utf8');
    const uri = (filePath: string) => webview.asWebviewUri(vscode.Uri.file(filePath)).toString();
    const csp = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; font-src ${webview.cspSource} data:; script-src ${webview.cspSource} 'unsafe-eval' 'wasm-unsafe-eval'; connect-src ${webview.cspSource};">`;

    return template
        .replace('<meta charset="UTF-8">', `<meta charset="UTF-8">\n    ${csp}`)
        .replace('styles.css', uri(cssPath))
        .replace('dist/katex/katex.min.css', uri(katexCssPath))
        .replace('dist/qsharpRuntime.bundle.js', uri(runtimePath))
        .replace('runtime/qsharpRuntimeUi.js', uri(runtimeUiPath))
        .replace('dist/webview.bundle.js', uri(webviewBundlePath))
        .replace('assets/wasm/qsc_wasm_bg.wasm', uri(wasmPath))
        .replace('samples/test.qs', uri(testQsPath));
}




