import { getPhaseToRgb } from '../math/index.js';

const HORIZONTAL_TICKS = [
    { label: '0', fraction: 0 },
    { label: 'π/2', fraction: 0.25 },
    { label: 'π', fraction: 0.5 },
    { label: '3π/2', fraction: 0.75 },
    { label: '2π', fraction: 1.0 }
];

const VERTICAL_TICKS = [
    { label: '2π', fraction: 0 },
    { label: '3π/2', fraction: 0.25 },
    { label: 'π', fraction: 0.5 },
    { label: 'π/2', fraction: 0.75 },
    { label: '0', fraction: 1.0 }
];

/**
 * Draws a phase gradient bar and optional title/ticks onto a 2D Canvas context.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {Object} options
 * @param {number} [options.x=0] - X position of the bar
 * @param {number} [options.y=0] - Y position of the bar
 * @param {number} options.width - Width of the gradient bar
 * @param {number} options.height - Height of the gradient bar
 * @param {'vertical'|'horizontal'} [options.orientation='vertical']
 * @param {boolean} [options.showTitle=false]
 * @param {boolean} [options.showTicks=false]
 * @param {string} [options.title='Phase']
 * @param {string} [options.textColor='#e6e6ee']
 * @param {number} [options.titleX]
 * @param {number} [options.titleY]
 */
export function drawPhaseLegendToCanvas(ctx, options = {}) {
    const {
        x = 0,
        y = 0,
        width,
        height,
        orientation = 'vertical',
        showTitle = false,
        showTicks = false,
        title = 'Phase',
        textColor = '#e6e6ee',
        titleX,
        titleY
    } = options;

    if (!ctx || !width || !height) return;

    if (showTitle) {
        ctx.font = '600 11px system-ui, -apple-system, sans-serif';
        ctx.fillStyle = textColor;
        ctx.textAlign = 'center';
        if (orientation === 'horizontal') {
            ctx.textBaseline = 'bottom';
            ctx.fillText(title, titleX ?? (x + width / 2), titleY ?? (y - 5));
        } else {
            ctx.fillText(title, titleX ?? (x + 16), titleY ?? (y - 12));
        }
    }

    if (orientation === 'horizontal') {
        for (let px = 0; px < width; px++) {
            const t = width > 1 ? px / (width - 1) : 0;
            const phase = t * Math.PI * 2;
            const [r, g, b] = getPhaseToRgb(phase);
            ctx.fillStyle = `rgb(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)})`;
            ctx.fillRect(x + px, y, 1, height);
        }

        if (showTicks) {
            ctx.font = '600 11px system-ui, -apple-system, sans-serif';
            ctx.fillStyle = textColor;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'top';
            for (const tick of HORIZONTAL_TICKS) {
                const tickX = x + tick.fraction * width;
                ctx.fillText(tick.label, tickX, y + height + 5);
            }
        }
    } else {
        for (let py = 0; py < height; py++) {
            const t = height > 1 ? 1 - (py / (height - 1)) : 0;
            const phase = t * Math.PI * 2;
            const [r, g, b] = getPhaseToRgb(phase);
            ctx.fillStyle = `rgb(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)})`;
            ctx.fillRect(x, y + py, width, 1);
        }

        if (showTicks) {
            ctx.font = '600 11px system-ui, -apple-system, sans-serif';
            ctx.fillStyle = textColor;
            ctx.textAlign = 'start';
            for (const tick of VERTICAL_TICKS) {
                const tickY = y + tick.fraction * height + 4;
                ctx.fillText(tick.label, x + width + 6, tickY);
            }
        }
    }
}

/**
 * Generates an SVG <linearGradient> definition for the phase color spectrum.
 *
 * @param {string} gradientId
 * @param {'vertical'|'horizontal'} [orientation='horizontal']
 * @returns {string}
 */
export function generatePhaseGradientSvgDef(gradientId, orientation = 'horizontal') {
    const stops = [0, 0.25, 0.5, 0.75, 1.0];
    const isHoriz = orientation === 'horizontal';
    const x1 = '0%', y1 = isHoriz ? '0%' : '100%';
    const x2 = isHoriz ? '100%' : '0%', y2 = '0%';

    let svg = `    <linearGradient id="${gradientId}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}">\n`;
    for (const s of stops) {
        const [r, g, b] = getPhaseToRgb(s * Math.PI * 2);
        svg += `      <stop offset="${(s * 100).toFixed(0)}%" stop-color="rgb(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)})"/>\n`;
    }
    svg += `    </linearGradient>\n`;
    return svg;
}

/**
 * Generates vector SVG markup for the phase legend (title, gradient rectangle, and tick labels).
 *
 * @param {Object} options
 * @param {number} options.x
 * @param {number} options.y
 * @param {number} options.width
 * @param {number} options.height
 * @param {'vertical'|'horizontal'} [options.orientation='horizontal']
 * @param {string} options.gradientId
 * @param {string} [options.title='Phase']
 * @param {string} [options.textColor='#e6e6ee']
 * @param {number} [options.titleX]
 * @param {number} [options.titleY]
 * @param {number} [options.rx=2]
 * @returns {string}
 */
export function generatePhaseLegendSvg(options = {}) {
    const {
        x,
        y,
        width,
        height,
        orientation = 'horizontal',
        gradientId,
        title = 'Phase',
        textColor = '#e6e6ee',
        titleX,
        titleY,
        rx = 2
    } = options;

    let svg = '';

    if (orientation === 'horizontal') {
        const tX = titleX ?? (x + width / 2);
        const tY = titleY ?? (y - 10);
        svg += `  <text x="${tX}" y="${tY}" fill="${textColor}" font-size="11" font-weight="600" text-anchor="middle">${title}</text>\n`;
        svg += `  <rect x="${x}" y="${y}" width="${width}" height="${height}" rx="${rx}" fill="url(#${gradientId})"/>\n`;

        for (const tick of HORIZONTAL_TICKS) {
            const tickX = x + tick.fraction * width;
            svg += `  <text x="${tickX}" y="${y + height + 14}" fill="${textColor}" font-size="11" font-weight="600" text-anchor="middle">${tick.label}</text>\n`;
        }
    } else {
        const tX = titleX ?? (x + 16);
        const tY = titleY ?? (y - 14);
        svg += `  <text x="${tX}" y="${tY}" fill="${textColor}" font-size="11" font-weight="600" text-anchor="middle">${title}</text>\n`;
        svg += `  <rect x="${x}" y="${y}" width="${width}" height="${height}" rx="${rx}" fill="url(#${gradientId})"/>\n`;

        for (const tick of VERTICAL_TICKS) {
            const tickY = y + tick.fraction * height + 4;
            svg += `  <text x="${x + width + 8}" y="${tickY}" fill="${textColor}" font-size="11" font-weight="600" text-anchor="start">${tick.label}</text>\n`;
        }
    }

    return svg;
}
