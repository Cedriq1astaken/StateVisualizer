import statevectorVisualization from './statevector.js';
import blochVisualization from './bloch.js';
import qsphereVisualization from './qsphere.js';

const visualizations = new Map();

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

function getVisualization(id) {
    return visualizations.get(id) || null;
}

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
    qsphereVisualization
};

export default {
    visualizations,
    registerVisualization,
    getVisualization,
    getAllVisualizations
};
