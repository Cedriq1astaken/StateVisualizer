import { build } from 'esbuild';
import { cp, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(scriptsDir, '..');

const runtimeEntry = path.join(packageRoot, 'src', 'webview', 'runtime', 'qsharpRuntime.js');
const runtimeBundle = path.join(packageRoot, 'dist', 'qsharpRuntime.bundle.js');
const wasmSource = path.join(
    packageRoot,
    'node_modules',
    'qsharp-lang',
    'lib',
    'web',
    'qsc_wasm_bg.wasm'
);
const wasmDirectory = path.join(packageRoot, 'assets', 'wasm');
const wasmTarget = path.join(wasmDirectory, 'qsc_wasm_bg.wasm');

const webviewEntry = path.join(packageRoot, 'src', 'webview', 'main.js');
const webviewBundle = path.join(packageRoot, 'dist', 'webview.bundle.js');
const distDirectory = path.join(packageRoot, 'dist');

await mkdir(distDirectory, { recursive: true });
await mkdir(wasmDirectory, { recursive: true });

await build({
    entryPoints: [runtimeEntry],
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: 'es2020',
    outfile: runtimeBundle,
    legalComments: 'none',
    sourcemap: false
});

await build({
    entryPoints: [webviewEntry],
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: 'es2020',
    outfile: webviewBundle,
    legalComments: 'none',
    sourcemap: false,
    external: [],
    define: {
        'process.env.NODE_ENV': '"production"'
    }
});

await cp(wasmSource, wasmTarget);
