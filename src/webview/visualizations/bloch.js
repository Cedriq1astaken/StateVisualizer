import * as THREE from 'three';
import {
    vec3Normalize,
    vec3Cross,
    vec3Dot,
    vectorsClose,
    rodriguesRotate,
    alignmentRotation,
    interpolateVector,
    distanceToSegment,
    mult,
    createPerspectiveMatrix,
    createTranslationMatrix,
    rotateMatrix,
    projectPoint,
    extractQubitBloch
} from '../math/index.js';
import { createHoverTooltip } from '../render/hoverTooltip.js';

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
        premultipliedAlpha: true,
        preserveDrawingBuffer: true
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
        const hoverInfo = createHoverTooltip(rendererObj.stage, 'qubit-hover-info');
        rendererObj.hoverInfo = hoverInfo;

        canvasElement.addEventListener('mousemove', event => {
            updateArrowHover(rendererObj, event);
        });
        canvasElement.addEventListener('mouseleave', () => {
            if (rendererObj.hoverInfo) rendererObj.hoverInfo.hidden = true;
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


function generateBlochSvg() {
    const numQubits = miniRenderers.length;
    if (numQubits === 0) {
        return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 300" width="600" height="300"><rect width="100%" height="100%" fill="#0a0e17"/><text x="300" y="150" fill="white" font-family="system-ui, sans-serif" font-size="14" text-anchor="middle">No qubits declared</text></svg>`;
    }

    const cols = numQubits <= 3 ? numQubits : Math.min(4, Math.ceil(Math.sqrt(numQubits)));
    const rows = Math.ceil(numQubits / cols);
    const cardW = 270;
    const cardH = 320;
    const gap = 24;
    const totalW = cols * cardW + (cols + 1) * gap;
    const totalH = rows * cardH + (rows + 1) * gap;

    const labelMap = {
        'label-zero': '|0⟩',
        'label-one': '|1⟩',
        'label-plus': '|+⟩',
        'label-minus': '|-⟩',
        'label-i-plus': '|+i⟩',
        'label-i-minus': '|-i⟩'
    };

    let svg = `<?xml version="1.0" encoding="UTF-8"?>\n` +
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${totalW} ${totalH}" width="${totalW}" height="${totalH}">\n` +
        `  <defs>\n` +
        `    <style>\n` +
        `      text { font-family: system-ui, -apple-system, sans-serif; }\n` +
        `    </style>\n` +
        `  </defs>\n`;

    for (let i = 0; i < numQubits; i++) {
        const renderer = miniRenderers[i];
        const gridCol = i % cols;
        const gridRow = Math.floor(i / cols);
        const cardX = gap + gridCol * (cardW + gap);
        const cardY = gap + gridRow * (cardH + gap);

        const modelMatrix = rotateMatrix(...renderer.rotation, renderer._projMatrix);

        svg += `  <g transform="translate(${cardX}, ${cardY})">\n`;
        svg += `    <rect width="${cardW}" height="${cardH}" rx="8" fill="rgba(20, 26, 38, 0.7)" stroke="rgba(255, 255, 255, 0.12)" stroke-width="1"/>\n`;
        svg += `    <text x="${cardW / 2}" y="24" fill="#e6e6ee" font-size="14" font-weight="bold" text-anchor="middle">Qubit ${i}</text>\n`;

        // Wireframe circles (3 orthogonal planes)
        const segments = 32;
        for (let plane = 0; plane < 3; plane++) {
            const points = [];
            for (let s = 0; s <= segments; s++) {
                const a = (s / segments) * 2 * Math.PI;
                const c = Math.cos(a), sn = Math.sin(a);
                const pos = plane === 0 ? [c, 0, sn] : (plane === 1 ? [c, sn, 0] : [0, sn, c]);
                const pt = projectPoint(pos, modelMatrix, cardW, cardW);
                if (pt) points.push(`${pt[0].toFixed(1)},${(pt[1] + 28).toFixed(1)}`);
            }
            if (points.length > 1) {
                svg += `    <polyline points="${points.join(' ')}" fill="none" stroke="#5a6578" stroke-width="1" stroke-opacity="0.45"/>\n`;
            }
        }

        // Axes (X, Y, Z)
        const axes = [
            { from: [-1, 0, 0], to: [1, 0, 0] },
            { from: [0, -1, 0], to: [0, 1, 0] },
            { from: [0, 0, -1], to: [0, 0, 1] }
        ];
        for (const axis of axes) {
            const p1 = projectPoint(axis.from, modelMatrix, cardW, cardW);
            const p2 = projectPoint(axis.to, modelMatrix, cardW, cardW);
            if (p1 && p2) {
                svg += `    <line x1="${p1[0].toFixed(1)}" y1="${(p1[1] + 28).toFixed(1)}" x2="${p2[0].toFixed(1)}" y2="${(p2[1] + 28).toFixed(1)}" stroke="#5a6578" stroke-width="1" stroke-dasharray="3,3" stroke-opacity="0.6"/>\n`;
            }
        }

        // Basis state labels
        for (const labelDef of blochLabelDefs) {
            const pt = projectPoint(labelDef.pos, modelMatrix, cardW, cardW);
            if (pt) {
                const text = labelMap[labelDef.id] || '';
                svg += `    <text x="${pt[0].toFixed(1)}" y="${(pt[1] + 32).toFixed(1)}" fill="#e0e0e0" font-size="12" font-weight="bold" text-anchor="middle">${text}</text>\n`;
            }
        }

        // State vector arrow
        const centerPt = projectPoint([0, 0, 0], modelMatrix, cardW, cardW);
        const tipPt = projectPoint(renderer.currentVector, modelMatrix, cardW, cardW);

        if (centerPt && tipPt) {
            const dx = tipPt[0] - centerPt[0];
            const dy = tipPt[1] - centerPt[1];
            const len = Math.hypot(dx, dy);

            if (len > 3) {
                const angle = Math.atan2(dy, dx);
                const headLen = Math.min(10, len * 0.35);
                const leftAngle = angle + Math.PI * 0.82;
                const rightAngle = angle - Math.PI * 0.82;
                const hx1 = tipPt[0] + headLen * Math.cos(leftAngle);
                const hy1 = tipPt[1] + 28 + headLen * Math.sin(leftAngle);
                const hx2 = tipPt[0] + headLen * Math.cos(rightAngle);
                const hy2 = tipPt[1] + 28 + headLen * Math.sin(rightAngle);

                svg += `    <line x1="${centerPt[0].toFixed(1)}" y1="${(centerPt[1] + 28).toFixed(1)}" x2="${tipPt[0].toFixed(1)}" y2="${(tipPt[1] + 28).toFixed(1)}" stroke="#e6edf3" stroke-width="2.5" stroke-linecap="round"/>\n`;
                svg += `    <polygon points="${tipPt[0].toFixed(1)},${(tipPt[1] + 28).toFixed(1)} ${hx1.toFixed(1)},${hy1.toFixed(1)} ${hx2.toFixed(1)},${hy2.toFixed(1)}" fill="#e6edf3"/>\n`;
            }
        }

        // Summary text below sphere
        const blochZ = renderer.currentVector[1];
        const prob0 = ((1 + blochZ) / 2 * 100).toFixed(1);
        const prob1 = ((1 - blochZ) / 2 * 100).toFixed(1);
        svg += `    <text x="${cardW / 2}" y="${cardH - 12}" fill="rgba(255,255,255,0.75)" font-size="11" font-weight="500" text-anchor="middle">P(|0⟩): ${prob0}%  •  P(|1⟩): ${prob1}%</text>\n`;

        svg += `  </g>\n`;
    }

    svg += `</svg>`;
    return svg;
}

function generateBlochPng() {
    const numQubits = miniRenderers.length;
    if (numQubits === 0) return '';

    const cols = numQubits <= 3 ? numQubits : Math.min(4, Math.ceil(Math.sqrt(numQubits)));
    const rows = Math.ceil(numQubits / cols);
    const cardW = 270;
    const cardH = 320;
    const gap = 24;
    const dpr = window.devicePixelRatio || 1;

    const totalW = cols * cardW + (cols + 1) * gap;
    const totalH = rows * cardH + (rows + 1) * gap;

    const offscreen = document.createElement('canvas');
    offscreen.width = Math.floor(totalW * dpr);
    offscreen.height = Math.floor(totalH * dpr);
    const ctx = offscreen.getContext('2d');
    if (!ctx) return '';

    ctx.scale(dpr, dpr);
    // (Transparent canvas background preserved)

    const labelMap = {
        'label-zero': '|0⟩',
        'label-one': '|1⟩',
        'label-plus': '|+⟩',
        'label-minus': '|-⟩',
        'label-i-plus': '|+i⟩',
        'label-i-minus': '|-i⟩'
    };

    for (let i = 0; i < numQubits; i++) {
        const renderer = miniRenderers[i];
        if (!renderer || !renderer.threeRenderer) continue;

        // Render current 3D state
        renderer.threeRenderer.render(renderer.scene, renderer.camera);

        const gridCol = i % cols;
        const gridRow = Math.floor(i / cols);
        const cardX = gap + gridCol * (cardW + gap);
        const cardY = gap + gridRow * (cardH + gap);

        // Card background
        ctx.fillStyle = 'rgba(20, 26, 38, 0.7)';
        if (typeof ctx.roundRect === 'function') {
            ctx.beginPath();
            ctx.roundRect(cardX, cardY, cardW, cardH, 8);
            ctx.fill();
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
            ctx.lineWidth = 1;
            ctx.stroke();
        } else {
            ctx.fillRect(cardX, cardY, cardW, cardH);
        }

        // Title
        ctx.font = 'bold 14px system-ui, -apple-system, sans-serif';
        ctx.fillStyle = '#e6e6ee';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(`Qubit ${i}`, cardX + cardW / 2, cardY + 20);

        // Draw WebGL canvas
        ctx.drawImage(renderer.canvas, cardX, cardY + 28, cardW, cardW);

        // Draw labels
        const modelMatrix = rotateMatrix(...renderer.rotation, renderer._projMatrix);
        ctx.font = 'bold 12px system-ui, -apple-system, sans-serif';
        ctx.fillStyle = '#e0e0e0';
        ctx.shadowColor = 'rgba(0, 0, 0, 0.9)';
        ctx.shadowBlur = 4;

        for (const labelDef of blochLabelDefs) {
            const pt = projectPoint(labelDef.pos, modelMatrix, cardW, cardW);
            if (pt) {
                const text = labelMap[labelDef.id] || '';
                ctx.fillText(text, cardX + pt[0], cardY + 28 + pt[1]);
            }
        }
        ctx.shadowBlur = 0;

        // Summary text below sphere
        const blochZ = renderer.currentVector[1];
        const prob0 = ((1 + blochZ) / 2 * 100).toFixed(1);
        const prob1 = ((1 - blochZ) / 2 * 100).toFixed(1);
        ctx.font = '500 11px system-ui, -apple-system, sans-serif';
        ctx.fillStyle = 'rgba(255,255,255,0.75)';
        ctx.fillText(`P(|0⟩): ${prob0}%  •  P(|1⟩): ${prob1}%`, cardX + cardW / 2, cardY + cardH - 12);
    }

    return offscreen.toDataURL('image/png');
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

    replayAnimation,

    async export() {
        const svgContent = generateBlochSvg();
        const pngDataUrl = generateBlochPng();
        return {
            filenamePrefix: 'bloch',
            pngDataUrl,
            svgContent
        };
    }
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
    createArrowMesh,
    generateBlochSvg,
    generateBlochPng
};

if (typeof window !== 'undefined') {
    window.bloch = {
        blochVisualization,
        extractQubitBloch,
        buildArrowVertices,
        computeBlochArrow,
        populateQubitColumn,
        destroyMiniRenderers,
        replayAnimation,
        generateBlochSvg,
        generateBlochPng
    };
    window.computeBlochArrow = computeBlochArrow;
    window.extractQubitBloch = extractQubitBloch;
    window.buildArrowVertices = buildArrowVertices;
}

