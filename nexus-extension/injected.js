/**
 * NEXUS Scanner Pro - Injected Scanner Loader
 * This file is loaded via chrome-extension:// URL which BYPASSES ALL CSP
 * The actual scanner code is dynamically injected by background.js
 */

(function () {
    'use strict';

    // Prevent double initialization
    if (window.__NEXUS_INJECTED_LOADER__) return;
    window.__NEXUS_INJECTED_LOADER__ = true;

    console.log('%c[NEXUS] CSP Bypass Loader Active (chrome-extension:// method)',
        'color: #22c55e; font-weight: bold; font-size: 12px');

    // Set extension markers
    window.__NEXUS_EXTENSION_AVAILABLE__ = true;
    window.__NEXUS_EXTENSION_VERSION__ = '5.0';
    window.__NEXUS_EXTENSION_MODE__ = true;
    window.__NEXUS_CSP_BYPASS__ = 'extension-url';

    // Listen for the actual scanner code from background.js
    window.addEventListener('message', function (event) {
        if (event.source !== window) return;

        const data = event.data;
        if (!data || data.type !== 'NEXUS_INJECT_SCANNER_CODE') return;

        console.log('[NEXUS] Received scanner code, executing...');

        try {
            // Execute the scanner code
            const fn = new Function(data.code);
            fn();

            // Notify success
            window.postMessage({
                type: 'NEXUS_SCANNER_INJECTED',
                success: true,
                method: 'extension-url-loader'
            }, '*');

        } catch (e) {
            console.error('[NEXUS] Scanner execution failed:', e);
            window.postMessage({
                type: 'NEXUS_SCANNER_INJECTED',
                success: false,
                error: e.message
            }, '*');
        }
    });

    // Signal that loader is ready for scanner code
    window.postMessage({ type: 'NEXUS_LOADER_READY' }, '*');

    console.log('[NEXUS] Loader ready - waiting for scanner code');
})();
