import { test, describe } from 'node:test';
import assert from 'node:assert';

/*
import { generateStatevectorSvg } from '../src/webview/visualizations/statevector.js';
import {
    generateBlochSvg,
    generateSingleBlochSvg
} from '../src/webview/visualizations/bloch.js';
import { generateQsphereSvg } from '../src/webview/visualizations/qsphere.js';
import {
    generatePhaseGradientSvgDef,
    generatePhaseLegendSvg
} from '../src/webview/render/phaseLegend.js';
*/
import { computeStatevectorLayout, statevectorVisualization } from '../src/webview/visualizations/statevector.js';
import {
    computeBlochCardLayout,
    getBlochModelMatrix,
    getProjectedBlochLabels,
    getBlochWireframePoints,
    getBlochAxes,
    blochVisualization
} from '../src/webview/visualizations/bloch.js';
import { computeQsphereWithState, qsphereVisualization } from '../src/webview/visualizations/qsphere.js';
import { densityMatrixVisualization } from '../src/webview/visualizations/densityMatrix.js';
import { createPerspectiveMatrix, createTranslationMatrix, mult } from '../src/webview/math/index.js';

describe('Visualization PNG Export Structure (SVG deactivated)', () => {
    test('Statevector export returns PNG without SVG', async () => {
        const result = await statevectorVisualization.export();
        assert.strictEqual(result.filenamePrefix, 'statevector');
        assert.strictEqual(result.svgContent, undefined, 'SVG is deactivated');
    });

    test('Bloch Sphere export returns separate PNG frames without SVG', async () => {
        const exportResult = await blochVisualization.export();
        assert.strictEqual(exportResult.filenamePrefix, 'bloch');
        assert.ok(Array.isArray(exportResult.files), 'Bloch export returns files array');
        assert.strictEqual(exportResult.svgContent, undefined, 'SVG is deactivated');
    });

    test('Q-sphere export returns PNG without SVG', async () => {
        const bellAmps = [
            { re: Math.SQRT1_2, im: 0 },
            { re: 0, im: 0 },
            { re: 0, im: 0 },
            { re: Math.SQRT1_2, im: 0 }
        ];
        const qsphereData = computeQsphereWithState(bellAmps, 2);
        assert.strictEqual(qsphereData.points.length, 4, '2-qubit Q-sphere has 4 points');
        assert.strictEqual(qsphereData.hoverTargets.length, 4, '4 hover targets generated');

        const exportResult = await qsphereVisualization.export();
        assert.strictEqual(exportResult.filenamePrefix, 'qsphere');
        assert.strictEqual(exportResult.svgContent, undefined, 'SVG is deactivated');
    });

    test('Density Matrix export returns PNG without SVG', async () => {
        const result = await densityMatrixVisualization.export();
        assert.strictEqual(result.filenamePrefix, 'densitymatrix');
        assert.strictEqual(result.svgContent, undefined, 'SVG is deactivated');
    });
});

describe('Phase Legend, Statevector, and Bloch Layout Helpers', () => {
    /*
    test('Phase gradient SVG definition generator handles horizontal & vertical orientations', () => {
        const horizGrad = generatePhaseGradientSvgDef('gradH', 'horizontal');
        assert.ok(horizGrad.includes('id="gradH"'));
        assert.ok(horizGrad.includes('x1="0%" y1="0%" x2="100%" y2="0%"'));
        assert.ok(horizGrad.includes('stop offset="0%"'));
        assert.ok(horizGrad.includes('stop offset="100%"'));

        const vertGrad = generatePhaseGradientSvgDef('gradV', 'vertical');
        assert.ok(vertGrad.includes('id="gradV"'));
        assert.ok(vertGrad.includes('x1="0%" y1="100%" x2="0%" y2="0%"'));
    });

    test('Phase legend SVG markup generator renders labels and ticks', () => {
        const hLegend = generatePhaseLegendSvg({
            x: 100,
            y: 200,
            width: 220,
            height: 10,
            orientation: 'horizontal',
            gradientId: 'testGradH'
        });
        assert.ok(hLegend.includes('Phase'));
        assert.ok(hLegend.includes('fill="url(#testGradH)"'));
        assert.ok(hLegend.includes('>0<'));
        assert.ok(hLegend.includes('>π/2<'));
        assert.ok(hLegend.includes('>π<'));
        assert.ok(hLegend.includes('>3π/2<'));
        assert.ok(hLegend.includes('>2π<'));

        const vLegend = generatePhaseLegendSvg({
            x: 300,
            y: 50,
            width: 10,
            height: 180,
            orientation: 'vertical',
            gradientId: 'testGradV'
        });
        assert.ok(vLegend.includes('Phase'));
        assert.ok(vLegend.includes('fill="url(#testGradV)"'));
        assert.ok(vLegend.includes('>2π<'));
        assert.ok(vLegend.includes('>0<'));
    });
    */

    test('computeStatevectorLayout calculates responsive geometry correctly', () => {
        const layout8 = computeStatevectorLayout(8, 800);
        assert.strictEqual(layout8.paddingLeft, 52);
        assert.strictEqual(layout8.plotHeight, 210);
        assert.strictEqual(layout8.totalWidth, 800);
        assert.strictEqual(layout8.minBarWidth, 44);
        assert.strictEqual(layout8.barGap, 20);

        // Large number of states expands totalWidth beyond wrapper if needed
        const layout64 = computeStatevectorLayout(64, 800);
        assert.strictEqual(layout64.minBarWidth, 20);
        assert.strictEqual(layout64.barGap, 8);
        assert.ok(layout64.totalWidth > 800, 'Expands totalWidth when needed for min bar width');
    });

    test('computeBlochCardLayout calculates grid dimensions', () => {
        const layout1 = computeBlochCardLayout(1);
        assert.strictEqual(layout1.cols, 1);
        assert.strictEqual(layout1.rows, 1);
        assert.strictEqual(layout1.cardW, 270);
        assert.strictEqual(layout1.cardH, 320);

        const layout4 = computeBlochCardLayout(4);
        assert.strictEqual(layout4.cols, 2);
        assert.strictEqual(layout4.rows, 2);
    });

    test('Bloch projection helpers project labels, wireframes, and axes', () => {
        const proj = mult(
            createPerspectiveMatrix(Math.PI / 4, 1.0, 0.1, 100),
            createTranslationMatrix(0, 0, -3)
        );
        const modelMatrix = getBlochModelMatrix([0.3, 0.0, 0.0], proj);

        const labels = getProjectedBlochLabels(modelMatrix, 270, 270);
        assert.strictEqual(labels.length, 6);
        assert.strictEqual(labels[0].text, '|0⟩');
        assert.ok(labels[0].point !== null);

        const wireframes = getBlochWireframePoints(modelMatrix, 270, 270);
        assert.strictEqual(wireframes.length, 3, '3 orthogonal wireframe circle planes');
        assert.ok(wireframes[0].length > 10);

        const axes = getBlochAxes(modelMatrix, 270, 270);
        assert.strictEqual(axes.length, 3, '3 coordinate axes');
        assert.ok(axes[0].p1 !== null && axes[0].p2 !== null);
    });
});

describe('Live Update Mode Controller', () => {
    test('Live update is enabled by default and toggles correctly', async () => {
        const { getIsLiveUpdate, setLiveUpdate } = await import('../src/webview/main.js');
        assert.strictEqual(getIsLiveUpdate(), true, 'Live update should be enabled by default');

        setLiveUpdate(false);
        assert.strictEqual(getIsLiveUpdate(), false, 'Live update should be disabled when toggled off');

        setLiveUpdate(true);
        assert.strictEqual(getIsLiveUpdate(), true, 'Live update should be re-enabled when toggled on');
    });

    test('Auto deactivates live update when qubit count >= 5', async () => {
        const { getIsLiveUpdate, setLiveUpdate, checkAutoDeactivateLive } = await import('../src/webview/main.js');

        setLiveUpdate(true);
        assert.strictEqual(getIsLiveUpdate(), true);

        // 3 qubits declared: should remain live
        checkAutoDeactivateLive({ qubitsDeclared: 3, states: [{ qubits: 3, amplitudes: [] }] });
        assert.strictEqual(getIsLiveUpdate(), true, 'Live update should remain enabled for < 5 qubits');

        // 4 qubits declared: should remain live
        checkAutoDeactivateLive(4);
        assert.strictEqual(getIsLiveUpdate(), true, 'Live update should remain enabled for 4 qubits');

        // 5 qubits declared: should auto-deactivate
        checkAutoDeactivateLive({ qubitsDeclared: 5, states: [{ qubits: 5, amplitudes: [] }] });
        assert.strictEqual(getIsLiveUpdate(), false, 'Live update should auto deactivate for 5 qubits');

        // Re-enable and test with number
        setLiveUpdate(true);
        checkAutoDeactivateLive(6);
        assert.strictEqual(getIsLiveUpdate(), false, 'Live update should auto deactivate for 6 qubits');
    });
});

describe('Statevector Amplitude / Probability Mode Toggle', () => {
    test('setStatevectorMode and getStatevectorMode toggles between amplitude and probability', async () => {
        const { setStatevectorMode, getStatevectorMode } = await import('../src/webview/visualizations/statevector.js');
        assert.strictEqual(getStatevectorMode(), 'amplitude', 'Default statevector mode should be amplitude');

        setStatevectorMode('probability');
        assert.strictEqual(getStatevectorMode(), 'probability', 'Statevector mode should toggle to probability');

        setStatevectorMode('amplitude');
        assert.strictEqual(getStatevectorMode(), 'amplitude', 'Statevector mode should toggle back to amplitude');
    });
});

describe('LaTeX Quantum State Display Controller', () => {
    test('updateLatexDisplay and getCurrentLatexString formats current state with state symbol', async () => {
        const { updateLatexDisplay, getCurrentLatexString } = await import('../src/webview/main.js');

        const bellResult = {
            states: [{
                qubits: 2,
                amplitudes: [
                    { re: Math.SQRT1_2, im: 0 },
                    { re: 0, im: 0 },
                    { re: 0, im: 0 },
                    { re: Math.SQRT1_2, im: 0 }
                ]
            }],
            qubitsDeclared: 2
        };

        updateLatexDisplay(bellResult);
        assert.strictEqual(
            getCurrentLatexString(),
            '|\\psi\\rangle = \\frac{1}{\\sqrt{2}}|00\\rangle + \\frac{1}{\\sqrt{2}}|11\\rangle'
        );
    });
});



