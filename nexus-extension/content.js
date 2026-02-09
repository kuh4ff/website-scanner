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
        }
        return true;
    });
    
    // Listen for messages from page (injected script)
    window.addEventListener('message', (event) => {
        if (event.source !== window) return;
        
        const data = event.data;
        if (!data) return;
        
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
        const script = document.createElement('script');
        script.textContent = `
            (function() {
                if (window.TerminalBridge && window.TerminalBridge.askAI) {
                    window.TerminalBridge.askAI('${question.replace(/'/g, "\\'")}').then(answer => {
                        window.postMessage({ type: 'NEXUS_AI_RESPONSE', answer: answer }, '*');
                    });
                } else {
                    window.postMessage({ type: 'NEXUS_AI_RESPONSE', error: 'AI not available' }, '*');
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
        // Send to page
        window.postMessage({ 
            type: 'NEXUS_FROM_TERMINAL', 
            data: data 
        }, '*');
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
