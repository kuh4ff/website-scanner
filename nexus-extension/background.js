/**
 * NEXUS Scanner Pro v3.0 - Background Service Worker
 * Handles WebSocket, Script Injection, Message Relay, and Remote Config
 */

class NexusBackground {
    constructor() {
        this.ws = null;
        this.wsUrl = null;
        this.wsToken = null;
        this.reconnectAttempts = 0;
        this.maxReconnect = 5;
        this.messageQueue = [];
        this.remoteConfig = null;
        this.configUrl = 'https://raw.githubusercontent.com/kuh4ff/website-scanner/main/nexus-extension/remote-config.json';
        this.configFetchInterval = 5 * 60 * 1000; // 5 minutes
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
            this.fetchRemoteConfig(); // Fetch config immediately on install
        });
        
        // Fetch remote config on startup
        this.fetchRemoteConfig();
        
        // Set up periodic config fetch
        this.startConfigSync();
        
        console.log('[NEXUS] Background service worker started');
    }
    
    // ==================== Remote Config System ====================
    async fetchRemoteConfig() {
        try {
            const response = await fetch(this.configUrl + '?t=' + Date.now(), {
                cache: 'no-store'
            });
            
            if (!response.ok) {
                throw new Error('Config fetch failed: ' + response.status);
            }
            
            const config = await response.json();
            this.remoteConfig = config;
            
            // Store in chrome.storage for popup access
            await chrome.storage.local.set({ 
                remoteConfig: config,
                configLastFetch: Date.now()
            });
            
            console.log('[NEXUS] Remote config updated:', config.version);
            
            // Notify all extension views about config update
            chrome.runtime.sendMessage({ 
                type: 'CONFIG_UPDATED', 
                config: config 
            }).catch(() => {}); // Ignore if no listeners
            
            return config;
        } catch (e) {
            console.error('[NEXUS] Config fetch error:', e);
            // Try to load from storage
            const stored = await chrome.storage.local.get('remoteConfig');
            if (stored.remoteConfig) {
                this.remoteConfig = stored.remoteConfig;
            }
            return this.remoteConfig;
        }
    }
    
    startConfigSync() {
        // Use chrome.alarms for background sync (service workers can't use setInterval persistently)
        chrome.alarms.create('configSync', { periodInMinutes: 5 });
        
        chrome.alarms.onAlarm.addListener((alarm) => {
            if (alarm.name === 'configSync') {
                this.fetchRemoteConfig();
            }
        });
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
            
            case 'GET_REMOTE_CONFIG':
                this.getRemoteConfig(sendResponse);
                break;
            
            case 'REFRESH_CONFIG':
                this.fetchRemoteConfig().then(config => {
                    sendResponse({ success: true, config });
                }).catch(e => {
                    sendResponse({ success: false, error: e.message });
                });
                break;
                
            default:
                console.log('[NEXUS] Unknown message type:', msg.type);
                sendResponse({ error: 'Unknown message type' });
        }
    }
    
    async getRemoteConfig(sendResponse) {
        if (this.remoteConfig) {
            sendResponse({ success: true, config: this.remoteConfig });
        } else {
            const config = await this.fetchRemoteConfig();
            sendResponse({ success: true, config: config || null });
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
        this.responseSent = false;
        
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
                } else {
                    // No token needed, connection is success
                    if (!this.responseSent) {
                        this.responseSent = true;
                        sendResponse({ success: true });
                    }
                }
                
                // Send any queued messages
                while (this.messageQueue.length > 0) {
                    const msg = this.messageQueue.shift();
                    this.ws.send(JSON.stringify(msg));
                }
            };
            
            this.ws.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);
                    
                    // Handle auth response
                    if (data.type === 'auth_success') {
                        if (!this.responseSent) {
                            this.responseSent = true;
                            sendResponse({ success: true });
                        }
                    } else if (data.type === 'auth_failed') {
                        if (!this.responseSent) {
                            this.responseSent = true;
                            sendResponse({ success: false, error: 'Authentication failed' });
                        }
                        return; // Don't broadcast auth failure
                    }
                    
                    // Broadcast to page
                    this.handleTerminalMessage(event.data);
                } catch (e) {
                    this.handleTerminalMessage(event.data);
                }
            };
            
            this.ws.onerror = (error) => {
                console.error('[NEXUS] WebSocket error:', error);
                if (!this.responseSent) {
                    this.responseSent = true;
                    sendResponse({ success: false, error: 'Connection failed' });
                }
            };
            
            this.ws.onclose = (event) => {
                console.log('[NEXUS] WebSocket closed:', event.code);
                if (!this.responseSent) {
                    this.responseSent = true;
                    sendResponse({ success: false, error: 'Connection closed' });
                }
                this.attemptReconnect();
            };
            
            // Timeout for connection
            setTimeout(() => {
                if (!this.responseSent) {
                    this.responseSent = true;
                    sendResponse({ success: false, error: 'Connection timeout' });
                }
            }, 10000);
            
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

