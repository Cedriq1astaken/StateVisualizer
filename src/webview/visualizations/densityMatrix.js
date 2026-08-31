import {
    getQsphereState,
    formatBasisState,
    formatPhasePi,
    stepStatevectorTransition
} from '../math/index.js';
import { getOrCreateHoverTooltip } from '../render/hoverTooltip.js';

let densityContainer = null;
let realCanvas = null;
let imagCanvas = null;
let legendCanvas = null;
let densityStats = null;
let densityPanelsWrapper = null;
let densityHoverInfo = null;

let currentAmplitudes = [];
let targetAmplitudes = [];
let currentQubits = 0;
let targetQubits = 0;
let isTransitioning = false;
let hoveredCell = null; // { panel: 'real'|'imag', row: number, col: number }
let isInitialized = false;
let lastResult = null;

/**
 * Computes the density matrix elements rho_ij = c_i * conj(c_j)
 * @param {Array<{re: number, im: number}>} amplitudes
 * @param {number} N
 * @returns {Array<Array<{re: number, im: number, mag: number, phase: number}>>}
 */
export function computeDensityMatrix(amplitudes, N) {
    const numStates = 2 ** N;
    const matrix = [];

    for (let i = 0; i < numStates; i++) {
        const row = [];
        const ci = amplitudes[i] || { re: 0, im: 0 };
        for (let j = 0; j < numStates; j++) {
            const cj = amplitudes[j] || { re: 0, im: 0 };
            // rho_ij = c_i * c_j* = (ci.re + i ci.im) * (cj.re - i cj.im)
            const re = ci.re * cj.re + ci.im * cj.im;
            const im = ci.im * cj.re - ci.re * cj.im;
            const mag = Math.sqrt(re * re + im * im);
            const phase = Math.atan2(im, re);
            row.push({ re, im, mag, phase });
        }
        matrix.push(row);
    }
    return matrix;
}

/**
 * Maps a scalar value in [-1, 1] to a diverging Blue-White-Red RGB color.
 * -1.0 -> Blue, 0.0 -> White, +1.0 -> Red
 * @param {number} val
 * @returns {[number, number, number]} RGB values in [0, 255]
 */
export function getBwrColorRgb(val) {
    const clamped = Math.max(-1, Math.min(1, Number.isFinite(val) ? val : 0));

    if (clamped > 0) {
        // White (255, 255, 255) -> Red (235, 60, 60)
        const t = clamped;
        const r = Math.round(255 - t * (255 - 235));
        const g = Math.round(255 - t * (255 - 60));
        const b = Math.round(255 - t * (255 - 60));
        return [r, g, b];
    }

    if (clamped < 0) {
        // White (255, 255, 255) -> Blue (55, 125, 245)
        const t = -clamped;
        const r = Math.round(255 - t * (255 - 55));
        const g = Math.round(255 - t * (255 - 125));
        const b = Math.round(255 - t * (255 - 245));
        return [r, g, b];
    }

    return [255, 255, 255];
}

/**
 * Formats a scalar value to a CSS rgb string.
 * @param {number} val
 * @returns {string}
 */
export function getBwrColor(val) {
    const [r, g, b] = getBwrColorRgb(val);
    return `rgb(${r}, ${g}, ${b})`;
}

/**
 * Computes responsive layout geometry for a single heatmap panel.
 * @param {number} numStates
 * @param {number} availablePanelWidth
 */
export function computeHeatmapLayout(numStates, availablePanelWidth = 360) {
    const isRotated = numStates > 4;
    const labelMarginLeft = numStates > 8 ? 64 : (numStates > 4 ? 48 : 40);
    const labelMarginTop = isRotated ? 44 : 32;
    const titleHeight = 24;
    const paddingBottom = 16;
    const paddingRight = 16;

    const maxGridSize = Math.max(160, availablePanelWidth - labelMarginLeft - paddingRight);
    const cellSize = numStates > 0 ? Math.max(14, Math.min(64, Math.floor(maxGridSize / numStates))) : 24;
    const gridSize = cellSize * numStates;
    const totalWidth = labelMarginLeft + gridSize + paddingRight;
    const totalHeight = titleHeight + labelMarginTop + gridSize + paddingBottom;

    return {
        labelMarginLeft,
        labelMarginTop,
        titleHeight,
        paddingBottom,
        paddingRight,
        cellSize,
        gridSize,
        totalWidth,
        totalHeight,
        isRotated
    };
}

function initDensityElements(elements = {}) {
    if (typeof document === 'undefined') return;
    densityContainer = elements.container || document.getElementById('densitymatrix-container');
    realCanvas = elements.realCanvas || document.getElementById('densitymatrix-real-canvas');
    imagCanvas = elements.imagCanvas || document.getElementById('densitymatrix-imag-canvas');
    legendCanvas = elements.legendCanvas || document.getElementById('densitymatrix-legend-canvas');
    densityStats = elements.stats || document.getElementById('densitymatrix-stats');
    densityPanelsWrapper = elements.panelsWrapper || document.getElementById('densitymatrix-panels');

    if (!isInitialized && realCanvas && imagCanvas) {
        setupDensityEvents();
        isInitialized = true;
    }
}

function getDensityHoverInfo() {
    if (!densityContainer) return null;
    densityHoverInfo = getOrCreateHoverTooltip(densityContainer, 'statevector-hover-info', densityHoverInfo);
    return densityHoverInfo;
}

function handleCanvasMouseMove(canvas, panelType, event, numStates, layout) {
    if (document.body?.dataset.visualizationMode !== 'densitymatrix' || numStates === 0) return;

    const rect = canvas.getBoundingClientRect();
    const mouseX = event.clientX - rect.left;
    const mouseY = event.clientY - rect.top;

    const gridX = mouseX - layout.labelMarginLeft;
    const gridY = mouseY - (layout.titleHeight + layout.labelMarginTop);

    if (gridX >= 0 && gridX < layout.gridSize && gridY >= 0 && gridY < layout.gridSize) {
        const col = Math.floor(gridX / layout.cellSize);
        const row = Math.floor(gridY / layout.cellSize);

        if (row >= 0 && row < numStates && col >= 0 && col < numStates) {
            hoveredCell = { panel: panelType, row, col };
            const matrix = computeDensityMatrix(currentAmplitudes, currentQubits);
            const cellData = matrix[row]?.[col] || { re: 0, im: 0, mag: 0, phase: 0 };

            const hoverInfo = getDensityHoverInfo();
            if (hoverInfo && densityContainer) {
                const rowLabel = formatBasisState(row, currentQubits);
                const colLabel = formatBasisState(col, currentQubits);
                const phaseDeg = (((cellData.phase * 180 / Math.PI) % 360) + 360) % 360;

                hoverInfo.innerHTML =
                    `<strong>ρ<sub>${rowLabel},${colLabel}</sub></strong> (Row ${row}, Col ${jToStr(col)})<br>` +
                    `Real Part: ${cellData.re >= 0 ? '+' : ''}${cellData.re.toFixed(4)}<br>` +
                    `Imag Part: ${cellData.im >= 0 ? '+' : ''}${cellData.im.toFixed(4)}<br>` +
                    `Magnitude: ${cellData.mag.toFixed(4)}<br>` +
                    `Phase: ${phaseDeg.toFixed(1)}° (${formatPhasePi(cellData.phase)})`;

                const containerRect = densityContainer.getBoundingClientRect();
                const posX = event.clientX - containerRect.left + 12;
                const posY = event.clientY - containerRect.top + 12;

                hoverInfo.style.left = `${Math.min(containerRect.width - 160, Math.max(8, posX))}px`;
                hoverInfo.style.top = `${Math.min(containerRect.height - 90, Math.max(8, posY))}px`;
                hoverInfo.hidden = false;
            }
            return;
        }
    }

    hoveredCell = null;
    const hoverInfo = getDensityHoverInfo();
    if (hoverInfo) hoverInfo.hidden = true;
}

function jToStr(col) {
    return formatBasisState(col, currentQubits);
}

function setupDensityEvents() {
    if (!realCanvas || !imagCanvas) return;

    const numStates = 2 ** currentQubits;
    const panelWidth = Math.min(420, Math.max(240, ((densityPanelsWrapper?.clientWidth || 800) - 32) / 2));
    const layout = computeHeatmapLayout(numStates, panelWidth);

    realCanvas.addEventListener('mousemove', e => handleCanvasMouseMove(realCanvas, 'real', e, 2 ** currentQubits, layout));
    imagCanvas.addEventListener('mousemove', e => handleCanvasMouseMove(imagCanvas, 'imag', e, 2 ** currentQubits, layout));

    const onLeave = () => {
        hoveredCell = null;
        const hoverInfo = getDensityHoverInfo();
        if (hoverInfo) hoverInfo.hidden = true;
    };

    realCanvas.addEventListener('mouseleave', onLeave);
    imagCanvas.addEventListener('mouseleave', onLeave);
}

/**
 * Draws a single heatmap (Real or Imaginary) onto a 2D Canvas context.
 */
function drawHeatmapToContext(ctx, options) {
    const {
        matrix,
        numStates,
        N,
        isReal,
        title,
        layout,
        dpr = 1
    } = options;

    const {
        labelMarginLeft,
        labelMarginTop,
        titleHeight,
        cellSize,
        gridSize,
        totalWidth,
        totalHeight,
        isRotated
    } = layout;

    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, totalWidth, totalHeight);

    // Title header
    ctx.font = '600 13px system-ui, -apple-system, sans-serif';
    ctx.fillStyle = '#e6e6ee';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(title, totalWidth / 2, titleHeight / 2);

    if (numStates === 0 || N === 0) {
        ctx.fillStyle = 'rgba(255, 255, 255, 0.75)';
        ctx.font = 'bold 12px system-ui, -apple-system, sans-serif';
        ctx.fillText('No quantum state declared.', totalWidth / 2, totalHeight / 2);
        ctx.restore();
        return;
    }

    const startX = labelMarginLeft;
    const startY = titleHeight + labelMarginTop;

    // Draw Column labels (top)
    ctx.font = 'bold 11px system-ui, -apple-system, sans-serif';
    ctx.fillStyle = '#e0e0e0';

    for (let j = 0; j < numStates; j++) {
        const colText = formatBasisState(j, N);
        const colCenterX = startX + j * cellSize + cellSize / 2;

        if (isRotated) {
            ctx.save();
            ctx.translate(colCenterX, startY - 8);
            ctx.rotate(-Math.PI / 4);
            ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';
            ctx.fillText(colText, 0, 0);
            ctx.restore();
        } else {
            ctx.textAlign = 'center';
            ctx.textBaseline = 'bottom';
            ctx.fillText(colText, colCenterX, startY - 6);
        }
    }

    // Draw Row labels (left) and Heatmap Cells
    for (let i = 0; i < numStates; i++) {
        const rowText = formatBasisState(i, N);
        const rowCenterY = startY + i * cellSize + cellSize / 2;

        ctx.font = 'bold 11px system-ui, -apple-system, sans-serif';
        ctx.fillStyle = '#e0e0e0';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        ctx.fillText(rowText, startX - 8, rowCenterY);

        for (let j = 0; j < numStates; j++) {
            const cell = matrix[i]?.[j] || { re: 0, im: 0, mag: 0, phase: 0 };
            const val = isReal ? cell.re : cell.im;

            const x = startX + j * cellSize;
            const y = startY + i * cellSize;

            // Cell fill
            ctx.fillStyle = getBwrColor(val);
            ctx.fillRect(x, y, cellSize, cellSize);

            // Cell border
            ctx.strokeStyle = 'rgba(0, 0, 0, 0.25)';
            ctx.lineWidth = 1;
            ctx.strokeRect(x, y, cellSize, cellSize);
        }
    }

    // Outer grid border
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(startX, startY, gridSize, gridSize);

    ctx.restore();
}

/**
 * Draws the horizontal -1 to +1 diverging Blue-White-Red color bar.
 */
export function drawBwrLegendToCanvas(ctx, options = {}) {
    const {
        x = 0,
        y = 0,
        width = 220,
        height = 10,
        title = 'Matrix Element Value',
        textColor = '#e6e6ee',
        showTitle = true,
        showTicks = true
    } = options;

    if (!ctx || !width || !height) return;

    if (showTitle) {
        ctx.font = '600 11px system-ui, -apple-system, sans-serif';
        ctx.fillStyle = textColor;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.fillText(title, x + width / 2, y - 5);
    }

    // Draw continuous Blue-White-Red color gradient
    for (let px = 0; px < width; px++) {
        const fraction = width > 1 ? px / (width - 1) : 0; // 0 to 1
        const val = fraction * 2 - 1; // -1 to +1
        ctx.fillStyle = getBwrColor(val);
        ctx.fillRect(x + px, y, 1, height);
    }

    // Border around color bar
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x, y, width, height);

    if (showTicks) {
        const ticks = [
            { label: '-1.0', frac: 0 },
            { label: '-0.5', frac: 0.25 },
            { label: '0.0', frac: 0.5 },
            { label: '+0.5', frac: 0.75 },
            { label: '+1.0', frac: 1.0 }
        ];

        ctx.font = '600 11px system-ui, -apple-system, sans-serif';
        ctx.fillStyle = textColor;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';

        for (const tick of ticks) {
            const tickX = x + tick.frac * width;
            ctx.fillText(tick.label, tickX, y + height + 5);
        }
    }
}

function drawDensityMatrixWithAmplitudes(amplitudes, N) {
    initDensityElements();
    if (!realCanvas || !imagCanvas) return;

    const realCtx = realCanvas.getContext('2d');
    const imagCtx = imagCanvas.getContext('2d');
    if (!realCtx || !imagCtx) return;

    const numStates = 2 ** N;
    const matrix = computeDensityMatrix(amplitudes, N);

    if (densityStats) {
        let nonZeroCount = 0;
        for (let i = 0; i < numStates; i++) {
            for (let j = 0; j < numStates; j++) {
                if (matrix[i][j].mag > 1e-4) nonZeroCount++;
            }
        }
        densityStats.textContent = N > 0
            ? `${N} Qubit${N > 1 ? 's' : ''} • ${numStates}×${numStates} Matrix • ${nonZeroCount} Non-Zero Elements`
            : '';
    }

    const dpr = window.devicePixelRatio || 1;
    const wrapperWidth = densityPanelsWrapper?.clientWidth || 800;
    const availablePanelWidth = Math.min(420, Math.max(240, (wrapperWidth - 32) / 2));
    const layout = computeHeatmapLayout(numStates, availablePanelWidth);

    // Resize Real Canvas
    if (realCanvas.width !== Math.floor(layout.totalWidth * dpr) || realCanvas.height !== Math.floor(layout.totalHeight * dpr)) {
        realCanvas.width = Math.floor(layout.totalWidth * dpr);
        realCanvas.height = Math.floor(layout.totalHeight * dpr);
        realCanvas.style.width = `${layout.totalWidth}px`;
        realCanvas.style.height = `${layout.totalHeight}px`;
    }

    // Resize Imaginary Canvas
    if (imagCanvas.width !== Math.floor(layout.totalWidth * dpr) || imagCanvas.height !== Math.floor(layout.totalHeight * dpr)) {
        imagCanvas.width = Math.floor(layout.totalWidth * dpr);
        imagCanvas.height = Math.floor(layout.totalHeight * dpr);
        imagCanvas.style.width = `${layout.totalWidth}px`;
        imagCanvas.style.height = `${layout.totalHeight}px`;
    }

    // Draw Real Heatmap
    drawHeatmapToContext(realCtx, {
        matrix,
        numStates,
        N,
        isReal: true,
        title: 'Real Part (Re[ρ])',
        layout,
        dpr
    });

    // Draw Imaginary Heatmap
    drawHeatmapToContext(imagCtx, {
        matrix,
        numStates,
        N,
        isReal: false,
        title: 'Imaginary Part (Im[ρ])',
        layout,
        dpr
    });

    // Draw Color Bar Legend
    if (legendCanvas) {
        const legCtx = legendCanvas.getContext('2d');
        if (legCtx) {
            legCtx.clearRect(0, 0, legendCanvas.width, legendCanvas.height);
            drawBwrLegendToCanvas(legCtx, {
                x: 0,
                y: 0,
                width: legendCanvas.width,
                height: legendCanvas.height,
                showTitle: false,
                showTicks: false
            });
        }
    }
}

function generateDensityMatrixPng() {
    if (typeof document === 'undefined') return '';

    let amplitudes = currentAmplitudes;
    let N = currentQubits;

    if (amplitudes.length === 0 && lastResult) {
        const stateObj = getQsphereState(lastResult);
        amplitudes = stateObj.state;
        N = stateObj.N;
    }
    const numStates = 2 ** N;
    const matrix = computeDensityMatrix(amplitudes, N);

    const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
    const panelWidth = 360;
    const layout = computeHeatmapLayout(numStates, panelWidth);

    const gap = 24;
    const padding = 16;
    const legendH = 50;
    const totalW = padding * 2 + layout.totalWidth * 2 + gap;
    const totalH = padding * 2 + layout.totalHeight + legendH;

    const offscreen = document.createElement('canvas');
    offscreen.width = Math.floor(totalW * dpr);
    offscreen.height = Math.floor(totalH * dpr);
    const ctx = offscreen.getContext('2d');
    if (!ctx) return '';

    ctx.save();
    ctx.scale(dpr, dpr);

    // Draw Real Heatmap on left
    ctx.save();
    ctx.translate(padding, padding);
    drawHeatmapToContext(ctx, {
        matrix,
        numStates,
        N,
        isReal: true,
        title: 'Real Part (Re[ρ])',
        layout,
        dpr: 1
    });
    ctx.restore();

    // Draw Imaginary Heatmap on right
    ctx.save();
    ctx.translate(padding + layout.totalWidth + gap, padding);
    drawHeatmapToContext(ctx, {
        matrix,
        numStates,
        N,
        isReal: false,
        title: 'Imaginary Part (Im[ρ])',
        layout,
        dpr: 1
    });
    ctx.restore();

    // Draw Centered Legend at bottom
    const legW = 240;
    const legH = 10;
    const legX = (totalW - legW) / 2;
    const legY = padding + layout.totalHeight + 18;

    drawBwrLegendToCanvas(ctx, {
        x: legX,
        y: legY,
        width: legW,
        height: legH,
        title: 'Matrix Element Value',
        textColor: '#e6e6ee',
        showTitle: true,
        showTicks: true
    });

    ctx.restore();
    return offscreen.toDataURL('image/png');
}

const densityMatrixVisualization = {
    id: 'densitymatrix',
    label: 'Density Matrix',

    mount(container) {
        initDensityElements();
        const densityContainerEl = document.getElementById('densitymatrix-container');
        if (densityContainerEl) {
            densityContainerEl.hidden = false;
            densityContainerEl.style.display = 'flex';
        }
        if (currentAmplitudes.length > 0) {
            drawDensityMatrixWithAmplitudes(currentAmplitudes, currentQubits);
        } else if (lastResult) {
            const { state, N } = getQsphereState(lastResult);
            drawDensityMatrixWithAmplitudes(state, N);
        }
    },

    unmount() {
        const densityContainerEl = document.getElementById('densitymatrix-container');
        if (densityContainerEl) {
            densityContainerEl.hidden = true;
            densityContainerEl.style.display = 'none';
        }
        const hoverInfo = getDensityHoverInfo();
        if (hoverInfo) hoverInfo.hidden = true;
    },

    update(result) {
        if (!result) return;
        lastResult = result;
        initDensityElements();

        const { state, N } = getQsphereState(result);

        targetAmplitudes = state;
        targetQubits = N;

        if (currentQubits !== N || currentAmplitudes.length !== state.length) {
            currentQubits = N;
            currentAmplitudes = Array.from({ length: state.length }, () => ({ re: 0, im: 0 }));
        }

        isTransitioning = true;
    },

    animate(lerpFactor = 0.20) {
        if (isTransitioning) {
            const transition = stepStatevectorTransition(currentAmplitudes, targetAmplitudes, lerpFactor, 1e-4);
            isTransitioning = transition.isTransitioning;
            currentAmplitudes = transition.currentAmplitudes;
            drawDensityMatrixWithAmplitudes(currentAmplitudes, currentQubits);
        }
    },

    resize() {
        if (currentAmplitudes.length > 0) {
            drawDensityMatrixWithAmplitudes(currentAmplitudes, currentQubits);
        } else if (lastResult) {
            const { state, N } = getQsphereState(lastResult);
            drawDensityMatrixWithAmplitudes(state, N);
        }
    },

    async export() {
        const pngDataUrl = generateDensityMatrixPng();
        return {
            filenamePrefix: 'densitymatrix',
            pngDataUrl
        };
    }
};

export default densityMatrixVisualization;

export {
    densityMatrixVisualization,
    initDensityElements,
    drawDensityMatrixWithAmplitudes,
    generateDensityMatrixPng
};
