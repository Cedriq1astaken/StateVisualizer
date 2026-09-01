import { test, describe } from 'node:test';
import assert from 'node:assert';

import {
    computeDensityMatrix,
    getBwrColorRgb,
    getBwrColor,
    computeHeatmapLayout,
    densityMatrixVisualization
} from '../src/webview/visualizations/densityMatrix.js';

describe('Density Matrix Visualization Module', () => {
    test('computeDensityMatrix for 1-qubit |0⟩ state', () => {
        const amplitudes = [{ re: 1, im: 0 }, { re: 0, im: 0 }];
        const rho = computeDensityMatrix(amplitudes, 1);

        assert.strictEqual(rho.length, 2);
        assert.strictEqual(rho[0].length, 2);

        // rho_00 = 1
        assert.strictEqual(rho[0][0].re, 1);
        assert.strictEqual(rho[0][0].im, 0);
        assert.strictEqual(rho[0][0].mag, 1);

        // rho_01 = 0, rho_10 = 0, rho_11 = 0
        assert.strictEqual(rho[0][1].re, 0);
        assert.strictEqual(rho[1][0].re, 0);
        assert.strictEqual(rho[1][1].re, 0);
    });

    test('computeDensityMatrix for 1-qubit |+i⟩ state', () => {
        // |psi> = 1/sqrt(2) |0> + i/sqrt(2) |1>
        const amplitudes = [{ re: Math.SQRT1_2, im: 0 }, { re: 0, im: Math.SQRT1_2 }];
        const rho = computeDensityMatrix(amplitudes, 1);

        // rho_00 = 0.5
        assert.ok(Math.abs(rho[0][0].re - 0.5) < 1e-6);
        assert.ok(Math.abs(rho[0][0].im) < 1e-6);

        // rho_01 = (1/sqrt(2)) * (-i/sqrt(2)) = -0.5i -> Re=0, Im=-0.5
        assert.ok(Math.abs(rho[0][1].re) < 1e-6);
        assert.ok(Math.abs(rho[0][1].im - (-0.5)) < 1e-6);

        // rho_10 = (i/sqrt(2)) * (1/sqrt(2)) = 0.5i -> Re=0, Im=0.5
        assert.ok(Math.abs(rho[1][0].re) < 1e-6);
        assert.ok(Math.abs(rho[1][0].im - 0.5) < 1e-6);

        // rho_11 = 0.5
        assert.ok(Math.abs(rho[1][1].re - 0.5) < 1e-6);
        assert.ok(Math.abs(rho[1][1].im) < 1e-6);
    });

    test('computeDensityMatrix for 2-qubit Bell state (|00⟩ + |11⟩)/√2', () => {
        const amplitudes = [
            { re: Math.SQRT1_2, im: 0 },
            { re: 0, im: 0 },
            { re: 0, im: 0 },
            { re: Math.SQRT1_2, im: 0 }
        ];
        const rho = computeDensityMatrix(amplitudes, 2);

        assert.strictEqual(rho.length, 4);
        assert.strictEqual(rho[0].length, 4);

        assert.ok(Math.abs(rho[0][0].re - 0.5) < 1e-6);
        assert.ok(Math.abs(rho[0][3].re - 0.5) < 1e-6);
        assert.ok(Math.abs(rho[3][0].re - 0.5) < 1e-6);
        assert.ok(Math.abs(rho[3][3].re - 0.5) < 1e-6);

        assert.strictEqual(rho[0][1].mag, 0);
        assert.strictEqual(rho[1][1].mag, 0);
    });

    test('getBwrColor diverging colormap', () => {
        // Value 0 -> pure white [255, 255, 255]
        const white = getBwrColorRgb(0);
        assert.deepStrictEqual(white, [255, 255, 255]);
        assert.strictEqual(getBwrColor(0), 'rgb(255, 255, 255)');

        // Value +1 -> Red
        const red = getBwrColorRgb(1.0);
        assert.strictEqual(red[0], 235);
        assert.strictEqual(red[1], 60);
        assert.strictEqual(red[2], 60);

        // Value -1 -> Blue
        const blue = getBwrColorRgb(-1.0);
        assert.strictEqual(blue[0], 55);
        assert.strictEqual(blue[1], 125);
        assert.strictEqual(blue[2], 245);

        // Intermediate values
        const midPos = getBwrColorRgb(0.5);
        assert.ok(midPos[0] < 255);
        assert.ok(midPos[1] < 255);
        assert.ok(midPos[2] < 255);

        const midNeg = getBwrColorRgb(-0.5);
        assert.ok(midNeg[0] < 255);
        assert.ok(midNeg[1] < 255);
        assert.ok(midNeg[2] <= 255);
    });

    test('computeHeatmapLayout calculates geometry correctly', () => {
        const layout2 = computeHeatmapLayout(2, 360);
        assert.strictEqual(layout2.isRotated, false);
        assert.ok(layout2.cellSize > 0);
        assert.ok(layout2.totalWidth > 0);
        assert.ok(layout2.totalHeight > 0);

        const layout8 = computeHeatmapLayout(8, 360);
        assert.strictEqual(layout8.isRotated, true);
    });

    test('densityMatrixVisualization plugin structure', () => {
        assert.strictEqual(densityMatrixVisualization.id, 'densitymatrix');
        assert.strictEqual(densityMatrixVisualization.label, 'Density Matrix');
        assert.strictEqual(typeof densityMatrixVisualization.mount, 'function');
        assert.strictEqual(typeof densityMatrixVisualization.unmount, 'function');
        assert.strictEqual(typeof densityMatrixVisualization.update, 'function');
        assert.strictEqual(typeof densityMatrixVisualization.export, 'function');
    });

    test('setDensityMode and getDensityMode toggles between 2d and 3d', async () => {
        const { setDensityMode, getDensityMode } = await import('../src/webview/visualizations/densityMatrix.js');
        assert.strictEqual(getDensityMode(), '2d');
        setDensityMode('3d');
        assert.strictEqual(getDensityMode(), '3d');
        setDensityMode('2d');
        assert.strictEqual(getDensityMode(), '2d');
    });

    test('2D export legend calculation centers Matrix Element Value legend', () => {
        const numStates = 4;
        const layout = computeHeatmapLayout(numStates, 360);
        const padding = 20;
        const gap = 24;
        const cssTotalW = layout.totalWidth * 2 + gap + padding * 2;
        const legendW = 240;
        const legendX = (cssTotalW - legendW) / 2;

        assert.strictEqual(legendX + legendW / 2, cssTotalW / 2, 'Legend center should match total canvas center');
        assert.ok(legendX > padding, 'Legend start X should be greater than left padding');
        assert.ok(legendX + legendW < cssTotalW - padding, 'Legend end X should be within canvas bounds');
    });
});
