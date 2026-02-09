/**
 * NEXUS Scanner Pro v3.0 - Content Script
 * Runs in page context for communication with injected scanner
 */

(function() {
    'use strict';
    
    // Prevent double injection
    if (window.__NEXUS_CONTENT_LOADED__) return;
    window.__NEXUS_CONTENT_LOADED__ = true;
    
    console.log('[NEXUS Content] Script loaded');
    
    // State
    let scannerInjected = false;
    let scanResults = { findings: 0, apiKeys: 0, tokens: 0 };
    
    // ==================== Extension Marker ====================
    // Set marker for page scripts to detect extension
    function setExtensionMarker() {
        const script = document.createElement('script');
        script.textContent = `
            window.__NEXUS_EXTENSION_AVAILABLE__ = true;
            window.__NEXUS_EXTENSION_VERSION__ = '3.0';
            window.__NEXUS_RELAY_TO_EXTENSION__ = function(data) {
                window.postMessage({ type: 'NEXUS_TO_EXTENSION', payload: data }, '*');
            };
        `;
        (document.head || document.documentElement).appendChild(script);
        script.remove();
    }
    
    // Set marker immediately
    setExtensionMarker();
    
    // ==================== Message Handlers ====================
    // Listen for messages from popup
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
        switch(msg.type) {
            case 'CHECK_STATUS':
                sendResponse({ injected: scannerInjected });
                break;
                
            case 'EXECUTE_SCAN':
                executeScan(msg.scanType, sendResponse);
                return true; // Async
                
            case 'ASK_AI':
                askAI(msg.question, sendResponse);
                return true;
                
            case 'ANALYZE_STORAGE':
                analyzeStorage(sendResponse);
                break;
                
            case 'ANALYZE_COOKIES':
                analyzeCookies(sendResponse);
                break;
                
            case 'EXPORT_JSON':
                exportJSON(sendResponse);
                break;
                
            case 'EXPORT_REPORT':
                exportReport(sendResponse);
                break;
                
            case 'TERMINAL_MESSAGE':
                relayTerminalMessage(msg.data);
                break;
            
            // ==================== Terminal Connection via Page ====================
            case 'CONNECT_TERMINAL_VIA_PAGE':
                connectTerminalViaPage(msg.url, msg.token, sendResponse);
                return true; // Async
                
            case 'DISCONNECT_TERMINAL_VIA_PAGE':
                disconnectTerminalViaPage(sendResponse);
                return true;
                
            case 'TERMINAL_CONNECTED':
                // Inform page that terminal connected directly (fallback mode)
                notifyPageTerminalConnected(msg.url);
                sendResponse({ success: true });
                break;
        }
        return true;
    });
    
    // ==================== Terminal Connection Functions ====================
    function connectTerminalViaPage(url, token, sendResponse) {
        const script = document.createElement('script');
        script.textContent = `
            (function() {
                const url = ${JSON.stringify(url)};
                const token = ${JSON.stringify(token)};
                
                // Use connectTerminal if available
                if (typeof window.connectTerminal === 'function') {
                    console.log('[NEXUS] Connecting terminal via page...');
                    window.connectTerminal(url, token).then(() => {
                        window.postMessage({ type: 'NEXUS_TERMINAL_CONNECT_RESULT', success: true }, '*');
                    }).catch(err => {
                        window.postMessage({ type: 'NEXUS_TERMINAL_CONNECT_RESULT', success: false, error: err.message }, '*');
                    });
                } else if (window.TerminalBridge && window.TerminalBridge.connect) {
                    window.TerminalBridge.connect(url, token).then(() => {
                        window.postMessage({ type: 'NEXUS_TERMINAL_CONNECT_RESULT', success: true }, '*');
                    }).catch(err => {
                        window.postMessage({ type: 'NEXUS_TERMINAL_CONNECT_RESULT', success: false, error: err.message }, '*');
                    });
                } else {
                    window.postMessage({ type: 'NEXUS_TERMINAL_CONNECT_RESULT', success: false, error: 'TerminalBridge not available' }, '*');
                }
            })();
        `;
        (document.head || document.documentElement).appendChild(script);
        script.remove();
        
        // Wait for response from page
        const handler = (event) => {
            if (event.data?.type === 'NEXUS_TERMINAL_CONNECT_RESULT') {
                window.removeEventListener('message', handler);
                sendResponse(event.data);
            }
        };
        window.addEventListener('message', handler);
        
        // Timeout
        setTimeout(() => {
            window.removeEventListener('message', handler);
            sendResponse({ success: false, error: 'Connection timeout' });
        }, 15000);
    }
    
    function disconnectTerminalViaPage(sendResponse) {
        const script = document.createElement('script');
        script.textContent = `
            (function() {
                if (typeof window.disconnectTerminal === 'function') {
                    window.disconnectTerminal();
                } else if (window.TerminalBridge && window.TerminalBridge.disconnect) {
                    window.TerminalBridge.disconnect();
                }
                window.postMessage({ type: 'NEXUS_TERMINAL_DISCONNECT_RESULT', success: true }, '*');
            })();
        `;
        (document.head || document.documentElement).appendChild(script);
        script.remove();
        
        setTimeout(() => sendResponse({ success: true }), 100);
    }
    
    function notifyPageTerminalConnected(url) {
        // Update page's TerminalBridge state for direct connection mode
        const script = document.createElement('script');
        script.textContent = `
            (function() {
                if (window.TerminalBridge) {
                    window.TerminalBridge.connected = true;
                    window.TerminalBridge.authenticated = true;
                    window.TerminalBridge.useExtension = true;
                    window.TerminalBridge.serverUrl = ${JSON.stringify(url)};
                    console.log('[NEXUS] TerminalBridge updated: Extension mode active');
                }
            })();
        `;
        (document.head || document.documentElement).appendChild(script);
        script.remove();
    }
    
    // Listen for messages from page (injected script)
    window.addEventListener('message', (event) => {
        if (event.source !== window) return;
        
        const data = event.data;
        if (!data) return;
        
        // ==================== Terminal Bridge Requests from Page ====================
        // Handle connection requests from all_phases.js TerminalBridge
        if (data.nexusExtension === true) {
            console.log('[NEXUS Content] Extension request from page:', data.action);
            
            switch(data.action) {
                case 'connect':
                    // Forward to background for WebSocket connection
                    chrome.runtime.sendMessage({
                        type: 'CONNECT_TERMINAL',
                        url: data.serverUrl,
                        token: data.token
                    }, (response) => {
                        // Send response back to page
                        window.postMessage({
                            nexusResponse: true,
                            success: response?.success || false,
                            error: response?.error || null
                        }, '*');
                    });
                    break;
                    
                case 'disconnect':
                    chrome.runtime.sendMessage({ type: 'DISCONNECT_TERMINAL' }, (response) => {
                        window.postMessage({ nexusResponse: true, success: true }, '*');
                    });
                    break;
                    
                case 'send':
                    chrome.runtime.sendMessage({
                        type: 'RELAY_TO_TERMINAL',
                        data: data.payload
                    }, (response) => {
                        if (response?.success === false) {
                            console.warn('[NEXUS Content] Send failed:', response.error);
                        }
                    });
                    break;
                    
                case 'getStatus':
                    chrome.runtime.sendMessage({ type: 'GET_WS_STATUS' }, (response) => {
                        window.postMessage({
                            nexusResponse: true,
                            type: 'status',
                            connected: response?.connected || false,
                            url: response?.url || null
                        }, '*');
                    });
                    break;
            }
            return;
        }
        
        // Messages from injected scanner
        if (data.type === 'NEXUS_TO_EXTENSION') {
            chrome.runtime.sendMessage(data.payload);
        }
        
        // Scanner status update
        if (data.type === 'NEXUS_SCANNER_READY') {
            scannerInjected = true;
            console.log('[NEXUS Content] Scanner detected as ready');
        }
        
        // Scan results
        if (data.type === 'NEXUS_SCAN_RESULTS') {
            scanResults = data.stats || scanResults;
        }
    });
    
    // ==================== Scanner Functions ====================
    function executeScan(scanType, sendResponse) {
        // Send command to injected scanner
        const script = document.createElement('script');
        script.textContent = `
            (function() {
                if (typeof window.Scanner !== 'undefined') {
                    if ('${scanType}' === 'quick') {
                        window.Scanner.quickScan && window.Scanner.quickScan();
                    } else {
                        window.Scanner.deepScan && window.Scanner.deepScan();
                    }
                    window.postMessage({ type: 'NEXUS_SCAN_RESULTS', stats: window.Scanner.getStats ? window.Scanner.getStats() : {} }, '*');
                } else if (typeof window.runPhase !== 'undefined') {
                    // Legacy scanner
                    window.runPhase(1);
                } else {
                    console.warn('[NEXUS] Scanner not found');
                }
            })();
        `;
        (document.head || document.documentElement).appendChild(script);
        script.remove();
        
        // Return success after brief delay
        setTimeout(() => {
            sendResponse({ success: true, stats: scanResults });
        }, 500);
    }
    
    function askAI(question, sendResponse) {
        // Use Scanner API if available, otherwise try TerminalBridge directly
        const script = document.createElement('script');
        script.textContent = `
            (function() {
                const q = ${JSON.stringify(question)};
                
                // Try Scanner.askAI first (newer API)
                if (window.Scanner && window.Scanner.askAI) {
                    window.Scanner.askAI(q).then(result => {
                        window.postMessage({ 
                            type: 'NEXUS_AI_RESPONSE', 
                            answer: result.response || result.answer || result,
                            success: result.success !== false
                        }, '*');
                    }).catch(err => {
                        window.postMessage({ type: 'NEXUS_AI_RESPONSE', error: err.message }, '*');
                    });
                }
                // Fallback to TerminalBridge.askAI
                else if (window.TerminalBridge && window.TerminalBridge.askAI) {
                    window.TerminalBridge.askAI(q).then(answer => {
                        window.postMessage({ type: 'NEXUS_AI_RESPONSE', answer: answer }, '*');
                    }).catch(err => {
                        window.postMessage({ type: 'NEXUS_AI_RESPONSE', error: err.message }, '*');
                    });
                } else {
                    window.postMessage({ type: 'NEXUS_AI_RESPONSE', error: 'AI not available - Connect terminal first' }, '*');
                }
            })();
        `;
        (document.head || document.documentElement).appendChild(script);
        script.remove();
        
        // Wait for response
        const handler = (event) => {
            if (event.data?.type === 'NEXUS_AI_RESPONSE') {
                window.removeEventListener('message', handler);
                sendResponse(event.data);
            }
        };
        window.addEventListener('message', handler);
        
        // Timeout
        setTimeout(() => {
            window.removeEventListener('message', handler);
            sendResponse({ error: 'Timeout' });
        }, 30000);
    }
    
    function analyzeStorage(sendResponse) {
        try {
            const data = {};
            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                data[key] = localStorage.getItem(key);
            }
            sendResponse({ data: data });
        } catch (e) {
            sendResponse({ error: e.message });
        }
    }
    
    function analyzeCookies(sendResponse) {
        try {
            const cookies = document.cookie.split(';');
            sendResponse({ count: cookies.length, cookies: cookies });
        } catch (e) {
            sendResponse({ error: e.message });
        }
    }
    
    function exportJSON(sendResponse) {
        const script = document.createElement('script');
        script.textContent = `
            (function() {
                if (window.Scanner && window.Scanner.export) {
                    window.Scanner.export('json');
                } else if (window.exportResults) {
                    window.exportResults('json');
                }
            })();
        `;
        (document.head || document.documentElement).appendChild(script);
        script.remove();
        sendResponse({ success: true });
    }
    
    function exportReport(sendResponse) {
        const script = document.createElement('script');
        script.textContent = `
            (function() {
                if (window.Scanner && window.Scanner.export) {
                    window.Scanner.export('html');
                } else if (window.exportResults) {
                    window.exportResults('html');
                }
            })();
        `;
        (document.head || document.documentElement).appendChild(script);
        script.remove();
        sendResponse({ success: true });
    }
    
    function relayTerminalMessage(data) {
        // Send to page via postMessage (for general listeners)
        window.postMessage({ 
            type: 'NEXUS_FROM_TERMINAL', 
            data: data 
        }, '*');
        
        // Also dispatch as CustomEvent for all_phases.js TerminalBridge
        // Need to inject script because CustomEvents don't cross content script boundary
        const eventData = JSON.stringify(data);
        const script = document.createElement('script');
        script.textContent = `
            (function() {
                try {
                    const data = ${eventData};
                    // Dispatch appropriate event based on message type
                    if (data.type === 'ai_response') {
                        window.dispatchEvent(new CustomEvent('nexus_ai_response', { detail: data }));
                    } else if (data.type === 'terminal_output' || data.type === 'command_result') {
                        window.dispatchEvent(new CustomEvent('nexus_terminal_output', { detail: data }));
                    } else if (data.type === 'disconnected') {
                        window.dispatchEvent(new CustomEvent('nexus_terminal_disconnected', { detail: data }));
                    } else {
                        window.dispatchEvent(new CustomEvent('nexus_message', { detail: data }));
                    }
                    // Also call TerminalBridge handler if available
                    if (window.TerminalBridge && window.TerminalBridge._handleMessage) {
                        window.TerminalBridge._handleMessage(data);
                    }
                } catch(e) { console.warn('[NEXUS] Event dispatch error:', e); }
            })();
        `;
        (document.head || document.documentElement).appendChild(script);
        script.remove();
    }
    
    // ==================== Auto-Detection ====================
    // Check if scanner is already on page
    setTimeout(() => {
        const script = document.createElement('script');
        script.textContent = `
            if (typeof window.Scanner !== 'undefined' || typeof window.TerminalBridge !== 'undefined') {
                window.postMessage({ type: 'NEXUS_SCANNER_READY' }, '*');
            }
        `;
        (document.head || document.documentElement).appendChild(script);
        script.remove();
    }, 1000);
    
    console.log('[NEXUS Content] Initialization complete');
})();
