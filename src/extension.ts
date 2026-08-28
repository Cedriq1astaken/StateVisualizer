import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

export function activate(context: vscode.ExtensionContext) {
    console.log('Qsphere extension active for .qs files!');

    let activeTargetOp: { name: string, startLine: number, endLine: number } | undefined;
    let activePanel: vscode.WebviewPanel | undefined;

    const openVisualizerDisposable = vscode.commands.registerCommand('qsphere.openVisualizer', (targetOp?: { name: string, startLine: number, endLine: number }) => {
        if (targetOp) {
            activeTargetOp = targetOp;
        }

        const activeEditor = vscode.window.activeTextEditor;
        const sourceDocument = activeEditor?.document;
        const fileName = sourceDocument?.fileName || 'test.qs';
        let codeContent = sourceDocument?.getText() || '';

        if (!codeContent) {
            const testQsPath = path.join(context.extensionPath, 'samples', 'test.qs');
            if (fs.existsSync(testQsPath)) codeContent = fs.readFileSync(testQsPath, 'utf8');
        }

        const titleName = activeTargetOp?.name ? `Qsphere: ${activeTargetOp.name}` : 'Qsphere Quantum Visualizer';

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

        const readyDisposable = panel.webview.onDidReceiveMessage(message => {
            if (message.command !== 'ready') return;
            const currentEditor = vscode.window.activeTextEditor;
            postSource(
                'init',
                currentEditor?.document.getText() || codeContent,
                currentEditor?.document.fileName || fileName
            );
        });

        postSource('init', codeContent, fileName);

        let updateTimer: ReturnType<typeof setTimeout> | undefined;
        const trackedUri = sourceDocument?.uri.toString();
        const changeDisposable = vscode.workspace.onDidChangeTextDocument(event => {
            if (!event.document.fileName.endsWith('.qs')) return;
            if (trackedUri && event.document.uri.toString() !== trackedUri) return;
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


    const inspectCurrentLineDisposable = vscode.commands.registerCommand('qsphere.inspectCurrentLine', () => {
        const activeEditor = vscode.window.activeTextEditor;
        if (!activeEditor) return;

        const document = activeEditor.document;
        if (!document.fileName.endsWith('.qs') && document.languageId !== 'qsharp') return;

        const cursorLine = activeEditor.selection.active.line;
        const lineText = document.lineAt(cursorLine).text.trim();

        // Highlight the line being visualized
        const lineRange = document.lineAt(cursorLine).range;
        activeEditor.setDecorations(lineHighlightDecoration, [lineRange]);

        // Advance cursor to the end of the next line
        if (cursorLine + 1 < document.lineCount) {
            const nextLine = cursorLine + 1;
            const nextLineEnd = document.lineAt(nextLine).range.end;
            activeEditor.selection = new vscode.Selection(nextLineEnd, nextLineEnd);
            activeEditor.revealRange(new vscode.Range(nextLineEnd, nextLineEnd), vscode.TextEditorRevealType.Default);
        }

        if (!activePanel) {
            vscode.commands.executeCommand('qsphere.openVisualizer');
            setTimeout(() => {
                activePanel?.webview.postMessage({
                    command: 'inspectLine',
                    data: {
                        fileName: document.fileName,
                        code: document.getText(),
                        targetLine: cursorLine,
                        lineText,
                        targetOp: activeTargetOp
                    }
                });
            }, 300);
        } else {
            activePanel.webview.postMessage({
                command: 'inspectLine',
                data: {
                    fileName: document.fileName,
                    code: document.getText(),
                    targetLine: cursorLine,
                    lineText,
                    targetOp: activeTargetOp
                }
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
                const lenses: vscode.CodeLens[] = [];
                const operationPattern = /^\s*operation\s+([A-Za-z_][A-Za-z0-9_]*)/;
                const operationRanges = new Map<string, { startLine: number, endLine: number }>();

                for (let line = 0; line < document.lineCount; line++) {
                    const match = document.lineAt(line).text.match(operationPattern);
                    if (!match) continue;
                    const opName = match[1];

                    let braceCount = 0;
                    let foundOpenBrace = false;
                    let endLine = line;
                    for (let l = line; l < document.lineCount; l++) {
                        const lineText = document.lineAt(l).text;
                        for (const char of lineText) {
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

                    operationRanges.set(opName, { startLine: line, endLine });

                    if (opName === 'Main') {
                        lenses.push(new vscode.CodeLens(new vscode.Range(line, 0, line, 0), {
                            title: 'State (Main)',
                            command: 'qsphere.openVisualizer',
                            arguments: [{ name: opName, startLine: line, endLine }],
                            tooltip: 'Click to open Qsphere visualizer for Main'
                        }));
                    }
                }

                const operationCallPattern = /\b([A-Za-z_][A-Za-z0-9_]*)\s*\(/g;
                for (let line = 0; line < document.lineCount; line++) {
                    const lineText = document.lineAt(line).text;
                    if (operationPattern.test(lineText)) continue;

                    operationCallPattern.lastIndex = 0;
                    const call = operationCallPattern.exec(lineText);
                    if (!call) continue;

                    const opName = call[1];
                    const operation = operationRanges.get(opName);
                    if (!operation) continue;

                    lenses.push(new vscode.CodeLens(new vscode.Range(line, 0, line, 0), {
                        title: `State (${opName})`,
                        command: 'qsphere.openVisualizer',
                        arguments: [{ name: opName, ...operation }],
                        tooltip: `Click to open Qsphere visualizer for this ${opName} call`
                    }));
                }
                return lenses;
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



export function deactivate() {}

function getWebviewContent(context: vscode.ExtensionContext, webview: vscode.Webview): string {
    const extRoot = context.extensionPath;

    const templatePath = path.join(extRoot, 'src', 'webview', 'index.html');
    const cssPath = path.join(extRoot, 'src', 'webview', 'styles.css');
    const runtimePath = path.join(extRoot, 'dist', 'qsharpRuntime.bundle.js');
    const runtimeUiPath = path.join(extRoot, 'src', 'webview', 'runtime', 'qsharpRuntimeUi.js');
    const mathJsPath = path.join(extRoot, 'src', 'webview', 'math', 'math.js');
    const webviewBundlePath = path.join(extRoot, 'dist', 'webview.bundle.js');
    const wasmPath = path.join(extRoot, 'assets', 'wasm', 'qsc_wasm_bg.wasm');
    const testQsPath = path.join(extRoot, 'samples', 'test.qs');
    const template = fs.readFileSync(templatePath, 'utf8');
    const uri = (filePath: string) => webview.asWebviewUri(vscode.Uri.file(filePath)).toString();
    const csp = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src ${webview.cspSource} 'unsafe-eval' 'wasm-unsafe-eval'; connect-src ${webview.cspSource};">`;

    return template
        .replace('<meta charset="UTF-8">', `<meta charset="UTF-8">\n    ${csp}`)
        .replace('styles.css', uri(cssPath))
        .replace('dist/qsharpRuntime.bundle.js', uri(runtimePath))
        .replace('runtime/qsharpRuntimeUi.js', uri(runtimeUiPath))
        .replace('math/math.js', uri(mathJsPath))
        .replace('dist/webview.bundle.js', uri(webviewBundlePath))
        .replace('assets/wasm/qsc_wasm_bg.wasm', uri(wasmPath))
        .replace('samples/test.qs', uri(testQsPath));
}



