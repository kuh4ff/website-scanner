/**
 * NEXUS Scanner Pro v3.0 - Background Service Worker
 * Handles WebSocket, Script Injection, and Message Relay
 */

class NexusBackground {
    constructor() {
        this.ws = null;
        this.wsUrl = null;
        this.wsToken = null;
        this.reconnectAttempts = 0;
        this.maxReconnect = 5;
        this.messageQueue = [];
        this.init();
    }
    
    init() {
        // Listen for messages from popup and content scripts
        chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
            this.handleMessage(msg, sender, sendResponse);
            return true; // Keep channel open for async response
        });
        
        // Handle extension install/update
        chrome.runtime.onInstalled.addListener((details) => {
            console.log('[NEXUS] Extension installed:', details.reason);
        });
        
        console.log('[NEXUS] Background service worker started');
    }
    
    handleMessage(msg, sender, sendResponse) {
        switch(msg.type) {
            case 'INJECT_SCRIPT':
                this.injectScript(msg.tabId, msg.script, sendResponse);
                break;
                
            case 'CONNECT_TERMINAL':
                this.connectWebSocket(msg.url, msg.token, sendResponse);
                break;
                
            case 'DISCONNECT_TERMINAL':
                this.disconnectWebSocket();
                sendResponse({ success: true });
                break;
                
            case 'SEND_COMMAND':
                this.sendCommand(msg.command, sendResponse);
                break;
                
            case 'RELAY_TO_TERMINAL':
                this.relayToTerminal(msg.data, sendResponse);
                break;
                
            case 'GET_WS_STATUS':
                sendResponse({ 
                    connected: this.ws && this.ws.readyState === WebSocket.OPEN,
                    url: this.wsUrl 
                });
                break;
                
            default:
                console.log('[NEXUS] Unknown message type:', msg.type);
                sendResponse({ error: 'Unknown message type' });
        }
    }
    
    // ==================== Script Injection ====================
    async injectScript(tabId, script, sendResponse) {
        try {
            // First inject the marker and setup
            await chrome.scripting.executeScript({
                target: { tabId: tabId },
                func: () => {
                    window.__NEXUS_EXTENSION_AVAILABLE__ = true;
                    window.__NEXUS_EXTENSION_VERSION__ = '3.0';
                    console.log('[NEXUS] Extension marker set');
                }
            });
            
            // Then inject the main script
            await chrome.scripting.executeScript({
                target: { tabId: tabId },
                func: (code) => {
                    try {
                        // Create script element
                        const script = document.createElement('script');
                        script.textContent = code;
                        (document.head || document.documentElement).appendChild(script);
                        script.remove();
                        console.log('[NEXUS] Scanner script injected');
                        return true;
                    } catch (e) {
                        console.error('[NEXUS] Script injection error:', e);
                        return false;
                    }
                },
                args: [script]
            });
            
            // Also inject helper communication
            await chrome.scripting.executeScript({
                target: { tabId: tabId },
                func: () => {
                    // Setup message relay from page to extension
                    window.addEventListener('message', (event) => {
                        if (event.source !== window) return;
                        if (event.data && event.data.type === 'NEXUS_TO_EXTENSION') {
                            chrome.runtime.sendMessage(event.data);
                        }
                    });
                    
                    // Listen for extension messages
                    window.__NEXUS_SEND_TO_EXTENSION__ = (data) => {
                        chrome.runtime.sendMessage({ type: 'RELAY_TO_TERMINAL', data: data });
                    };
                }
            });
            
            sendResponse({ success: true });
            
        } catch (e) {
            console.error('[NEXUS] Injection error:', e);
            sendResponse({ success: false, error: e.message });
        }
    }
    
    // ==================== WebSocket Management ====================
    connectWebSocket(url, token, sendResponse) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.close();
        }
        
        this.wsUrl = url;
        this.wsToken = token;
        this.reconnectAttempts = 0;
        
        try {
            this.ws = new WebSocket(url);
            
            this.ws.onopen = () => {
                console.log('[NEXUS] WebSocket connected');
                
                // Send auth if token provided
                if (token) {
                    this.ws.send(JSON.stringify({
                        type: 'auth',
                        token: token
                    }));
                }
                
                // Send any queued messages
                while (this.messageQueue.length > 0) {
                    const msg = this.messageQueue.shift();
                    this.ws.send(JSON.stringify(msg));
                }
                
                sendResponse({ success: true });
            };
            
            this.ws.onmessage = (event) => {
                this.handleTerminalMessage(event.data);
            };
            
            this.ws.onerror = (error) => {
                console.error('[NEXUS] WebSocket error:', error);
            };
            
            this.ws.onclose = (event) => {
                console.log('[NEXUS] WebSocket closed:', event.code);
                this.attemptReconnect();
            };
            
        } catch (e) {
            console.error('[NEXUS] WebSocket connection error:', e);
            sendResponse({ success: false, error: e.message });
        }
    }
    
    disconnectWebSocket() {
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
        this.wsUrl = null;
        this.wsToken = null;
        this.reconnectAttempts = this.maxReconnect; // Prevent auto-reconnect
    }
    
    attemptReconnect() {
        if (this.reconnectAttempts >= this.maxReconnect) {
            console.log('[NEXUS] Max reconnect attempts reached');
            return;
        }
        
        this.reconnectAttempts++;
        const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
        
        console.log('[NEXUS] Reconnecting in ' + delay + 'ms...');
        
        setTimeout(() => {
            if (this.wsUrl) {
                this.connectWebSocket(this.wsUrl, this.wsToken, () => {});
            }
        }, delay);
    }
    
    handleTerminalMessage(data) {
        try {
            const msg = JSON.parse(data);
            
            // Broadcast to all tabs with content script
            chrome.tabs.query({}, (tabs) => {
                tabs.forEach(tab => {
                    chrome.tabs.sendMessage(tab.id, {
                        type: 'TERMINAL_MESSAGE',
                        data: msg
                    }).catch(() => {/* Tab doesn't have content script */});
                });
            });
            
        } catch (e) {
            console.error('[NEXUS] Parse terminal message error:', e);
        }
    }
    
    sendCommand(command, sendResponse) {
        const msg = {
            type: 'command',
            command: command
        };
        
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(msg));
            sendResponse({ success: true });
        } else {
            this.messageQueue.push(msg);
            sendResponse({ success: false, error: 'Not connected, queued' });
        }
    }
    
    relayToTerminal(data, sendResponse) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(data));
            sendResponse({ success: true });
        } else {
            this.messageQueue.push(data);
            sendResponse({ success: false, error: 'Not connected' });
        }
    }
}

// Initialize
const nexusBackground = new NexusBackground();

