/**
 * NEXUS Scanner Pro v5.0 - Background Service Worker
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
        this.heartbeatInterval = null;
        this.isConnected = false;
        // Connection check debounce to prevent reconnect loops
        this.lastConnectionCheck = 0;
        this.connectionCheckDebounce = 3000; // 3 second debounce
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
            }).catch(() => { }); // Ignore if no listeners

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
        switch (msg.type) {
            case 'INJECT_SCRIPT':
                this.injectScript(msg.tabId, msg.script, sendResponse);
                break;

            case 'EXECUTE_IN_PAGE':
                this.executeInPage(msg.tabId, msg.command, msg.args, sendResponse);
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
                // Debounce connection checks to prevent reconnect loops
                const now = Date.now();
                const isConnectedNow = this.ws && this.ws.readyState === WebSocket.OPEN;

                if (now - this.lastConnectionCheck < this.connectionCheckDebounce) {
                    // Return cached state within debounce window
                    sendResponse({
                        connected: this.isConnected,
                        url: this.wsUrl,
                        cached: true
                    });
                } else {
                    this.lastConnectionCheck = now;
                    this.isConnected = isConnectedNow;
                    sendResponse({
                        connected: isConnectedNow,
                        url: this.wsUrl
                    });
                }
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

            case 'GET_FINDINGS':
                this.getFindings(msg.tabId, sendResponse);
                break;

            // ==================== AI API Proxy (CSP Bypass) ====================
            case 'AI_API_CALL':
                this.proxyAICall(msg.url, msg.options, sendResponse);
                break;

            case 'AI_VALIDATE_KEY':
                this.validateAIKey(msg.provider, msg.apiKey, sendResponse);
                break;

            default:
                console.log('[NEXUS] Unknown message type:', msg.type);
                sendResponse({ error: 'Unknown message type' });
        }
    }

    // ==================== AI API Proxy Methods ====================
    async proxyAICall(url, options, sendResponse) {
        try {
            console.log('[NEXUS] Proxying AI call to:', url);
            const response = await fetch(url, options);
            const data = await response.json();
            sendResponse({
                success: response.ok,
                status: response.status,
                data: data
            });
        } catch (e) {
            console.error('[NEXUS] AI proxy error:', e);
            sendResponse({ success: false, error: e.message });
        }
    }

    async validateAIKey(provider, apiKey, sendResponse) {
        try {
            console.log('[NEXUS] Validating AI key for:', provider);

            const endpoints = {
                groq: {
                    url: 'https://api.groq.com/openai/v1/models',
                    headers: { 'Authorization': `Bearer ${apiKey}` }
                },
                openai: {
                    url: 'https://api.openai.com/v1/models',
                    headers: { 'Authorization': `Bearer ${apiKey}` }
                },
                anthropic: {
                    url: 'https://api.anthropic.com/v1/messages',
                    headers: {
                        'x-api-key': apiKey,
                        'anthropic-version': '2023-06-01',
                        'Content-Type': 'application/json'
                    },
                    method: 'POST',
                    body: JSON.stringify({
                        model: 'claude-3-haiku-20240307',
                        max_tokens: 1,
                        messages: [{ role: 'user', content: 'test' }]
                    })
                },
                gemini: {
                    url: `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`,
                    headers: {}
                },
                deepseek: {
                    url: 'https://api.deepseek.com/v1/models',
                    headers: { 'Authorization': `Bearer ${apiKey}` }
                },
                openrouter: {
                    url: 'https://openrouter.ai/api/v1/models',
                    headers: { 'Authorization': `Bearer ${apiKey}` }
                }
            };

            const config = endpoints[provider];
            if (!config) {
                sendResponse({ valid: false, error: 'Unknown provider: ' + provider });
                return;
            }

            const response = await fetch(config.url, {
                method: config.method || 'GET',
                headers: config.headers,
                body: config.body
            });

            const data = await response.json();

            if (response.ok || response.status === 200) {
                sendResponse({
                    valid: true,
                    provider: provider,
                    models: data.data || data.models || []
                });
            } else {
                sendResponse({
                    valid: false,
                    error: data.error?.message || 'Invalid API key',
                    status: response.status
                });
            }
        } catch (e) {
            console.error('[NEXUS] AI key validation error:', e);
            sendResponse({ valid: false, error: e.message });
        }
    }

    // ==================== Execute Command Directly in Page ====================
    async executeInPage(tabId, command, args, sendResponse) {
        try {
            const results = await chrome.scripting.executeScript({
                target: { tabId: tabId },
                func: (cmd, cmdArgs) => {
                    try {
                        console.log('[NEXUS] Executing command:', cmd);

                        // Command mapping - call the function directly
                        const commands = {
                            // Scanner commands
                            'quickScan': () => window.Scanner?.quickScan?.() || (typeof quickScan === 'function' && quickScan()),
                            'deepScan': () => window.Scanner?.deepScan?.() || (typeof deepScan === 'function' && deepScan()),
                            'stop': () => typeof stop === 'function' && stop(),
                            'scan': () => typeof scan === 'function' ? scan() : (typeof start === 'function' && start()),

                            // Dashboard commands
                            'dashboard': () => typeof dashboard === 'function' && dashboard(),
                            'vulns': () => typeof vulns === 'function' && vulns(),
                            'domxss': () => typeof domxss === 'function' ? domxss() : (typeof xss === 'function' && xss()),
                            'cors': () => typeof cors === 'function' && cors(),
                            'ssrf': () => typeof ssrf === 'function' && ssrf(),
                            'headers': () => typeof headers === 'function' ? headers() : (typeof secHeaders === 'function' && secHeaders()),
                            'postmessage': () => typeof postmessage === 'function' ? postmessage() : (typeof pm === 'function' && pm()),

                            // Secret detection
                            'patterns': () => typeof patterns === 'function' && patterns(),
                            'findings': () => typeof findings === 'function' && findings(),
                            'exploitable': () => typeof exploitable === 'function' && exploitable(),
                            'results': () => typeof results === 'function' && results(),
                            'validate': () => typeof validate === 'function' && validate(),

                            // Files & endpoints
                            'files': () => typeof files === 'function' ? files() : (typeof sensitiveFiles === 'function' && sensitiveFiles()),
                            'endpoints': () => typeof endpoints === 'function' && endpoints(),
                            'forms': () => typeof forms === 'function' && forms(),

                            // Auto exploit
                            'autoExploit': () => typeof autoExploit === 'function' ? autoExploit() : (typeof auto === 'function' && auto()),
                            'deepExploit': () => typeof deepExploit === 'function' && deepExploit(),

                            // AI commands
                            'ai': () => typeof ai === 'function' && ai(),
                            'aiAgent': () => typeof aiAgent === 'function' && aiAgent(),
                            'fullReport': () => typeof fullReport === 'function' && fullReport(),
                            'setGroq': () => {
                                // setGroq needs the key from args
                                if (cmdArgs?.key && typeof setGroq === 'function') setGroq(cmdArgs.key);
                                else if (cmdArgs?.key && typeof setOpenAI === 'function') setOpenAI(cmdArgs.key);
                            },

                            // Terminal commands
                            'syncFindings': () => typeof syncFindings === 'function' && syncFindings(),
                            'runAllCurls': () => typeof runAllCurls === 'function' && runAllCurls(),

                            // Storage
                            'localStorage': () => {
                                console.log('%c[LocalStorage]', 'color: #22c55e; font-weight: bold');
                                for (let i = 0; i < localStorage.length; i++) {
                                    const key = localStorage.key(i);
                                    console.log(key + ':', localStorage.getItem(key));
                                }
                            },
                            'sessionStorage': () => {
                                console.log('%c[SessionStorage]', 'color: #22c55e; font-weight: bold');
                                for (let i = 0; i < sessionStorage.length; i++) {
                                    const key = sessionStorage.key(i);
                                    console.log(key + ':', sessionStorage.getItem(key));
                                }
                            },
                            'analyzeCookies': () => {
                                console.log('%c[Cookies]', 'color: #22c55e; font-weight: bold');
                                document.cookie.split(';').forEach(c => console.log(c.trim()));
                            },

                            // Export
                            'exportJSON': () => typeof exportResults === 'function' && exportResults('json'),
                            'exportHTML': () => typeof exportResults === 'function' && exportResults('html'),
                            'exportCSV': () => typeof exportResults === 'function' && exportResults('csv'),
                            'exportAll': () => {
                                if (typeof exportResults === 'function') {
                                    exportResults('json');
                                    exportResults('html');
                                    exportResults('csv');
                                }
                            },

                            // Utility
                            'help': () => typeof help === 'function' && help(),
                            'diagnose': () => typeof diagnose === 'function' && diagnose(),
                            'status': () => typeof status === 'function' && status()
                        };

                        if (commands[cmd]) {
                            commands[cmd]();
                            return { success: true, command: cmd };
                        } else if (typeof window[cmd] === 'function') {
                            // Try calling as direct function
                            window[cmd](cmdArgs);
                            return { success: true, command: cmd };
                        } else {
                            console.warn('[NEXUS] Command not found:', cmd);
                            return { success: false, error: 'Command not found: ' + cmd };
                        }
                    } catch (e) {
                        console.error('[NEXUS] Command error:', e);
                        return { success: false, error: e.message };
                    }
                },
                args: [command, args || {}],
                world: 'MAIN'
            });

            sendResponse(results[0]?.result || { success: false, error: 'No result' });
        } catch (e) {
            console.error('[NEXUS] executeInPage error:', e);
            sendResponse({ success: false, error: e.message });
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
    // Ultimate CSP Bypass: Loads bundled scanner directly via chrome-extension:// URL
    // NO eval() or new Function() needed - static file loading bypasses ALL CSP
    async injectScript(tabId, script, sendResponse) {
        try {
            console.log('[NEXUS] Starting injection...');

            // Step 1: Set markers in MAIN world
            await chrome.scripting.executeScript({
                target: { tabId: tabId },
                func: () => {
                    window.__NEXUS_EXTENSION_AVAILABLE__ = true;
                    window.__NEXUS_EXTENSION_VERSION__ = '5.0';
                    window.__NEXUS_EXTENSION_MODE__ = true;
                    console.log('%c[NEXUS] Extension markers set', 'color: #22c55e; font-weight: bold');
                },
                world: 'MAIN'
            });

            // ============================
            // PRIMARY METHOD: Load bundled scanner via chrome-extension:// URL
            // This ALWAYS works - browsers allow their own extension URLs regardless of CSP
            // ============================
            const bundledScannerUrl = chrome.runtime.getURL('all_phases_bundled.js');
            console.log('[NEXUS] Loading bundled scanner:', bundledScannerUrl);

            const loadResult = await chrome.scripting.executeScript({
                target: { tabId: tabId },
                func: (url) => {
                    return new Promise((resolve) => {
                        // Check if already loaded
                        if (window.Scanner || window.__NEXUS_SCANNER_LOADED__) {
                            console.log('%c[NEXUS] Scanner already loaded', 'color: #22c55e');
                            resolve({ success: true, method: 'already-loaded' });
                            return;
                        }

                        // Set timeout
                        const timeout = setTimeout(() => {
                            resolve({ success: false, error: 'Script load timeout' });
                        }, 10000);

                        // Create script element with chrome-extension:// URL
                        const script = document.createElement('script');
                        script.src = url;

                        script.onload = () => {
                            clearTimeout(timeout);
                            window.__NEXUS_SCANNER_LOADED__ = true;
                            console.log('%c[NEXUS] Bundled scanner loaded via extension URL!', 'color: #22c55e; font-weight: bold; font-size: 14px');
                            resolve({ success: true, method: 'extension-url-bundled' });
                        };

                        script.onerror = (e) => {
                            clearTimeout(timeout);
                            console.error('[NEXUS] Script load error');
                            resolve({ success: false, error: 'Script element load failed' });
                        };

                        (document.head || document.documentElement).appendChild(script);
                    });
                },
                args: [bundledScannerUrl],
                world: 'MAIN'
            });

            const primaryResult = loadResult[0]?.result;

            if (primaryResult?.success) {
                console.log('[NEXUS] Injection complete via:', primaryResult.method);
                this.setupBridge(tabId);
                sendResponse({ success: true, method: primaryResult.method });
                return;
            }

            // ============================
            // FALLBACK: Try dynamic methods for non-strict CSP sites
            // (These will fail on GitHub but work on most other sites)
            // ============================
            console.log('[NEXUS] Bundled load failed, trying dynamic methods...');

            const result = await chrome.scripting.executeScript({
                target: { tabId: tabId },
                func: (code) => {
                    const methods = [];

                    // Method 1: Function constructor
                    try {
                        const fn = new Function(code);
                        fn();
                        console.log('%c[NEXUS] Injected via Function constructor', 'color: #22c55e');
                        return { success: true, method: 'function' };
                    } catch (e) {
                        methods.push('function:' + e.message);
                    }

                    // Method 2: Indirect eval
                    try {
                        (0, eval)(code);
                        console.log('%c[NEXUS] Injected via eval', 'color: #22c55e');
                        return { success: true, method: 'eval' };
                    } catch (e) {
                        methods.push('eval:' + e.message);
                    }

                    // Method 3: Blob URL
                    try {
                        const blob = new Blob([code], { type: 'application/javascript' });
                        const url = URL.createObjectURL(blob);
                        const script = document.createElement('script');
                        script.src = url;
                        document.head.appendChild(script);
                        URL.revokeObjectURL(url);
                        console.log('%c[NEXUS] Injected via Blob URL', 'color: #22c55e');
                        return { success: true, method: 'blob' };
                    } catch (e) {
                        methods.push('blob:' + e.message);
                    }

                    // All methods failed
                    console.error('[NEXUS] All injection methods failed:', methods);
                    return {
                        success: false,
                        error: 'Strict CSP - all methods blocked',
                        attempts: methods
                    };
                },
                args: [script],
                world: 'MAIN'
            });

            const r = result[0]?.result;

            if (r?.success) {
                this.setupBridge(tabId);
                console.log('[NEXUS] Injection complete via:', r.method);
                sendResponse({ success: true, method: r.method });
            } else {
                console.log('[NEXUS] All injection methods failed');
                sendResponse({
                    success: false,
                    error: r?.error || 'Injection failed - strict CSP site',
                    attempts: r?.attempts
                });
            }

        } catch (e) {
            console.error('[NEXUS] Injection error:', e);
            sendResponse({ success: false, error: e.message });
        }
    }

    // Helper: Setup communication bridge after successful injection
    async setupBridge(tabId) {
        await chrome.scripting.executeScript({
            target: { tabId: tabId },
            func: () => {
                if (!window.__NEXUS_BRIDGE_READY__) {
                    window.__NEXUS_BRIDGE_READY__ = true;
                    window.__NEXUS_SEND_TO_EXTENSION__ = (data) => {
                        window.postMessage({ type: 'NEXUS_TO_EXTENSION', payload: data }, '*');
                    };
                    window.postMessage({ type: 'NEXUS_SCANNER_READY' }, '*');
                }
            },
            world: 'MAIN'
        });
    }

    // ==================== Get Findings Data ====================
    async getFindings(tabId, sendResponse) {
        try {
            const results = await chrome.scripting.executeScript({
                target: { tabId: tabId },
                func: () => {
                    const data = {
                        findings: [],
                        secrets: [],
                        vulnerabilities: [],
                        endpoints: [],
                        stats: { total: 0, critical: 0, high: 0, medium: 0, low: 0 }
                    };

                    // Try multiple ways to get data
                    if (window.Scanner?.state?.findings) {
                        data.findings = window.Scanner.state.findings;
                    } else if (typeof getFindings === 'function') {
                        const f = getFindings();
                        if (Array.isArray(f)) data.findings = f;
                    }

                    // Get secrets
                    if (window.Scanner?.state?.secretFindings) {
                        data.secrets = window.Scanner.state.secretFindings;
                    } else if (window.secretFindings) {
                        data.secrets = window.secretFindings;
                    }

                    // Get vulnerabilities
                    if (window.Scanner?.state?.vulns) {
                        data.vulnerabilities = window.Scanner.state.vulns;
                    } else if (window.vulnFindings) {
                        data.vulnerabilities = window.vulnFindings;
                    }

                    // Get endpoints
                    if (window.Scanner?.state?.endpoints) {
                        data.endpoints = window.Scanner.state.endpoints;
                    } else if (window.discoveredEndpoints) {
                        data.endpoints = window.discoveredEndpoints;
                    }

                    // Calculate stats
                    const countSeverity = (items) => {
                        items.forEach(item => {
                            const sev = (item.severity || item.level || '').toLowerCase();
                            data.stats.total++;
                            if (sev.includes('critical')) data.stats.critical++;
                            else if (sev.includes('high')) data.stats.high++;
                            else if (sev.includes('medium')) data.stats.medium++;
                            else if (sev.includes('low')) data.stats.low++;
                        });
                    };

                    countSeverity(data.findings);
                    countSeverity(data.secrets);
                    countSeverity(data.vulnerabilities);

                    return data;
                },
                world: 'MAIN'
            });

            sendResponse({ success: true, data: results[0]?.result });
        } catch (e) {
            sendResponse({ success: false, error: e.message });
        }
    }

    // ==================== WebSocket Management ====================
    connectWebSocket(url, token, sendResponse) {
        console.log('[NEXUS] Attempting WebSocket connection to:', url);

        // Clear any existing heartbeat
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
            this.heartbeatInterval = null;
        }

        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            console.log('[NEXUS] Closing existing connection');
            this.ws.close();
        }

        this.wsUrl = url;
        this.wsToken = token;
        this.reconnectAttempts = 0;
        this.responseSent = false;
        this.isConnected = false;

        try {
            console.log('[NEXUS] Creating WebSocket...');
            this.ws = new WebSocket(url);

            this.ws.onopen = () => {
                console.log('[NEXUS] WebSocket connected successfully');
                this.isConnected = true;

                // Send auth if token provided
                if (token) {
                    console.log('[NEXUS] Sending auth token...');
                    this.ws.send(JSON.stringify({
                        type: 'auth',
                        token: token,
                        client: 'nexus-extension',
                        version: '5.0'
                    }));

                    // For servers that don't send auth_success, consider connected after short delay
                    setTimeout(() => {
                        if (!this.responseSent) {
                            console.log('[NEXUS] Auth response timeout - assuming connected');
                            this.responseSent = true;
                            sendResponse({ success: true });
                            this.startHeartbeat();
                        }
                    }, 2000);
                } else {
                    // No token needed, connection is success
                    if (!this.responseSent) {
                        this.responseSent = true;
                        sendResponse({ success: true });
                        this.startHeartbeat();
                    }
                }

                // Send any queued messages safely
                while (this.messageQueue.length > 0) {
                    const msg = this.messageQueue.shift();
                    this.safeSend(msg);
                }
            };

            this.ws.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);

                    // Handle auth response
                    if (data.type === 'auth_success' || data.type === 'authenticated') {
                        console.log('[NEXUS] Auth success received');
                        if (!this.responseSent) {
                            this.responseSent = true;
                            sendResponse({ success: true });
                            this.startHeartbeat();
                        }
                        return;
                    } else if (data.type === 'auth_failed' || data.type === 'error') {
                        console.log('[NEXUS] Auth failed:', data);
                        if (!this.responseSent) {
                            this.responseSent = true;
                            sendResponse({ success: false, error: data.message || 'Authentication failed' });
                        }
                        return;
                    }

                    // Handle pong
                    if (data.type === 'pong') {
                        console.log('[NEXUS] Pong received');
                        return;
                    }

                    // Broadcast to page
                    this.handleTerminalMessage(event.data);
                } catch (e) {
                    this.handleTerminalMessage(event.data);
                }
            };

            this.ws.onerror = (error) => {
                console.error('[NEXUS] WebSocket error:', error);
                this.isConnected = false;
                if (!this.responseSent) {
                    this.responseSent = true;
                    sendResponse({ success: false, error: 'Connection failed' });
                }
            };

            this.ws.onclose = (event) => {
                console.log('[NEXUS] WebSocket closed:', event.code, event.reason);
                this.isConnected = false;

                // Stop heartbeat
                if (this.heartbeatInterval) {
                    clearInterval(this.heartbeatInterval);
                    this.heartbeatInterval = null;
                }

                if (!this.responseSent) {
                    this.responseSent = true;
                    sendResponse({ success: false, error: 'Connection closed' });
                }

                // Only auto-reconnect if we were connected before
                if (this.wsUrl && this.reconnectAttempts < this.maxReconnect) {
                    this.attemptReconnect();
                }
            };

            // Timeout for initial connection (15 seconds)
            setTimeout(() => {
                if (!this.responseSent) {
                    this.responseSent = true;
                    console.log('[NEXUS] WebSocket connection timeout');
                    sendResponse({ success: false, error: 'Connection timeout - check URL and if terminal is running' });
                }
            }, 15000);

        } catch (e) {
            console.error('[NEXUS] WebSocket connection error:', e);
            sendResponse({ success: false, error: e.message });
        }
    }

    // Heartbeat to keep connection alive
    startHeartbeat() {
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
        }

        console.log('[NEXUS] Starting heartbeat');

        this.heartbeatInterval = setInterval(() => {
            if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                this.ws.send(JSON.stringify({ type: 'ping', timestamp: Date.now() }));
            } else {
                console.log('[NEXUS] Heartbeat: WebSocket not open, stopping');
                clearInterval(this.heartbeatInterval);
                this.heartbeatInterval = null;
            }
        }, 25000); // Send ping every 25 seconds
    }

    disconnectWebSocket() {
        console.log('[NEXUS] Disconnecting WebSocket');

        // Stop heartbeat
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
            this.heartbeatInterval = null;
        }

        if (this.ws) {
            this.ws.close(1000, 'User disconnect');
            this.ws = null;
        }
        this.wsUrl = null;
        this.wsToken = null;
        this.isConnected = false;
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
                this.connectWebSocket(this.wsUrl, this.wsToken, () => { });
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
                    }).catch(() => {/* Tab doesn't have content script */ });
                });
            });

        } catch (e) {
            console.error('[NEXUS] Parse terminal message error:', e);
        }
    }

    // Safe WebSocket send - prevents "still in CONNECTING state" errors
    safeSend(data) {
        try {
            if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                this.ws.send(JSON.stringify(data));
                return true;
            } else if (this.ws && this.ws.readyState === WebSocket.CONNECTING) {
                // Queue message if still connecting
                console.log('[NEXUS] WebSocket still connecting, queuing message');
                this.messageQueue.push(data);
                return false;
            }
        } catch (e) {
            console.error('[NEXUS] WebSocket send error:', e.message);
        }
        return false;
    }

    sendCommand(command, sendResponse) {
        const msg = {
            type: 'command',
            command: command
        };

        if (this.safeSend(msg)) {
            sendResponse({ success: true });
        } else {
            this.messageQueue.push(msg);
            sendResponse({ success: false, error: 'Not connected, queued' });
        }
    }

    relayToTerminal(data, sendResponse) {
        if (this.safeSend(data)) {
            sendResponse({ success: true });
        } else {
            this.messageQueue.push(data);
            sendResponse({ success: false, error: 'Not connected' });
        }
    }
}

// Initialize
const nexusBackground = new NexusBackground();

