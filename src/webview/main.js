import * as THREE from 'three';
import {
    getVisualization,
    getAllVisualizations,
    registerVisualization
} from './visualizations/index.js';
import { getPhaseToRgb } from './visualizations/statevector.js';
import {
    createSphereMaterial,
    createLineMaterial,
    createSphereWireframe
} from './visualizations/bloch.js';
import {
    mult,
    createPerspectiveMatrix,
    createTranslationMatrix,
    rotateMatrix
} from './math/math.js';

const vscode = typeof acquireVsCodeApi === 'function' ? acquireVsCodeApi() : undefined;

const canvas = document.querySelector('#canvas');
const statusText = document.querySelector('#status');
const qsphereContainer = document.getElementById('container');
const controlsContainer = document.getElementById('controls');

let rotationAngles = [0.3, 0.0, 0.0];
let currentMode = 'statevector';
let lastParsedResult = null;
let threeState = null;
let isDragging = false;
let previousMousePosition = { x: 0, y: 0 };

function setStatus(message) {
    if (statusText) statusText.textContent = '';
}

function drawPhaseLegend() {
    const verticalCanvases = document.querySelectorAll('.phase-bar-canvas');
    verticalCanvases.forEach(c => {
        const context = c.getContext('2d');
        if (!context) return;

        const width = c.width;
        const height = c.height;
        context.clearRect(0, 0, width, height);

        for (let y = 0; y < height; y++) {
            const t = height > 1 ? 1 - (y / (height - 1)) : 0;
            const phase = t * Math.PI * 2;
            const [r, g, b] = getPhaseToRgb(phase);
            context.fillStyle = `rgb(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)})`;
            context.fillRect(0, y, width, 1);
        }
    });

    const horizontalCanvases = document.querySelectorAll('.phase-horizontal-bar-canvas');
    horizontalCanvases.forEach(c => {
        const context = c.getContext('2d');
        if (!context) return;

        const width = c.width;
        const height = c.height;
        context.clearRect(0, 0, width, height);

        for (let x = 0; x < width; x++) {
            const t = width > 1 ? (x / (width - 1)) : 0;
            const phase = t * Math.PI * 2;
            const [r, g, b] = getPhaseToRgb(phase);
            context.fillStyle = `rgb(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)})`;
            context.fillRect(x, 0, 1, height);
        }
    });
}

function updateModeTabs() {
    document.body.dataset.visualizationMode = currentMode;
    document.querySelectorAll('.view-tab').forEach(tab => {
        const isActive = tab.dataset.viewMode === currentMode;
        tab.classList.toggle('active', isActive);
        tab.setAttribute('aria-selected', String(isActive));
    });
}

function setVisualizationMode(mode) {
    if (!getVisualization(mode) || mode === currentMode) return;

    const prevViz = getVisualization(currentMode);
    if (prevViz?.unmount) {
        prevViz.unmount();
    }

    currentMode = mode;
    updateModeTabs();

    const nextViz = getVisualization(mode);
    if (nextViz?.mount) {
        nextViz.mount(null, { threeState, canvas });
    }

    if (lastParsedResult) {
        nextViz?.update(lastParsedResult);
    }

    if (threeState) {
        if (mode === 'qsphere') {
            resizeRenderer(threeState);
        }
        renderScene();
    }
}

function initThreeRenderer() {
    const renderer = new THREE.WebGLRenderer({
        canvas,
        alpha: true,
        antialias: true,
        premultipliedAlpha: true
    });
    renderer.setClearColor(0x000000, 0);
    renderer.setPixelRatio(window.devicePixelRatio || 1);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(
        45,
        (canvas.clientWidth || 270) / (canvas.clientHeight || 270),
        0.1,
        100
    );
    camera.position.set(0, 0, 3);
    camera.lookAt(0, 0, 0);

    const sphereMaterial = createSphereMaterial();
    const lineMaterial = createLineMaterial();

    const sphereGeo = new THREE.SphereGeometry(1, 32, 32);
    const sphereMesh = new THREE.Mesh(sphereGeo, sphereMaterial);
    scene.add(sphereMesh);

    const wireframe = createSphereWireframe(lineMaterial);
    scene.add(wireframe);

    const arrowGroup = new THREE.Group();
    arrowGroup.visible = false;
    scene.add(arrowGroup);

    const qsphereGroup = new THREE.Group();
    qsphereGroup.visible = false;
    scene.add(qsphereGroup);

    return {
        renderer,
        scene,
        camera,
        sphereMesh,
        wireframe,
        arrowGroup,
        qsphereGroup,
        lineMaterial
    };
}

function resizeRenderer(state) {
    if (!state) return;
    const width = canvas.clientWidth || 270;
    const height = canvas.clientHeight || 270;
    if (canvas.width !== width || canvas.height !== height) {
        state.renderer.setSize(width, height, false);
        state.camera.aspect = width / height;
        state.camera.updateProjectionMatrix();
    }
}

function renderScene() {
    if (!threeState) return;
    threeState.renderer.render(threeState.scene, threeState.camera);
}

let pendingCode = null;

async function initScene() {
    const testQsUri = canvas.dataset.testQs || 'samples/test.qs';

    if (pendingCode) {
        try {
            const result = await parseQSharp(pendingCode);
            lastParsedResult = result;
        } catch (e) {
            console.warn('Could not parse pending Q# code:', e);
        }
    }

    if (!lastParsedResult) {
        try {
            const response = await fetch(testQsUri);
            if (response.ok) {
                const code = await response.text();
                const result = await parseQSharp(code);
                lastParsedResult = result;
            }
        } catch (e) {
            console.warn('Could not fetch initial Q# file:', e);
        }
    }

    const state = initThreeRenderer();

    const projMatrix = mult(
        createPerspectiveMatrix(Math.PI / 4, (canvas.clientWidth || 270) / (canvas.clientHeight || 270), 0.1, 100),
        createTranslationMatrix(0, 0, -3)
    );
    state._projMatrix = projMatrix;
    state._buildProjMatrix = function () {
        return mult(
            createPerspectiveMatrix(Math.PI / 4, (canvas.clientWidth || 270) / (canvas.clientHeight || 270), 0.1, 100),
            createTranslationMatrix(0, 0, -3)
        );
    };

    const activeViz = getVisualization(currentMode);
    if (activeViz?.mount) {
        activeViz.mount(null, { threeState: state, canvas });
    }

    return state;
}

// Mouse interaction for 3D sphere rotation and hover
canvas.addEventListener('mousedown', e => {
    isDragging = true;
    const qsphereViz = getVisualization('qsphere');
    if (qsphereViz?.clearHover) qsphereViz.clearHover();
    previousMousePosition = { x: e.clientX, y: e.clientY };
});

canvas.addEventListener('mousemove', e => {
    if (currentMode !== 'qsphere') return;

    if (isDragging) {
        const deltaX = e.clientX - previousMousePosition.x;
        const deltaY = e.clientY - previousMousePosition.y;

        rotationAngles[0] += deltaY * 0.005;
        rotationAngles[0] = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, rotationAngles[0]));
        rotationAngles[1] += deltaX * 0.005;

        previousMousePosition = { x: e.clientX, y: e.clientY };
    } else {
        const qsphereViz = getVisualization('qsphere');
        if (qsphereViz?.updateHover) {
            qsphereViz.updateHover(e, canvas, rotationAngles);
        }
    }
});

canvas.addEventListener('mouseleave', () => {
    isDragging = false;
    const qsphereViz = getVisualization('qsphere');
    if (qsphereViz?.clearHover) qsphereViz.clearHover();
});

window.addEventListener('mouseup', () => {
    isDragging = false;
});

// View tabs event listener
document.querySelectorAll('.view-tab').forEach(tab => {
    tab.addEventListener('click', () => setVisualizationMode(tab.dataset.viewMode));
});
updateModeTabs();
drawPhaseLegend();

function frame() {
    const activeViz = getVisualization(currentMode);
    if (activeViz?.animate) {
        activeViz.animate(0.20);
    }

    if (threeState && currentMode === 'qsphere') {
        threeState.scene.rotation.set(rotationAngles[0], rotationAngles[1], rotationAngles[2]);
        const modelMatrix = rotateMatrix(...rotationAngles, threeState._projMatrix);
        const rect = canvas.getBoundingClientRect();
        const qsphereViz = getVisualization('qsphere');
        if (qsphereViz?.updateLabels) {
            qsphereViz.updateLabels(modelMatrix, rect.width, rect.height);
        }
        try {
            renderScene();
        } catch (e) {}
    }

    requestAnimationFrame(frame);
}

initScene()
    .then(state => {
        threeState = state;
        if (lastParsedResult) {
            for (const viz of getAllVisualizations()) {
                viz.update(lastParsedResult);
            }
        }
        const activeViz = getVisualization(currentMode);
        if (activeViz?.mount) {
            activeViz.mount(null, { threeState, canvas });
        }
        if (vscode) {
            vscode.postMessage({ command: 'ready' });
        }
        requestAnimationFrame(frame);
    })
    .catch(error => {
        console.error('Three.js renderer setup failed:', error);
        setStatus('Renderer setup failed.');
    });

window.addEventListener('resize', () => {
    resizeRenderer(threeState);
    if (threeState) {
        threeState._projMatrix = threeState._buildProjMatrix();
        try {
            renderScene();
        } catch (e) {}
    }
    const activeViz = getVisualization(currentMode);
    if (activeViz?.resize) {
        activeViz.resize();
    }
});

let currentTargetOp = null;
let sourceUpdateGeneration = 0;

window.addEventListener('message', async event => {
    const message = event.data;
    if (message.command === 'replayAnimation') {
        const blochViz = getVisualization('bloch');
        if (blochViz?.replayAnimation) {
            blochViz.replayAnimation();
        }
        return;
    }
    if (message.command === 'inspectLine') {
        if (message.data && message.data.code) {
            const updateGeneration = ++sourceUpdateGeneration;
            pendingCode = message.data.code;
            if (message.data.targetOp !== undefined) {
                currentTargetOp = message.data.targetOp;
            }
            const targetLine = message.data.targetLine;
            const result = await parseQSharp(pendingCode, currentTargetOp, targetLine);
            if (updateGeneration !== sourceUpdateGeneration) return;
            console.log('Q# Inspected Line Result (line ' + (targetLine + 1) + '):', result);
            lastParsedResult = result;

            for (const viz of getAllVisualizations()) {
                viz.update(result);
            }
        }
        if (threeState && currentMode === 'qsphere') {
            try {
                renderScene();
            } catch (e) {}
        }
        return;
    }
    if (message.command === 'init' || message.command === 'update') {
        if (message.data && message.data.code) {
            const updateGeneration = ++sourceUpdateGeneration;
            pendingCode = message.data.code;
            if (message.data.targetOp !== undefined) {
                currentTargetOp = message.data.targetOp;
            }
            const result = await parseQSharp(pendingCode, currentTargetOp);
            if (updateGeneration !== sourceUpdateGeneration) return;
            console.log('Q# Parse Result:', result);
            lastParsedResult = result;

            for (const viz of getAllVisualizations()) {
                viz.update(result);
            }
        }
        if (threeState && currentMode === 'qsphere') {
            try {
                renderScene();
            } catch (e) {}
        }
    }
});

export {
    getVisualization,
    getAllVisualizations,
    registerVisualization,
    setVisualizationMode,
    currentMode
};
