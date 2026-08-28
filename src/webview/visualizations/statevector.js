function getQsphereState(result) {
    if (typeof computeQsphereState === 'function') {
        return computeQsphereState(result);
    }
    if (typeof window !== 'undefined' && typeof window.computeQsphereState === 'function') {
        return window.computeQsphereState(result);
    }
    const states = result?.states || [];
    const latest = states.length > 0 ? states[states.length - 1] : null;
    const N = latest?.qubits || result?.qubitsDeclared || 0;
    const state = latest?.amplitudes || Array.from(
        { length: 2 ** N },
        () => ({ re: 0, im: 0 })
    );
    return { state, N };
}

function getPhaseToRgb(phase) {
    if (typeof phaseToRgb === 'function') {
        return phaseToRgb(phase);
    }
    if (typeof window !== 'undefined' && typeof window.phaseToRgb === 'function') {
        return window.phaseToRgb(phase);
    }
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

let statevectorContainer = null;
let statevectorCanvas = null;
let statevectorStats = null;
let statevectorChartWrapper = null;
let statevectorHoverInfo = null;

let statevectorBarData = [];
let currentAmplitudes = [];
let targetAmplitudes = [];
let currentQubits = 0;
let targetQubits = 0;
let isTransitioning = false;
let hoveredStateIndex = null;
let isInitialized = false;
let lastResult = null;

function initStatevectorElements(elements = {}) {
    statevectorContainer = elements.container || document.getElementById('statevector-container');
    statevectorCanvas = elements.canvas || document.getElementById('statevector-canvas');
    statevectorStats = elements.stats || document.getElementById('statevector-stats');
    statevectorChartWrapper = elements.chartWrapper || document.getElementById('statevector-chart-wrapper');

    if (!isInitialized && statevectorCanvas) {
        setupStatevectorEvents();
        isInitialized = true;
    }
}

function getStatevectorHoverInfo() {
    if (statevectorHoverInfo || !statevectorContainer) return statevectorHoverInfo;

    statevectorHoverInfo = document.createElement('div');
    statevectorHoverInfo.className = 'statevector-hover-info';
    statevectorHoverInfo.hidden = true;
    statevectorContainer.appendChild(statevectorHoverInfo);
    return statevectorHoverInfo;
}

function setupStatevectorEvents() {
    if (!statevectorCanvas) return;

    statevectorCanvas.addEventListener('mousemove', event => {
        if (document.body.dataset.visualizationMode !== 'statevector' || !statevectorBarData.length) return;

        const rect = statevectorCanvas.getBoundingClientRect();
        const mouseX = event.clientX - rect.left;
        const mouseY = event.clientY - rect.top;

        let hovered = null;
        for (const bar of statevectorBarData) {
            if (mouseX >= bar.x - 4 && mouseX <= bar.x + bar.width + 4 && mouseY >= 10 && mouseY <= rect.height - 10) {
                hovered = bar;
                break;
            }
        }

        const prev = hoveredStateIndex;
        hoveredStateIndex = hovered ? hovered.index : null;
        if (prev !== hoveredStateIndex) {
            if (currentAmplitudes.length > 0) {
                drawStateVectorHistogramWithAmplitudes(currentAmplitudes, currentQubits);
            }
        }

        const hoverInfo = getStatevectorHoverInfo();
        if (hovered && hoverInfo && statevectorContainer) {
            const phaseDeg = (((hovered.phase * 180 / Math.PI) % 360) + 360) % 360;
            const reSign = hovered.amp.im >= 0 ? '+' : '-';
            const imAbs = Math.abs(hovered.amp.im);

            hoverInfo.innerHTML =
                `<strong>${hovered.label}</strong><br>` +
                `Amplitude: ${hovered.magnitude.toFixed(4)}<br>` +
                `Probability: ${(hovered.probability * 100).toFixed(1)}%<br>` +
                `Phase: ${phaseDeg.toFixed(1)}° (${formatPhasePi(hovered.phase)})`;

            const containerRect = statevectorContainer.getBoundingClientRect();
            const posX = event.clientX - containerRect.left + 12;
            const posY = event.clientY - containerRect.top + 12;

            hoverInfo.style.left = `${Math.min(containerRect.width - 150, Math.max(8, posX))}px`;
            hoverInfo.style.top = `${Math.min(containerRect.height - 80, Math.max(8, posY))}px`;
            hoverInfo.hidden = false;
        } else if (hoverInfo) {
            hoverInfo.hidden = true;
        }
    });

    statevectorCanvas.addEventListener('mouseleave', () => {
        if (hoveredStateIndex !== null) {
            hoveredStateIndex = null;
            if (currentAmplitudes.length > 0) {
                drawStateVectorHistogramWithAmplitudes(currentAmplitudes, currentQubits);
            }
        }
        const hoverInfo = getStatevectorHoverInfo();
        if (hoverInfo) hoverInfo.hidden = true;
    });
}

function renderStateVectorHistogram(result) {
    if (!result) return;
    lastResult = result;
    initStatevectorElements();

    const { state, N } = getQsphereState(result);

    targetAmplitudes = state;
    targetQubits = N;

    if (currentQubits !== N || currentAmplitudes.length !== state.length) {
        currentQubits = N;
        currentAmplitudes = Array.from({ length: state.length }, () => ({ re: 0, im: 0 }));
    }

    isTransitioning = true;
}

function drawStateVectorHistogramWithAmplitudes(state, N) {
    initStatevectorElements();
    if (!statevectorCanvas) return;
    const ctx = statevectorCanvas.getContext('2d');
    if (!ctx) return;

    const numStates = 2 ** N;

    if (statevectorStats) {
        let activeCount = 0;
        let totalProb = 0;
        for (let i = 0; i < numStates; i++) {
            const amp = state[i] || { re: 0, im: 0 };
            const p = amp.re * amp.re + amp.im * amp.im;
            if (p > 1e-5) activeCount++;
            totalProb += p;
        }
        statevectorStats.textContent = N > 0
            ? `${N} Qubit${N > 1 ? 's' : ''} • ${numStates} Basis States • ${activeCount} Non-Zero States`
            : '';
    }

    const dpr = window.devicePixelRatio || 1;
    const wrapperWidth = (statevectorChartWrapper ? statevectorChartWrapper.clientWidth : 800) || 800;
    const paddingLeft = 52;
    const paddingRight = 20;
    const paddingTop = 28;
    const paddingBottom = 42;
    const plotHeight = 210;
    const totalHeight = paddingTop + plotHeight + paddingBottom;

    const minBarWidth = numStates <= 8 ? 44 : (numStates <= 16 ? 30 : 20);
    const barGap = numStates <= 8 ? 20 : (numStates <= 16 ? 12 : 8);
    const minPlotWidth = numStates * (minBarWidth + barGap);
    const totalWidth = Math.max(wrapperWidth, paddingLeft + paddingRight + minPlotWidth);
    const plotWidth = totalWidth - paddingLeft - paddingRight;

    if (statevectorCanvas.width !== Math.floor(totalWidth * dpr) || statevectorCanvas.height !== Math.floor(totalHeight * dpr)) {
        statevectorCanvas.width = Math.floor(totalWidth * dpr);
        statevectorCanvas.height = Math.floor(totalHeight * dpr);
        statevectorCanvas.style.width = `${totalWidth}px`;
        statevectorCanvas.style.height = `${totalHeight}px`;
    }

    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, totalWidth, totalHeight);

    // Draw Y-Axis Grid Lines & Ticks (0.0 to 1.0)
    const yTicks = [1.0, 0.75, 0.5, 0.25, 0.0];
    ctx.font = 'bold 11px system-ui, -apple-system, sans-serif';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';

    for (const tick of yTicks) {
        const y = paddingTop + (1.0 - tick) * plotHeight;

        ctx.strokeStyle = tick === 0.0 ? 'rgba(255, 255, 255, 0.65)' : 'rgba(255, 255, 255, 0.20)';
        ctx.lineWidth = tick === 0.0 ? 1.5 : 1;
        ctx.setLineDash(tick === 0.0 ? [] : [4, 4]);


        ctx.beginPath();
        ctx.moveTo(paddingLeft, y);
        ctx.lineTo(totalWidth - paddingRight, y);
        ctx.stroke();

        ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
        ctx.fillText(tick.toFixed(2), paddingLeft - 8, y);
    }
    ctx.setLineDash([]);

    if (numStates === 0 || N === 0) {
        ctx.fillStyle = 'rgba(255, 255, 255, 0.75)';
        ctx.textAlign = 'center';
        ctx.font = 'bold 13px system-ui, -apple-system, sans-serif';
        ctx.fillText('No quantum state declared.', totalWidth / 2, paddingTop + plotHeight / 2);
        ctx.restore();
        statevectorBarData = [];
        return;
    }

    // Calculate bar positions
    const step = plotWidth / numStates;
    const barWidth = Math.max(14, Math.min(52, step - barGap));
    statevectorBarData = [];

    for (let i = 0; i < numStates; i++) {
        const amp = state[i] || { re: 0, im: 0 };
        const magnitude = Math.sqrt(amp.re * amp.re + amp.im * amp.im);
        const probability = amp.re * amp.re + amp.im * amp.im;
        const phase = Math.atan2(amp.im, amp.re);
        const [r, g, b] = getPhaseToRgb(phase);

        const barX = paddingLeft + i * step + (step - barWidth) / 2;
        const barHeight = Math.max(0, Math.min(plotHeight, magnitude * plotHeight));
        const barY = paddingTop + plotHeight - barHeight;
        const isHovered = hoveredStateIndex === i;

        statevectorBarData.push({
            index: i,
            label: formatBasisState(i, N),
            amp,
            magnitude,
            probability,
            phase,
            color: `rgb(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)})`,
            x: barX,
            y: barY,
            width: barWidth,
            height: barHeight,
            centerX: barX + barWidth / 2
        });

        // Draw Bar
        if (barHeight > 1) {
            ctx.save();
            ctx.fillStyle = `rgb(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)})`;
            if (isHovered) {
                ctx.shadowColor = `rgba(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)}, 0.6)`;
                ctx.shadowBlur = 8;
            }

            const radius = Math.min(3, barWidth / 2, barHeight / 2);
            ctx.beginPath();
            if (typeof ctx.roundRect === 'function') {
                ctx.roundRect(barX, barY, barWidth, barHeight, [radius, radius, 0, 0]);
            } else {
                ctx.rect(barX, barY, barWidth, barHeight);
            }
            ctx.fill();

            if (isHovered) {
                ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
                ctx.lineWidth = 1.2;
                ctx.stroke();
            }
            ctx.restore();
        } else {
            // Draw subtle zero baseline indicator
            ctx.fillStyle = 'rgba(255, 255, 255, 0.35)';
            ctx.fillRect(barX, paddingTop + plotHeight - 1.5, barWidth, 1.5);
        }

        // Amplitude value label above bar
        if (magnitude >= 0.05) {
            ctx.fillStyle = isHovered ? '#ffffff' : 'rgba(255, 255, 255, 0.95)';
            ctx.font = 'bold 10px system-ui, -apple-system, sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'bottom';
            const labelY = Math.max(paddingTop - 2, barY - 6);
            ctx.fillText(magnitude.toFixed(2), barX + barWidth / 2, labelY);
        }

        // Basis state label below X-axis
        ctx.fillStyle = isHovered ? '#ffffff' : (magnitude > 1e-4 ? '#ffffff' : 'rgba(255, 255, 255, 0.55)');
        ctx.font = 'bold 12px system-ui, -apple-system, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';

        const labelText = formatBasisState(i, N);
        const labelY = paddingTop + plotHeight + 8;
        if (step < 32 && numStates > 8) {
            ctx.save();
            ctx.translate(barX + barWidth / 2, labelY);
            ctx.rotate(-Math.PI / 4);
            ctx.textAlign = 'right';
            ctx.fillText(labelText, 0, 0);
            ctx.restore();
        } else {
            ctx.fillText(labelText, barX + barWidth / 2, labelY);
        }
    }

    ctx.restore();
}

function stepStatevectorTransition(lerpFactor = 0.25, threshold = 1e-4) {
    if (!isTransitioning) {
        return { isTransitioning: false, currentAmplitudes, currentQubits };
    }

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

    if (!anyDifference) {
        isTransitioning = false;
    }

    return {
        isTransitioning,
        currentAmplitudes,
        currentQubits
    };
}

function getIsTransitioning() {
    return isTransitioning;
}

function getCurrentAmplitudes() {
    return currentAmplitudes;
}

function getCurrentQubits() {
    return currentQubits;
}

const statevectorVisualization = {
    id: 'statevector',
    label: 'Statevector',

    mount(container) {
        initStatevectorElements();
        if (statevectorContainer) {
            statevectorContainer.hidden = false;
            statevectorContainer.style.display = 'flex';
        }
        if (currentAmplitudes.length > 0) {
            drawStateVectorHistogramWithAmplitudes(currentAmplitudes, currentQubits);
        } else if (lastResult) {
            renderStateVectorHistogram(lastResult);
        }
    },

    unmount() {
        if (statevectorContainer) {
            statevectorContainer.hidden = true;
            statevectorContainer.style.display = 'none';
        }
        const hoverInfo = getStatevectorHoverInfo();
        if (hoverInfo) hoverInfo.hidden = true;
    },

    update(result, options = {}) {
        if (!result) return;
        renderStateVectorHistogram(result);
        if (options.immediate) {
            const { state, N } = getQsphereState(result);
            currentAmplitudes = state;
            currentQubits = N;
            isTransitioning = false;
            drawStateVectorHistogramWithAmplitudes(currentAmplitudes, currentQubits);
        }
    },

    animate(lerpFactor = 0.20) {
        if (isTransitioning) {
            const transition = stepStatevectorTransition(lerpFactor, 1e-4);
            drawStateVectorHistogramWithAmplitudes(transition.currentAmplitudes, transition.currentQubits);
        }
    },

    resize() {
        if (currentAmplitudes.length > 0) {
            drawStateVectorHistogramWithAmplitudes(currentAmplitudes, currentQubits);
        } else if (lastResult) {
            const { state, N } = getQsphereState(lastResult);
            drawStateVectorHistogramWithAmplitudes(state, N);
        }
    }
};

export default statevectorVisualization;

export {
    statevectorVisualization,
    initStatevectorElements,
    renderStateVectorHistogram,
    drawStateVectorHistogramWithAmplitudes,
    stepStatevectorTransition,
    getIsTransitioning,
    getCurrentAmplitudes,
    getCurrentQubits,
    formatBasisState,
    formatPhasePi,
    getQsphereState,
    getPhaseToRgb
};

if (typeof window !== 'undefined') {
    window.statevector = {
        statevectorVisualization,
        initStatevectorElements,
        renderStateVectorHistogram,
        drawStateVectorHistogramWithAmplitudes,
        stepStatevectorTransition,
        getIsTransitioning,
        getCurrentAmplitudes,
        getCurrentQubits,
        formatBasisState,
        formatPhasePi,
        getQsphereState,
        getPhaseToRgb
    };
}
