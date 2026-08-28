/**
 * Creates and appends a hidden hover tooltip element to a container if not already existing.
 *
 * @param {HTMLElement} container - Parent element to append tooltip to
 * @param {string} className - CSS class name for styling
 * @returns {HTMLDivElement|null}
 */
export function createHoverTooltip(container, className) {
    if (!container) return null;
    const tooltip = document.createElement('div');
    tooltip.className = className;
    tooltip.hidden = true;
    container.appendChild(tooltip);
    return tooltip;
}

/**
 * Returns an existing cached tooltip or lazily creates and appends one.
 *
 * @param {HTMLElement} container - Parent container element
 * @param {string} className - CSS class name for styling
 * @param {HTMLDivElement|null} [cachedElement=null] - Currently cached tooltip reference
 * @returns {HTMLDivElement|null}
 */
export function getOrCreateHoverTooltip(container, className, cachedElement = null) {
    if (cachedElement && cachedElement.parentElement) {
        return cachedElement;
    }
    return createHoverTooltip(container, className);
}
