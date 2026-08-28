# StateVisualizer

An interactive VS Code extension for visualizing Q# quantum states across statevector histograms, 3D Bloch spheres, and 3D Q-spheres.

It currently provides:

- **Statevector view**: Interactive histogram of state vector amplitudes and phases
- **Bloch sphere view**: Individual Bloch spheres per qubit with basis state labels
- **Q-sphere view**: Multi-qubit spherical representation with phase coloring and Hamming weight rings
- Hover tooltips for state vector bars, Bloch arrows, and Q-sphere nodes/spokes
- Animation interpolation for step-by-step state changes
- Stepping execution up to the current line (`Shift+Enter`)

## How To Use

Open a `.qs` file in VS Code, then run:

```text
Qsphere: Open Quantum Visualizer
```

Or press `Shift+Enter` on any line to inspect the state up to that point.

## Project Map

```text
Qsphere/
├── src/
│   ├── extension.ts                    # VS Code extension host entry point
│   └── webview/                        # Browser visualizer source
│       ├── index.html                  # Visualizer HTML structure
│       ├── styles.css                  # Visualizer stylesheet
│       ├── main.js                     # Main coordinator (tabs, messages, status & render loop)
│       ├── visualizations/             # Plugin-based visualizers
│       │   ├── index.js                # Visualization registry & loader
│       │   ├── statevector.js          # Statevector histogram renderer & lerp animation
│       │   ├── bloch.js                # Bloch spheres renderer (per-qubit cards & arrows)
│       │   └── qsphere.js              # Q-sphere 3D renderer (nodes, spokes, rings & labels)
│       ├── math/
│       │   └── math.js                 # Shared 3D projection, rotations & complex numbers
│       └── runtime/
│           ├── qsharpRuntime.js        # Q# WASM runtime & execution capture
│           └── qsharpRuntimeUi.js      # Q# parsing wrapper & error handling
├── assets/
│   └── wasm/
│       └── qsc_wasm_bg.wasm            # Q# compiler WebAssembly binary
├── dist/                               # Bundled webview output (esbuild)
│   ├── webview.bundle.js
│   └── qsharpRuntime.bundle.js
├── samples/
│   └── test.qs                         # Sample Q# program for testing
├── scripts/
│   └── build-webview.mjs               # Esbuild bundling script
└── out/                                # TypeScript compile output
```

## Build & Development

- `npm run compile` - Bundles the webview scripts and compiles TypeScript
- `npm run bundle:webview` - Bundles the webview scripts into `dist/`
- `npm run watch` - Watches TypeScript files for changes
