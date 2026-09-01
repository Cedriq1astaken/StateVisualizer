/**
 * Qiskit Python Parser & Quantum State Simulator
 *
 * Pure JavaScript implementation that parses Python/Qiskit source code,
 * extracts quantum circuit definitions, simulates gate operations on
 * a state vector, and produces output in the same format as the Q# runtime.
 *
 * Output schema:
 *   { qubitsDeclared, qubitsList, states, steps, error? }
 *
 * where each state is { qubits, amplitudes: [{re, im}, ...] }
 */

// ---------------------------------------------------------------------------
// Complex number helpers (lightweight, self-contained)
// ---------------------------------------------------------------------------

function c(re, im) { return { re: re || 0, im: im || 0 }; }
function cAdd(a, b) { return { re: a.re + b.re, im: a.im + b.im }; }
function cSub(a, b) { return { re: a.re - b.re, im: a.im - b.im }; }
function cMul(a, b) {
    return { re: a.re * b.re - a.im * b.im, im: a.re * b.im + a.im * b.re };
}
function cScale(a, s) { return { re: a.re * s, im: a.im * s }; }
function cExp(theta) { return { re: Math.cos(theta), im: Math.sin(theta) }; }
function cAbs2(a) { return a.re * a.re + a.im * a.im; }

// ---------------------------------------------------------------------------
// 1. Import validation
// ---------------------------------------------------------------------------

const QISKIT_IMPORT_RE = /(?:^|\n)\s*(?:import\s+qiskit|from\s+qiskit(?:\.\w+)*\s+import\s+)/;

function hasQiskitImport(source) {
    return QISKIT_IMPORT_RE.test(source);
}

// ---------------------------------------------------------------------------
// 2. Circuit detection
// ---------------------------------------------------------------------------

function findCircuitInit(source) {
    const lines = source.split('\n');
    // Detect aliased QuantumCircuit names
    const aliasMatch = source.match(/from\s+qiskit(?:\.\w+)*\s+import\s+QuantumCircuit\s+as\s+(\w+)/);

    const classNames = ['QuantumCircuit'];
    if (aliasMatch) classNames.push(aliasMatch[1]);

    // Build dynamic regex for circuit init
    const classPattern = classNames.map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
    const circuitRe = new RegExp(`^(\\s*)(\\w+)\\s*=\\s*(?:\\w+\\.)*(?:${classPattern})\\s*\\(\\s*(?:num_qubits\\s*=\\s*)?(\\d+)`);

    for (let i = 0; i < lines.length; i++) {
        const match = lines[i].match(circuitRe);
        if (match) {
            const varName = match[2];
            const qubits = parseInt(match[3], 10);

            // Find end of circuit usage (last line referencing varName)
            let endLine = i;
            const varPattern = new RegExp(`\\b${varName}\\b`);
            for (let j = i + 1; j < lines.length; j++) {
                if (varPattern.test(lines[j])) endLine = j;
            }

            return {
                name: varName,
                startLine: i,
                endLine,
                qubits
            };
        }
    }
    return null;
}

// ---------------------------------------------------------------------------
// 3. Python expression evaluator (for angle parameters)
// ---------------------------------------------------------------------------

function evalPythonExpr(expr) {
    if (expr == null) return NaN;
    let s = String(expr).trim();

    s = s.replace(/\bnp\.pi\b/g, String(Math.PI));
    s = s.replace(/\bmath\.pi\b/g, String(Math.PI));
    s = s.replace(/\bpi\b/g, String(Math.PI));
    s = s.replace(/\bnp\.e\b/g, String(Math.E));
    s = s.replace(/\bmath\.e\b/g, String(Math.E));
    s = s.replace(/\bnp\.sqrt\s*\(\s*([^)]+)\s*\)/g, (_, inner) => {
        const val = evalPythonExpr(inner);
        return String(Math.sqrt(val));
    });
    s = s.replace(/\bmath\.sqrt\s*\(\s*([^)]+)\s*\)/g, (_, inner) => {
        const val = evalPythonExpr(inner);
        return String(Math.sqrt(val));
    });

    // Only allow safe characters
    if (/[^0-9eE.\-+*/() \t]/.test(s)) return NaN;

    try {
        const result = new Function(`"use strict"; return (${s});`)();
        return typeof result === 'number' ? result : NaN;
    } catch {
        return NaN;
    }
}

// ---------------------------------------------------------------------------
// 4. Gate definitions (unitary matrices)
// ---------------------------------------------------------------------------

const SQRT2_INV = 1 / Math.sqrt(2);

const GATES = {
    h:    () => [c(SQRT2_INV), c(SQRT2_INV), c(SQRT2_INV), c(-SQRT2_INV)],
    x:    () => [c(0), c(1), c(1), c(0)],
    y:    () => [c(0), c(0, -1), c(0, 1), c(0)],
    z:    () => [c(1), c(0), c(0), c(-1)],
    s:    () => [c(1), c(0), c(0), c(0, 1)],
    sdg:  () => [c(1), c(0), c(0), c(0, -1)],
    t:    () => [c(1), c(0), c(0), cExp(Math.PI / 4)],
    tdg:  () => [c(1), c(0), c(0), cExp(-Math.PI / 4)],
    sx:   () => [c(0.5, 0.5), c(0.5, -0.5), c(0.5, -0.5), c(0.5, 0.5)],
    sxdg: () => [c(0.5, -0.5), c(0.5, 0.5), c(0.5, 0.5), c(0.5, -0.5)],
    id:   () => [c(1), c(0), c(0), c(1)],
    i:    () => [c(1), c(0), c(0), c(1)],

    rx: (theta) => {
        const ct = Math.cos(theta / 2), st = Math.sin(theta / 2);
        return [c(ct), c(0, -st), c(0, -st), c(ct)];
    },
    ry: (theta) => {
        const ct = Math.cos(theta / 2), st = Math.sin(theta / 2);
        return [c(ct), c(-st), c(st), c(ct)];
    },
    rz: (phi) => {
        return [cExp(-phi / 2), c(0), c(0), cExp(phi / 2)];
    },
    p: (theta) => [c(1), c(0), c(0), cExp(theta)],
    u1: (theta) => [c(1), c(0), c(0), cExp(theta)],
    u: (theta, phi, lam) => {
        const ct = Math.cos(theta / 2), st = Math.sin(theta / 2);
        return [
            c(ct),
            cMul(c(-st), cExp(lam)),
            cMul(c(st), cExp(phi)),
            cMul(c(ct), cExp(phi + lam))
        ];
    },
    u3: (theta, phi, lam) => GATES.u(theta, phi, lam),
    u2: (phi, lam) => {
        return [
            cScale(c(1), SQRT2_INV),
            cScale(cExp(lam), -SQRT2_INV),
            cScale(cExp(phi), SQRT2_INV),
            cScale(cExp(phi + lam), SQRT2_INV)
        ];
    }
};

// ---------------------------------------------------------------------------
// 5. State vector simulator engine
// ---------------------------------------------------------------------------

function apply1QGate(sv, N, target, matrix) {
    const size = 1 << N;
    const step = 1 << (N - 1 - target);
    for (let i = 0; i < size; i++) {
        if (i & step) continue;
        const j = i | step;
        const a0 = sv[i];
        const a1 = sv[j];
        sv[i] = cAdd(cMul(matrix[0], a0), cMul(matrix[1], a1));
        sv[j] = cAdd(cMul(matrix[2], a0), cMul(matrix[3], a1));
    }
}

function applyControlledGate(sv, N, ctrl, tgt, matrix) {
    const size = 1 << N;
    const ctrlBit = 1 << (N - 1 - ctrl);
    const tgtBit = 1 << (N - 1 - tgt);
    for (let i = 0; i < size; i++) {
        if (!(i & ctrlBit)) continue;
        if (i & tgtBit) continue;
        const j = i | tgtBit;
        const a0 = sv[i];
        const a1 = sv[j];
        sv[i] = cAdd(cMul(matrix[0], a0), cMul(matrix[1], a1));
        sv[j] = cAdd(cMul(matrix[2], a0), cMul(matrix[3], a1));
    }
}

function applyMultiControlledGate(sv, N, controlQubits, tgt, matrix) {
    const size = 1 << N;
    const tgtBit = 1 << (N - 1 - tgt);
    const ctrlMask = controlQubits.reduce((mask, q) => mask | (1 << (N - 1 - q)), 0);
    for (let i = 0; i < size; i++) {
        if ((i & ctrlMask) !== ctrlMask) continue;
        if (i & tgtBit) continue;
        const j = i | tgtBit;
        const a0 = sv[i];
        const a1 = sv[j];
        sv[i] = cAdd(cMul(matrix[0], a0), cMul(matrix[1], a1));
        sv[j] = cAdd(cMul(matrix[2], a0), cMul(matrix[3], a1));
    }
}

function applySWAP(sv, N, q1, q2) {
    const size = 1 << N;
    const bit1 = 1 << (N - 1 - q1);
    const bit2 = 1 << (N - 1 - q2);
    for (let i = 0; i < size; i++) {
        const b1 = (i & bit1) ? 1 : 0;
        const b2 = (i & bit2) ? 1 : 0;
        if (b1 === b2) continue;
        const j = i ^ bit1 ^ bit2;
        if (i < j) {
            const tmp = sv[i];
            sv[i] = sv[j];
            sv[j] = tmp;
        }
    }
}

function applyISWAP(sv, N, q1, q2) {
    const size = 1 << N;
    const bit1 = 1 << (N - 1 - q1);
    const bit2 = 1 << (N - 1 - q2);
    for (let i = 0; i < size; i++) {
        const b1 = (i & bit1) ? 1 : 0;
        const b2 = (i & bit2) ? 1 : 0;
        if (b1 === b2) continue;
        const j = i ^ bit1 ^ bit2;
        if (i < j) {
            const tmp = sv[i];
            sv[i] = cMul(c(0, 1), sv[j]);
            sv[j] = cMul(c(0, 1), tmp);
        }
    }
}

function applyECR(sv, N, q1, q2) {
    const size = 1 << N;
    const bit1 = 1 << (N - 1 - q1);
    const bit2 = 1 << (N - 1 - q2);
    for (let i = 0; i < size; i++) {
        if ((i & bit1) !== 0 || (i & bit2) !== 0) continue;
        const i00 = i;
        const i01 = i | bit2;
        const i10 = i | bit1;
        const i11 = i | bit1 | bit2;

        const a00 = sv[i00];
        const a01 = sv[i01];
        const a10 = sv[i10];
        const a11 = sv[i11];

        sv[i00] = cScale(cAdd(a10, cMul(c(0, 1), a11)), SQRT2_INV);
        sv[i01] = cScale(cAdd(cMul(c(0, 1), a10), a11), SQRT2_INV);
        sv[i10] = cScale(cAdd(a00, cMul(c(0, -1), a01)), SQRT2_INV);
        sv[i11] = cScale(cAdd(cMul(c(0, -1), a00), a01), SQRT2_INV);
    }
}

function applyDCX(sv, N, q1, q2) {
    applyControlledGate(sv, N, q1, q2, GATES.x());
    applyControlledGate(sv, N, q2, q1, GATES.x());
}

function applyRXX(sv, N, q1, q2, theta) {
    const ct = Math.cos(theta / 2), st = Math.sin(theta / 2);
    const size = 1 << N;
    const bit1 = 1 << (N - 1 - q1), bit2 = 1 << (N - 1 - q2);
    for (let i = 0; i < size; i++) {
        if ((i & bit1) !== 0 || (i & bit2) !== 0) continue;
        const i00 = i, i01 = i | bit2, i10 = i | bit1, i11 = i | bit1 | bit2;
        const a00 = sv[i00], a01 = sv[i01], a10 = sv[i10], a11 = sv[i11];
        const mist = c(0, -st);
        sv[i00] = cAdd(cScale(a00, ct), cMul(mist, a11));
        sv[i01] = cAdd(cScale(a01, ct), cMul(mist, a10));
        sv[i10] = cAdd(cScale(a10, ct), cMul(mist, a01));
        sv[i11] = cAdd(cScale(a11, ct), cMul(mist, a00));
    }
}

function applyRYY(sv, N, q1, q2, theta) {
    const ct = Math.cos(theta / 2), st = Math.sin(theta / 2);
    const size = 1 << N;
    const bit1 = 1 << (N - 1 - q1), bit2 = 1 << (N - 1 - q2);
    for (let i = 0; i < size; i++) {
        if ((i & bit1) !== 0 || (i & bit2) !== 0) continue;
        const i00 = i, i01 = i | bit2, i10 = i | bit1, i11 = i | bit1 | bit2;
        const a00 = sv[i00], a01 = sv[i01], a10 = sv[i10], a11 = sv[i11];
        sv[i00] = cAdd(cScale(a00, ct), cMul(c(0, st), a11));
        sv[i01] = cAdd(cScale(a01, ct), cMul(c(0, -st), a10));
        sv[i10] = cAdd(cScale(a10, ct), cMul(c(0, -st), a01));
        sv[i11] = cAdd(cScale(a11, ct), cMul(c(0, st), a00));
    }
}

function applyRZZ(sv, N, q1, q2, theta) {
    const size = 1 << N;
    const bit1 = 1 << (N - 1 - q1), bit2 = 1 << (N - 1 - q2);
    const ep = cExp(theta / 2), em = cExp(-theta / 2);
    for (let i = 0; i < size; i++) {
        const b1 = (i & bit1) ? 1 : 0, b2 = (i & bit2) ? 1 : 0;
        const parity = b1 ^ b2;
        sv[i] = cMul(sv[i], parity ? em : ep);
    }
}

function applyRZX(sv, N, q1, q2, theta) {
    const ct = Math.cos(theta / 2), st = Math.sin(theta / 2);
    const size = 1 << N;
    const bit1 = 1 << (N - 1 - q1), bit2 = 1 << (N - 1 - q2);
    for (let i = 0; i < size; i++) {
        if ((i & bit1) !== 0 || (i & bit2) !== 0) continue;
        const i00 = i, i01 = i | bit2, i10 = i | bit1, i11 = i | bit1 | bit2;
        const a00 = sv[i00], a01 = sv[i01], a10 = sv[i10], a11 = sv[i11];
        sv[i00] = cAdd(cScale(a00, ct), cMul(c(0, -st), a10));
        sv[i01] = cAdd(cMul(c(0, st), a11), cScale(a01, ct));
        sv[i10] = cAdd(cMul(c(0, -st), a00), cScale(a10, ct));
        sv[i11] = cAdd(cScale(a11, ct), cMul(c(0, st), a01));
    }
}

function applyReset(sv, N, qubit) {
    const size = 1 << N;
    const bit = 1 << (N - 1 - qubit);

    // For each pair of basis states differing only in `qubit`,
    // move the |1⟩ amplitude to the |0⟩ position, then zero out |1⟩.
    // This simulates measuring and conditionally flipping.
    for (let i = 0; i < size; i++) {
        if (!(i & bit)) continue;       // only process |1⟩ states
        const j = i ^ bit;              // corresponding |0⟩ state
        // Move amplitude from |1⟩ to |0⟩
        // For a pure state this is equivalent to measure + conditional X
        sv[j] = c(
            Math.sqrt(cAbs2(sv[j]) + cAbs2(sv[i])),
            0
        );
        sv[i] = c(0);
    }
}

function applyInitialize(sv, N, stateVec, qubits) {
    if (!qubits || qubits.length === N) {
        for (let i = 0; i < sv.length; i++) {
            if (i < stateVec.length) {
                const v = stateVec[i];
                sv[i] = typeof v === 'number' ? c(v) : c(v.re || v[0] || 0, v.im || v[1] || 0);
            } else {
                sv[i] = c(0);
            }
        }
        return;
    }

    if (qubits.length === 1 && stateVec.length === 2) {
        const q = qubits[0];
        applyReset(sv, N, q);
        const alpha = typeof stateVec[0] === 'number' ? c(stateVec[0]) : c(stateVec[0].re || 0, stateVec[0].im || 0);
        const beta = typeof stateVec[1] === 'number' ? c(stateVec[1]) : c(stateVec[1].re || 0, stateVec[1].im || 0);
        const matrix = [
            alpha,
            { re: -beta.re, im: beta.im },
            beta,
            { re: alpha.re, im: -alpha.im }
        ];
        apply1QGate(sv, N, q, matrix);
    }
}

// ---------------------------------------------------------------------------
// 6. Line parser
// ---------------------------------------------------------------------------

function parseArgs(argsStr) {
    const args = [];
    let depth = 0;
    let current = '';
    for (const ch of argsStr) {
        if (ch === '(' || ch === '[') { depth++; current += ch; }
        else if (ch === ')' || ch === ']') { depth--; current += ch; }
        else if (ch === ',' && depth === 0) { args.push(current.trim()); current = ''; }
        else { current += ch; }
    }
    if (current.trim()) args.push(current.trim());
    return args;
}

function parseIntList(s) {
    const m = s.match(/^\[([^\]]*)\]$/);
    if (!m) return null;
    return m[1].split(',').map(x => parseInt(x.trim(), 10)).filter(x => !isNaN(x));
}

function parseNumericList(s) {
    const m = s.match(/^\[([^\]]*)\]$/);
    if (!m) return null;
    return m[1].split(',').map(x => {
        const val = evalPythonExpr(x.trim());
        return isNaN(val) ? 0 : val;
    });
}

function parseGateLine(line, circuitVar) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('import ') ||
        trimmed.startsWith('from ')) return null;

    const escaped = circuitVar.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`^${escaped}\\.(\\w+)\\s*\\((.*)\\)\\s*(?:#.*)?$`);
    const match = trimmed.match(re);
    if (!match) return null;

    const gate = match[1].toLowerCase();
    const argsStr = match[2];
    const args = parseArgs(argsStr);

    return { gate, args };
}

// ---------------------------------------------------------------------------
// 7. Main simulation entry point
// ---------------------------------------------------------------------------

function snapshotFromSv(sv, N) {
    return {
        qubits: N,
        amplitudes: sv.map(a => ({ re: a.re, im: a.im }))
    };
}

function areSnapshotsEqual(a, b, tolerance) {
    if (!a || !b) return false;
    if (a.qubits !== b.qubits) return false;
    const ampsA = a.amplitudes, ampsB = b.amplitudes;
    if (ampsA.length !== ampsB.length) return false;
    for (let i = 0; i < ampsA.length; i++) {
        if (Math.abs(ampsA[i].re - ampsB[i].re) > tolerance) return false;
        if (Math.abs(ampsA[i].im - ampsB[i].im) > tolerance) return false;
    }
    return true;
}

function isTrivialState(snapshot) {
    if (!snapshot || !snapshot.amplitudes || snapshot.amplitudes.length === 0) return true;
    const first = snapshot.amplitudes[0];
    if (Math.abs(first.re - 1) > 1e-9 || Math.abs(first.im) > 1e-9) return false;
    for (let i = 1; i < snapshot.amplitudes.length; i++) {
        if (Math.abs(snapshot.amplitudes[i].re) > 1e-9 || Math.abs(snapshot.amplitudes[i].im) > 1e-9) return false;
    }
    return true;
}

function parseQiskit(source, targetLine) {
    const result = { qubitsDeclared: 0, qubitsList: [], states: [], steps: [] };

    if (!hasQiskitImport(source)) {
        result.error = 'No Qiskit import detected in Python file.';
        return result;
    }

    const circuit = findCircuitInit(source);
    if (!circuit) {
        result.error = 'No QuantumCircuit instance found.';
        return result;
    }

    const N = circuit.qubits;
    const circuitVar = circuit.name;
    result.qubitsDeclared = N;
    result.qubitsList = Array.from({ length: N }, (_, i) => `q${i}`);

    const size = 1 << N;
    const sv = Array.from({ length: size }, (_, i) => i === 0 ? c(1) : c(0));

    // Record initial ground state |0...0⟩ so un-executed or newly declared circuits initialize to |0...0⟩
    const initialSnapshot = snapshotFromSv(sv, N);
    result.states.push(initialSnapshot);
    let lastSnapshot = initialSnapshot;

    const lines = source.split('\n');
    const hasTargetLine = typeof targetLine === 'number' && targetLine >= 0;

    for (let lineIdx = circuit.startLine + 1; lineIdx < lines.length; lineIdx++) {
        if (hasTargetLine && lineIdx > targetLine) break;

        const parsed = parseGateLine(lines[lineIdx], circuitVar);
        if (!parsed) continue;

        const { gate, args } = parsed;

        result.steps.push({
            line: lineIdx,
            range: { start: { line: lineIdx, character: 0 }, end: { line: lineIdx, character: lines[lineIdx].length } },
            gate
        });

        let gateApplied = false;

        // --- Standard 1-qubit gates ---
        if (['h', 'x', 'y', 'z', 's', 'sdg', 't', 'tdg', 'sx', 'sxdg', 'id', 'i'].includes(gate)) {
            const qubit = parseInt(args[0], 10);
            if (!isNaN(qubit) && qubit < N) {
                apply1QGate(sv, N, qubit, GATES[gate]());
                gateApplied = true;
            }
        }
        else if (gate === 'not') {
            const qubit = parseInt(args[0], 10);
            if (!isNaN(qubit) && qubit < N) {
                apply1QGate(sv, N, qubit, GATES.x());
                gateApplied = true;
            }
        }
        // --- Parametric 1-qubit gates ---
        else if (['rx', 'ry', 'rz'].includes(gate)) {
            const theta = evalPythonExpr(args[0]);
            const qubit = parseInt(args[1], 10);
            if (!isNaN(theta) && !isNaN(qubit) && qubit < N) {
                apply1QGate(sv, N, qubit, GATES[gate](theta));
                gateApplied = true;
            }
        }
        else if (gate === 'p' || gate === 'u1') {
            const theta = evalPythonExpr(args[0]);
            const qubit = parseInt(args[1], 10);
            if (!isNaN(theta) && !isNaN(qubit) && qubit < N) {
                apply1QGate(sv, N, qubit, GATES.p(theta));
                gateApplied = true;
            }
        }
        else if (gate === 'u' || gate === 'u3') {
            const theta = evalPythonExpr(args[0]);
            const phi = evalPythonExpr(args[1]);
            const lam = evalPythonExpr(args[2]);
            const qubit = parseInt(args[3], 10);
            if (!isNaN(theta) && !isNaN(phi) && !isNaN(lam) && !isNaN(qubit) && qubit < N) {
                apply1QGate(sv, N, qubit, GATES.u(theta, phi, lam));
                gateApplied = true;
            }
        }
        else if (gate === 'u2') {
            const phi = evalPythonExpr(args[0]);
            const lam = evalPythonExpr(args[1]);
            const qubit = parseInt(args[2], 10);
            if (!isNaN(phi) && !isNaN(lam) && !isNaN(qubit) && qubit < N) {
                apply1QGate(sv, N, qubit, GATES.u2(phi, lam));
                gateApplied = true;
            }
        }
        // --- 2-qubit controlled gates ---
        else if (gate === 'cx' || gate === 'cnot') {
            const ctrl = parseInt(args[0], 10), tgt = parseInt(args[1], 10);
            if (!isNaN(ctrl) && !isNaN(tgt) && ctrl < N && tgt < N) {
                applyControlledGate(sv, N, ctrl, tgt, GATES.x());
                gateApplied = true;
            }
        }
        else if (gate === 'cy') {
            const ctrl = parseInt(args[0], 10), tgt = parseInt(args[1], 10);
            if (!isNaN(ctrl) && !isNaN(tgt) && ctrl < N && tgt < N) {
                applyControlledGate(sv, N, ctrl, tgt, GATES.y());
                gateApplied = true;
            }
        }
        else if (gate === 'cz') {
            const ctrl = parseInt(args[0], 10), tgt = parseInt(args[1], 10);
            if (!isNaN(ctrl) && !isNaN(tgt) && ctrl < N && tgt < N) {
                applyControlledGate(sv, N, ctrl, tgt, GATES.z());
                gateApplied = true;
            }
        }
        else if (gate === 'ch') {
            const ctrl = parseInt(args[0], 10), tgt = parseInt(args[1], 10);
            if (!isNaN(ctrl) && !isNaN(tgt) && ctrl < N && tgt < N) {
                applyControlledGate(sv, N, ctrl, tgt, GATES.h());
                gateApplied = true;
            }
        }
        else if (gate === 'cp' || gate === 'cu1') {
            const theta = evalPythonExpr(args[0]);
            const ctrl = parseInt(args[1], 10), tgt = parseInt(args[2], 10);
            if (!isNaN(theta) && !isNaN(ctrl) && !isNaN(tgt) && ctrl < N && tgt < N) {
                applyControlledGate(sv, N, ctrl, tgt, GATES.p(theta));
                gateApplied = true;
            }
        }
        else if (gate === 'crx') {
            const theta = evalPythonExpr(args[0]);
            const ctrl = parseInt(args[1], 10), tgt = parseInt(args[2], 10);
            if (!isNaN(theta) && !isNaN(ctrl) && !isNaN(tgt) && ctrl < N && tgt < N) {
                applyControlledGate(sv, N, ctrl, tgt, GATES.rx(theta));
                gateApplied = true;
            }
        }
        else if (gate === 'cry') {
            const theta = evalPythonExpr(args[0]);
            const ctrl = parseInt(args[1], 10), tgt = parseInt(args[2], 10);
            if (!isNaN(theta) && !isNaN(ctrl) && !isNaN(tgt) && ctrl < N && tgt < N) {
                applyControlledGate(sv, N, ctrl, tgt, GATES.ry(theta));
                gateApplied = true;
            }
        }
        else if (gate === 'crz') {
            const theta = evalPythonExpr(args[0]);
            const ctrl = parseInt(args[1], 10), tgt = parseInt(args[2], 10);
            if (!isNaN(theta) && !isNaN(ctrl) && !isNaN(tgt) && ctrl < N && tgt < N) {
                applyControlledGate(sv, N, ctrl, tgt, GATES.rz(theta));
                gateApplied = true;
            }
        }
        else if (gate === 'cu') {
            const theta = evalPythonExpr(args[0]);
            const phi = evalPythonExpr(args[1]);
            const lam = evalPythonExpr(args[2]);
            const gamma = evalPythonExpr(args[3]);
            const ctrl = parseInt(args[4], 10), tgt = parseInt(args[5], 10);
            if (!isNaN(theta) && !isNaN(phi) && !isNaN(lam) && !isNaN(gamma) &&
                !isNaN(ctrl) && !isNaN(tgt) && ctrl < N && tgt < N) {
                const uMatrix = GATES.u(theta, phi, lam);
                if (Math.abs(gamma) > 1e-12) {
                    const phaseGate = [c(1), c(0), c(0), cExp(gamma)];
                    apply1QGate(sv, N, ctrl, phaseGate);
                }
                applyControlledGate(sv, N, ctrl, tgt, uMatrix);
                gateApplied = true;
            }
        }
        // --- 2-qubit swap / special ---
        else if (gate === 'swap') {
            const q1 = parseInt(args[0], 10), q2 = parseInt(args[1], 10);
            if (!isNaN(q1) && !isNaN(q2) && q1 < N && q2 < N) {
                applySWAP(sv, N, q1, q2);
                gateApplied = true;
            }
        }
        else if (gate === 'iswap') {
            const q1 = parseInt(args[0], 10), q2 = parseInt(args[1], 10);
            if (!isNaN(q1) && !isNaN(q2) && q1 < N && q2 < N) {
                applyISWAP(sv, N, q1, q2);
                gateApplied = true;
            }
        }
        else if (gate === 'ecr') {
            const q1 = parseInt(args[0], 10), q2 = parseInt(args[1], 10);
            if (!isNaN(q1) && !isNaN(q2) && q1 < N && q2 < N) {
                applyECR(sv, N, q1, q2);
                gateApplied = true;
            }
        }
        else if (gate === 'dcx') {
            const q1 = parseInt(args[0], 10), q2 = parseInt(args[1], 10);
            if (!isNaN(q1) && !isNaN(q2) && q1 < N && q2 < N) {
                applyDCX(sv, N, q1, q2);
                gateApplied = true;
            }
        }
        else if (gate === 'rxx') {
            const theta = evalPythonExpr(args[0]);
            const q1 = parseInt(args[1], 10), q2 = parseInt(args[2], 10);
            if (!isNaN(theta) && !isNaN(q1) && !isNaN(q2) && q1 < N && q2 < N) {
                applyRXX(sv, N, q1, q2, theta);
                gateApplied = true;
            }
        }
        else if (gate === 'ryy') {
            const theta = evalPythonExpr(args[0]);
            const q1 = parseInt(args[1], 10), q2 = parseInt(args[2], 10);
            if (!isNaN(theta) && !isNaN(q1) && !isNaN(q2) && q1 < N && q2 < N) {
                applyRYY(sv, N, q1, q2, theta);
                gateApplied = true;
            }
        }
        else if (gate === 'rzz') {
            const theta = evalPythonExpr(args[0]);
            const q1 = parseInt(args[1], 10), q2 = parseInt(args[2], 10);
            if (!isNaN(theta) && !isNaN(q1) && !isNaN(q2) && q1 < N && q2 < N) {
                applyRZZ(sv, N, q1, q2, theta);
                gateApplied = true;
            }
        }
        else if (gate === 'rzx') {
            const theta = evalPythonExpr(args[0]);
            const q1 = parseInt(args[1], 10), q2 = parseInt(args[2], 10);
            if (!isNaN(theta) && !isNaN(q1) && !isNaN(q2) && q1 < N && q2 < N) {
                applyRZX(sv, N, q1, q2, theta);
                gateApplied = true;
            }
        }
        // --- 3-qubit / multi-qubit gates ---
        else if (gate === 'ccx' || gate === 'toffoli') {
            const c1 = parseInt(args[0], 10), c2 = parseInt(args[1], 10), tgt = parseInt(args[2], 10);
            if (!isNaN(c1) && !isNaN(c2) && !isNaN(tgt) && c1 < N && c2 < N && tgt < N) {
                applyMultiControlledGate(sv, N, [c1, c2], tgt, GATES.x());
                gateApplied = true;
            }
        }
        else if (gate === 'cswap' || gate === 'fredkin') {
            const ctrl = parseInt(args[0], 10), q1 = parseInt(args[1], 10), q2 = parseInt(args[2], 10);
            if (!isNaN(ctrl) && !isNaN(q1) && !isNaN(q2) && ctrl < N && q1 < N && q2 < N) {
                const ctrlBit = 1 << (N - 1 - ctrl);
                const bit1 = 1 << (N - 1 - q1), bit2 = 1 << (N - 1 - q2);
                for (let i = 0; i < size; i++) {
                    if (!(i & ctrlBit)) continue;
                    const b1 = (i & bit1) ? 1 : 0, b2 = (i & bit2) ? 1 : 0;
                    if (b1 === b2) continue;
                    const j = i ^ bit1 ^ bit2;
                    if (i < j) {
                        const tmp = sv[i];
                        sv[i] = sv[j];
                        sv[j] = tmp;
                    }
                }
                gateApplied = true;
            }
        }
        else if (gate === 'mcx') {
            const controlList = parseIntList(args[0]);
            const tgt = parseInt(args[1], 10);
            if (controlList && !isNaN(tgt) && tgt < N && controlList.every(q => q < N)) {
                applyMultiControlledGate(sv, N, controlList, tgt, GATES.x());
                gateApplied = true;
            }
        }
        else if (gate === 'mcp') {
            const theta = evalPythonExpr(args[0]);
            const controlList = parseIntList(args[1]);
            const tgt = parseInt(args[2], 10);
            if (!isNaN(theta) && controlList && !isNaN(tgt) && tgt < N && controlList.every(q => q < N)) {
                applyMultiControlledGate(sv, N, controlList, tgt, GATES.p(theta));
                gateApplied = true;
            }
        }
        // --- State / utility ---
        else if (gate === 'reset') {
            const qubit = parseInt(args[0], 10);
            if (!isNaN(qubit) && qubit < N) {
                applyReset(sv, N, qubit);
                gateApplied = true;
            }
        }
        else if (gate === 'initialize') {
            const stateList = parseNumericList(args[0]);
            if (stateList) {
                let qubits = null;
                if (args.length > 1) {
                    const singleQ = parseInt(args[1], 10);
                    if (!isNaN(singleQ)) {
                        qubits = [singleQ];
                    } else {
                        qubits = parseIntList(args[1]);
                    }
                }
                applyInitialize(sv, N, stateList, qubits);
                gateApplied = true;
            }
        }
        else if (gate === 'barrier') {
            gateApplied = true;
        }

        if (gateApplied) {
            const snapshot = snapshotFromSv(sv, N);
            if (!areSnapshotsEqual(snapshot, lastSnapshot, 1e-9)) {
                lastSnapshot = snapshot;
                result.states.push(snapshot);
            }
        }
    }

    // Strip leading trivial |0...0⟩ states (same as Q# runtime)
    while (result.states.length > 1 && isTrivialState(result.states[0])) {
        result.states.shift();
    }

    return result;
}

// ---------------------------------------------------------------------------
// 8. Exports
// ---------------------------------------------------------------------------

if (typeof window !== 'undefined') {
    window.parseQiskit = parseQiskit;
}

export {
    parseQiskit,
    hasQiskitImport,
    findCircuitInit,
    evalPythonExpr,
    GATES,
    apply1QGate,
    applyControlledGate,
    applyMultiControlledGate,
    applySWAP
};
