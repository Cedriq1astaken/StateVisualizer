import * as THREE from 'three';

const vscode = typeof acquireVsCodeApi === 'function' ? acquireVsCodeApi() : undefined;

const canvas = document.querySelector('canvas');
const statusText = document.querySelector('#status');
const qsphereContainer = document.getElementById('container');
const controlsContainer = document.getElementById('controls');
let rotationAngles = [0.3, 0.0, 0.0];
let currentMode = 'bloch';
let lastParsedResult = null;
let selectedQubitIndex = 0;
let selectedQubitName = null;
let currentQubitsList = [];
let miniRenderers = [];
const qubitSphereSize = 270;
let qsphereHoverInfo = null;

function vectorsClose(a, b, epsilon = 1e-3) {
    return Math.abs(a[0] - b[0]) < epsilon
        && Math.abs(a[1] - b[1]) < epsilon
        && Math.abs(a[2] - b[2]) < epsilon;
}

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

function setStatus(message) {
    if (statusText) statusText.textContent = '';
}

function drawPhaseLegend() {
    const legendCanvas = document.getElementById('qsphere-phase-wheel');
    if (!legendCanvas || typeof phaseToRgb !== 'function') return;

    const context = legendCanvas.getContext('2d');
    if (!context) return;

    const center = legendCanvas.width / 2;
    const outerRadius = center - 4;
    const innerRadius = outerRadius - 10;
    const segments = 24;

    context.clearRect(0, 0, legendCanvas.width, legendCanvas.height);
    for (let index = 0; index < segments; index++) {
        const start = (index / segments) * Math.PI * 2;
        const end = ((index + 1) / segments) * Math.PI * 2;
        const phase = -((start + end) / 2);
        const [r, g, b] = phaseToRgb(phase);
        context.beginPath();
        context.arc(center, center, outerRadius, start, end);
        context.arc(center, center, innerRadius, end, start, true);
        context.closePath();
        context.fillStyle = `rgb(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)})`;
        context.fill();
    }

    context.beginPath();
    context.arc(center, center, innerRadius - 1, 0, Math.PI * 2);
    context.fillStyle = '#12303a';
    context.fill();
    context.strokeStyle = 'rgba(230, 230, 238, 0.35)';
    context.lineWidth = 1;
    context.stroke();
}

function updateModeTabs() {
    document.body.dataset.visualizationMode = currentMode;
    document.querySelectorAll('.view-tab').forEach(tab => {
        const isActive = tab.dataset.viewMode === currentMode;
        tab.classList.toggle('active', isActive);
        tab.setAttribute('aria-selected', String(isActive));
    });
}

function getQsphereHoverInfo() {
    if (qsphereHoverInfo || !qsphereContainer) return qsphereHoverInfo;

    qsphereHoverInfo = document.createElement('div');
    qsphereHoverInfo.className = 'qubit-hover-info qsphere-hover-info';
    qsphereHoverInfo.hidden = true;
    qsphereContainer.appendChild(qsphereHoverInfo);
    return qsphereHoverInfo;
}

function formatBasisState(index, qubits) {
    return `|${index.toString(2).padStart(qubits, '0')}>`;
}

function formatPhasePi(phase) {
    const twoPi = Math.PI * 2;
    const normalized = ((phase % twoPi) + twoPi) % twoPi;
    const units = normalized / Math.PI;
    const known = [
        [0, '0'],
        [0.5, 'pi/2'],
        [1, 'pi'],
        [1.5, '3pi/2'],
        [2, '0']
    ];

    for (const [value, label] of known) {
        if (Math.abs(units - value) < 0.03) return label;
    }
    return `${units.toFixed(2)}pi`;
}

function createSphereMaterial() {
    return new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        vertexShader: `
            varying vec3 vNormal;
            varying float vDepth;
            void main() {
                vNormal = normalize(normalMatrix * normal);
                vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
                gl_Position = projectionMatrix * mvPos;
                vDepth = gl_Position.z / gl_Position.w;
            }
        `,
        fragmentShader: `
            varying vec3 vNormal;
            varying float vDepth;
            void main() {
                vec3 baseColor = vec3(0.92, 0.92, 0.92);
                float depthFactor = mix(1.0, 0.52, clamp(vDepth * 0.5 + 0.5, 0.0, 1.0));
                vec3 N = normalize(vNormal);
                float centerFactor = max(N.z, 0.0);
                float alpha = mix(0.6, 0.2, centerFactor);
                gl_FragColor = vec4(baseColor * depthFactor, alpha);
            }
        `
    });
}

function createArrowMaterial() {
    return new THREE.ShaderMaterial({
        transparent: false,
        side: THREE.DoubleSide,
        vertexShader: `
            varying vec3 vNormal;
            varying float vDepth;
            void main() {
                vNormal = normalize(normalMatrix * normal);
                vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
                gl_Position = projectionMatrix * mvPos;
                vDepth = gl_Position.z / gl_Position.w;
            }
        `,
        fragmentShader: `
            varying vec3 vNormal;
            varying float vDepth;
            void main() {
                vec3 baseColor = vec3(0.55, 0.12, 0.88);
                float depthFactor = mix(1.0, 0.45, clamp(vDepth * 0.5 + 0.5, 0.0, 1.0));
                vec3 N = normalize(vNormal);
                vec3 lightDir = normalize(vec3(0.3, 0.5, 1.0));
                float diffuse = max(dot(N, lightDir), 0.0);
                float ambient = 0.35;
                float lighting = ambient + (1.0 - ambient) * diffuse;
                gl_FragColor = vec4(baseColor * depthFactor * lighting, 1.0);
            }
        `
    });
}

function createLineMaterial() {
    return new THREE.LineBasicMaterial({
        color: new THREE.Color(0.55, 0.55, 0.65),
        transparent: true,
        opacity: 0.5,
        depthTest: true
    });
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

    return group;
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

    return group;
}

function createQnodeMesh(cx, cy, cz, radius, r, g, b, a) {
    const geo = new THREE.SphereGeometry(radius, 8, 8);
    const mat = new THREE.MeshBasicMaterial({
        color: new THREE.Color(r, g, b),
        transparent: a < 1.0,
        opacity: a
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(cx, cy, cz);
    return mesh;
}

function createSpokeMesh(end, radius, r, g, b, a) {
    const [ex, ey, ez] = end;
    const length = Math.hypot(ex, ey, ez);
    if (length < 1e-6) return null;

    const geo = new THREE.CylinderGeometry(radius, radius, length, 6);
    geo.translate(0, length / 2, 0);
    const mat = new THREE.MeshBasicMaterial({
        color: new THREE.Color(r, g, b),
        transparent: a < 1.0,
        opacity: a
    });
    const mesh = new THREE.Mesh(geo, mat);

    const dir = new THREE.Vector3(ex, ey, ez).normalize();
    const up = new THREE.Vector3(0, 1, 0);
    if (Math.abs(dir.dot(up)) > 0.9999) {
        if (dir.y < 0) mesh.rotation.z = Math.PI;
    } else {
        mesh.quaternion.setFromUnitVectors(up, dir);
    }

    return mesh;
}

function createHammingRings(N, lineMat) {
    const group = new THREE.Group();
    const segments = 64;
    const mat = lineMat || createLineMaterial();
    for (let w = 1; w < N; w++) {
        const theta = (Math.PI * w) / N;
        const ringY = Math.cos(theta);
        const ringR = Math.sin(theta);
        const verts = [];
        for (let i = 0; i <= segments; i++) {
            const a = (i / segments) * 2 * Math.PI;
            verts.push(ringR * Math.cos(a), ringY, ringR * Math.sin(a));
        }
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
        group.add(new THREE.Line(geo, mat));
    }
    return group;
}

let threeState = null;

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

function updateQsphereScene(result, options = {}) {
    if (!threeState || !result) return;

    const qs = computeQsphere(result, {
        focusedIndex: threeState._qsphereHoveredIndex
    });

    const group = threeState.qsphereGroup;
    while (group.children.length > 0) {
        const child = group.children[0];
        group.remove(child);
        if (child.geometry) child.geometry.dispose();
        if (child.material) child.material.dispose();
    }

    const rings = createHammingRings(qs.N, threeState.lineMaterial);
    group.add(rings);

    const state = qs.state;
    const N = qs.N;
    const points = qs.points;

    for (const point of points) {
        const amp = state[point.index] || { re: 0, im: 0 };
        const probability = amp.re * amp.re + amp.im * amp.im;
        if (probability < 1e-5) continue;

        const radius = 0.12 * Math.sqrt(probability);
        const phase = Math.atan2(amp.im, amp.re);
        const [r, g, b] = phaseToRgb(phase);
        const focusedIndex = threeState._qsphereHoveredIndex;
        const alpha = (focusedIndex === null || focusedIndex === undefined || point.index === focusedIndex) ? 1.0 : 0.24;

        const node = createQnodeMesh(point.x, point.y, point.z, radius, r, g, b, alpha);
        group.add(node);

        const spoke = createSpokeMesh([point.x, point.y, point.z], 0.015, r, g, b, alpha);
        if (spoke) group.add(spoke);
    }

    threeState._qsphereData = qs;
    if (options.rebuildLabels !== false) rebuildQsphereLabels(qs.points, qs.N);
}

function setQsphereHoveredIndex(index) {
    if (!threeState || threeState._qsphereHoveredIndex === index) return;
    threeState._qsphereHoveredIndex = index;
    if (lastParsedResult) updateQsphereScene(lastParsedResult, { rebuildLabels: false });
}

function clearQsphereHover() {
    setQsphereHoveredIndex(null);
    if (qsphereHoverInfo) qsphereHoverInfo.hidden = true;
}

function updateQsphereHover(event) {
    if (!threeState || currentMode !== 'qsphere' || isDragging) {
        clearQsphereHover();
        return;
    }

    const hoverInfo = getQsphereHoverInfo();
    const qsphereData = threeState._qsphereData;
    if (!hoverInfo || !qsphereData?.hoverTargets?.length) return;

    const rect = canvas.getBoundingClientRect();
    const width = qsphereContainer.clientWidth;
    const height = qsphereContainer.clientHeight;
    const point = [event.clientX - rect.left, event.clientY - rect.top];
    const modelMatrix = rotateMatrix(...rotationAngles, threeState._projMatrix);
    const center = projectPoint([0, 0, 0], modelMatrix, width, height);

    let best = null;
    for (const target of qsphereData.hoverTargets) {
        const projected = projectPoint(target.pos, modelMatrix, width, height);
        if (!projected) continue;

        const nodeDistance = Math.hypot(point[0] - projected[0], point[1] - projected[1]);
        const nodeHitRadius = Math.max(9, 10 + target.radius * 125);
        const centerDistance = center ? Math.hypot(point[0] - center[0], point[1] - center[1]) : 0;
        const spokeDistance = center ? distanceToSegment(point, center, projected) : Number.POSITIVE_INFINITY;
        const isNodeHit = nodeDistance <= nodeHitRadius;
        const isSpokeHit = centerDistance > 14 && spokeDistance <= 9;
        const hitDistance = isNodeHit ? nodeDistance : spokeDistance;
        const hitThreshold = isNodeHit ? nodeHitRadius : 9;

        if ((isNodeHit || isSpokeHit) && hitDistance <= hitThreshold && (!best || hitDistance < best.distance)) {
            best = { target, projected, distance: hitDistance };
        }
    }

    if (!best) {
        clearQsphereHover();
        return;
    }

    setQsphereHoveredIndex(best.target.index);

    const phaseDegrees = (((best.target.phase * 180 / Math.PI) % 360) + 360) % 360;
    hoverInfo.innerHTML =
        `${formatBasisState(best.target.index, qsphereData.N)}<br>` +
        `Probability: ${(best.target.probability * 100).toFixed(1)}%<br>` +
        `Phase: ${phaseDegrees.toFixed(1)} deg (${formatPhasePi(best.target.phase)})`;
    hoverInfo.style.left = `${Math.min(width - 8, Math.max(8, point[0] + 12))}px`;
    hoverInfo.style.top = `${Math.min(height - 8, Math.max(8, point[1] + 12))}px`;
    hoverInfo.hidden = false;
}

function setVisualizationMode(mode) {
    if (mode !== 'bloch' && mode !== 'qsphere') return;
    clearQsphereHover();
    currentMode = mode;
    updateModeTabs();

    updateVisibility(lastParsedResult?.qubitsDeclared || 0);
    if (lastParsedResult && currentMode === 'qsphere') {
        resizeRenderer(threeState);
        updateQsphereScene(lastParsedResult);
    }

    if (threeState) {
        updateSceneForMode();
        renderScene();
    }
}

function updateSceneForMode() {
    if (!threeState) return;
    const isQsphere = currentMode === 'qsphere';
    threeState.qsphereGroup.visible = isQsphere;
    threeState.sphereMesh.visible = isQsphere;
    threeState.wireframe.visible = isQsphere;
    threeState.arrowGroup.visible = false;
}

document.querySelectorAll('.view-tab').forEach(tab => {
    tab.addEventListener('click', () => setVisualizationMode(tab.dataset.viewMode));
});
updateModeTabs();
drawPhaseLegend();

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
    const stepVectors = arrowResult.stepVectors || [];
    const finalVector = arrowResult.screenVector || [0, 1, 0];
    const currentVector = previousVector || stepVectors[0] || finalVector;
    const targetVector = previousVector ? finalVector : (stepVectors[0] || finalVector);
    const stepQueue = previousVector ? [] : stepVectors.slice(1);

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

function replayAnimation() {
    if (!lastParsedResult) return;

    for (let index = 0; index < miniRenderers.length; index++) {
        const renderer = miniRenderers[index];
        const arrowResult = computeBlochArrow(lastParsedResult, index);
        const firstVector = arrowResult.stepVectors[0] || arrowResult.screenVector || [0, 1, 0];
        renderer.currentVector = [...firstVector];
        renderer.targetVector = [...firstVector];
        renderer.stepQueue = (arrowResult.stepVectors || []).slice(1);

        while (renderer.arrowGroup.children.length > 0) {
            const c = renderer.arrowGroup.children[0];
            renderer.arrowGroup.remove(c);
            if (c.traverse) c.traverse(obj => { if (obj.geometry) obj.geometry.dispose(); });
        }
        renderer.arrowGroup.add(createArrowMesh(firstVector, renderer.arrowMaterial));
    }
}

let pendingCode = null;

function renderScene() {
    if (!threeState) return;
    threeState.renderer.render(threeState.scene, threeState.camera);
}

async function initScene() {
    let initialArrowData = null;
    let initialQubits = 0;
    const testQsUri = canvas.dataset.testQs || 'test.qs';

    if (pendingCode) {
        try {
            const result = await parseQSharp(pendingCode);
            initialArrowData = computeBlochArrow(result);
            initialQubits = result.qubitsDeclared;
        } catch (e) {
            console.warn('Could not parse pending Q# code:', e);
        }
    }

    if (!initialArrowData) {
        try {
            const response = await fetch(testQsUri);
            if (response.ok) {
                const code = await response.text();
                const result = await parseQSharp(code);
                initialArrowData = computeBlochArrow(result);
                initialQubits = result.qubitsDeclared;
            }
        } catch (e) {
            console.warn('Could not fetch initial Q# file:', e);
        }
    }

    if (!initialArrowData) {
        initialArrowData = computeBlochArrow({ operations: [], qubitsDeclared: 0 });
        initialQubits = 0;
    }

    updateVisibility(initialQubits);

    const state = initThreeRenderer();

    const initialScreenVec = initialArrowData.screenVector || [0, 1, 0];
    state._currentVector = [...initialScreenVec];
    state._targetVector = [...initialScreenVec];
    state._stepVectors = initialArrowData.stepVectors || [];
    state._stepQueue = [];
    state._qsphereHoveredIndex = null;
    state._qsphereData = null;

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

    updateSceneForMode();

    return state;
}

let isDragging = false;
let previousMousePosition = { x: 0, y: 0 };

canvas.addEventListener('mousedown', e => {
    isDragging = true;
    clearQsphereHover();
    previousMousePosition = { x: e.clientX, y: e.clientY };
});

canvas.addEventListener('mousemove', updateQsphereHover);
canvas.addEventListener('mouseleave', clearQsphereHover);
window.addEventListener('mousemove', e => {
    if (!isDragging) return;
    const deltaX = e.clientX - previousMousePosition.x;

    rotationAngles[1] += deltaX * 0.005;

    previousMousePosition = { x: e.clientX, y: e.clientY };
});

window.addEventListener('mouseup', () => {
    isDragging = false;
});

const blochLabelDefs = [
    { id: 'label-zero', pos: [0, 1.15, 0] },
    { id: 'label-one', pos: [0, -1.15, 0] },
    { id: 'label-plus', pos: [1.15, 0, 0] },
    { id: 'label-minus', pos: [-1.15, 0, 0] },
    { id: 'label-i-plus', pos: [0, 0, 1.15] },
    { id: 'label-i-minus', pos: [0, 0, -1.15] }
];

function updateLabels(modelMatrix) {
    const rect = canvas.getBoundingClientRect();
    const w = rect.width;
    const h = rect.height;

    const blochLabelsDiv = document.getElementById('bloch-labels');
    const qsLabelsDiv = document.getElementById('qs-labels');

    if (currentMode === 'bloch') {
        if (blochLabelsDiv) blochLabelsDiv.style.display = 'block';
        if (qsLabelsDiv) qsLabelsDiv.style.display = 'none';

        for (let i = 0; i < blochLabelDefs.length; i++) {
            const item = blochLabelDefs[i];
            const el = document.getElementById(item.id);
            if (!el) continue;
            const pt = projectPoint(item.pos, modelMatrix, w, h);
            if (pt) {
                el.style.transform = `translate(-50%, -50%) translate(${pt[0]}px, ${pt[1]}px)`;
                el.style.display = 'block';
            } else {
                el.style.display = 'none';
            }
        }
    } else {
        if (blochLabelsDiv) blochLabelsDiv.style.display = 'none';
        if (qsLabelsDiv) {
            qsLabelsDiv.style.display = 'block';
            updateQsphereLabels(modelMatrix, w, h);
        }
    }
}

let _qsLabelData = [];

function rebuildQsphereLabels(points, N) {
    const qsLabelsDiv = document.getElementById('qs-labels');
    if (!qsLabelsDiv) return;
    qsLabelsDiv.innerHTML = '';
    _qsLabelData = [];
    for (const pt of points) {
        const binaryStr = pt.index.toString(2).padStart(N, '0');
        const el = document.createElement('div');
        el.className = 'label qs-label';
        el.textContent = '|' + binaryStr + '⟩';
        el.dataset.ptIndex = String(pt.index);
        qsLabelsDiv.appendChild(el);
        _qsLabelData.push({ el, pos: [pt.x * 1.15, pt.y * 1.15, pt.z * 1.15] });
    }
}

function updateQsphereLabels(modelMatrix, w, h) {
    for (const item of _qsLabelData) {
        const pt = projectPoint(item.pos, modelMatrix, w, h);
        if (pt) {
            item.el.style.transform = `translate(-50%, -50%) translate(${pt[0]}px, ${pt[1]}px)`;
            item.el.style.display = 'block';
        } else {
            item.el.style.display = 'none';
        }
    }
}

function frame() {
    if (threeState) {
        if (currentMode === 'qsphere') {
            threeState.scene.rotation.set(rotationAngles[0], rotationAngles[1], rotationAngles[2]);
            const modelMatrix = rotateMatrix(...rotationAngles, threeState._projMatrix);
            updateLabels(modelMatrix);
            try {
                renderScene();
            } catch (e) {}
        }

        for (const renderer of miniRenderers) {
            renderMiniRenderer(renderer);
        }
    }
    requestAnimationFrame(frame);
}

initScene()
    .then(state => {
        threeState = state;
        if (lastParsedResult) {
            populateQubitColumn(lastParsedResult);
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
});

function updateVisibility(qubitsDeclared) {
    const container = qsphereContainer;
    const controls = controlsContainer;
    const phaseLegend = document.getElementById('qsphere-phase-legend');
    if (container) {
        const showQsphere = currentMode === 'qsphere';
        if (showQsphere && !container.parentElement) {
            document.body.insertBefore(container, phaseLegend || controls || null);
        } else if (!showQsphere && container.parentElement) {
            container.remove();
        }
        container.hidden = !showQsphere;
        container.style.display = showQsphere ? 'block' : 'none';
        canvas.style.visibility = showQsphere ? 'visible' : 'hidden';
        canvas.style.display = showQsphere ? 'block' : 'none';
        if (!showQsphere) {
            const qsLabels = document.getElementById('qs-labels');
            if (qsLabels) qsLabels.style.display = 'none';
        }
    }
    if (controls) {
        const showBloch = currentMode === 'bloch' && qubitsDeclared > 0;
        controls.hidden = !showBloch;
        controls.style.display = showBloch ? 'flex' : 'none';
    }
    if (phaseLegend) phaseLegend.style.display = currentMode === 'qsphere' ? 'block' : 'none';
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
            renderer.stepQueue = (arrowResult.stepVectors || []).slice(1);
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

let currentTargetOp = null;
let sourceUpdateGeneration = 0;

window.addEventListener('message', async event => {
    const message = event.data;
    if (message.command === 'replayAnimation') {
        replayAnimation();
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

            updateVisibility(result.qubitsDeclared);
            populateQubitColumn(result);

            if (threeState) {
                if (currentMode === 'qsphere') {
                    updateQsphereScene(result);
                }
            }
        }
        if (threeState && currentMode === 'qsphere') {
            try {
                renderScene();
            } catch (e) {}
        }
    }
});
