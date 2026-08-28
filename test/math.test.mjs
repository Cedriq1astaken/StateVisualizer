import { test, describe } from 'node:test';
import assert from 'node:assert';

import {
    Complex,
    complexAbs2,
    vec3Normalize,
    vec3Cross,
    vec3Dot,
    vectorsClose,
    rodriguesRotate,
    alignmentRotation,
    interpolateVector,
    distanceToSegment,
    projectPoint,
    mult,
    createPerspectiveMatrix,
    createTranslationMatrix,
    extractQubitBloch,
    hammingWeight,
    computeQspherePoints,
    getPhaseToRgb,
    formatBasisState,
    formatPhasePi,
    parseAmplitude,
    isTrivialState,
    stepStatevectorTransition
} from '../src/webview/math/index.js';

describe('Math Module - Vectors, Matrices, and Geometry', () => {
    test('Complex arithmetic and magnitude squared', () => {
        const c1 = new Complex(3, 4);
        assert.strictEqual(c1.abs2(), 25);
        assert.strictEqual(complexAbs2({ re: 3, im: 4 }), 25);

        const c2 = new Complex(1, 2);
        const added = c1.add(c2);
        assert.strictEqual(added.re, 4);
        assert.strictEqual(added.im, 6);

        const multiplied = c1.mul(c2); // (3+4i)*(1+2i) = 3 + 6i + 4i - 8 = -5 + 10i
        assert.strictEqual(multiplied.re, -5);
        assert.strictEqual(multiplied.im, 10);
    });

    test('3D vector operations and Rodrigues rotation', () => {
        const v = [0, 3, 4];
        const normalized = vec3Normalize(v);
        assert.strictEqual(normalized[0], 0);
        assert.strictEqual(normalized[1], 0.6);
        assert.strictEqual(normalized[2], 0.8);

        // Rotate [1, 0, 0] around Z-axis [0, 0, 1] by 90 degrees -> [0, 1, 0]
        const rotated = rodriguesRotate([1, 0, 0], [0, 0, 1], Math.PI / 2);
        assert.ok(Math.abs(rotated[0] - 0) < 1e-6);
        assert.ok(Math.abs(rotated[1] - 1) < 1e-6);
        assert.ok(Math.abs(rotated[2] - 0) < 1e-6);
    });

    test('Vector interpolation (Slerp)', () => {
        const v1 = [1, 0, 0];
        const v2 = [0, 1, 0];
        const mid = interpolateVector(v1, v2, 0.5);
        assert.ok(Math.abs(mid[0] - Math.SQRT1_2) < 1e-3);
        assert.ok(Math.abs(mid[1] - Math.SQRT1_2) < 1e-3);
    });

    test('Distance to segment', () => {
        const p = [0, 5];
        const start = [-10, 0];
        const end = [10, 0];
        const dist = distanceToSegment(p, start, end);
        assert.strictEqual(dist, 5);
    });

    test('3D to 2D projection', () => {
        const proj = createPerspectiveMatrix(Math.PI / 4, 1.0, 0.1, 100);
        const view = createTranslationMatrix(0, 0, -3);
        const screenPoint = projectPoint([0, 0, 0], mult(proj, view), 800, 600);
        assert.deepStrictEqual(screenPoint, [400, 300]);
    });
});

describe('Quantum Math Module - States, Bloch, Hamming, and Phase', () => {
    test('Amplitude string parsing', () => {
        assert.deepStrictEqual(parseAmplitude('1'), { re: 1, im: 0 });
        assert.deepStrictEqual(parseAmplitude('-0.7071'), { re: -0.7071, im: 0 });
        assert.deepStrictEqual(parseAmplitude('i'), { re: 0, im: 1 });
        assert.deepStrictEqual(parseAmplitude('-i'), { re: 0, im: -1 });
        assert.deepStrictEqual(parseAmplitude('0.5+0.866i'), { re: 0.5, im: 0.866 });
    });

    test('isTrivialState detects ground state', () => {
        assert.strictEqual(isTrivialState({ qubits: 2, amplitudes: [{ re: 1, im: 0 }, { re: 0, im: 0 }, { re: 0, im: 0 }, { re: 0, im: 0 }] }), true);
        assert.strictEqual(isTrivialState({ qubits: 1, amplitudes: [{ re: 0.7071, im: 0 }, { re: 0.7071, im: 0 }] }), false);
    });

    test('extractQubitBloch for single qubit basis states', () => {
        // |0⟩ -> [0, 0, 1]
        const state0 = { qubits: 1, amplitudes: [{ re: 1, im: 0 }, { re: 0, im: 0 }] };
        assert.deepStrictEqual(extractQubitBloch(state0, 0), [0, 0, 1]);

        // |1⟩ -> [0, 0, -1]
        const state1 = { qubits: 1, amplitudes: [{ re: 0, im: 0 }, { re: 1, im: 0 }] };
        assert.deepStrictEqual(extractQubitBloch(state1, 0), [0, 0, -1]);

        // |+⟩ -> [1, 0, 0]
        const statePlus = { qubits: 1, amplitudes: [{ re: Math.SQRT1_2, im: 0 }, { re: Math.SQRT1_2, im: 0 }] };
        const blochPlus = extractQubitBloch(statePlus, 0);
        assert.ok(Math.abs(blochPlus[0] - 1) < 1e-6);
        assert.ok(Math.abs(blochPlus[1] - 0) < 1e-6);
        assert.ok(Math.abs(blochPlus[2] - 0) < 1e-6);
    });

    test('Hamming weight and Q-sphere coordinate rings', () => {
        assert.strictEqual(hammingWeight(0), 0);
        assert.strictEqual(hammingWeight(1), 1);
        assert.strictEqual(hammingWeight(3), 2);
        assert.strictEqual(hammingWeight(7), 3);

        const pts = computeQspherePoints(3);
        assert.strictEqual(pts.length, 8);
        assert.strictEqual(pts[0].y, 1);  // |000⟩ at North Pole
        assert.strictEqual(pts[7].y, -1); // |111⟩ at South Pole
    });

    test('Phase to RGB color mapping and formatting', () => {
        const rgb0 = getPhaseToRgb(0);
        const rgbPi = getPhaseToRgb(Math.PI);
        assert.notDeepStrictEqual(rgb0, rgbPi);

        assert.strictEqual(formatBasisState(2, 3), '|010⟩');
        assert.strictEqual(formatPhasePi(0), '0');
        assert.strictEqual(formatPhasePi(Math.PI / 2), 'π/2');
        assert.strictEqual(formatPhasePi(Math.PI), 'π');
    });

    test('State transition step convergence', () => {
        const curr = [{ re: 0, im: 0 }, { re: 0, im: 0 }];
        const target = [{ re: 1, im: 0 }, { re: 0, im: 0 }];
        let step = stepStatevectorTransition(curr, target, 0.5);
        assert.strictEqual(step.isTransitioning, true);
        assert.strictEqual(step.currentAmplitudes[0].re, 0.5);

        // Run until convergence
        for (let i = 0; i < 20; i++) {
            step = stepStatevectorTransition(step.currentAmplitudes, target, 0.5);
        }
        assert.strictEqual(step.isTransitioning, false);
        assert.strictEqual(step.currentAmplitudes[0].re, 1);
    });
});
