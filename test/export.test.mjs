import { test, describe } from 'node:test';
import assert from 'node:assert';

import { generateStatevectorSvg, computeStatevectorLayout } from '../src/webview/visualizations/statevector.js';
import { generateBlochSvg } from '../src/webview/visualizations/bloch.js';
import { generateQsphereSvg, computeQsphereWithState } from '../src/webview/visualizations/qsphere.js';
import {
    generatePhaseGradientSvgDef,
    generatePhaseLegendSvg
} from '../src/webview/render/phaseLegend.js';

describe('Visualization SVG Export Generators', () => {
    test('Statevector SVG generator produces valid SVG markup', () => {
        const svg = generateStatevectorSvg();
        assert.ok(svg.startsWith('<?xml version="1.0" encoding="UTF-8"?>'), 'SVG has XML declaration');
        assert.ok(svg.includes('<svg xmlns="http://www.w3.org/2000/svg"'), 'SVG contains root element');
        assert.ok(svg.includes('linearGradient id="phaseGradient"'), 'SVG includes phase gradient');
        assert.ok(svg.includes('</svg>'), 'SVG properly closed');
    });

    test('Bloch Sphere SVG generator handles states', () => {
        const svg = generateBlochSvg();
        assert.ok(svg.includes('<svg'), 'Bloch SVG root present');
        assert.ok(svg.includes('</svg>'), 'Bloch SVG properly closed');
    });

    test('Q-sphere SVG generator produces valid spherical coordinates and legend', () => {
        const bellAmps = [
            { re: Math.SQRT1_2, im: 0 },
            { re: 0, im: 0 },
            { re: 0, im: 0 },
            { re: Math.SQRT1_2, im: 0 }
        ];
        const qsphereData = computeQsphereWithState(bellAmps, 2);
        assert.strictEqual(qsphereData.points.length, 4, '2-qubit Q-sphere has 4 points');
        assert.strictEqual(qsphereData.hoverTargets.length, 4, '4 hover targets generated');

        const svg = generateQsphereSvg();
        assert.ok(svg.includes('<svg xmlns="http://www.w3.org/2000/svg"'), 'Q-sphere SVG root present');
        assert.ok(svg.includes('id="qspherePhaseGrad"'), 'Q-sphere SVG contains phase gradient');
        assert.ok(svg.includes('</svg>'), 'Q-sphere SVG properly closed');
    });
});

describe('Phase Legend and Statevector Layout Helpers', () => {
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
});

