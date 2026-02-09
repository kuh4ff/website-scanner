/**
 * NEXUS Scanner Pro v3.0.2 - Content Script
 * CSP-SAFE: Uses postMessage communication only, no inline scripts
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
            
            // Set up timeout
            const timeout = setTimeout(() => {
                pendingCallbacks.delete(id);
                resolve({ success: false, error: 'Timeout' });
            }, 10000);
            
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
            
            switch(data.action) {
                case 'connect':
                    chrome.runtime.sendMessage({
                        type: 'CONNECT_TERMINAL',
                        url: data.serverUrl,
                        token: data.token
                    }, (response) => {
                        const lastError = chrome.runtime.lastError;
                        window.postMessage({
                            nexusResponse: true,
                            success: lastError ? false : (response?.success || false),
                            error: lastError?.message || response?.error || null
                        }, '*');
                    });
                    break;
                    
                case 'disconnect':
                    chrome.runtime.sendMessage({ type: 'DISCONNECT_TERMINAL' }, () => {
                        window.postMessage({ nexusResponse: true, success: true }, '*');
                    });
                    break;
                    
                case 'send':
                    chrome.runtime.sendMessage({
                        type: 'RELAY_TO_TERMINAL',
                        data: data.payload
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
        switch(msg.type) {
            case 'CHECK_STATUS':
                sendResponse({ injected: scannerInjected });
                break;
                
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
                
            case 'GET_SCAN_STATS':
                getStats(sendResponse);
                return true;
        }
        return false;
    });
    
    // ==================== CSP-SAFE Scanner Functions ====================
    
    async function executeScan(scanType, sendResponse) {
        console.log('[NEXUS Content] executeScan:', scanType);
        
        const response = await sendToPage('scan', { type: scanType });
        
        if (response.success) {
            scanResults = response.stats || scanResults;
        }
        
        sendResponse({ 
            success: response.success, 
            stats: response.stats || scanResults,
            error: response.error 
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
