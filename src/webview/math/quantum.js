import { complexAbs2 } from './math.js';

function parseAmplitude(value) {
    const normalized = String(value || '')
        .replace(/\s/g, '')
        .replace(/𝑖/g, 'i')
        .replace(/[−–—]/g, '-');
    if (normalized === 'i' || normalized === '+i') return { re: 0, im: 1 };
    if (normalized === '-i') return { re: 0, im: -1 };
    const complex = normalized.match(/^([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)([+-](?:\d+(?:\.\d*)?|\.\d+)?(?:e[+-]?\d+)?)i$/i);
    if (complex) {
        const imPart = complex[2] === '+' || complex[2] === '' ? 1 : (complex[2] === '-' ? -1 : Number(complex[2]));
        return { re: Number(complex[1]), im: imPart };
    }
    const imaginary = normalized.match(/^([+-]?(?:\d+(?:\.\d*)?|\.\d+)?(?:e[+-]?\d+)?)i$/i);
    if (imaginary) {
        const imPart = imaginary[1] === '+' || imaginary[1] === '' ? 1 : (imaginary[1] === '-' ? -1 : Number(imaginary[1]));
        return { re: 0, im: imPart };
    }
    const real = Number.parseFloat(normalized);
    return { re: Number.isFinite(real) ? real : 0, im: 0 };
}

function isTrivialState(snapshot) {
    if (!snapshot || snapshot.qubits === 0) return true;
    const amps = snapshot.amplitudes;
    if (Math.abs(amps[0].re - 1) > 1e-8 || Math.abs(amps[0].im) > 1e-8) return false;
    for (let i = 1; i < amps.length; i++) {
        if (Math.abs(amps[i].re) > 1e-8 || Math.abs(amps[i].im) > 1e-8) return false;
    }
    return true;
}

function getQsphereState(result) {
    const states = result?.states || [];
    const latest = states.length > 0 ? states[states.length - 1] : null;
    const N = latest?.qubits || result?.qubitsDeclared || 0;
    const state = latest?.amplitudes || Array.from(
        { length: 2 ** N },
        () => ({ re: 0, im: 0 })
    );
    return { state, N };
}

function extractQubitBloch(snapshot, targetQubit = 0) {
    if (!snapshot || snapshot.qubits === 0 || targetQubit >= snapshot.qubits) return [0, 0, 1];
    const state = snapshot.amplitudes;
    const qubits = snapshot.qubits;
    const bit = 1 << (qubits - 1 - targetQubit);
    let rho00 = 0;
    let rho11 = 0;
    let rho10Re = 0;
    let rho10Im = 0;

    for (let i = 0; i < state.length; i++) {
        if (i & bit) continue;
        const j = i | bit;
        const ci = state[i] || { re: 0, im: 0 };
        const cj = state[j] || { re: 0, im: 0 };
        rho00 += complexAbs2(ci);
        rho11 += complexAbs2(cj);
        rho10Re += ci.re * cj.re + ci.im * cj.im;
        rho10Im += ci.re * cj.im - ci.im * cj.re;
    }
    return [2 * rho10Re, 2 * rho10Im, rho00 - rho11];
}

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

function getPhaseToRgb(phase) {
    const deg = ((phase / (2 * Math.PI)) * 360 + 360) % 360;
    const s = 0.68, l = 0.68;
    const k = n => (n + deg / 30) % 12;
    const a = s * Math.min(l, 1 - l);
    const f = n => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    return [f(0), f(8), f(4)];
}

function formatBasisState(index, qubits) {
    return `|${index.toString(2).padStart(qubits, '0')}⟩`;
}

function formatPhasePi(phase) {
    const twoPi = Math.PI * 2;
    const normalized = ((phase % twoPi) + twoPi) % twoPi;
    const units = normalized / Math.PI;
    const known = [
        [0, '0'],
        [0.5, 'π/2'],
        [1, 'π'],
        [1.5, '3π/2'],
        [2, '0']
    ];

    for (const [value, label] of known) {
        if (Math.abs(units - value) < 0.03) return label;
    }
    return `${units.toFixed(2)}π`;
}

function stepStatevectorTransition(currentAmplitudes, targetAmplitudes, lerpFactor = 0.25, threshold = 1e-4) {
    let anyDifference = false;
    for (let i = 0; i < targetAmplitudes.length; i++) {
        const curr = currentAmplitudes[i] || (currentAmplitudes[i] = { re: 0, im: 0 });
        const target = targetAmplitudes[i] || { re: 0, im: 0 };

        const currR = Math.sqrt(curr.re * curr.re + curr.im * curr.im);
        const targetR = Math.sqrt(target.re * target.re + target.im * target.im);

        const currTheta = Math.atan2(curr.im, curr.re);
        const targetTheta = Math.atan2(target.im, target.re);

        const diffR = targetR - currR;
        let diffTheta = targetTheta - currTheta;

        while (diffTheta < -Math.PI) diffTheta += Math.PI * 2;
        while (diffTheta > Math.PI) diffTheta -= Math.PI * 2;

        const rChanged = Math.abs(diffR) > threshold;
        const thetaChanged = targetR > threshold && Math.abs(diffTheta) > threshold;

        if (rChanged || thetaChanged) {
            const nextR = currR + diffR * lerpFactor;
            const nextTheta = currTheta + (thetaChanged ? diffTheta * lerpFactor : 0);

            curr.re = nextR * Math.cos(nextTheta);
            curr.im = nextR * Math.sin(nextTheta);
            anyDifference = true;
        } else {
            curr.re = target.re;
            curr.im = target.im;
        }
    }

    return {
        isTransitioning: anyDifference,
        currentAmplitudes
    };
}

export {
    parseAmplitude,
    isTrivialState,
    getQsphereState,
    extractQubitBloch,
    hammingWeight,
    computeQspherePoints,
    getPhaseToRgb,
    formatBasisState,
    formatPhasePi,
    stepStatevectorTransition
};
