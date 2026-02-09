/**
 * NEXUS Scanner Pro v3.0.2 - Content Script
 * CSP-SAFE: Uses postMessage communication only, no inline scripts
 */

(function () {
    'use strict';

    // Prevent double injection
    if (window.__NEXUS_CONTENT_LOADED__) return;
    window.__NEXUS_CONTENT_LOADED__ = true;

    console.log('[NEXUS Content] Script loaded');

    // State
    let scannerInjected = false;
    let scanResults = { findings: 0, apiKeys: 0, tokens: 0 };
    let pendingCallbacks = new Map();
    let callbackId = 0;

    // ══════════════════════════════════════════════════════════════════════════════
    // CSP-SAFE MESSAGE COMMUNICATION
    // All communication with page uses postMessage - NO INLINE SCRIPTS
    // ══════════════════════════════════════════════════════════════════════════════

    // Send command to page and wait for response
    function sendToPage(command, args = {}) {
        return new Promise((resolve) => {
            const id = ++callbackId;

            // Set timeout based on command type
            let timeoutMs = 10000; // Default 10s
            if (command === 'connectTerminal') timeoutMs = 30000;
            else if (command === 'ping') timeoutMs = 3000; // Shorter for ping

            const timeout = setTimeout(() => {
                pendingCallbacks.delete(id);
                // Don't log ping timeouts (expected when scanner not injected)
                if (command !== 'ping') {
                    console.log('[NEXUS Content] Command timeout:', command);
                }
                resolve({ success: false, error: 'Timeout' });
            }, timeoutMs);

            pendingCallbacks.set(id, (response) => {
                clearTimeout(timeout);
                pendingCallbacks.delete(id);
                resolve(response);
            });

            window.postMessage({
                type: 'NEXUS_COMMAND',
                id: id,
                command: command,
                args: args
            }, '*');
        });
    }

    // Listen for responses from page
    window.addEventListener('message', (event) => {
        if (event.source !== window) return;

        const data = event.data;
        if (!data) return;

        // Handle command responses from page
        if (data.type === 'NEXUS_RESPONSE' && data.id) {
            const callback = pendingCallbacks.get(data.id);
            if (callback) {
                callback(data);
            }
            return;
        }

        // ==================== Terminal Bridge Requests from Page ====================
        if (data.nexusExtension === true) {
            console.log('[NEXUS Content] Extension request from page:', data.action);

            // Helper function to safely send messages (handles context invalidation)
            const safeSendMessage = (message, callback) => {
                try {
                    if (!chrome.runtime?.id) {
                        console.warn('[NEXUS Content] Extension context invalidated - reload page');
                        window.postMessage({
                            nexusResponse: true,
                            success: false,
                            error: 'Extension reloaded - please refresh this page'
                        }, '*');
                        return;
                    }
                    chrome.runtime.sendMessage(message, (response) => {
                        if (chrome.runtime.lastError) {
                            console.warn('[NEXUS Content] Runtime error:', chrome.runtime.lastError.message);
                            window.postMessage({
                                nexusResponse: true,
                                success: false,
                                error: chrome.runtime.lastError.message
                            }, '*');
                            return;
                        }
                        if (callback) callback(response);
                    });
                } catch (e) {
                    console.error('[NEXUS Content] Send message error:', e.message);
                    window.postMessage({
                        nexusResponse: true,
                        success: false,
                        error: 'Extension connection lost - refresh page'
                    }, '*');
                }
            };

            switch (data.action) {
                case 'connect':
                    safeSendMessage({
                        type: 'CONNECT_TERMINAL',
                        url: data.serverUrl,
                        token: data.token
                    }, (response) => {
                        window.postMessage({
                            nexusResponse: true,
                            success: response?.success || false,
                            error: response?.error || null
                        }, '*');
                    });
                    break;

                case 'disconnect':
                    safeSendMessage({ type: 'DISCONNECT_TERMINAL' }, () => {
                        window.postMessage({ nexusResponse: true, success: true }, '*');
                    });
                    break;

                case 'send':
                    safeSendMessage({
                        type: 'RELAY_TO_TERMINAL',
                        data: data.payload
                    }, (response) => {
                        // Optional success callback
                        if (response?.success) {
                            console.log('[NEXUS Content] Message relayed to terminal');
                        }
                    });
                    break;

                case 'getStatus':
                    safeSendMessage({ type: 'GET_WS_STATUS' }, (response) => {
                        window.postMessage({
                            nexusResponse: true,
                            type: 'status',
                            connected: response?.connected || false,
                            url: response?.url || null
                        }, '*');
                    });
                    break;

                // AI API Proxy - bypass CSP restrictions
                case 'aiCall':
                    safeSendMessage({
                        type: 'AI_API_CALL',
                        url: data.url,
                        options: data.options
                    }, (response) => {
                        window.postMessage({
                            nexusResponse: true,
                            type: 'aiResponse',
                            requestId: data.requestId,
                            success: response?.success || false,
                            data: response?.data,
                            error: response?.error
                        }, '*');
                    });
                    break;

                case 'aiValidate':
                    safeSendMessage({
                        type: 'AI_VALIDATE_KEY',
                        provider: data.provider,
                        apiKey: data.apiKey
                    }, (response) => {
                        window.postMessage({
                            nexusResponse: true,
                            type: 'aiValidation',
                            requestId: data.requestId,
                            valid: response?.valid || false,
                            provider: response?.provider,
                            models: response?.models,
                            error: response?.error
                        }, '*');
                    });
                    break;
            }
            return;
        }

        // Scanner ready signal
        if (data.type === 'NEXUS_SCANNER_READY') {
            scannerInjected = true;
            console.log('[NEXUS Content] Scanner detected as ready');
        }

        // Scan results update
        if (data.type === 'NEXUS_SCAN_RESULTS') {
            scanResults = data.stats || scanResults;
        }

        // Messages from injected scanner to extension
        if (data.type === 'NEXUS_TO_EXTENSION') {
            chrome.runtime.sendMessage(data.payload);
        }
    });

    console.log('[NEXUS Content] Message listener ready');

    // ==================== Set Extension Marker via postMessage ====================
    function setExtensionMarker() {
        const marker = () => {
            window.postMessage({
                type: 'NEXUS_EXTENSION_INIT',
                version: '3.0.2'
            }, '*');
        };
        marker();
        setTimeout(marker, 100);
        setTimeout(marker, 500);
        setTimeout(marker, 1000);
    }

    setExtensionMarker();
    console.log('[NEXUS Content] Extension marker sent');

    // ==================== Message Handlers from Popup ====================
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
        switch (msg.type) {
            case 'CHECK_STATUS':
                sendResponse({ injected: scannerInjected });
                break;

            case 'EXECUTE_COMMAND':
                executeCommand(msg.command, msg.args || {}, sendResponse);
                return true;

            case 'EXECUTE_SCAN':
                executeScan(msg.scanType, sendResponse);
                return true;

            case 'ASK_AI':
                askAI(msg.question, sendResponse);
                return true;

            case 'ANALYZE_STORAGE':
                analyzeStorage(sendResponse);
                return true;

            case 'ANALYZE_COOKIES':
                analyzeCookies(sendResponse);
                return true;

            case 'EXPORT_JSON':
                exportData('json', sendResponse);
                return true;

            case 'EXPORT_REPORT':
                exportData('html', sendResponse);
                return true;

            case 'EXPORT_DATA':
                exportData(msg.format || 'json', sendResponse);
                return true;

            case 'TERMINAL_MESSAGE':
                relayTerminalMessage(msg.data);
                sendResponse({ success: true });
                break;

            case 'TERMINAL_CONNECTED':
                updateTerminalStatus(true, msg.url);
                sendResponse({ success: true });
                break;

            case 'CONNECT_TERMINAL_VIA_PAGE':
                connectTerminalViaPage(msg.url, msg.token, sendResponse);
                return true;

            case 'DISCONNECT_TERMINAL_VIA_PAGE':
                disconnectTerminalViaPage(sendResponse);
                return true;

            case 'TERMINAL_EXECUTE':
                terminalExecute(msg.command, sendResponse);
                return true;

            case 'GET_SCAN_STATS':
                getStats(sendResponse);
                return true;
        }
        return false;
    });

    // ==================== CSP-SAFE Scanner Functions ====================

    // Generic command executor for all scanner commands
    async function executeCommand(command, args, sendResponse) {
        console.log('[NEXUS Content] executeCommand:', command, args);

        const response = await sendToPage(command, args);

        if (response.success && response.stats) {
            scanResults = response.stats;
        }

        sendResponse({
            success: response.success,
            stats: response.stats || scanResults,
            data: response.data,
            response: response.response,
            error: response.error
        });
    }

    async function executeScan(scanType, sendResponse) {
        console.log('[NEXUS Content] executeScan:', scanType);

        // Try regular scanner first (injected via page script)
        const response = await sendToPage('scan', { type: scanType });

        if (response.success) {
            scanResults = response.stats || scanResults;
            sendResponse({
                success: response.success,
                stats: response.stats || scanResults,
                error: response.error
            });
            return;
        }

        // Fallback: Use DOM Scanner (runs in content script context, bypasses ALL CSP)
        console.log('[NEXUS Content] Regular scanner failed/timeout, using DOM Scanner fallback');

        try {
            // Check if DOM scanner is available
            if (window.__NEXUS_DOM_SCANNER_INSTANCE__) {
                const domResult = await window.__NEXUS_DOM_SCANNER_INSTANCE__.scan(scanType);
                const findings = window.__NEXUS_DOM_SCANNER_INSTANCE__.getFindings();

                scannerInjected = true; // Mark as injected via DOM scanner
                scanResults = findings.stats || scanResults;

                console.log('[NEXUS Content] DOM Scanner complete:', findings.stats);

                sendResponse({
                    success: true,
                    stats: findings.stats,
                    data: findings,
                    method: 'dom-scanner',
                    cspBypassed: true
                });
                return;
            }
        } catch (e) {
            console.error('[NEXUS Content] DOM Scanner error:', e);
        }

        // Both methods failed
        sendResponse({
            success: false,
            stats: scanResults,
            error: 'Both regular scanner and DOM scanner failed. Try refreshing the page.',
            needsManualAction: true
        });
    }

    async function askAI(question, sendResponse) {
        console.log('[NEXUS Content] askAI:', question);

        const response = await sendToPage('askAI', { question: question });
        sendResponse(response);
    }

    async function analyzeStorage(sendResponse) {
        const response = await sendToPage('analyzeStorage', {});
        sendResponse(response);
    }

    async function analyzeCookies(sendResponse) {
        const response = await sendToPage('analyzeCookies', {});
        sendResponse(response);
    }

    async function exportData(format, sendResponse) {
        const response = await sendToPage('export', { format: format });
        sendResponse(response);
    }

    async function getStats(sendResponse) {
        const response = await sendToPage('getStats', {});
        sendResponse(response);
    }

    async function connectTerminalViaPage(url, token, sendResponse) {
        console.log('[NEXUS Content] Connecting terminal via page:', url);

        const response = await sendToPage('connectTerminal', { url: url, token: token });
        sendResponse(response);
    }

    async function disconnectTerminalViaPage(sendResponse) {
        const response = await sendToPage('disconnectTerminal', {});
        sendResponse(response);
    }

    async function terminalExecute(command, sendResponse) {
        console.log('[NEXUS Content] terminalExecute:', command);
        const response = await sendToPage('terminalRun', { command: command });
        sendResponse(response);
    }

    function updateTerminalStatus(connected, url) {
        window.postMessage({
            type: 'NEXUS_TERMINAL_STATUS',
            connected: connected,
            url: url
        }, '*');
    }

    function relayTerminalMessage(data) {
        window.postMessage({
            type: 'NEXUS_FROM_TERMINAL',
            data: data
        }, '*');
    }

    // ==================== Auto-Detection ====================
    setTimeout(() => {
        sendToPage('ping', {}).then(response => {
            if (response.success) {
                scannerInjected = true;
                console.log('[NEXUS Content] Scanner detected');
            }
        });
    }, 1000);

    console.log('[NEXUS Content] Initialization complete (CSP-SAFE mode)');
})();
