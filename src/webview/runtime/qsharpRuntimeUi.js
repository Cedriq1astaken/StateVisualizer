
(function () {
    const parseQSharp = window.parseQSharp;
    if (typeof parseQSharp !== 'function') return;

    let lastSuccessfulResult = null;
    let requestGeneration = 0;

    window.parseQSharp = async function (source, targetOp, targetLine) {
        const requestId = ++requestGeneration;
        try {
            const result = await parseQSharp(source, targetOp, targetLine);
            if (requestId !== requestGeneration) {
                return lastSuccessfulResult || result;
            }
            if (result?.error) {
                return lastSuccessfulResult || result;
            }
            lastSuccessfulResult = result;
            return result;
        } catch (error) {
            const failure = {
                qubitsDeclared: 0,
                qubitsList: [],
                states: [],
                steps: [],
                error: String(error)
            };
            if (requestId !== requestGeneration) {
                return lastSuccessfulResult || failure;
            }
            return lastSuccessfulResult || failure;
        }
    };
})();
