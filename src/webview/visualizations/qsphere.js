import * as THREE from 'three';
import {
    projectPoint,
    rotateMatrix
} from '../math/math.js';
import {
    getPhaseToRgb,
    formatBasisState,
    formatPhasePi,
    getQsphereState,
    renderStateVectorHistogram,
    stepStatevectorTransition,
    getIsTransitioning,
    getCurrentAmplitudes,
    getCurrentQubits
} from './statevector.js';

function hammingWeight(n) {
    let count = 0;
    while (n > 0) {
        count += n & 1;
        n >>>= 1;
    }
    return count;
}

function computeQspherePoints(N) {
    const size = 2 ** N;
    const byWeight = Array.from({ length: N + 1 }, () => []);
    for (let k = 0; k < size; k++) byWeight[hammingWeight(k)].push(k);

    return Array.from({ length: size }, (_, k) => {
        const w = hammingWeight(k);
        const group = byWeight[w];
        const M = group.length;
        const j = group.indexOf(k);
        const theta = N === 0 ? 0 : (Math.PI * w) / N;
        const phi = M === 1 ? 0 : (2 * Math.PI * j) / M;
        return {
            index: k,
            x: Math.sin(theta) * Math.cos(phi),
            y: Math.cos(theta),
            z: Math.sin(theta) * Math.sin(phi),
            w
        };
    });
}

function computeQsphereWithState(state, N, options) {
    const focusedIndex = options?.focusedIndex;
    const ringVertices = buildHammingRings(N);
    const spokeVertices = buildQSphereSpokes(state, N, focusedIndex);
    return {
        nodeVertices: buildQNodes(state, N, focusedIndex),
        ringVertices,
        spokeVertices,
        lineVertices: ringVertices,
        points: computeQspherePoints(N),
        hoverTargets: buildQSphereHoverTargets(state, N),
        state,
        N
    };
}

function getFocusedAlpha(pointIndex, focusedIndex) {
    if (focusedIndex === null || focusedIndex === undefined || pointIndex === focusedIndex) {
        return 1.0;
    }
    return 0.24;
}

function buildQNodes(state, N, focusedIndex) {
    const verts = [];
    const points = computeQspherePoints(N);
    for (const point of points) {
        const amp = state[point.index] || { re: 0, im: 0 };
        const probability = amp.re * amp.re + amp.im * amp.im;
        if (probability < 1e-5) continue;
        const radius = 0.12 * Math.sqrt(probability);
        const phase = Math.atan2(amp.im, amp.re);
        const [r, g, b] = getPhaseToRgb(phase);
        const alpha = getFocusedAlpha(point.index, focusedIndex);
        verts.push(...buildNodeSphere(point.x, point.y, point.z, radius, r, g, b, alpha, 8));
    }
    return new Float32Array(verts);
}

function buildNodeSphere(cx, cy, cz, radius, r, g, b, a, segments) {
    const verts = [];
    for (let ri = 0; ri < segments; ri++) {
        const t0 = (ri / segments) * Math.PI;
        const t1 = ((ri + 1) / segments) * Math.PI;
        for (let si = 0; si < segments; si++) {
            const p0 = (si / segments) * 2 * Math.PI;
            const p1 = ((si + 1) / segments) * 2 * Math.PI;
            const v = [
                [Math.sin(t0) * Math.cos(p0), Math.cos(t0), Math.sin(t0) * Math.sin(p0)],
                [Math.sin(t0) * Math.cos(p1), Math.cos(t0), Math.sin(t0) * Math.sin(p1)],
                [Math.sin(t1) * Math.cos(p0), Math.cos(t1), Math.sin(t1) * Math.sin(p0)],
                [Math.sin(t1) * Math.cos(p1), Math.cos(t1), Math.sin(t1) * Math.sin(p1)]
            ];
            for (const tri of [[0, 1, 2], [1, 3, 2]]) {
                for (const vi of tri) {
                    const [nx, ny, nz] = v[vi];
                    verts.push(cx + radius * nx, cy + radius * ny, cz + radius * nz, r, g, b, a);
                }
            }
        }
    }
    return verts;
}

function buildHammingRings(N) {
    const segments = 64;
    const verts = [];
    for (let w = 1; w < N; w++) {
        const theta = (Math.PI * w) / N;
        const ringY = Math.cos(theta);
        const ringR = Math.sin(theta);
        for (let i = 0; i < segments; i++) {
            const a0 = (i / segments) * 2 * Math.PI;
            const a1 = ((i + 1) / segments) * 2 * Math.PI;
            verts.push(ringR * Math.cos(a0), ringY, ringR * Math.sin(a0));
            verts.push(ringR * Math.cos(a1), ringY, ringR * Math.sin(a1));
        }
    }
    return new Float32Array(verts);
}

function buildQSphereSpokes(state, N, focusedIndex) {
    const points = computeQspherePoints(N);
    const verts = [];
    for (const point of points) {
        const amp = state[point.index] || { re: 0, im: 0 };
        const probability = amp.re * amp.re + amp.im * amp.im;
        if (probability < 1e-5) continue;
        const phase = Math.atan2(amp.im, amp.re);
        const [r, g, b] = getPhaseToRgb(phase);
        const alpha = getFocusedAlpha(point.index, focusedIndex);
        verts.push(0, 0, 0, r, g, b, alpha);
        verts.push(point.x, point.y, point.z, r, g, b, alpha);
    }
    return new Float32Array(verts);
}

function buildQSphereHoverTargets(state, N) {
    const points = computeQspherePoints(N);
    const targets = [];
    for (const point of points) {
        const amp = state[point.index] || { re: 0, im: 0 };
        const probability = amp.re * amp.re + amp.im * amp.im;
        const phase = Math.atan2(amp.im, amp.re);
        targets.push({
            index: point.index,
            point: [point.x, point.y, point.z],
            probability,
            phase,
            radius: Math.max(0.08, 0.12 * Math.sqrt(probability))
        });
    }
    return targets;
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
    const mat = lineMat || new THREE.LineBasicMaterial({ color: 0x5a6578, transparent: true, opacity: 0.35 });
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
    group.scale.set(1.025, 1.025, 1.025);
    return group;
}

let threeState = null;
let lastResult = null;
let _qsLabelData = [];
let qsphereHoverInfo = null;

function getQsphereHoverInfo() {
    if (qsphereHoverInfo) return qsphereHoverInfo;
    const container = document.getElementById('container');
    if (!container) return null;
    qsphereHoverInfo = document.createElement('div');
    qsphereHoverInfo.className = 'qubit-hover-info';
    qsphereHoverInfo.hidden = true;
    container.appendChild(qsphereHoverInfo);
    return qsphereHoverInfo;
}

function rebuildQsphereLabels(points, N, state) {
    const qsLabelsDiv = document.getElementById('qs-labels');
    if (!qsLabelsDiv) return;
    qsLabelsDiv.innerHTML = '';
    _qsLabelData = [];
    if (!points || !N) return;

    for (const pt of points) {
        if (state) {
            const amp = state[pt.index] || { re: 0, im: 0 };
            const probability = amp.re * amp.re + amp.im * amp.im;
            if (probability < 1e-5) continue;
        }

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

function updateQsphereSceneWithAmplitudes(state, N, options = {}) {
    if (!threeState) return;

    const qs = computeQsphereWithState(state, N, {
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

    const points = qs.points;

    for (const point of points) {
        const amp = state[point.index] || { re: 0, im: 0 };
        const probability = amp.re * amp.re + amp.im * amp.im;
        if (probability < 1e-5) continue;

        const radius = 0.12 * Math.sqrt(probability);
        const phase = Math.atan2(amp.im, amp.re);
        const [r, g, b] = getPhaseToRgb(phase);
        const focusedIndex = threeState._qsphereHoveredIndex;
        const alpha = (focusedIndex === null || focusedIndex === undefined || point.index === focusedIndex) ? 1.0 : 0.24;

        const node = createQnodeMesh(point.x, point.y, point.z, radius, r, g, b, alpha);
        group.add(node);

        const spoke = createSpokeMesh([point.x, point.y, point.z], 0.015, r, g, b, alpha);
        if (spoke) group.add(spoke);
    }

    threeState._qsphereData = qs;
    if (options.rebuildLabels !== false) rebuildQsphereLabels(qs.points, qs.N, qs.state);
}

function setQsphereHoveredIndex(index) {
    if (!threeState || threeState._qsphereHoveredIndex === index) return;
    threeState._qsphereHoveredIndex = index;
    const currentAmplitudes = getCurrentAmplitudes();
    const currentQubits = getCurrentQubits();
    if (currentAmplitudes && currentAmplitudes.length > 0) {
        updateQsphereSceneWithAmplitudes(currentAmplitudes, currentQubits, { rebuildLabels: false });
    } else if (lastResult) {
        const { state, N } = getQsphereState(lastResult);
        updateQsphereSceneWithAmplitudes(state, N, { rebuildLabels: false });
    }
}

function clearQsphereHover() {
    setQsphereHoveredIndex(null);
    const hoverInfo = getQsphereHoverInfo();
    if (hoverInfo) hoverInfo.hidden = true;
}

function updateQsphereHover(event, canvas, rotationAngles) {
    const hoverInfo = getQsphereHoverInfo();
    if (!hoverInfo || !threeState?._qsphereData || !canvas) return;

    const rect = canvas.getBoundingClientRect();
    const width = rect.width;
    const height = rect.height;
    const mouseX = event.clientX - rect.left;
    const mouseY = event.clientY - rect.top;
    const point = [mouseX, mouseY];
    const modelMatrix = rotateMatrix(...rotationAngles, threeState._projMatrix);

    const qsphereData = threeState._qsphereData;
    const targets = qsphereData.hoverTargets || [];
    let best = null;

    for (const target of targets) {
        if (target.probability < 1e-4) continue;
        const screenPoint = projectPoint(target.point, modelMatrix, width, height);
        if (!screenPoint) continue;
        const distance = Math.hypot(point[0] - screenPoint[0], point[1] - screenPoint[1]);
        if (distance <= Math.max(16, target.radius * width * 0.45)) {
            if (!best || distance < best.distance) {
                best = { target, distance, screenPoint };
            }
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

const qsphereVisualization = {
    id: 'qsphere',
    label: 'Q-sphere',

    mount(container, sharedContext) {
        if (sharedContext?.threeState) {
            threeState = sharedContext.threeState;
        }
        const qsphereWrapper = document.getElementById('qsphere-view-wrapper');
        if (qsphereWrapper) {
            qsphereWrapper.hidden = false;
            qsphereWrapper.style.display = 'flex';
        }
        const canvas = document.querySelector('#canvas');
        if (canvas) {
            canvas.style.visibility = 'visible';
            canvas.style.display = 'block';
        }
        const qsLabels = document.getElementById('qs-labels');
        if (qsLabels) qsLabels.style.display = 'block';

        if (threeState) {
            threeState.qsphereGroup.visible = true;
            threeState.sphereMesh.visible = true;
            threeState.wireframe.visible = true;
            threeState.arrowGroup.visible = false;
        }

        if (lastResult) {
            const { state, N } = getQsphereState(lastResult);
            updateQsphereSceneWithAmplitudes(state, N, { rebuildLabels: true });
        }
    },

    unmount() {
        const qsphereWrapper = document.getElementById('qsphere-view-wrapper');
        if (qsphereWrapper) {
            qsphereWrapper.hidden = true;
            qsphereWrapper.style.display = 'none';
        }
        const canvas = document.querySelector('#canvas');
        if (canvas) {
            canvas.style.visibility = 'hidden';
            canvas.style.display = 'none';
        }
        const qsLabels = document.getElementById('qs-labels');
        if (qsLabels) qsLabels.style.display = 'none';

        if (threeState) {
            threeState.qsphereGroup.visible = false;
        }
        clearQsphereHover();
    },

    update(result, options = {}) {
        if (!result) return;
        lastResult = result;
        const { state, N } = getQsphereState(result);
        renderStateVectorHistogram(result);
        updateQsphereSceneWithAmplitudes(state, N, options);
    },

    animate(lerpFactor = 0.20) {
        if (getIsTransitioning()) {
            const transition = stepStatevectorTransition(lerpFactor, 1e-4);
            updateQsphereSceneWithAmplitudes(transition.currentAmplitudes, transition.currentQubits, { rebuildLabels: true });
        }
    },

    updateScene(sharedState) {
        if (sharedState) threeState = sharedState;
    },

    updateLabels(modelMatrix, w, h) {
        updateQsphereLabels(modelMatrix, w, h);
    },

    updateHover(event, canvas, rotationAngles) {
        updateQsphereHover(event, canvas, rotationAngles);
    },

    clearHover() {
        clearQsphereHover();
    }
};

export default qsphereVisualization;

export {
    qsphereVisualization,
    hammingWeight,
    computeQspherePoints,
    computeQsphereWithState,
    buildQNodes,
    buildHammingRings,
    buildQSphereSpokes,
    buildQSphereHoverTargets,
    createQnodeMesh,
    createSpokeMesh,
    createHammingRings,
    updateQsphereSceneWithAmplitudes,
    rebuildQsphereLabels,
    updateQsphereLabels,
    updateQsphereHover,
    clearQsphereHover,
    setQsphereHoveredIndex
};

if (typeof window !== 'undefined') {
    window.qsphere = {
        qsphereVisualization,
        computeQspherePoints,
        computeQsphereWithState,
        buildQNodes,
        buildHammingRings,
        buildQSphereSpokes,
        buildQSphereHoverTargets,
        updateQsphereSceneWithAmplitudes
    };
    window.computeQspherePoints = computeQspherePoints;
    window.buildQNodes = buildQNodes;
    window.buildHammingRings = buildHammingRings;
    window.buildQSphereSpokes = buildQSphereSpokes;
    window.buildQSphereHoverTargets = buildQSphereHoverTargets;
}
