import { test, describe } from 'node:test';
import assert from 'node:assert';

import { generateStatevectorSvg } from '../src/webview/visualizations/statevector.js';
import { generateBlochSvg } from '../src/webview/visualizations/bloch.js';
import { generateQsphereSvg, computeQsphereWithState } from '../src/webview/visualizations/qsphere.js';

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
