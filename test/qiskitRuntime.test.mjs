import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
    parseQiskit,
    hasQiskitImport,
    findCircuitInit,
    evalPythonExpr,
    GATES,
    apply1QGate,
    applyControlledGate,
    applyMultiControlledGate,
    applySWAP
} from '../src/webview/runtime/qiskitRuntime.js';

const TOLERANCE = 1e-9;
const SQRT2_INV = 1 / Math.sqrt(2);

function assertAmplitude(amp, expectedRe, expectedIm, label) {
    assert.ok(
        Math.abs(amp.re - expectedRe) < TOLERANCE && Math.abs(amp.im - (expectedIm || 0)) < TOLERANCE,
        `${label || 'amplitude'}: expected (${expectedRe}, ${expectedIm || 0}), got (${amp.re}, ${amp.im})`
    );
}

function assertState(result, expectedAmplitudes, label) {
    const state = result.states[result.states.length - 1];
    assert.ok(state, `${label || 'state'}: no states produced`);
    assert.strictEqual(state.amplitudes.length, expectedAmplitudes.length,
        `${label || 'state'}: amplitude count mismatch`);
    for (let i = 0; i < expectedAmplitudes.length; i++) {
        const [re, im] = expectedAmplitudes[i];
        assertAmplitude(state.amplitudes[i], re, im || 0, `${label || 'state'}[${i}]`);
    }
}

// ============================================================================
// Suite 1: Validation & Circuit Detection
// ============================================================================
describe('Qiskit Validation & Circuit Detection', () => {
    test('1. Missing Qiskit import returns error', () => {
        const result = parseQiskit('x = 42\nprint(x)\n');
        assert.ok(result.error);
        assert.match(result.error, /No Qiskit import/i);
        assert.strictEqual(result.states.length, 0);
    });

    test('2. Missing QuantumCircuit returns error', () => {
        const result = parseQiskit('from qiskit import QuantumCircuit\nx = 42\n');
        assert.ok(result.error);
        assert.match(result.error, /No QuantumCircuit/i);
    });

    test('3a. Detects "import qiskit" style', () => {
        assert.ok(hasQiskitImport('import qiskit\n'));
    });

    test('3b. Detects "from qiskit import QuantumCircuit" style', () => {
        assert.ok(hasQiskitImport('from qiskit import QuantumCircuit\n'));
    });

    test('3c. Detects "from qiskit import *" style', () => {
        assert.ok(hasQiskitImport('from qiskit import *\n'));
    });

    test('3d. Detects "from qiskit.circuit import QuantumCircuit as QC" style', () => {
        const source = `from qiskit.circuit import QuantumCircuit as QC\ncirc = QC(2)\ncirc.h(0)\n`;
        assert.ok(hasQiskitImport(source));
        const circuit = findCircuitInit(source);
        assert.ok(circuit);
        assert.strictEqual(circuit.name, 'circ');
        assert.strictEqual(circuit.qubits, 2);
    });

    test('4. Correctly identifies circuit variable name and qubit count', () => {
        const source = `from qiskit import QuantumCircuit\nmy_circuit = QuantumCircuit(5)\nmy_circuit.h(0)\n`;
        const circuit = findCircuitInit(source);
        assert.ok(circuit);
        assert.strictEqual(circuit.name, 'my_circuit');
        assert.strictEqual(circuit.qubits, 5);
        assert.strictEqual(circuit.startLine, 1);
    });

    test('4b. Fresh circuit initialization QuantumCircuit(2, 2) initializes to |00⟩', () => {
        const source = `from qiskit import QuantumCircuit\n\nqc = QuantumCircuit(2, 2)\n`;
        const result = parseQiskit(source);
        assert.ok(!result.error);
        assert.strictEqual(result.qubitsDeclared, 2);
        assert.deepStrictEqual(result.qubitsList, ['q0', 'q1']);
        assert.strictEqual(result.states.length, 1);
        assertState(result, [[1, 0], [0, 0], [0, 0], [0, 0]], '|00⟩ ground state');
    });
});

// ============================================================================
// Suite 2: Single-Qubit Standard & Parametric Gates
// ============================================================================
describe('Qiskit Single-Qubit Gates', () => {
    test('5. Hadamard (H) creates equal superposition', () => {
        const source = `from qiskit import QuantumCircuit\nqc = QuantumCircuit(1)\nqc.h(0)\n`;
        const result = parseQiskit(source);
        assert.ok(!result.error, result.error);
        assertState(result, [[SQRT2_INV, 0], [SQRT2_INV, 0]], 'H|0⟩');
    });

    test('6a. Pauli-X flips |0⟩ to |1⟩', () => {
        const source = `from qiskit import QuantumCircuit\nqc = QuantumCircuit(1)\nqc.x(0)\n`;
        const result = parseQiskit(source);
        assert.ok(!result.error);
        assertState(result, [[0, 0], [1, 0]], 'X|0⟩');
    });

    test('6b. Pauli-Y on |0⟩ gives i|1⟩', () => {
        const source = `from qiskit import QuantumCircuit\nqc = QuantumCircuit(1)\nqc.y(0)\n`;
        const result = parseQiskit(source);
        assert.ok(!result.error);
        assertState(result, [[0, 0], [0, 1]], 'Y|0⟩');
    });

    test('6c. Pauli-Z on |0⟩ keeps |0⟩, on |1⟩ gives -|1⟩', () => {
        // Z|0⟩ = |0⟩ (trivial, no state change), so test Z on |1⟩
        const source = `from qiskit import QuantumCircuit\nqc = QuantumCircuit(1)\nqc.x(0)\nqc.z(0)\n`;
        const result = parseQiskit(source);
        assert.ok(!result.error);
        assertState(result, [[0, 0], [-1, 0]], 'Z|1⟩');
    });

    test('7a. H then S gives |+i⟩ = (|0⟩ + i|1⟩)/√2', () => {
        const source = `from qiskit import QuantumCircuit\nqc = QuantumCircuit(1)\nqc.h(0)\nqc.s(0)\n`;
        const result = parseQiskit(source);
        assert.ok(!result.error);
        assertState(result, [[SQRT2_INV, 0], [0, SQRT2_INV]], 'S·H|0⟩');
    });

    test('7b. H then T gives (|0⟩ + e^(iπ/4)|1⟩)/√2', () => {
        const source = `from qiskit import QuantumCircuit\nqc = QuantumCircuit(1)\nqc.h(0)\nqc.t(0)\n`;
        const result = parseQiskit(source);
        assert.ok(!result.error);
        const state = result.states[result.states.length - 1];
        assertAmplitude(state.amplitudes[0], SQRT2_INV, 0, '|0⟩ component');
        assertAmplitude(state.amplitudes[1],
            SQRT2_INV * Math.cos(Math.PI / 4),
            SQRT2_INV * Math.sin(Math.PI / 4),
            '|1⟩ component');
    });

    test('7c. H then P(pi/2) gives (|0⟩ + i|1⟩)/√2', () => {
        const source = `from qiskit import QuantumCircuit\nimport numpy as np\nqc = QuantumCircuit(1)\nqc.h(0)\nqc.p(np.pi / 2, 0)\n`;
        const result = parseQiskit(source);
        assert.ok(!result.error);
        assertState(result, [[SQRT2_INV, 0], [0, SQRT2_INV]], 'P(π/2)·H|0⟩');
    });

    test('8. SX gate on |0⟩', () => {
        const source = `from qiskit import QuantumCircuit\nqc = QuantumCircuit(1)\nqc.sx(0)\n`;
        const result = parseQiskit(source);
        assert.ok(!result.error);
        assertState(result, [[0.5, 0.5], [0.5, -0.5]], 'SX|0⟩');
    });

    test('9a. RX(π) on |0⟩ gives -i|1⟩', () => {
        const source = `from qiskit import QuantumCircuit\nimport numpy as np\nqc = QuantumCircuit(1)\nqc.rx(np.pi, 0)\n`;
        const result = parseQiskit(source);
        assert.ok(!result.error);
        assertState(result, [[0, 0], [0, -1]], 'RX(π)|0⟩');
    });

    test('9b. RY(π) on |0⟩ gives |1⟩', () => {
        const source = `from qiskit import QuantumCircuit\nimport numpy as np\nqc = QuantumCircuit(1)\nqc.ry(np.pi, 0)\n`;
        const result = parseQiskit(source);
        assert.ok(!result.error);
        assertState(result, [[0, 0], [1, 0]], 'RY(π)|0⟩');
    });

    test('10. U(π/2, 0, π) on |0⟩ (equivalent to H)', () => {
        const source = `from qiskit import QuantumCircuit\nimport numpy as np\nqc = QuantumCircuit(1)\nqc.u(np.pi / 2, 0, np.pi, 0)\n`;
        const result = parseQiskit(source);
        assert.ok(!result.error);
        assertState(result, [[SQRT2_INV, 0], [SQRT2_INV, 0]], 'U(π/2,0,π)|0⟩');
    });
});

// ============================================================================
// Suite 3: Multi-Qubit Entanglement & Controlled Gates
// ============================================================================
describe('Qiskit Multi-Qubit & Controlled Gates', () => {
    test('11. Bell state |Φ+⟩ = H then CX', () => {
        const source = `from qiskit import QuantumCircuit\nqc = QuantumCircuit(2)\nqc.h(0)\nqc.cx(0, 1)\n`;
        const result = parseQiskit(source);
        assert.ok(!result.error);
        assertState(result, [[SQRT2_INV, 0], [0, 0], [0, 0], [SQRT2_INV, 0]], '|Φ+⟩');
    });

    test('12. Bell state |Ψ+⟩ = X(1) then H(0) then CX(0,1)', () => {
        const source = `from qiskit import QuantumCircuit\nqc = QuantumCircuit(2)\nqc.x(1)\nqc.h(0)\nqc.cx(0, 1)\n`;
        const result = parseQiskit(source);
        assert.ok(!result.error);
        // |Ψ+⟩ = (|01⟩ + |10⟩)/√2
        assertState(result, [[0, 0], [SQRT2_INV, 0], [SQRT2_INV, 0], [0, 0]], '|Ψ+⟩');
    });

    test('13. GHZ state on 3 qubits', () => {
        const source = `from qiskit import QuantumCircuit\nqc = QuantumCircuit(3)\nqc.h(0)\nqc.cx(0, 1)\nqc.cx(1, 2)\n`;
        const result = parseQiskit(source);
        assert.ok(!result.error);
        const state = result.states[result.states.length - 1];
        assertAmplitude(state.amplitudes[0], SQRT2_INV, 0, '|000⟩');
        assertAmplitude(state.amplitudes[7], SQRT2_INV, 0, '|111⟩');
        // All others should be 0
        for (const i of [1, 2, 3, 4, 5, 6]) {
            assertAmplitude(state.amplitudes[i], 0, 0, `|${i.toString(2).padStart(3, '0')}⟩`);
        }
    });

    test('14. CZ on H|0⟩⊗H|0⟩ gives (|00⟩+|01⟩+|10⟩-|11⟩)/2', () => {
        const source = `from qiskit import QuantumCircuit\nqc = QuantumCircuit(2)\nqc.h(0)\nqc.h(1)\nqc.cz(0, 1)\n`;
        const result = parseQiskit(source);
        assert.ok(!result.error);
        assertState(result, [[0.5, 0], [0.5, 0], [0.5, 0], [-0.5, 0]], 'CZ|++⟩');
    });

    test('15. SWAP exchanges qubit states', () => {
        const source = `from qiskit import QuantumCircuit\nqc = QuantumCircuit(2)\nqc.x(0)\nqc.swap(0, 1)\n`;
        const result = parseQiskit(source);
        assert.ok(!result.error);
        // |10⟩ → |01⟩ (index 2 → index 1)
        assertState(result, [[0, 0], [1, 0], [0, 0], [0, 0]], 'SWAP|10⟩');
    });

    test('16a. Toffoli (CCX) gate', () => {
        const source = `from qiskit import QuantumCircuit\nqc = QuantumCircuit(3)\nqc.x(0)\nqc.x(1)\nqc.ccx(0, 1, 2)\n`;
        const result = parseQiskit(source);
        assert.ok(!result.error);
        // |110⟩ → |111⟩ (index 6 → index 7)
        assertState(result, [
            [0, 0], [0, 0], [0, 0], [0, 0],
            [0, 0], [0, 0], [0, 0], [1, 0]
        ], 'CCX|110⟩');
    });

    test('16b. Fredkin (CSWAP) gate', () => {
        const source = `from qiskit import QuantumCircuit\nqc = QuantumCircuit(3)\nqc.x(0)\nqc.x(1)\nqc.cswap(0, 1, 2)\n`;
        const result = parseQiskit(source);
        assert.ok(!result.error);
        // |110⟩ → |101⟩ (control q0=1, swap q1 and q2: index 6 → index 5)
        assertState(result, [
            [0, 0], [0, 0], [0, 0], [0, 0],
            [0, 0], [1, 0], [0, 0], [0, 0]
        ], 'CSWAP|110⟩');
    });

    test('17. Multi-Controlled X (MCX)', () => {
        const source = `from qiskit import QuantumCircuit\nqc = QuantumCircuit(4)\nqc.x(0)\nqc.x(1)\nqc.x(2)\nqc.mcx([0, 1, 2], 3)\n`;
        const result = parseQiskit(source);
        assert.ok(!result.error);
        // |1110⟩ → |1111⟩ (all controls set → flip target: index 14 → index 15)
        const state = result.states[result.states.length - 1];
        assertAmplitude(state.amplitudes[15], 1, 0, '|1111⟩');
    });
});

// ============================================================================
// Suite 4: State Reset, Initialization, & Line Inspection
// ============================================================================
describe('Qiskit State Reset, Initialization, & Line Inspection', () => {
    test('18. Reset returns qubit to |0⟩', () => {
        const source = `from qiskit import QuantumCircuit\nqc = QuantumCircuit(1)\nqc.x(0)\nqc.reset(0)\n`;
        const result = parseQiskit(source);
        assert.ok(!result.error);
        assertState(result, [[1, 0], [0, 0]], 'reset after X');
    });

    test('19. Initialize sets arbitrary state', () => {
        const source = `from qiskit import QuantumCircuit\nqc = QuantumCircuit(1)\nqc.initialize([0, 1], 0)\n`;
        const result = parseQiskit(source);
        assert.ok(!result.error);
        assertState(result, [[0, 0], [1, 0]], 'initialize |1⟩');
    });

    test('20. Line inspection (targetLine) stops simulation at specified line', () => {
        const source = [
            'from qiskit import QuantumCircuit',
            'qc = QuantumCircuit(2)',       // line 1
            'qc.h(0)',                       // line 2
            'qc.cx(0, 1)',                   // line 3
        ].join('\n');

        // Inspect up to line 2 (H gate only on q0, before CX)
        const result = parseQiskit(source, 2);
        assert.ok(!result.error);
        // After H on qubit 0 (MSB): (|00⟩ + |10⟩)/√2
        const state = result.states[result.states.length - 1];
        assertAmplitude(state.amplitudes[0], SQRT2_INV, 0, '|00⟩ after H(0)');
        assertAmplitude(state.amplitudes[1], 0, 0, '|01⟩');
        assertAmplitude(state.amplitudes[2], SQRT2_INV, 0, '|10⟩ after H(0)');
        assertAmplitude(state.amplitudes[3], 0, 0, '|11⟩');
    });

    test('21. findCircuitInit returns correct line for CodeLens placement', () => {
        const source = [
            'from qiskit import QuantumCircuit',
            'import numpy as np',
            '',
            'qc = QuantumCircuit(3)',  // line 3
            'qc.h(0)',
            'qc.cx(0, 1)',
        ].join('\n');

        const circuit = findCircuitInit(source);
        assert.ok(circuit);
        assert.strictEqual(circuit.startLine, 3, 'CodeLens should be on QuantumCircuit init line');
        assert.strictEqual(circuit.name, 'qc');
        assert.strictEqual(circuit.qubits, 3);
    });
});

// ============================================================================
// Python expression evaluator tests
// ============================================================================
describe('Qiskit Python Expression Evaluator', () => {
    test('Evaluates np.pi correctly', () => {
        const val = evalPythonExpr('np.pi');
        assert.ok(Math.abs(val - Math.PI) < TOLERANCE);
    });

    test('Evaluates math.pi / 2 correctly', () => {
        const val = evalPythonExpr('math.pi / 2');
        assert.ok(Math.abs(val - Math.PI / 2) < TOLERANCE);
    });

    test('Evaluates 3 * pi / 4 correctly', () => {
        const val = evalPythonExpr('3 * pi / 4');
        assert.ok(Math.abs(val - 3 * Math.PI / 4) < TOLERANCE);
    });

    test('Evaluates float literal correctly', () => {
        const val = evalPythonExpr('0.5');
        assert.ok(Math.abs(val - 0.5) < TOLERANCE);
    });

    test('Evaluates -pi correctly', () => {
        const val = evalPythonExpr('-pi');
        assert.ok(Math.abs(val - (-Math.PI)) < TOLERANCE);
    });
});

// ============================================================================
// Output schema compatibility
// ============================================================================
describe('Qiskit Output Schema Compatibility', () => {
    test('Output matches Q# schema shape', () => {
        const source = `from qiskit import QuantumCircuit\nqc = QuantumCircuit(2)\nqc.h(0)\nqc.cx(0, 1)\n`;
        const result = parseQiskit(source);

        // Required top-level fields
        assert.ok('qubitsDeclared' in result);
        assert.ok('qubitsList' in result);
        assert.ok('states' in result);
        assert.ok('steps' in result);
        assert.strictEqual(result.qubitsDeclared, 2);
        assert.deepStrictEqual(result.qubitsList, ['q0', 'q1']);
        assert.ok(Array.isArray(result.states));
        assert.ok(result.states.length > 0);

        // State shape
        const state = result.states[0];
        assert.ok('qubits' in state);
        assert.ok('amplitudes' in state);
        assert.ok(Array.isArray(state.amplitudes));
        assert.strictEqual(state.amplitudes.length, 4); // 2^2

        // Amplitude shape
        const amp = state.amplitudes[0];
        assert.ok('re' in amp);
        assert.ok('im' in amp);
    });
});
