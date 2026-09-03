/**
 * @typedef {Object} SharedContext
 * @property {any} [threeState] - Global Three.js scene, camera, renderer, and mesh objects
 * @property {HTMLCanvasElement} [canvas] - Main 3D WebGL canvas
 * @property {any} [vscode] - VS Code webview API handle
 */

/**
 * @typedef {Object} VisualizationPlugin
 * @property {string} id - Unique identifier matching the tab mode ('statevector' | 'bloch' | 'qsphere' | string)
 * @property {string} [label] - Human-readable label for UI tabs
 * @property {function(HTMLElement|null, SharedContext=): void} [mount] - Lifecycle hook invoked when this view becomes active
 * @property {function(): void} [unmount] - Lifecycle hook invoked when switching away from this view
 * @property {function(any, Object=): void} update - Required handler invoked when quantum state results or options update
 * @property {function(number=): void} [animate] - Optional per-frame animation hook for transitions/interpolation
 * @property {function(number=, number=): void} [resize] - Optional hook called when the window or container resizes
 * @property {function(): void} [replayAnimation] - Optional view-specific hook to replay step-by-step state animations
 * @property {function(MouseEvent, HTMLCanvasElement, number[]): void} [updateHover] - Optional view-specific hover hit-testing
 * @property {function(): void} [clearHover] - Optional view-specific hover clearing
 * @property {function(Float32Array, number, number): void} [updateLabels] - Optional view-specific 3D label projection updater
 * @property {function(SharedContext=): Promise<{ filenamePrefix: string, pngDataUrl: string, svgContent: string }>} [export] - Export visualization as PNG data URL and SVG content
 */

import statevectorVisualization from './statevector.js';
import blochVisualization from './bloch.js';
import qsphereVisualization from './qsphere.js';
import densityMatrixVisualization from './densityMatrix.js';

/** @type {Map<string, VisualizationPlugin>} */
const visualizations = new Map();

/**
 * Register a visualization plugin.
 * @param {VisualizationPlugin} plugin
 */
function registerVisualization(plugin) {
    if (!plugin || !plugin.id) {
        throw new Error('Visualization plugin must have a valid id');
    }
    visualizations.set(plugin.id, plugin);
}

// Register built-in visualizations
registerVisualization(statevectorVisualization);
registerVisualization(blochVisualization);
registerVisualization(qsphereVisualization);
registerVisualization(densityMatrixVisualization);

/**
 * Retrieve a visualization plugin by its id.
 * @param {string} id
 * @returns {VisualizationPlugin|null}
 */
function getVisualization(id) {
    return visualizations.get(id) || null;
}

/**
 * Retrieve all registered visualization plugins.
 * @returns {VisualizationPlugin[]}
 */
function getAllVisualizations() {
    return Array.from(visualizations.values());
}

export {
    visualizations,
    registerVisualization,
    getVisualization,
    getAllVisualizations,
    statevectorVisualization,
    blochVisualization,
    qsphereVisualization,
    densityMatrixVisualization
};

export default {
    visualizations,
    registerVisualization,
    getVisualization,
    getAllVisualizations
};
