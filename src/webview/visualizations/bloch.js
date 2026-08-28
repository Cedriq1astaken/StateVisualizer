import * as THREE from 'three';
import {
    vec3Normalize,
    vec3Cross,
    vec3Dot,
    rodriguesRotate,
    interpolateVector,
    mult,
    createPerspectiveMatrix,
    createTranslationMatrix,
    rotateMatrix,
    projectPoint
} from '../math/math.js';

function complexAbs2(value) {
    return value.re * value.re + value.im * value.im;
}

function extractQubitBloch(snapshot, targetQubit) {
    if (!snapshot || snapshot.qubits === 0 || targetQubit >= snapshot.qubits) return [0, 0, 1];
    const state = snapshot.amplitudes;
    const qubits = snapshot.qubits;
    const bit = 1 << (qubits - 1 - targetQubit);
    let rho00 = 0;
    let rho11 = 0;
    let rho10Re = 0;
    let rho10Im = 0;

    for (let i = 0; i < state.length; i++) {
        if (i & bit) continue;
        const j = i | bit;
        const ci = state[i] || { re: 0, im: 0 };
        const cj = state[j] || { re: 0, im: 0 };
        rho00 += complexAbs2(ci);
        rho11 += complexAbs2(cj);
        rho10Re += ci.re * cj.re + ci.im * cj.im;
        rho10Im += ci.re * cj.im - ci.im * cj.re;
    }
    return [2 * rho10Re, 2 * rho10Im, rho00 - rho11];
}

function alignmentRotation(targetVec) {
    const from = [0, 0, 1];
    const to = vec3Normalize(targetVec);
    const dot = vec3Dot(from, to);
    if (dot > 0.99999) return { axis: [1, 0, 0], angle: 0 };
    if (dot < -0.99999) return { axis: [1, 0, 0], angle: Math.PI };
    return {
        axis: vec3Normalize(vec3Cross(from, to)),
        angle: Math.acos(Math.max(-1, Math.min(1, dot)))
    };
}

function buildArrowVertices(blochVec, options) {
    const r = Math.sqrt(blochVec[0] ** 2 + blochVec[1] ** 2 + blochVec[2] ** 2);
    if (r < 0.001) return new Float32Array(0);

    const opts = options || {};
    const baseShaftRadius = opts.shaftRadius ?? 0.02;
    const baseHeadRadius = opts.headRadius ?? 0.055;
    const segments = opts.segments ?? 12;
    const headLength = 0.14 * r;
    const shaftLength = 0.86 * r;
    const radiusScale = Math.max(0.3, Math.min(1.0, r));
    const shaftRadius = baseShaftRadius * radiusScale;
    const headRadius = baseHeadRadius * radiusScale;
    const verts = [];
    const { axis, angle } = alignmentRotation(blochVec);

    function pushVertex(pos, norm) {
        const rp = rodriguesRotate(pos, axis, angle);
        const rn = vec3Normalize(rodriguesRotate(norm, axis, angle));
        verts.push(rp[0], rp[1], rp[2], rn[0], rn[1], rn[2]);
    }

    for (let i = 0; i < segments; i++) {
        const a0 = (i / segments) * 2 * Math.PI;
        const a1 = ((i + 1) / segments) * 2 * Math.PI;
        const c0 = Math.cos(a0), s0 = Math.sin(a0);
        const c1 = Math.cos(a1), s1 = Math.sin(a1);
        const n0 = [c0, s0, 0], n1 = [c1, s1, 0];
        const bot0 = [shaftRadius * c0, shaftRadius * s0, 0];
        const top0 = [shaftRadius * c0, shaftRadius * s0, shaftLength];
        const bot1 = [shaftRadius * c1, shaftRadius * s1, 0];
        const top1 = [shaftRadius * c1, shaftRadius * s1, shaftLength];
        pushVertex(bot0, n0); pushVertex(bot1, n1); pushVertex(top0, n0);
        pushVertex(bot1, n1); pushVertex(top1, n1); pushVertex(top0, n0);
    }

    const tipZ = shaftLength + headLength;
    const coneSlope = headLength > 0 ? headRadius / headLength : 0;

    for (let i = 0; i < segments; i++) {
        const a0 = (i / segments) * 2 * Math.PI;
        const a1 = ((i + 1) / segments) * 2 * Math.PI;
        const c0 = Math.cos(a0), s0 = Math.sin(a0);
        const c1 = Math.cos(a1), s1 = Math.sin(a1);
        const base0 = [headRadius * c0, headRadius * s0, shaftLength];
        const base1 = [headRadius * c1, headRadius * s1, shaftLength];
        const tip = [0, 0, tipZ];
        const cn0 = vec3Normalize([c0, s0, coneSlope]);
        const cn1 = vec3Normalize([c1, s1, coneSlope]);
        const cnt = vec3Normalize([(c0 + c1) / 2, (s0 + s1) / 2, coneSlope]);
        pushVertex(base0, cn0); pushVertex(base1, cn1); pushVertex(tip, cnt);
    }

    for (let i = 0; i < segments; i++) {
        const a0 = (i / segments) * 2 * Math.PI;
        const a1 = ((i + 1) / segments) * 2 * Math.PI;
        const c0 = Math.cos(a0), s0 = Math.sin(a0);
        const c1 = Math.cos(a1), s1 = Math.sin(a1);
        const capNorm = [0, 0, -1];
        pushVertex([0, 0, shaftLength], capNorm);
        pushVertex([headRadius * c1, headRadius * s1, shaftLength], capNorm);
        pushVertex([headRadius * c0, headRadius * s0, shaftLength], capNorm);
    }
    return new Float32Array(verts);
}

function computeBlochArrow(result, targetQubit = 0) {
    const snapshots = result?.states || [];
    const stepVectors = snapshots.map(snapshot => {
        const bloch = extractQubitBloch(snapshot, targetQubit);
        return [bloch[0], bloch[2], bloch[1]];
    });
    const screenVector = stepVectors.length > 0 ? stepVectors[stepVectors.length - 1] : [0, 1, 0];
    return {
        vertices: buildArrowVertices(screenVector),
        blochVector: [screenVector[0], screenVector[2], screenVector[1]],
        screenVector,
        stepVectors
    };
}

const blochLabelDefs = [
    { id: 'label-zero', pos: [0, 1.15, 0] },
    { id: 'label-one', pos: [0, -1.15, 0] },
    { id: 'label-plus', pos: [1.15, 0, 0] },
    { id: 'label-minus', pos: [-1.15, 0, 0] },
    { id: 'label-i-plus', pos: [0, 0, 1.15] },
    { id: 'label-i-minus', pos: [0, 0, -1.15] }
];

function createSphereMaterial() {
    return new THREE.ShaderMaterial({
        vertexShader: `
            varying vec3 vNormal;
            varying vec3 vViewPosition;
            void main() {
                vNormal = normalize(normalMatrix * normal);
                vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
                vViewPosition = -mvPosition.xyz;
                gl_Position = projectionMatrix * mvPosition;
            }
        `,
        fragmentShader: `
            varying vec3 vNormal;
            varying vec3 vViewPosition;
            void main() {
                vec3 normal = normalize(vNormal);
                vec3 viewDir = normalize(vViewPosition);
                float rim = 1.0 - max(dot(viewDir, normal), 0.0);
                rim = smoothstep(0.4, 0.98, rim);
                vec3 rimColor = vec3(0.35, 0.45, 0.65);
                float alpha = rim * 0.12;
                gl_FragColor = vec4(rimColor, alpha);
            }
        `,
        transparent: true,
        depthWrite: false,
        side: THREE.FrontSide
    });
}

function createLineMaterial() {
    return new THREE.LineBasicMaterial({
        color: 0x5a6578,
        transparent: true,
        opacity: 0.35
    });
}

function createArrowMaterial() {
    return new THREE.MeshBasicMaterial({
        color: 0xe6edf3,
        transparent: true,
        opacity: 0.95
    });
}

function createSphereWireframe(lineMat) {
    const group = new THREE.Group();
    const segments = 64;
    const mat = lineMat || createLineMaterial();

    const axisPositions = new Float32Array([
        -1, 0, 0, 1, 0, 0,
        0, -1, 0, 0, 1, 0,
        0, 0, -1, 0, 0, 1
    ]);
    const axisGeo = new THREE.BufferGeometry();
    axisGeo.setAttribute('position', new THREE.BufferAttribute(axisPositions, 3));
    group.add(new THREE.LineSegments(axisGeo, mat));

    for (let plane = 0; plane < 3; plane++) {
        const circleVerts = [];
        for (let i = 0; i <= segments; i++) {
            const a = (i / segments) * 2 * Math.PI;
            const c = Math.cos(a), s = Math.sin(a);
            if (plane === 0) circleVerts.push(c, 0, s);
            else if (plane === 1) circleVerts.push(c, s, 0);
            else circleVerts.push(0, s, c);
        }
        const circleGeo = new THREE.BufferGeometry();
        circleGeo.setAttribute('position', new THREE.Float32BufferAttribute(circleVerts, 3));
        group.add(new THREE.Line(circleGeo, mat));
    }

    group.scale.set(1.025, 1.025, 1.025);
    return group;
}

function createArrowMesh(blochVec, material) {
    const group = new THREE.Group();
    const r = Math.sqrt(blochVec[0] ** 2 + blochVec[1] ** 2 + blochVec[2] ** 2);
    if (r < 0.001) return group;

    const shaftRadius = 0.02 * Math.max(0.3, Math.min(1.0, r));
    const headRadius = 0.055 * Math.max(0.3, Math.min(1.0, r));
    const headLength = 0.14 * r;
    const shaftLength = 0.86 * r;

    const useMat = material || createArrowMaterial();

    const shaftGeo = new THREE.CylinderGeometry(shaftRadius, shaftRadius, shaftLength, 12);
    shaftGeo.translate(0, shaftLength / 2, 0);
    const shaft = new THREE.Mesh(shaftGeo, useMat);
    group.add(shaft);

    const headGeo = new THREE.ConeGeometry(headRadius, headLength, 12);
    headGeo.translate(0, shaftLength + headLength / 2, 0);
    const head = new THREE.Mesh(headGeo, useMat);
    group.add(head);

    const dir = new THREE.Vector3(blochVec[0], blochVec[1], blochVec[2]).normalize();
    const up = new THREE.Vector3(0, 1, 0);
    if (Math.abs(dir.dot(up)) > 0.9999) {
        if (dir.y < 0) {
            group.rotation.z = Math.PI;
        }
    } else {
        const quat = new THREE.Quaternion().setFromUnitVectors(up, dir);
        group.quaternion.copy(quat);
    }

    group.scale.set(1.05, 1.05, 1.05);
    return group;
}

function vectorsClose(a, b, epsilon = 1e-3) {
    return Math.abs(a[0] - b[0]) < epsilon
        && Math.abs(a[1] - b[1]) < epsilon
        && Math.abs(a[2] - b[2]) < epsilon;
}

function distanceToSegment(point, start, end) {
    const dx = end[0] - start[0];
    const dy = end[1] - start[1];
    const lengthSquared = dx * dx + dy * dy;
    if (lengthSquared < 1e-6) {
        return Math.hypot(point[0] - start[0], point[1] - start[1]);
    }
    const t = Math.max(0, Math.min(1,
        ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / lengthSquared));
    return Math.hypot(
        point[0] - (start[0] + t * dx),
        point[1] - (start[1] + t * dy)
    );
}

function updateArrowHover(renderer, event) {
    if (!renderer.hoverInfo) return;

    const width = renderer.stage.clientWidth;
    const height = renderer.stage.clientHeight;
    const rect = renderer.canvas.getBoundingClientRect();
    const point = [event.clientX - rect.left, event.clientY - rect.top];
    const modelMatrix = rotateMatrix(...renderer.rotation, renderer._projMatrix);
    const start = projectPoint([0, 0, 0], modelMatrix, width, height);
    const end = projectPoint(renderer.currentVector, modelMatrix, width, height);

    if (!start || !end || distanceToSegment(point, start, end) > 11) {
        renderer.hoverInfo.hidden = true;
        return;
    }

    const blochX = renderer.currentVector[0];
    const blochY = renderer.currentVector[2];
    const blochZ = renderer.currentVector[1];
    const probabilityZero = Math.max(0, Math.min(1, (1 + blochZ) / 2));
    const probabilityOne = Math.max(0, Math.min(1, (1 - blochZ) / 2));
    const phase = Math.atan2(blochY, blochX) * 180 / Math.PI;
    const phaseText = Math.hypot(blochX, blochY) < 1e-3
        ? 'undefined'
        : `${phase.toFixed(1)}°`;

    renderer.hoverInfo.innerHTML =
        `P(|0⟩): ${(probabilityZero * 100).toFixed(1)}%<br>` +
        `P(|1⟩): ${(probabilityOne * 100).toFixed(1)}%<br>` +
        `Phase: ${phaseText}`;
    renderer.hoverInfo.style.left = `${Math.min(width - 8, Math.max(8, point[0] + 12))}px`;
    renderer.hoverInfo.style.top = `${Math.min(height - 8, Math.max(8, point[1] + 12))}px`;
    renderer.hoverInfo.hidden = false;
}

const qubitSphereSize = 270;
let miniRenderers = [];
let currentQubitsList = [];
let selectedQubitIndex = 0;
let selectedQubitName = null;
let lastResult = null;

function createQubitSphereStage(card, canvasElement) {
    const stage = document.createElement('div');
    stage.className = 'qubit-sphere-stage';

    const labels = document.createElement('div');
    labels.className = 'qubit-bloch-labels';
    const labelNames = [
        ['zero', '|0⟩'], ['one', '|1⟩'], ['plus', '|+⟩'],
        ['minus', '|-⟩'], ['i-plus', '|+i⟩'], ['i-minus', '|-i⟩']
    ];
    for (const [name, text] of labelNames) {
        const label = document.createElement('div');
        label.className = `qubit-bloch-label label-${name}`;
        label.textContent = text;
        labels.appendChild(label);
    }

    stage.appendChild(canvasElement);
    stage.appendChild(labels);
    card.appendChild(stage);
    return { stage, labels };
}

function createMiniRenderer(canvasElement, result, qubitIndex, previousVector, previousRotation) {
    const miniRenderer = new THREE.WebGLRenderer({
        canvas: canvasElement,
        alpha: true,
        antialias: true,
        premultipliedAlpha: true
    });
    miniRenderer.setClearColor(0x000000, 0);
    miniRenderer.setPixelRatio(window.devicePixelRatio || 1);
    miniRenderer.setSize(canvasElement.clientWidth || qubitSphereSize, canvasElement.clientHeight || qubitSphereSize, false);

    const scene = new THREE.Scene();
    const aspect = (canvasElement.clientWidth || qubitSphereSize) / (canvasElement.clientHeight || qubitSphereSize);
    const camera = new THREE.PerspectiveCamera(45, aspect, 0.1, 100);
    camera.position.set(0, 0, 3);
    camera.lookAt(0, 0, 0);

    const sphereMaterial = createSphereMaterial();
    const lineMaterial = createLineMaterial();
    const arrowMaterial = createArrowMaterial();

    const sphereGeo = new THREE.SphereGeometry(1, 32, 32);
    scene.add(new THREE.Mesh(sphereGeo, sphereMaterial));
    scene.add(createSphereWireframe(lineMaterial));

    const arrowResult = computeBlochArrow(result, qubitIndex);
    const finalVector = arrowResult.screenVector || [0, 1, 0];
    const currentVector = previousVector || finalVector;
    const targetVector = finalVector;
    const stepQueue = [];

    const arrowGroup = new THREE.Group();
    const initialArrow = createArrowMesh(currentVector, arrowMaterial);
    arrowGroup.add(initialArrow);
    scene.add(arrowGroup);


    const rotation = previousRotation ? [...previousRotation] : [0.3, 0.0, 0.0];
    let dragging = false;
    let previousX = 0;
    canvasElement.addEventListener('mousedown', event => {
        dragging = true;
        previousX = event.clientX;
    });
    canvasElement.addEventListener('mousemove', event => {
        if (!dragging) return;
        rotation[1] += (event.clientX - previousX) * 0.005;
        previousX = event.clientX;
    });
    canvasElement.addEventListener('mouseup', () => { dragging = false; });
    canvasElement.addEventListener('mouseleave', () => { dragging = false; });

    const projMatrix = mult(
        createPerspectiveMatrix(Math.PI / 4, aspect, 0.1, 100),
        createTranslationMatrix(0, 0, -3)
    );

    const rendererObj = {
        canvas: canvasElement,
        stage: canvasElement.parentElement,
        labels: [...canvasElement.parentElement.querySelectorAll('.qubit-bloch-label')],
        threeRenderer: miniRenderer,
        scene,
        camera,
        arrowGroup,
        arrowMaterial,
        sphereMaterial,
        lineMaterial,
        currentVector: [...currentVector],
        targetVector: [...targetVector],
        stepQueue,
        rotation,
        qubitIndex,
        hoverInfo: null,
        arrowVector: arrowResult.screenVector,
        _projMatrix: projMatrix
    };

    try {
        const hoverInfo = document.createElement('div');
        hoverInfo.className = 'qubit-hover-info';
        hoverInfo.hidden = true;
        rendererObj.stage.appendChild(hoverInfo);
        rendererObj.hoverInfo = hoverInfo;

        canvasElement.addEventListener('mousemove', event => {
            updateArrowHover(rendererObj, event);
        });
        canvasElement.addEventListener('mouseleave', () => {
            rendererObj.hoverInfo.hidden = true;
        });
    } catch (error) {
        console.warn('Arrow hover information unavailable:', error);
    }

    return rendererObj;
}

function renderMiniRenderer(renderer) {
    if (!renderer.threeRenderer) return;
    const current = renderer.currentVector;
    const target = renderer.targetVector;
    if (!vectorsClose(current, target)) {
        const nextVector = interpolateVector(current, target, 0.25);
        renderer.currentVector = vectorsClose(nextVector, target) ? [...target] : nextVector;

        while (renderer.arrowGroup.children.length > 0) {
            const c = renderer.arrowGroup.children[0];
            renderer.arrowGroup.remove(c);
            if (c.traverse) {
                c.traverse(obj => {
                    if (obj.geometry) obj.geometry.dispose();
                });
            }
        }
        renderer.arrowGroup.add(createArrowMesh(renderer.currentVector, renderer.arrowMaterial));
    } else if (renderer.stepQueue && renderer.stepQueue.length > 0) {
        renderer.targetVector = renderer.stepQueue.shift();
    }

    renderer.scene.rotation.set(renderer.rotation[0], renderer.rotation[1], renderer.rotation[2]);
    updateMiniLabels(renderer, rotateMatrix(...renderer.rotation, renderer._projMatrix));

    try {
        renderer.threeRenderer.render(renderer.scene, renderer.camera);
    } catch (e) {
        // Suppress transient render errors
    }
}

function updateMiniLabels(renderer, modelMatrix) {
    const width = renderer.stage.clientWidth;
    const height = renderer.stage.clientHeight;
    for (let i = 0; i < blochLabelDefs.length; i++) {
        const label = renderer.labels[i];
        if (!label) continue;
        const point = projectPoint(blochLabelDefs[i].pos, modelMatrix, width, height);
        if (point) {
            label.style.transform = `translate(-50%, -50%) translate(${point[0]}px, ${point[1]}px)`;
            label.style.display = 'block';
        } else {
            label.style.display = 'none';
        }
    }
}

function destroyMiniRenderers() {
    for (const renderer of miniRenderers) {
        if (renderer.threeRenderer) {
            try {
                renderer.threeRenderer.forceContextLoss();
                renderer.threeRenderer.dispose();
            } catch (e) {
                console.warn('Error disposing mini renderer:', e);
            }
        }
        if (renderer.scene) {
            renderer.scene.traverse(obj => {
                if (obj.geometry) obj.geometry.dispose();
                if (obj.material) {
                    if (Array.isArray(obj.material)) obj.material.forEach(m => m.dispose());
                    else obj.material.dispose();
                }
            });
        }
    }
    miniRenderers = [];
}

function populateQubitColumn(result) {
    const column = document.getElementById('qubit-column');
    if (!column) return;

    const qubitsList = result?.qubitsList || [];
    const count = Math.max(qubitsList.length, result?.qubitsDeclared || 0);
    currentQubitsList = qubitsList;

    // Fast-path: If the qubit count hasn't changed, reuse the active WebGL contexts in place!
    if (miniRenderers.length === count && count > 0) {
        for (let i = 0; i < count; i++) {
            const renderer = miniRenderers[i];
            const arrowResult = computeBlochArrow(result, i);
            renderer.targetVector = arrowResult.screenVector || [0, 1, 0];
            renderer.stepQueue = [];
            renderer.arrowVector = arrowResult.screenVector;
            const card = column.children[i];
            if (card) {
                const label = card.querySelector('.qubit-mini-label');
                if (label) label.textContent = `Qubit ${i}`;
            }
        }
        return;
    }

    // Qubit count actually changed: destroy old WebGL contexts properly and rebuild
    destroyMiniRenderers();
    column.innerHTML = '';

    for (let i = 0; i < count; i++) {
        const card = document.createElement('div');
        card.className = 'qubit-mini';

        const label = document.createElement('div');
        label.className = 'qubit-mini-label';
        label.textContent = `Qubit ${i}`;

        const miniCanvas = document.createElement('canvas');
        miniCanvas.className = 'qubit-mini-canvas';
        miniCanvas.width = qubitSphereSize;
        miniCanvas.height = qubitSphereSize;

        card.appendChild(label);
        createQubitSphereStage(card, miniCanvas);
        column.appendChild(card);
    }

    if (count > 0) {
        selectedQubitIndex = Math.min(selectedQubitIndex, count - 1);
        selectedQubitName = currentQubitsList[selectedQubitIndex] || null;
    }

    const canvases = [...column.querySelectorAll('.qubit-mini-canvas')];
    miniRenderers = canvases.map((canvasElement, index) =>
        createMiniRenderer(canvasElement, result, index)
    ).filter(Boolean);
}

function replayAnimation() {
    if (!lastResult) return;

    for (let index = 0; index < miniRenderers.length; index++) {
        const renderer = miniRenderers[index];
        const arrowResult = computeBlochArrow(lastResult, index);
        const stepVectors = arrowResult.stepVectors || [];
        const firstVector = stepVectors[0] || arrowResult.screenVector || [0, 1, 0];
        const nextTarget = stepVectors[1] || firstVector;
        renderer.currentVector = [...firstVector];
        renderer.targetVector = [...nextTarget];
        renderer.stepQueue = stepVectors.slice(2);

        while (renderer.arrowGroup.children.length > 0) {
            const c = renderer.arrowGroup.children[0];
            renderer.arrowGroup.remove(c);
            if (c.traverse) c.traverse(obj => { if (obj.geometry) obj.geometry.dispose(); });
        }
        renderer.arrowGroup.add(createArrowMesh(firstVector, renderer.arrowMaterial));
    }
}


const blochVisualization = {
    id: 'bloch',
    label: 'Bloch',

    mount(container) {
        const controls = document.getElementById('controls');
        if (controls) {
            controls.hidden = false;
            controls.style.display = 'flex';
        }
        if (lastResult) {
            populateQubitColumn(lastResult);
        }
    },

    unmount() {
        const controls = document.getElementById('controls');
        if (controls) {
            controls.hidden = true;
            controls.style.display = 'none';
        }
    },

    update(result) {
        if (!result) return;
        lastResult = result;
        populateQubitColumn(result);
    },

    animate() {
        for (const renderer of miniRenderers) {
            renderMiniRenderer(renderer);
        }
    },

    replayAnimation
};

export default blochVisualization;

export {
    blochVisualization,
    extractQubitBloch,
    buildArrowVertices,
    computeBlochArrow,
    populateQubitColumn,
    destroyMiniRenderers,
    replayAnimation,
    createSphereMaterial,
    createLineMaterial,
    createArrowMaterial,
    createSphereWireframe,
    createArrowMesh
};

if (typeof window !== 'undefined') {
    window.bloch = {
        blochVisualization,
        extractQubitBloch,
        buildArrowVertices,
        computeBlochArrow,
        populateQubitColumn,
        destroyMiniRenderers,
        replayAnimation
    };
    window.computeBlochArrow = computeBlochArrow;
    window.extractQubitBloch = extractQubitBloch;
    window.buildArrowVertices = buildArrowVertices;
}
