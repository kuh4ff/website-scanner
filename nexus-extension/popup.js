/**
 * NEXUS Scanner Pro v5.0 - Popup Controller
 * Complete Integration with all_phases.js
 */

class NexusExtension {
    constructor() {
        this.state = {
            tabId: null,
            scriptLoaded: false,
            terminalConnected: false,
            aiProvider: 'groq',
            scriptCache: null,
            settings: {
                autoInject: false,
                notifications: true,
                autoSync: false,
                githubUrl: 'https://raw.githubusercontent.com/kuh4ff/website-scanner/main/all_phases.js',
                wsUrl: '',
                authToken: '',
                aiApiKey: ''
            }
        };
        this.init();
    }

    async init() {
        await this.loadSettings();
        this.setupNavigation();
        this.setupAllButtons();
        this.setupToggles();
        await this.getActiveTab();
        await this.checkAndSyncTerminalConnection(); // Check existing connection
        this.updateUI();
        this.log('Extension ready', 'info');
    }

    // Check if terminal is already connected in background.js and sync page state
    async checkAndSyncTerminalConnection() {
        try {
            const response = await new Promise((resolve) => {
                chrome.runtime.sendMessage({ type: 'GET_WS_STATUS' }, (resp) => {
                    if (chrome.runtime.lastError) {
                        resolve({ connected: false });
                    } else {
                        resolve(resp || { connected: false });
                    }
                });
            });

            if (response?.connected) {
                this.state.terminalConnected = true;
                this.updateStatus('terminal', true);
                document.getElementById('btnConnect').style.display = 'none';
                document.getElementById('btnDisconnect').style.display = 'block';
                document.getElementById('terminalStatus').textContent = 'Online';
                document.getElementById('terminalStatus').style.background = '#10b981';

                // Sync page TerminalBridge state with background connection
                await this.syncPageTerminalState(response.url);
                this.log('Terminal already connected', 'success');
            }
        } catch (e) {
            console.log('[NEXUS] Terminal status check error:', e);
        }
    }

    // Sync page TerminalBridge with background.js connection state
    async syncPageTerminalState(wsUrl) {
        try {
            await chrome.scripting.executeScript({
                target: { tabId: this.state.tabId },
                func: (url) => {
                    // Mark extension terminal as connected
                    window.__NEXUS_TERMINAL_VIA_EXTENSION__ = true;
                    window.__NEXUS_TERMINAL_URL__ = url;

                    // Create or update TerminalBridge
                    if (!window.TerminalBridge) {
                        window.TerminalBridge = {
                            connected: true,
                            authenticated: true,
                            serverUrl: url,
                            useExtension: true,
                            isConnected: () => true,
                            send: (data) => {
                                window.postMessage({
                                    nexusExtension: true,
                                    action: 'send',
                                    payload: data
                                }, '*');
                                return { success: true };
                            },
                            _send: (data) => window.TerminalBridge.send(data)
                        };
                    } else {
                        window.TerminalBridge.connected = true;
                        window.TerminalBridge.authenticated = true;
                        window.TerminalBridge.serverUrl = url;
                        window.TerminalBridge.useExtension = true;

                        // Override isConnected
                        window.TerminalBridge.isConnected = function () {
                            return window.TerminalBridge.connected === true ||
                                window.__NEXUS_TERMINAL_VIA_EXTENSION__ === true;
                        };

                        // Override send
                        window.TerminalBridge.send = function (data) {
                            if (window.__NEXUS_TERMINAL_VIA_EXTENSION__) {
                                window.postMessage({
                                    nexusExtension: true,
                                    action: 'send',
                                    payload: data
                                }, '*');
                                return { success: true };
                            }
                            return { success: false };
                        };
                    }

                    console.log('%c[NEXUS] Page synced with extension terminal connection', 'color: #22c55e; font-weight: bold');
                },
                args: [wsUrl || this.state.settings.wsUrl],
                world: 'MAIN'
            });
        } catch (e) {
            console.log('[NEXUS] Page sync error:', e);
        }
    }

    // ==================== Storage ====================
    async loadSettings() {
        try {
            const data = await chrome.storage.local.get(['nexusSettings', 'scriptCache']);
            if (data.nexusSettings) {
                this.state.settings = { ...this.state.settings, ...data.nexusSettings };
            }
            if (data.scriptCache) {
                this.state.scriptCache = data.scriptCache;
            }
            // Apply to UI
            document.getElementById('githubUrl').value = this.state.settings.githubUrl;
            document.getElementById('wsUrl').value = this.state.settings.wsUrl || '';
            document.getElementById('authToken').value = this.state.settings.authToken || '';
            document.getElementById('aiApiKey').value = this.state.settings.aiApiKey || '';

            if (this.state.settings.autoInject) document.getElementById('toggleAutoInject').classList.add('active');
            if (this.state.settings.notifications) document.getElementById('toggleNotifications').classList.add('active');
            if (this.state.settings.autoSync) document.getElementById('toggleAutoSync').classList.add('active');
        } catch (e) {
            console.error('Load settings error:', e);
        }
    }

    async saveSettings() {
        await chrome.storage.local.set({ nexusSettings: this.state.settings });
    }

    // ==================== Navigation ====================
    setupNavigation() {
        document.querySelectorAll('.nav-item').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
                document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
                btn.classList.add('active');
                document.getElementById('page-' + btn.dataset.page).classList.add('active');

                // Auto-check AI status when AI page is opened
                if (btn.dataset.page === 'ai') {
                    this.getAIStatus();
                }
            });
        });
    }

    // ==================== Setup All Buttons ====================
    setupAllButtons() {
        // Home page buttons
        document.getElementById('btnInject').addEventListener('click', () => this.injectScript());
        document.getElementById('btnStart').addEventListener('click', () => this.executeCmd('start'));
        document.getElementById('btnStop').addEventListener('click', () => this.executeCmd('stop'));
        document.getElementById('btnDashboard').addEventListener('click', () => this.executeCmd('dashboard'));
        document.getElementById('btnAutoExploit').addEventListener('click', () => this.executeCmd('autoExploit'));
        document.getElementById('btnFullPwn').addEventListener('click', () => this.executeCmd('fullpwn'));
        document.getElementById('btnFullStop').addEventListener('click', () => this.executeCmd('fullstop'));
        document.getElementById('btnClearLog').addEventListener('click', () => this.clearLog());

        // Findings refresh buttons
        document.getElementById('btnRefreshFindings')?.addEventListener('click', () => this.refreshFindings());
        document.getElementById('btnRefreshFindings2')?.addEventListener('click', () => this.refreshFindings());

        // Scanner page
        document.getElementById('btnQuickScan').addEventListener('click', () => this.executeCmd('quickScan'));
        document.getElementById('btnDeepScan').addEventListener('click', () => this.executeCmd('deepScan'));
        document.getElementById('btnStopScan').addEventListener('click', () => this.executeCmd('stop'));

        // Secrets page
        document.getElementById('btnAutoExploit2').addEventListener('click', () => this.executeCmd('autoExploit'));
        document.getElementById('btnDeepExploit').addEventListener('click', () => {
            const idx = document.getElementById('deepExploitIdx').value;
            if (idx) {
                this.executeCmd('deepExploit', { idx: parseInt(idx) });
            } else {
                this.executeCmd('deepExploit');
            }
        });

        // AI page
        document.querySelectorAll('.provider-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.provider-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this.state.aiProvider = btn.dataset.provider;
            });
        });
        document.getElementById('btnSetAI').addEventListener('click', () => this.setAIKey());
        document.getElementById('btnAskAI').addEventListener('click', () => this.askAI());
        document.getElementById('btnTestAI').addEventListener('click', () => this.testAIConnection());
        document.getElementById('btnSyncFindings').addEventListener('click', () => this.syncFindingsToTerminal());

        // Terminal page
        document.getElementById('btnConnect').addEventListener('click', () => this.connectTerminal());
        document.getElementById('btnDisconnect').addEventListener('click', () => this.disconnectTerminal());
        document.getElementById('btnExec').addEventListener('click', () => this.executeTerminalCmd());
        document.getElementById('cmdInput').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.executeTerminalCmd();
        });

        // Remote Terminal Control
        document.getElementById('btnDeployScript')?.addEventListener('click', () => this.deployTerminalScript());
        document.getElementById('btnUpdateScript')?.addEventListener('click', () => this.updateTerminalScript());
        document.getElementById('btnRemoteExec')?.addEventListener('click', () => this.remoteShellExec());
        document.getElementById('remoteShellCmd')?.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.remoteShellExec();
        });

        // Settings page
        document.getElementById('btnRefreshScript').addEventListener('click', () => this.refreshScript());
        document.getElementById('btnCopyScript').addEventListener('click', () => this.copyScript());
        document.getElementById('btnClearCache').addEventListener('click', () => this.clearCache());
        document.getElementById('btnResetAll').addEventListener('click', () => this.resetAll());

        // Input saves
        ['githubUrl', 'wsUrl', 'authToken', 'aiApiKey'].forEach(id => {
            document.getElementById(id).addEventListener('change', (e) => {
                this.state.settings[id] = e.target.value;
                this.saveSettings();
            });
        });

        // All data-cmd buttons
        document.querySelectorAll('[data-cmd]').forEach(btn => {
            btn.addEventListener('click', () => {
                this.executeCmd(btn.dataset.cmd);
            });
        });

        // Category tags
        document.querySelectorAll('.category-tag').forEach(tag => {
            tag.addEventListener('click', () => {
                this.executeCmd('showCategory', { category: tag.dataset.cat });
            });
        });
    }

    setupToggles() {
        document.getElementById('toggleAutoInject').addEventListener('click', (e) => {
            e.target.classList.toggle('active');
            this.state.settings.autoInject = e.target.classList.contains('active');
            this.saveSettings();
        });
        document.getElementById('toggleNotifications').addEventListener('click', (e) => {
            e.target.classList.toggle('active');
            this.state.settings.notifications = e.target.classList.contains('active');
            this.saveSettings();
        });
        document.getElementById('toggleAutoSync').addEventListener('click', (e) => {
            e.target.classList.toggle('active');
            this.state.settings.autoSync = e.target.classList.contains('active');
            this.saveSettings();
        });
    }

    // ==================== Tab Management ====================
    async getActiveTab() {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        this.state.tabId = tab?.id;

        // Check if scanner already injected
        try {
            const result = await this.checkScannerStatus();
            if (result?.injected) {
                this.state.scriptLoaded = true;
                this.updateStatus('scanner', true);
            }
        } catch (e) { }
    }

    async checkScannerStatus() {
        return new Promise(resolve => {
            chrome.scripting.executeScript({
                target: { tabId: this.state.tabId },
                func: () => ({
                    injected: typeof window.Scanner !== 'undefined' || typeof window.quickScan === 'function'
                }),
                world: 'MAIN'
            }).then(results => {
                resolve(results[0]?.result);
            }).catch(() => resolve(null));
        });
    }

    // ==================== Script Management ====================
    async fetchScript() {
        this.log('Fetching script from GitHub...', 'info');
        const response = await fetch(this.state.settings.githubUrl + '?t=' + Date.now());
        if (!response.ok) throw new Error('Fetch failed: ' + response.status);
        const script = await response.text();
        this.state.scriptCache = script;
        await chrome.storage.local.set({ scriptCache: script });
        this.log('Script fetched: ' + Math.round(script.length / 1024) + 'KB', 'success');
        return script;
    }

    async injectScript() {
        const btn = document.getElementById('btnInject');
        btn.querySelector('.btn-label').textContent = 'Loading...';

        try {
            let script = this.state.scriptCache;
            if (!script) {
                script = await this.fetchScript();
            }

            // Use background.js injection (handles CSP/Trusted Types)
            const response = await new Promise((resolve) => {
                chrome.runtime.sendMessage({
                    type: 'INJECT_SCRIPT',
                    tabId: this.state.tabId,
                    script: script
                }, (resp) => {
                    resolve(resp || { success: false, error: 'No response' });
                });
            });

            if (response?.success) {
                this.state.scriptLoaded = true;
                this.updateStatus('scanner', true);
                this.log('Scanner injected via ' + (response.method || 'extension'), 'success');
                this.notify('Scanner injected!');

                // Auto-refresh findings after injection
                setTimeout(() => this.refreshFindings(), 1000);

            } else if (response?.needsManualPaste) {
                // Site has strict Trusted Types - copy to clipboard for manual paste
                this.log('Strict CSP detected - copying to clipboard...', 'warning');

                try {
                    await navigator.clipboard.writeText(script);
                    this.notify('Script copied! Paste in DevTools Console (F12)', false);
                    this.log('Script copied to clipboard - open DevTools (F12) and paste', 'warning');

                    // Show instructions
                    this.showManualInstructions();
                } catch (clipErr) {
                    // Clipboard failed - show script in dialog
                    this.log('Clipboard failed - showing script...', 'error');
                    this.showScriptDialog(script);
                }
            } else {
                throw new Error(response?.error || 'Injection failed');
            }

        } catch (e) {
            this.log('Injection failed: ' + e.message, 'error');
            this.notify('Injection failed', true);
        } finally {
            btn.querySelector('.btn-label').textContent = 'Inject';
        }
    }

    showManualInstructions() {
        const modal = document.createElement('div');
        modal.style.cssText = `
            position: fixed; top: 0; left: 0; right: 0; bottom: 0;
            background: rgba(0,0,0,0.9); z-index: 9999;
            display: flex; align-items: center; justify-content: center;
            padding: 20px;
        `;
        modal.innerHTML = `
            <div style="background: #1a1a25; border-radius: 12px; padding: 24px; max-width: 400px; text-align: center;">
                <div style="font-size: 40px; margin-bottom: 16px;">⚠️</div>
                <h3 style="color: #f59e0b; margin-bottom: 12px;">Strict Security Detected</h3>
                <p style="color: #94a3b8; font-size: 12px; margin-bottom: 16px;">
                    This site has Trusted Types CSP that blocks automatic injection.
                    The script has been copied to your clipboard.
                </p>
                <div style="background: #0d1117; border-radius: 8px; padding: 12px; text-align: left; margin-bottom: 16px;">
                    <p style="color: #22c55e; font-size: 11px; margin-bottom: 8px;">📋 Steps:</p>
                    <ol style="color: #94a3b8; font-size: 11px; padding-left: 20px; margin: 0;">
                        <li>Press F12 to open DevTools</li>
                        <li>Go to Console tab</li>
                        <li>Press Ctrl+V to paste</li>
                        <li>Press Enter to execute</li>
                    </ol>
                </div>
                <button id="closeInstructions" style="
                    background: linear-gradient(135deg, #8b5cf6, #6366f1);
                    border: none; border-radius: 8px; padding: 10px 24px;
                    color: white; font-weight: 600; cursor: pointer;
                ">Got it!</button>
            </div>
        `;
        document.body.appendChild(modal);
        modal.querySelector('#closeInstructions').addEventListener('click', () => modal.remove());
        modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });
    }

    showScriptDialog(script) {
        const modal = document.createElement('div');
        modal.style.cssText = `
            position: fixed; top: 0; left: 0; right: 0; bottom: 0;
            background: rgba(0,0,0,0.9); z-index: 9999;
            display: flex; align-items: center; justify-content: center;
            padding: 20px;
        `;
        modal.innerHTML = `
            <div style="background: #1a1a25; border-radius: 12px; padding: 24px; max-width: 450px; width: 100%;">
                <h3 style="color: #f59e0b; margin-bottom: 12px;">⚠️ Manual Injection Required</h3>
                <p style="color: #94a3b8; font-size: 11px; margin-bottom: 12px;">
                    Copy this script and paste it in DevTools Console (F12):
                </p>
                <textarea id="scriptText" style="
                    width: 100%; height: 150px; background: #0d1117;
                    border: 1px solid #333; border-radius: 8px; padding: 10px;
                    color: #22c55e; font-family: monospace; font-size: 10px;
                    resize: none;
                " readonly>${script.substring(0, 500)}...</textarea>
                <div style="display: flex; gap: 10px; margin-top: 12px;">
                    <button id="copyScript" style="
                        flex: 1; background: #22c55e; border: none; border-radius: 8px;
                        padding: 10px; color: white; font-weight: 600; cursor: pointer;
                    ">📋 Copy Full Script</button>
                    <button id="closeDialog" style="
                        flex: 1; background: #374151; border: none; border-radius: 8px;
                        padding: 10px; color: white; font-weight: 600; cursor: pointer;
                    ">Close</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);

        modal.querySelector('#copyScript').addEventListener('click', async () => {
            try {
                await navigator.clipboard.writeText(script);
                modal.querySelector('#copyScript').textContent = '✅ Copied!';
            } catch (e) {
                // Select all text for manual copy
                const ta = modal.querySelector('#scriptText');
                ta.value = script;
                ta.select();
                document.execCommand('copy');
                modal.querySelector('#copyScript').textContent = '✅ Copied!';
            }
        });

        modal.querySelector('#closeDialog').addEventListener('click', () => modal.remove());
    }

    async refreshScript() {
        await this.fetchScript();
        this.notify('Script refreshed!');
    }

    async copyScript() {
        try {
            let script = this.state.scriptCache;
            if (!script) {
                script = await this.fetchScript();
            }
            await navigator.clipboard.writeText(script);
            this.notify('Script copied to clipboard!');
            this.log('Script copied - paste in DevTools (F12) Console', 'success');
        } catch (e) {
            this.notify('Copy failed', true);
        }
    }

    async clearCache() {
        this.state.scriptCache = null;
        await chrome.storage.local.remove('scriptCache');
        this.log('Cache cleared', 'success');
        this.notify('Cache cleared');
    }

    async resetAll() {
        await chrome.storage.local.clear();
        this.notify('All data reset');
        location.reload();
    }

    // ==================== Execute Commands ====================
    async executeCmd(cmd, args = {}) {
        if (!this.state.scriptLoaded && !['help'].includes(cmd)) {
            this.notify('Inject scanner first!', true);
            return;
        }

        this.log('Running: ' + cmd, 'info');
        document.getElementById('statusText').textContent = 'Running ' + cmd + '...';

        try {
            const results = await chrome.scripting.executeScript({
                target: { tabId: this.state.tabId },
                func: (command, cmdArgs) => {
                    try {
                        console.log('[NEXUS] Executing:', command, cmdArgs);

                        // Command mapping
                        const commands = {
                            // Core scan
                            'start': () => typeof start === 'function' ? start() : (typeof scan === 'function' && scan()),
                            'scan': () => typeof scan === 'function' && scan(),
                            'quickScan': () => typeof quickScan === 'function' ? quickScan() : (window.Scanner?.quickScan?.()),
                            'deepScan': () => typeof deepScan === 'function' ? deepScan() : (window.Scanner?.deepScan?.()),
                            'stop': () => typeof stop === 'function' && stop(),
                            'STOP': () => typeof STOP === 'function' && STOP(),

                            // Dashboard
                            'dashboard': () => typeof dashboard === 'function' ? dashboard() : (typeof vulns === 'function' && vulns()),
                            'vulns': () => typeof vulns === 'function' && vulns(),

                            // Vulnerabilities
                            'domxss': () => typeof domxss === 'function' ? domxss() : (typeof xss === 'function' && xss()),
                            'cors': () => typeof cors === 'function' && cors(),
                            'ssrf': () => typeof ssrf === 'function' && ssrf(),
                            'postmessage': () => typeof postmessage === 'function' ? postmessage() : (typeof pm === 'function' && pm()),
                            'headers': () => typeof headers === 'function' ? headers() : (typeof secHeaders === 'function' && secHeaders()),
                            'openRedirect': () => typeof openRedirect === 'function' && openRedirect(),

                            // Results
                            'findings': () => typeof findings === 'function' && findings(),
                            'exploitable': () => typeof exploitable === 'function' && exploitable(),
                            'results': () => typeof results === 'function' && results(),
                            'patterns': () => typeof patterns === 'function' && patterns(),
                            'validate': () => typeof validate === 'function' && validate(),

                            // Discovery
                            'endpoints': () => typeof endpoints === 'function' && endpoints(),
                            'files': () => typeof files === 'function' ? files() : (typeof sensitiveFiles === 'function' && sensitiveFiles()),
                            'forms': () => typeof forms === 'function' && forms(),
                            'scripts': () => typeof scripts === 'function' && scripts(),

                            // Show category
                            'showCategory': () => typeof showCategory === 'function' && showCategory(cmdArgs.category),

                            // Automation
                            'autoExploit': () => typeof autoExploit === 'function' ? autoExploit() : (typeof auto === 'function' && auto()),
                            'deepExploit': () => {
                                if (typeof deepExploit === 'function') {
                                    return cmdArgs.idx !== undefined ? deepExploit(cmdArgs.idx) : deepExploit();
                                }
                            },
                            'fullpwn': () => typeof fullpwn === 'function' ? fullpwn() : (typeof nuke === 'function' && nuke()),
                            'fullstop': () => typeof fullstop === 'function' ? fullstop() : (typeof fullStop === 'function' && fullStop()),

                            // AI
                            'ai': () => typeof ai === 'function' && ai(),
                            'aiAgent': () => typeof aiAgent === 'function' && aiAgent(),
                            'fullReport': () => typeof fullReport === 'function' ? fullReport() : (typeof report === 'function' && report()),
                            'brain': () => typeof brain === 'function' && brain(),
                            'brainStop': () => typeof brainStop === 'function' && brainStop(),
                            'brainStatus': () => typeof brainStatus === 'function' && brainStatus(),
                            'showBackups': () => typeof showBackups === 'function' && showBackups(),

                            // Terminal
                            'sendToTerminal': () => typeof sendToTerminal === 'function' && sendToTerminal(),
                            'syncFindings': () => typeof syncFindings === 'function' && syncFindings(),
                            'runAllCurls': () => typeof runAllCurls === 'function' && runAllCurls(),

                            // Export
                            'exportBounty': () => typeof exportBounty === 'function' && exportBounty(),
                            'exportAll': () => typeof exportAll === 'function' && exportAll(),
                            'exportFindings': () => typeof exportFindings === 'function' && exportFindings(),
                            'exportSecrets': () => typeof exportSecrets === 'function' && exportSecrets(),
                            'exportExploits': () => typeof exportExploits === 'function' && exportExploits(),
                            'exportVulnerabilities': () => typeof exportVulnerabilities === 'function' && exportVulnerabilities(),
                            'exportEndpoints': () => typeof exportEndpoints === 'function' && exportEndpoints(),
                            'exportJSON': () => typeof exportResults === 'function' && exportResults('json'),
                            'exportHTML': () => typeof exportResults === 'function' && exportResults('html'),
                            'exportMarkdown': () => typeof exportMarkdown === 'function' && exportMarkdown(),

                            // Utility
                            'help': () => typeof help === 'function' && help(),
                            'status': () => typeof status === 'function' && status(),
                            'diagnose': () => typeof diagnose === 'function' && diagnose()
                        };

                        if (commands[command]) {
                            commands[command]();
                            return { success: true };
                        } else if (typeof window[command] === 'function') {
                            window[command](cmdArgs);
                            return { success: true };
                        }
                        return { success: false, error: 'Command not found' };
                    } catch (e) {
                        console.error('[NEXUS]', e);
                        return { success: false, error: e.message };
                    }
                },
                args: [cmd, args],
                world: 'MAIN'
            });

            const r = results[0]?.result;
            if (r?.success) {
                this.log(cmd + ' executed', 'success');

                // Auto-refresh findings for scan commands
                if (['start', 'scan', 'quickScan', 'deepScan', 'autoExploit', 'fullpwn'].includes(cmd)) {
                    this.startAutoRefresh();
                }

                // Stop auto-refresh for stop commands
                if (['stop', 'STOP', 'fullstop'].includes(cmd)) {
                    this.stopAutoRefresh();
                }
            } else if (r?.error) {
                this.log(cmd + ' failed: ' + r.error, 'error');
            }
        } catch (e) {
            this.log('Error: ' + e.message, 'error');
        }

        document.getElementById('statusText').textContent = 'Ready';
    }

    startAutoRefresh() {
        this.stopAutoRefresh(); // Clear existing
        this.log('Auto-refresh started (every 3s)', 'info');
        this.autoRefreshInterval = setInterval(() => {
            this.refreshFindings();
        }, 3000);

        // Initial refresh after 1 second
        setTimeout(() => this.refreshFindings(), 1000);
    }

    stopAutoRefresh() {
        if (this.autoRefreshInterval) {
            clearInterval(this.autoRefreshInterval);
            this.autoRefreshInterval = null;
            this.log('Auto-refresh stopped', 'info');
        }
    }

    // ==================== AI ====================
    async setAIKey() {
        const key = document.getElementById('aiApiKey').value.trim();
        if (!key) {
            this.notify('Enter API key', true);
            return;
        }

        this.state.settings.aiApiKey = key;
        await this.saveSettings();

        const provider = this.state.aiProvider;
        this.log('Validating AI key via extension...', 'info');

        // FIRST: Validate directly via background.js (bypasses CSP)
        try {
            const validationResult = await new Promise((resolve) => {
                chrome.runtime.sendMessage({
                    type: 'AI_VALIDATE_KEY',
                    provider: provider,
                    apiKey: key
                }, (response) => {
                    if (chrome.runtime.lastError) {
                        resolve({ valid: false, error: chrome.runtime.lastError.message });
                    } else {
                        resolve(response || { valid: false, error: 'No response' });
                    }
                });
            });

            if (validationResult?.valid) {
                this.updateStatus('ai', true);
                this.log(`✅ AI VALIDATED: ${validationResult.provider}`, 'success');
                this.log(`Available models: ${(validationResult.models || []).length}`, 'info');
                this.notify('AI Key Validated!');
                this.updateAIStatusIndicator(true, validationResult.provider);

                // Now inform the page about the validated key
                await this.setPageAIConfig(key, validationResult.provider, true);
                return;
            } else {
                this.log(`Validation failed: ${validationResult?.error || 'Unknown'}`, 'warning');
            }
        } catch (e) {
            this.log('Extension validation error: ' + e.message, 'warning');
        }

        // FALLBACK: Try via page (may fail due to CSP)
        this.log('Trying via page (may be blocked by CSP)...', 'info');
        const result = await chrome.scripting.executeScript({
            target: { tabId: this.state.tabId },
            func: async (apiKey, providerHint) => {
                try {
                    // Primary method: Use setAI which calls AIAgent.init()
                    if (typeof window.setAI === 'function') {
                        const success = await window.setAI(apiKey, providerHint);
                        const cspBlocked = window.AIAgent?.config?.cspBlocked || false;
                        const bypassMethod = window.AIAgent?.cspBypass?.currentMethod || 'direct';

                        return {
                            success: success === true || success === 'csp_blocked',
                            method: 'setAI',
                            provider: window.AIAgent?.config?.provider || providerHint,
                            isValidated: window.AIAgent?.config?.isValidated || false,
                            cspBlocked: cspBlocked,
                            cspResult: success === 'csp_blocked' ? 'blocked' : 'ok',
                            bypassMethod: bypassMethod,
                            terminalConnected: window.TerminalBridge?.isConnected?.() || false
                        };
                    }
                    // Fallback: Direct AIAgent.init()
                    if (window.AIAgent?.init) {
                        const success = await window.AIAgent.init(apiKey, providerHint);
                        return {
                            success: success === true || success === 'csp_blocked',
                            method: 'AIAgent.init',
                            provider: window.AIAgent.config.provider,
                            isValidated: window.AIAgent.config.isValidated,
                            cspBlocked: window.AIAgent.config.cspBlocked,
                            cspResult: success === 'csp_blocked' ? 'blocked' : 'ok'
                        };
                    }
                    return { success: false, error: 'AIAgent not found' };
                } catch (e) {
                    return { success: false, error: e.message, cspBlocked: e.message.includes('Content Security Policy') };
                }
            },
            args: [key, provider],
            world: 'MAIN'
        });

        const aiResult = result?.[0]?.result;

        // Handle CSP blocked scenario
        if (aiResult?.cspBlocked || aiResult?.cspResult === 'blocked') {
            this.updateStatus('ai', true);
            this.log(`⚠️ CSP blocking AI on this site`, 'warning');
            this.log(`Key saved: ${aiResult.provider}`, 'info');

            if (aiResult?.terminalConnected) {
                this.log('✅ Terminal connected - can proxy AI', 'success');
                this.updateAIStatusIndicator(true, `${aiResult.provider} (proxy)`);
                this.notify('AI via terminal proxy!');
            } else {
                this.log('Connect terminal for AI bypass', 'info');
                this.updateAIStatusIndicator(false, `${aiResult.provider} (CSP)`);
                this.notify('Key saved - CSP blocks direct calls', true);
            }
            return;
        }

        if (aiResult?.success && aiResult?.isValidated) {
            this.updateStatus('ai', true);
            const mode = aiResult.bypassMethod !== 'direct' ? ` (${aiResult.bypassMethod})` : '';
            this.log(`AI CONNECTED: ${aiResult.provider}${mode} ✅`, 'success');
            this.notify('AI Connected & Validated!');
            this.updateAIStatusIndicator(true, aiResult.provider);
        } else if (aiResult?.success) {
            this.updateStatus('ai', true);
            this.log(`AI configured (unvalidated): ${aiResult.provider}`, 'info');
            this.notify('AI key set - validation pending');
            this.updateAIStatusIndicator(false, aiResult.provider);
        } else {
            this.updateStatus('ai', false);
            this.log(`AI setup failed: ${aiResult?.error || 'Unknown error'}`, 'error');
            this.notify('AI connection failed!', true);
            this.updateAIStatusIndicator(false);
        }
    }

    // Set page AIAgent config with pre-validated key
    async setPageAIConfig(apiKey, provider, isValidated) {
        try {
            await chrome.scripting.executeScript({
                target: { tabId: this.state.tabId },
                func: async (key, prov, validated) => {
                    // Mark extension as AI proxy available
                    window.__NEXUS_AI_EXTENSION_PROXY__ = true;
                    window.__NEXUS_AI_VALIDATED__ = validated;
                    window.__NEXUS_AI_PROVIDER__ = prov;
                    window.__NEXUS_AI_KEY__ = key;

                    // Try to call page's setAI with skipValidation flag
                    if (typeof window.setAI === 'function') {
                        try {
                            // Pass skipValidation=true since we already validated via extension
                            await window.setAI(key, prov, true);
                            console.log('%c[NEXUS] AI configured via page setAI (pre-validated)', 'color: #22c55e; font-weight: bold');
                            return;
                        } catch (e) {
                            console.log('[NEXUS] Page setAI failed, creating proxy:', e.message);
                        }
                    }

                    // Create or update AIAgent with validated config and proxy ask function
                    if (!window.AIAgent) {
                        window.AIAgent = {};
                    }

                    window.AIAgent.config = {
                        apiKey: key,
                        provider: prov,
                        isValidated: validated,
                        cspBlocked: false,
                        useExtension: true
                    };

                    // Provider endpoints for extension proxy
                    const endpoints = {
                        groq: 'https://api.groq.com/openai/v1/chat/completions',
                        openai: 'https://api.openai.com/v1/chat/completions',
                        anthropic: 'https://api.anthropic.com/v1/messages',
                        gemini: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent',
                        deepseek: 'https://api.deepseek.com/v1/chat/completions',
                        openrouter: 'https://openrouter.ai/api/v1/chat/completions'
                    };

                    const models = {
                        groq: 'llama-3.3-70b-versatile',
                        openai: 'gpt-4o-mini',
                        anthropic: 'claude-3-haiku-20240307',
                        gemini: 'gemini-pro',
                        deepseek: 'deepseek-chat',
                        openrouter: 'openai/gpt-4o-mini'
                    };

                    // Create ask function that uses extension proxy
                    window.AIAgent.ask = async function (prompt) {
                        return new Promise((resolve, reject) => {
                            const requestId = 'ai_' + Date.now();

                            // Build request based on provider
                            let url = endpoints[prov] || endpoints.groq;
                            let options = {
                                method: 'POST',
                                headers: {
                                    'Content-Type': 'application/json'
                                }
                            };

                            if (prov === 'anthropic') {
                                options.headers['x-api-key'] = key;
                                options.headers['anthropic-version'] = '2023-06-01';
                                options.body = JSON.stringify({
                                    model: models.anthropic,
                                    max_tokens: 4096,
                                    messages: [{ role: 'user', content: prompt }]
                                });
                            } else if (prov === 'gemini') {
                                url += `?key=${key}`;
                                options.body = JSON.stringify({
                                    contents: [{ parts: [{ text: prompt }] }]
                                });
                            } else {
                                // OpenAI-compatible format (Groq, OpenAI, DeepSeek, OpenRouter)
                                options.headers['Authorization'] = `Bearer ${key}`;
                                options.body = JSON.stringify({
                                    model: models[prov] || models.groq,
                                    messages: [{ role: 'user', content: prompt }],
                                    temperature: 0.7,
                                    max_tokens: 4096
                                });
                            }

                            // Listen for response
                            const handler = (event) => {
                                if (event.data?.nexusResponse && event.data?.type === 'aiResponse' && event.data?.requestId === requestId) {
                                    window.removeEventListener('message', handler);
                                    if (event.data.success) {
                                        // Extract response based on provider
                                        let text = '';
                                        const data = event.data.data;
                                        if (prov === 'anthropic') {
                                            text = data.content?.[0]?.text || '';
                                        } else if (prov === 'gemini') {
                                            text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
                                        } else {
                                            text = data.choices?.[0]?.message?.content || '';
                                        }
                                        resolve(text);
                                    } else {
                                        reject(new Error(event.data.error || 'AI request failed'));
                                    }
                                }
                            };

                            window.addEventListener('message', handler);

                            // Send request via extension
                            window.postMessage({
                                nexusExtension: true,
                                action: 'aiCall',
                                requestId: requestId,
                                url: url,
                                options: options
                            }, '*');

                            // Timeout
                            setTimeout(() => {
                                window.removeEventListener('message', handler);
                                reject(new Error('AI request timeout'));
                            }, 60000);
                        });
                    };

                    console.log('%c[NEXUS] AI configured via extension proxy - CSP bypassed!', 'color: #22c55e; font-weight: bold');
                    console.log('%c   Provider:', 'color: #94a3b8;', prov);
                    console.log('%c   Validated:', 'color: #94a3b8;', validated);
                    console.log('%c   Use: AIAgent.ask("your question")', 'color: #94a3b8;');
                },
                args: [apiKey, provider, isValidated],
                world: 'MAIN'
            });
        } catch (e) {
            console.log('[NEXUS] Failed to set page AI config:', e);
        }
    }

    // AI Status Indicator Update
    updateAIStatusIndicator(connected, provider = '', cspBlocked = false) {
        const indicator = document.getElementById('aiStatusIndicator');
        if (!indicator) return;

        // Check for CSP in provider string
        const isCSP = provider.includes('CSP') || provider.includes('proxy') || cspBlocked;

        if (connected) {
            if (provider.includes('proxy')) {
                indicator.innerHTML = `<span style="color:#22c55e;">● CONNECTED</span> <small style="color:#818cf8;">(${provider})</small>`;
                indicator.className = 'ai-status connected';
            } else {
                indicator.innerHTML = `<span style="color:#22c55e;">● CONNECTED</span> <small>(${provider})</small>`;
                indicator.className = 'ai-status connected';
            }
        } else if (provider && provider.includes('CSP')) {
            // CSP blocked but key saved
            indicator.innerHTML = `<span style="color:#f59e0b;">● CSP BLOCKED</span> <small style="color:#94a3b8;">${provider.replace(' (CSP)', '')}</small><br><small style="color:#94a3b8;">Connect terminal for bypass</small>`;
            indicator.className = 'ai-status csp-blocked';
        } else if (provider) {
            indicator.innerHTML = `<span style="color:#f59e0b;">● PENDING</span> <small>(${provider})</small>`;
            indicator.className = 'ai-status pending';
        } else {
            indicator.innerHTML = `<span style="color:#f43f5e;">● DISCONNECTED</span>`;
            indicator.className = 'ai-status disconnected';
        }
    }

    // Test AI Connection
    async testAIConnection() {
        this.log('Testing AI connection...', 'info');

        const result = await chrome.scripting.executeScript({
            target: { tabId: this.state.tabId },
            func: async () => {
                try {
                    // Check if AIAgent exists and is configured
                    if (!window.AIAgent) {
                        return { success: false, error: 'AIAgent not loaded' };
                    }

                    const config = window.AIAgent.config;
                    if (!config.apiKey) {
                        return { success: false, error: 'No API key configured' };
                    }

                    // Test with actual validation
                    const isValid = await window.AIAgent.validateAPIKey(true);

                    return {
                        success: isValid,
                        provider: config.provider,
                        isActive: config.isActive,
                        isValidated: config.isValidated,
                        message: isValid ? 'Connection successful!' : 'Validation failed'
                    };
                } catch (e) {
                    return { success: false, error: e.message };
                }
            },
            args: [],
            world: 'MAIN'
        });

        const testResult = result?.[0]?.result;

        if (testResult?.success) {
            this.log(`AI TEST PASSED: ${testResult.provider} ✅`, 'success');
            this.notify('AI Connection OK!');
            this.updateAIStatusIndicator(true, testResult.provider);
            this.updateStatus('ai', true);
        } else {
            this.log(`AI TEST FAILED: ${testResult?.error || 'Unknown error'}`, 'error');
            this.notify('AI test failed!', true);
            this.updateAIStatusIndicator(false);
            this.updateStatus('ai', false);
        }

        return testResult?.success;
    }

    // Get current AI status
    async getAIStatus() {
        const result = await chrome.scripting.executeScript({
            target: { tabId: this.state.tabId },
            func: () => {
                if (!window.AIAgent) return { connected: false, reason: 'Not loaded' };
                const c = window.AIAgent.config;
                return {
                    connected: c.isActive && c.isValidated,
                    provider: c.provider,
                    isActive: c.isActive,
                    isValidated: c.isValidated,
                    hasKey: !!c.apiKey
                };
            },
            args: [],
            world: 'MAIN'
        });

        const status = result?.[0]?.result;
        this.updateAIStatusIndicator(status?.connected, status?.provider);
        return status;
    }

    async askAI() {
        const question = document.getElementById('aiQuestion').value.trim();
        if (!question) {
            this.notify('Enter a question', true);
            return;
        }

        this.log('Asking AI...', 'info');

        await chrome.scripting.executeScript({
            target: { tabId: this.state.tabId },
            func: (q) => {
                if (typeof askAI === 'function') {
                    askAI(q);
                } else if (window.AIAgent?.query) {
                    window.AIAgent.query(q);
                } else if (window.TerminalBridge?.isConnected?.()) {
                    window.TerminalBridge.send({ type: 'ai_query', query: q });
                }
            },
            args: [question],
            world: 'MAIN'
        });

        this.log('AI query sent - check console', 'success');
    }

    // Sync Findings to Terminal with AI Analysis
    async syncFindingsToTerminal() {
        this.log('Syncing findings to terminal...', 'info');

        const result = await chrome.scripting.executeScript({
            target: { tabId: this.state.tabId },
            func: async () => {
                try {
                    // Check terminal connection first
                    if (!window.TerminalBridge?.isConnected?.()) {
                        return { success: false, error: 'Terminal not connected' };
                    }

                    // Use syncFindings global function or direct call
                    if (typeof window.syncFindings === 'function') {
                        const result = await window.syncFindings();
                        return { success: true, method: 'syncFindings', result };
                    }

                    // Direct implementation fallback
                    if (typeof syncFindingsToTerminal === 'function') {
                        const result = await syncFindingsToTerminal();
                        return { success: true, method: 'syncFindingsToTerminal', result };
                    }

                    // Manual sync with Scanner findings
                    if (window.Scanner?.getFindings) {
                        const findings = await window.Scanner.getFindings();
                        const stats = window.Scanner.getStats?.() || {};

                        window.TerminalBridge.send({
                            type: 'bulk_findings',
                            data: {
                                findings: findings,
                                stats: stats,
                                source: 'extension_sync',
                                timestamp: Date.now(),
                                aiEnabled: window.AIAgent?.config?.isActive || false
                            }
                        });

                        return {
                            success: true,
                            method: 'manual',
                            count: findings.length,
                            aiEnabled: window.AIAgent?.config?.isActive
                        };
                    }

                    return { success: false, error: 'No findings source available' };
                } catch (e) {
                    return { success: false, error: e.message };
                }
            },
            args: [],
            world: 'MAIN'
        });

        const syncResult = result?.[0]?.result;

        if (syncResult?.success) {
            this.log(`Findings synced! (${syncResult.count || 'all'} findings)`, 'success');
            this.notify('Findings synced to terminal!');
            if (syncResult.aiEnabled) {
                this.log('AI analysis enabled', 'info');
            }
        } else {
            this.log(`Sync failed: ${syncResult?.error || 'Unknown error'}`, 'error');
            this.notify('Sync failed: ' + (syncResult?.error || 'Unknown'), true);
        }
    }

    // ==================== Terminal ====================
    async connectTerminal() {
        // FIRST: Check if already connected to prevent reconnect loop
        const statusCheck = await new Promise((resolve) => {
            chrome.runtime.sendMessage({ type: 'GET_WS_STATUS' }, (resp) => {
                if (chrome.runtime.lastError) {
                    resolve({ connected: false });
                } else {
                    resolve(resp || { connected: false });
                }
            });
        });

        if (statusCheck?.connected) {
            this.log('Terminal already connected - syncing state', 'info');
            this.state.terminalConnected = true;
            this.updateStatus('terminal', true);
            document.getElementById('btnConnect').style.display = 'none';
            document.getElementById('btnDisconnect').style.display = 'block';
            document.getElementById('terminalStatus').textContent = 'Online';
            document.getElementById('terminalStatus').style.background = '#10b981';
            await this.syncPageTerminalState(statusCheck.url);
            this.notify('Already connected!');
            return;
        }

        let url = document.getElementById('wsUrl').value.trim();
        const token = document.getElementById('authToken').value.trim();

        if (!url) {
            this.notify('Enter WebSocket URL', true);
            return;
        }

        // Auto-fix URL format
        if (!url.startsWith('ws://') && !url.startsWith('wss://')) {
            // For cloudflare tunnels and https sites, use wss
            if (url.includes('trycloudflare.com') || url.includes('ngrok') || url.includes('https')) {
                url = 'wss://' + url.replace(/^https?:\/\//, '');
            } else {
                url = 'ws://' + url.replace(/^http:\/\//, '');
            }
            document.getElementById('wsUrl').value = url;
        }

        // Save settings
        this.state.settings.wsUrl = url;
        this.state.settings.authToken = token;
        await this.saveSettings();

        this.log('Connecting to ' + url + '...', 'info');
        document.getElementById('btnConnect').querySelector('.btn-label').textContent = 'Connecting...';

        try {
            const response = await new Promise((resolve) => {
                const timeout = setTimeout(() => {
                    resolve({ success: false, error: 'Connection timeout (20s) - check if terminal server is running' });
                }, 20000);

                chrome.runtime.sendMessage({
                    type: 'CONNECT_TERMINAL',
                    url: url,
                    token: token
                }, (resp) => {
                    clearTimeout(timeout);
                    if (chrome.runtime.lastError) {
                        resolve({ success: false, error: chrome.runtime.lastError.message });
                    } else {
                        resolve(resp || { success: false, error: 'No response from background' });
                    }
                });
            });

            if (response?.success) {
                this.state.terminalConnected = true;
                this.updateStatus('terminal', true);
                document.getElementById('btnConnect').style.display = 'none';
                document.getElementById('btnDisconnect').style.display = 'block';
                document.getElementById('terminalStatus').textContent = 'Online';
                document.getElementById('terminalStatus').style.background = '#10b981';
                this.log('Terminal connected!', 'success');
                this.notify('Terminal connected!');

                // Notify the page that terminal is connected via extension
                await chrome.scripting.executeScript({
                    target: { tabId: this.state.tabId },
                    func: (wsUrl, wsToken) => {
                        // Mark extension terminal as connected
                        window.__NEXUS_TERMINAL_VIA_EXTENSION__ = true;
                        window.__NEXUS_TERMINAL_URL__ = wsUrl;

                        // Create a bridge object if TerminalBridge doesn't exist
                        if (!window.TerminalBridge) {
                            window.TerminalBridge = {
                                connected: true,
                                authenticated: true,
                                serverUrl: wsUrl,
                                isConnected: () => true,
                                send: (data) => {
                                    window.postMessage({
                                        nexusExtension: true,
                                        action: 'send',
                                        payload: data
                                    }, '*');
                                },
                                _send: (data) => window.TerminalBridge.send(data)
                            };
                        } else {
                            // Update existing TerminalBridge - MUST override isConnected() method!
                            window.TerminalBridge.connected = true;
                            window.TerminalBridge.authenticated = true;
                            window.TerminalBridge.serverUrl = wsUrl;
                            window.TerminalBridge.useExtension = true;

                            // CRITICAL FIX: Override isConnected to return true when extension is managing connection
                            window.TerminalBridge.isConnected = function () {
                                return window.TerminalBridge.connected === true ||
                                    window.__NEXUS_TERMINAL_VIA_EXTENSION__ === true;
                            };

                            // Override send to use extension relay
                            const originalSend = window.TerminalBridge.send?.bind(window.TerminalBridge);
                            window.TerminalBridge.send = function (data) {
                                if (window.__NEXUS_TERMINAL_VIA_EXTENSION__) {
                                    window.postMessage({
                                        nexusExtension: true,
                                        action: 'send',
                                        payload: data
                                    }, '*');
                                    return { success: true };
                                }
                                return originalSend ? originalSend(data) : { success: false };
                            };
                        }

                        console.log('%c[NEXUS] Terminal connected via extension', 'color: #22c55e; font-weight: bold');
                    },
                    args: [url, token],
                    world: 'MAIN'
                });

            } else {
                throw new Error(response?.error || 'Connection failed');
            }

        } catch (e) {
            this.log('Connect failed: ' + e.message, 'error');
            this.notify('Connect failed: ' + e.message, true);
        } finally {
            document.getElementById('btnConnect').querySelector('.btn-label').textContent = 'Connect';
        }
    }

    disconnectTerminal() {
        chrome.runtime.sendMessage({ type: 'DISCONNECT_TERMINAL' });
        this.state.terminalConnected = false;
        this.updateStatus('terminal', false);
        document.getElementById('btnConnect').style.display = 'block';
        document.getElementById('btnDisconnect').style.display = 'none';
        document.getElementById('terminalStatus').textContent = 'Offline';
        document.getElementById('terminalStatus').style.background = '';
        this.log('Terminal disconnected', 'info');
    }

    executeTerminalCmd() {
        const cmd = document.getElementById('cmdInput').value.trim();
        if (!cmd) return;

        const output = document.getElementById('terminalOutput');
        output.innerHTML += '<div>$ ' + this.escapeHtml(cmd) + '</div>';

        if (this.state.terminalConnected) {
            chrome.runtime.sendMessage({
                type: 'RELAY_TO_TERMINAL',
                data: { type: 'command', command: cmd }
            });
            this.log('Command sent: ' + cmd, 'success');
        } else {
            // Execute locally
            this.executeCmd(cmd);
        }

        document.getElementById('cmdInput').value = '';
        output.scrollTop = output.scrollHeight;
    }

    // ==================== Remote Terminal Control ====================

    // Deploy nexus-terminal.js from GitHub to terminal
    async deployTerminalScript() {
        if (!this.state.terminalConnected) {
            this.notify('Connect to terminal first!', true);
            return;
        }

        this.log('Deploying nexus-terminal.js from GitHub...', 'info');
        const output = document.getElementById('remoteOutput');
        output.innerHTML = '<div>📥 Fetching script from GitHub...</div>';

        try {
            // Fetch script in extension
            const response = await fetch('https://raw.githubusercontent.com/kuh4ff/website-scanner/main/nexus-terminal.js');
            if (!response.ok) throw new Error('Fetch failed: ' + response.status);
            const scriptContent = await response.text();

            output.innerHTML += '<div>✅ Script fetched (' + Math.round(scriptContent.length / 1024) + 'KB)</div>';
            output.innerHTML += '<div>📤 Sending to terminal...</div>';

            // Send script content to terminal
            chrome.runtime.sendMessage({
                type: 'RELAY_TO_TERMINAL',
                data: {
                    type: 'deploy_script',
                    scriptName: 'nexus-terminal.js',
                    content: scriptContent,
                    source: 'extension_deploy'
                }
            });

            this.log('Script sent to terminal', 'success');
            this.notify('Script sent to terminal!');

        } catch (e) {
            output.innerHTML += `<div style="color:red">❌ Error: ${e.message}</div>`;
            this.log('Deploy failed: ' + e.message, 'error');
        }
    }

    // Update terminal script from GitHub
    async updateTerminalScript() {
        if (!this.state.terminalConnected) {
            this.notify('Connect to terminal first!', true);
            return;
        }

        this.log('Updating terminal script from GitHub...', 'info');
        const output = document.getElementById('remoteOutput');
        output.innerHTML = '<div>🔄 Updating script...</div>';

        // Just download new version, let user restart manually
        const updateCmd = `curl -sL https://raw.githubusercontent.com/kuh4ff/website-scanner/main/nexus-terminal.js -o nexus-terminal.js && echo "✅ Updated! Run 'node nexus-terminal.js' to restart"`;

        chrome.runtime.sendMessage({
            type: 'RELAY_TO_TERMINAL',
            data: {
                type: 'shell_exec',
                command: updateCmd,
                source: 'extension_update'
            }
        });

        output.innerHTML += '<div>📤 Update command sent</div>';
        this.log('Update command sent', 'success');
        this.notify('Update command sent!');
    }

    // Execute remote shell command on terminal
    async remoteShellExec() {
        const cmd = document.getElementById('remoteShellCmd').value.trim();
        if (!cmd) {
            this.notify('Enter a command', true);
            return;
        }

        if (!this.state.terminalConnected) {
            this.notify('Connect to terminal first!', true);
            return;
        }

        this.log('Executing remote: ' + cmd, 'info');
        const output = document.getElementById('remoteOutput');
        output.innerHTML += `<div style="color: #8b5cf6;">$ ${this.escapeHtml(cmd)}</div>`;

        // Send shell command to terminal
        chrome.runtime.sendMessage({
            type: 'RELAY_TO_TERMINAL',
            data: {
                type: 'shell_exec',
                command: cmd,
                source: 'extension_remote'
            }
        });

        // Clear input
        document.getElementById('remoteShellCmd').value = '';
        output.scrollTop = output.scrollHeight;
        this.log('Remote command sent', 'success');
    }

    // ==================== UI Updates ====================
    updateStatus(type, active) {
        const el = document.getElementById('status' + type.charAt(0).toUpperCase() + type.slice(1));
        if (el) {
            if (active) {
                el.classList.add('active');
            } else {
                el.classList.remove('active');
            }
        }
    }

    updateUI() {
        // Update stats if scanner is loaded
        if (this.state.scriptLoaded) {
            this.refreshFindings();
        }
    }

    log(message, type = 'info') {
        const container = document.getElementById('activityLog');
        const entry = document.createElement('div');
        entry.className = 'log-entry ' + type;
        const time = new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' });
        entry.innerHTML = '<span class="log-time">' + time + '</span>' + this.escapeHtml(message);
        container.appendChild(entry);
        container.scrollTop = container.scrollHeight;

        while (container.children.length > 100) {
            container.removeChild(container.firstChild);
        }
    }

    clearLog() {
        document.getElementById('activityLog').innerHTML = '<div class="log-entry"><span class="log-time">--:--</span>Log cleared</div>';
    }

    notify(message, isError = false) {
        if (!this.state.settings.notifications) return;

        const el = document.getElementById('notification');
        el.textContent = message;
        el.className = 'notification show' + (isError ? ' error' : '');

        setTimeout(() => el.classList.remove('show'), 3000);
    }

    escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    // ==================== Findings Display ====================
    async refreshFindings() {
        const btn = document.getElementById('btnRefreshFindings');
        const btn2 = document.getElementById('btnRefreshFindings2');
        if (btn) btn.classList.add('spinning');
        if (btn2) btn2.classList.add('spinning');

        try {
            const results = await chrome.scripting.executeScript({
                target: { tabId: this.state.tabId },
                func: () => {
                    const data = {
                        findings: [],
                        secrets: [],
                        vulnerabilities: [],
                        endpoints: [],
                        stats: { total: 0, critical: 0, high: 0, medium: 0, low: 0 }
                    };

                    // Method 1: Use Scanner API (CORRECT WAY)
                    if (window.Scanner?.getStats && window.Scanner?.getFindings) {
                        const stats = window.Scanner.getStats();
                        data.stats = {
                            total: stats.total || stats.findings || 0,
                            critical: stats.critical || 0,
                            high: 0,
                            medium: 0,
                            low: 0,
                            live: stats.live || 0,
                            validated: stats.validated || 0,
                            exploitable: stats.exploitable || 0
                        };
                        data.findings = window.Scanner.getFindings() || [];
                        data.secrets = data.findings.filter(f =>
                            f.type?.includes('API') || f.type?.includes('KEY') || f.type?.includes('TOKEN') || f.type?.includes('SECRET')
                        );
                    }

                    // Method 2: Direct Vault access
                    else if (window.__NEXUS__?.Vault) {
                        const vault = window.__NEXUS__.Vault;
                        data.stats = {
                            total: vault.stats?.total || 0,
                            critical: vault.stats?.critical || 0,
                            high: 0,
                            medium: 0,
                            low: 0,
                            live: vault.stats?.live || 0,
                            validated: vault.stats?.validated || 0
                        };

                        // Convert Vault.secrets Map to array
                        if (vault.secrets instanceof Map) {
                            vault.secrets.forEach((entry, value) => {
                                data.findings.push({
                                    value: value.substring(0, 80) + (value.length > 80 ? '...' : ''),
                                    fullValue: value,
                                    type: entry.type,
                                    severity: entry.severity,
                                    source: entry.source,
                                    status: entry.status
                                });
                            });
                        }

                        data.secrets = data.findings.filter(f =>
                            f.severity === 'CRITICAL' || f.severity === 'HIGH'
                        );
                    }

                    // Count severity
                    data.findings.forEach(f => {
                        const sev = (f.severity || '').toUpperCase();
                        if (sev === 'CRITICAL') data.stats.critical++;
                        else if (sev === 'HIGH') data.stats.high++;
                        else if (sev === 'MEDIUM') data.stats.medium++;
                        else data.stats.low++;
                    });

                    // Get endpoints if available
                    if (window.__NEXUS__?.DataCollector?.endpoints) {
                        data.endpoints = Array.from(window.__NEXUS__.DataCollector.endpoints || []).slice(0, 50);
                    }

                    // Get vulnerabilities
                    if (window.__NEXUS__?.VulnScanner?.findings) {
                        data.vulnerabilities = window.__NEXUS__.VulnScanner.findings || [];
                    }

                    return data;
                },
                world: 'MAIN'
            });

            const data = results[0]?.result;
            if (data) {
                this.displayFindings(data);
            }

        } catch (e) {
            console.error('Refresh findings error:', e);
            this.log('Refresh failed: ' + e.message, 'error');
        } finally {
            if (btn) btn.classList.remove('spinning');
            if (btn2) btn2.classList.remove('spinning');
        }
    }

    displayFindings(data) {
        const { findings, secrets, vulnerabilities, endpoints, stats } = data;

        // Update stats counters
        document.getElementById('statFindings').textContent = findings.length || stats.total || 0;
        document.getElementById('statSecrets').textContent = secrets.length || 0;
        document.getElementById('statVulns').textContent = vulnerabilities.length || 0;
        document.getElementById('statExploits').textContent = stats.exploitable || stats.critical || 0;

        // Update severity counts (home page)
        const criticalEl = document.getElementById('criticalCount');
        const highEl = document.getElementById('highCount');
        const mediumEl = document.getElementById('mediumCount');
        const lowEl = document.getElementById('lowCount');
        if (criticalEl) criticalEl.textContent = stats.critical || 0;
        if (highEl) highEl.textContent = stats.high || 0;
        if (mediumEl) mediumEl.textContent = stats.medium || 0;
        if (lowEl) lowEl.textContent = stats.low || 0;

        // Update findings page stats
        const totalEl = document.getElementById('totalFindings2');
        const critEl = document.getElementById('criticalFindings');
        const highFEl = document.getElementById('highFindings');
        const medFEl = document.getElementById('mediumFindings');
        if (totalEl) totalEl.textContent = findings.length || stats.total || 0;
        if (critEl) critEl.textContent = stats.critical || 0;
        if (highFEl) highFEl.textContent = stats.high || 0;
        if (medFEl) medFEl.textContent = stats.medium || 0;

        // Update badge counts
        const secCount = document.getElementById('secretsCount2');
        const vulnCount = document.getElementById('vulnsCount2');
        const endCount = document.getElementById('endpointsCount');
        if (secCount) secCount.textContent = secrets.length || 0;
        if (vulnCount) vulnCount.textContent = vulnerabilities.length || 0;
        if (endCount) endCount.textContent = endpoints.length || 0;

        // Render findings list (home page)
        const panel = document.getElementById('findingsPanel');
        if (panel) {
            if (findings.length === 0) {
                panel.innerHTML = '<div class="empty-state"><div class="empty-state-icon">🔍</div><div class="empty-state-text">No findings yet. Run start() or quickScan()</div></div>';
            } else {
                panel.innerHTML = findings.slice(0, 15).map((f, i) => this.renderFinding(f, i)).join('');
            }
        }

        // Render secrets panel
        const secretsPanel = document.getElementById('secretsPanel');
        if (secretsPanel) {
            if (secrets.length === 0) {
                secretsPanel.innerHTML = '<div class="empty-state"><div class="empty-state-icon">🔐</div><div class="empty-state-text">No secrets found yet</div></div>';
            } else {
                secretsPanel.innerHTML = secrets.slice(0, 10).map((s, i) => this.renderFinding(s, i, 'secret')).join('');
            }
        }

        // Render vulns panel
        const vulnsPanel = document.getElementById('vulnsPanel');
        if (vulnsPanel) {
            if (vulnerabilities.length === 0) {
                vulnsPanel.innerHTML = '<div class="empty-state"><div class="empty-state-icon">⚠️</div><div class="empty-state-text">No vulnerabilities found yet</div></div>';
            } else {
                vulnsPanel.innerHTML = vulnerabilities.slice(0, 10).map((v, i) => this.renderFinding(v, i, 'vuln')).join('');
            }
        }

        // Render endpoints panel
        const endpointsPanel = document.getElementById('endpointsPanel');
        if (endpointsPanel) {
            if (!endpoints || endpoints.length === 0) {
                endpointsPanel.innerHTML = '<div class="empty-state"><div class="empty-state-icon">🔗</div><div class="empty-state-text">No endpoints discovered yet</div></div>';
            } else {
                endpointsPanel.innerHTML = endpoints.slice(0, 10).map((e, i) => {
                    const url = typeof e === 'string' ? e : (e.url || e.endpoint || '');
                    return `
                        <div class="finding-item info" data-idx="${i}">
                            <span class="finding-icon">🔗</span>
                            <div class="finding-content">
                                <div class="finding-title">${this.escapeHtml(url.substring(0, 80))}</div>
                            </div>
                            <div class="finding-actions">
                                <button class="finding-action" title="Copy" data-copy="${this.escapeHtml(url)}">📋</button>
                            </div>
                        </div>
                    `;
                }).join('');

                // Add copy listeners
                endpointsPanel.querySelectorAll('[data-copy]').forEach(btn => {
                    btn.addEventListener('click', () => {
                        navigator.clipboard.writeText(btn.dataset.copy);
                        this.notify('Copied!');
                    });
                });
            }
        }

        this.log('Findings: ' + findings.length + ' total, ' + stats.critical + ' critical', 'success');

        // Add click handlers for copy and exploit buttons
        document.querySelectorAll('.copy-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const value = btn.dataset.value || '';
                navigator.clipboard.writeText(value);
                this.notify('Copied to clipboard!');
            });
        });

        document.querySelectorAll('.exploit-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const idx = parseInt(btn.dataset.idx);
                this.exploitFinding(idx);
            });
        });
    }

    renderFinding(f, idx, type = 'finding') {
        const severity = (f.severity || 'LOW').toUpperCase();
        let sevClass = 'low';
        if (severity === 'CRITICAL') sevClass = 'critical';
        else if (severity === 'HIGH') sevClass = 'high';
        else if (severity === 'MEDIUM') sevClass = 'medium';

        const icon = type === 'secret' ? '🔐' : (type === 'vuln' ? '⚠️' : '🎯');
        const title = f.type || f.category || f.name || 'Finding';
        const value = f.value || f.fullValue || f.match || '';
        const source = f.source || f.file || f.location || '';
        const status = f.status || '';

        const valueToShow = value.length > 60 ? value.substring(0, 60) + '...' : value;
        const valueForCopy = value.replace(/`/g, '\\`').replace(/\$/g, '\\$');

        return `
            <div class="finding-item ${sevClass}" data-idx="${idx}">
                <span class="finding-icon">${icon}</span>
                <div class="finding-content">
                    <div class="finding-title">${this.escapeHtml(title)}</div>
                    <div class="finding-meta">
                        <span class="finding-badge ${sevClass}">${severity}</span>
                        ${status ? '<span style="color:#22c55e;">✓ ' + status + '</span>' : ''}
                        ${source ? '<span>' + this.escapeHtml(source.substring(0, 30)) + '</span>' : ''}
                    </div>
                    ${value ? '<div class="finding-value">' + this.escapeHtml(valueToShow) + '</div>' : ''}
                </div>
                <div class="finding-actions">
                    <button class="finding-action copy-btn" title="Copy" data-value="${this.escapeHtml(value)}">📋</button>
                    <button class="finding-action exploit-btn" title="Deep Exploit" data-idx="${idx}">⚡</button>
                </div>
            </div>
        `;
    }

    async exploitFinding(idx) {
        this.log('Exploiting finding #' + idx, 'info');
        await this.executeCmd('deepExploit', { idx: idx });
    }
}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    window.nexus = new NexusExtension();
});

