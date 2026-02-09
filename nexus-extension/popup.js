/**
 * NEXUS Scanner Pro v3.0 - Popup Controller
 * Complete Remote Control System
 */

class NexusPopup {
    constructor() {
        this.state = {
            connected: false,
            tabId: null,
            scriptLoaded: false,
            scriptCache: null,
            ws: null,
            settings: {
                autoInject: false,
                notifications: true,
                githubUrl: 'https://raw.githubusercontent.com/kuh4ff/website-scanner/refs/heads/main/all_phases.js',
                wsUrl: '',
                authToken: ''
            },
            stats: { findings: 0, apiKeys: 0, tokens: 0 }
        };
        this.init();
    }
    
    async init() {
        await this.loadSettings();
        this.setupTabs();
        this.setupActions();
        this.getActiveTab();
        this.updateUI();
        this.log('Extension ready', 'info');
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
            
            if (this.state.settings.autoInject) {
                document.getElementById('toggleAutoInject').classList.add('active');
            }
            if (this.state.settings.notifications) {
                document.getElementById('toggleNotifications').classList.add('active');
            }
        } catch (e) {
            console.error('Load settings error:', e);
        }
    }
    
    async saveSettings() {
        try {
            await chrome.storage.local.set({ nexusSettings: this.state.settings });
        } catch (e) {
            console.error('Save settings error:', e);
        }
    }
    
    // ==================== Tabs ====================
    setupTabs() {
        document.querySelectorAll('.tab').forEach(tab => {
            tab.addEventListener('click', () => {
                document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
                document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
                tab.classList.add('active');
                document.getElementById('panel-' + tab.dataset.tab).classList.add('active');
            });
        });
    }
    
    // ==================== Actions ====================
    setupActions() {
        // Scanner Actions
        document.getElementById('btnInject').addEventListener('click', () => this.injectScript());
        document.getElementById('btnQuickScan').addEventListener('click', () => this.executeScan('quick'));
        document.getElementById('btnDeepScan').addEventListener('click', () => this.executeScan('deep'));
        document.getElementById('btnCopyScript').addEventListener('click', () => this.copyScript());
        document.getElementById('btnClearLog').addEventListener('click', () => this.clearLog());
        
        // Terminal Actions
        document.getElementById('btnConnect').addEventListener('click', () => this.connectTerminal());
        document.getElementById('btnDisconnect').addEventListener('click', () => this.disconnectTerminal());
        document.getElementById('btnExec').addEventListener('click', () => this.executeCommand());
        document.getElementById('btnCopyCmd').addEventListener('click', () => this.copyTerminalCommand());
        document.getElementById('cmdInput').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.executeCommand();
        });
        
        // Tools Actions
        document.getElementById('btnAskAI').addEventListener('click', () => this.askAI());
        document.getElementById('btnAnalyzeStorage').addEventListener('click', () => this.analyzeStorage());
        document.getElementById('btnAnalyzeCookies').addEventListener('click', () => this.analyzeCookies());
        document.getElementById('btnExportJSON').addEventListener('click', () => this.exportJSON());
        document.getElementById('btnExportReport').addEventListener('click', () => this.exportReport());
        
        // Settings Actions
        document.getElementById('btnRefreshScript').addEventListener('click', () => this.refreshScript());
        document.getElementById('btnClearCache').addEventListener('click', () => this.clearCache());
        
        // Toggles
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
        
        // Input saves
        document.getElementById('githubUrl').addEventListener('change', (e) => {
            this.state.settings.githubUrl = e.target.value;
            this.saveSettings();
        });
        document.getElementById('wsUrl').addEventListener('change', (e) => {
            this.state.settings.wsUrl = e.target.value;
            this.saveSettings();
        });
        document.getElementById('authToken').addEventListener('change', (e) => {
            this.state.settings.authToken = e.target.value;
            this.saveSettings();
        });
    }
    
    // ==================== Tab Management ====================
    async getActiveTab() {
        try {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            this.state.tabId = tab?.id;
            this.checkPageStatus();
        } catch (e) {
            console.error('Get tab error:', e);
        }
    }
    
    async checkPageStatus() {
        if (!this.state.tabId) return;
        try {
            const result = await chrome.tabs.sendMessage(this.state.tabId, { type: 'CHECK_STATUS' });
            if (result?.injected) {
                this.state.scriptLoaded = true;
                this.state.connected = true;
                this.updateConnectionStatus(true, 'Scanner Active');
            }
        } catch (e) {
            // Content script not loaded
        }
    }
    
    // ==================== Script Management ====================
    async fetchScript() {
        this.log('Fetching from GitHub...', 'info');
        try {
            const response = await fetch(this.state.settings.githubUrl + '?t=' + Date.now());
            if (!response.ok) throw new Error('Fetch failed: ' + response.status);
            const script = await response.text();
            this.state.scriptCache = script;
            await chrome.storage.local.set({ scriptCache: script });
            this.log('Script fetched: ' + Math.round(script.length / 1024) + 'KB', 'success');
            return script;
        } catch (e) {
            this.log('Fetch error: ' + e.message, 'error');
            throw e;
        }
    }
    
    async injectScript() {
        const btn = document.getElementById('btnInject');
        btn.disabled = true;
        btn.querySelector('.label').textContent = 'Injecting...';
        
        try {
            // Get or fetch script
            let script = this.state.scriptCache;
            if (!script) {
                script = await this.fetchScript();
            }
            
            // Inject via background service worker
            chrome.runtime.sendMessage({
                type: 'INJECT_SCRIPT',
                tabId: this.state.tabId,
                script: script
            }, (response) => {
                if (response?.success) {
                    this.state.scriptLoaded = true;
                    this.state.connected = true;
                    this.updateConnectionStatus(true, 'Scanner Injected');
                    this.log('Scanner injected successfully', 'success');
                    this.notify('Scanner injected!');
                } else {
                    this.log('Injection failed: ' + (response?.error || 'Unknown'), 'error');
                    this.notify('Injection failed', true);
                }
                btn.disabled = false;
                btn.querySelector('.label').textContent = 'Inject Scanner';
            });
        } catch (e) {
            this.log('Inject error: ' + e.message, 'error');
            this.notify('Error: ' + e.message, true);
            btn.disabled = false;
            btn.querySelector('.label').textContent = 'Inject Scanner';
        }
    }
    
    async copyScript() {
        try {
            let script = this.state.scriptCache;
            if (!script) {
                script = await this.fetchScript();
            }
            await navigator.clipboard.writeText(script);
            this.log('Script copied to clipboard', 'success');
            this.notify('Script copied!');
        } catch (e) {
            this.log('Copy error: ' + e.message, 'error');
        }
    }
    
    async refreshScript() {
        await this.fetchScript();
        this.notify('Script refreshed from GitHub');
    }
    
    async clearCache() {
        this.state.scriptCache = null;
        await chrome.storage.local.remove('scriptCache');
        this.log('Cache cleared', 'success');
        this.notify('Cache cleared');
    }
    
    // ==================== Scanning ====================
    async executeScan(type) {
        if (!this.state.scriptLoaded) {
            this.notify('Inject scanner first!', true);
            return;
        }
        
        this.log('Starting ' + type + ' scan...', 'info');
        
        chrome.tabs.sendMessage(this.state.tabId, {
            type: 'EXECUTE_SCAN',
            scanType: type
        }, (response) => {
            if (response?.success) {
                this.state.stats = response.stats || this.state.stats;
                this.updateStats();
                this.log(type + ' scan complete', 'success');
                this.notify('Scan complete!');
            } else {
                this.log('Scan failed', 'error');
            }
        });
    }
    
    // ==================== Terminal ====================
    connectTerminal() {
        const url = document.getElementById('wsUrl').value.trim();
        const token = document.getElementById('authToken').value.trim();
        
        if (!url) {
            this.notify('Enter WebSocket URL', true);
            return;
        }
        
        this.log('Connecting to terminal...', 'info');
        
        // Send to background for WebSocket handling
        chrome.runtime.sendMessage({
            type: 'CONNECT_TERMINAL',
            url: url,
            token: token
        }, (response) => {
            if (response?.success) {
                this.state.ws = true;
                document.getElementById('btnConnect').style.display = 'none';
                document.getElementById('btnDisconnect').style.display = 'flex';
                this.updateConnectionStatus(true, 'Terminal Connected');
                this.log('Terminal connected', 'success');
                this.notify('Connected!');
            } else {
                this.log('Connection failed: ' + (response?.error || 'Unknown'), 'error');
                this.notify('Connection failed', true);
            }
        });
    }
    
    disconnectTerminal() {
        chrome.runtime.sendMessage({ type: 'DISCONNECT_TERMINAL' }, () => {
            this.state.ws = null;
            document.getElementById('btnConnect').style.display = 'flex';
            document.getElementById('btnDisconnect').style.display = 'none';
            this.updateConnectionStatus(false);
            this.log('Disconnected', 'info');
        });
    }
    
    executeCommand() {
        const cmd = document.getElementById('cmdInput').value.trim();
        if (!cmd) return;
        if (!this.state.ws) {
            this.notify('Connect to terminal first', true);
            return;
        }
        
        chrome.runtime.sendMessage({
            type: 'SEND_COMMAND',
            command: cmd
        }, (response) => {
            this.log('> ' + cmd, 'info');
            document.getElementById('cmdInput').value = '';
        });
    }
    
    copyTerminalCommand() {
        navigator.clipboard.writeText('node nexus-terminal.js').then(() => {
            this.notify('Command copied!');
        });
    }
    
    // ==================== Tools ====================
    async askAI() {
        const question = document.getElementById('aiQuestion').value.trim();
        if (!question) {
            this.notify('Enter a question', true);
            return;
        }
        
        this.log('Asking AI...', 'info');
        
        chrome.tabs.sendMessage(this.state.tabId, {
            type: 'ASK_AI',
            question: question
        }, (response) => {
            if (response?.answer) {
                this.log('AI: ' + response.answer.substring(0, 100) + '...', 'success');
            }
        });
    }
    
    analyzeStorage() {
        chrome.tabs.sendMessage(this.state.tabId, { type: 'ANALYZE_STORAGE' }, (response) => {
            if (response?.data) {
                this.log('Storage: ' + Object.keys(response.data).length + ' items', 'success');
            }
        });
    }
    
    analyzeCookies() {
        chrome.tabs.sendMessage(this.state.tabId, { type: 'ANALYZE_COOKIES' }, (response) => {
            if (response?.count !== undefined) {
                this.log('Cookies: ' + response.count + ' found', 'success');
            }
        });
    }
    
    exportJSON() {
        chrome.tabs.sendMessage(this.state.tabId, { type: 'EXPORT_JSON' });
        this.log('Exporting JSON...', 'info');
    }
    
    exportReport() {
        chrome.tabs.sendMessage(this.state.tabId, { type: 'EXPORT_REPORT' });
        this.log('Generating report...', 'info');
    }
    
    // ==================== UI Updates ====================
    updateUI() {
        this.updateStats();
    }
    
    updateConnectionStatus(connected, detail = '') {
        const dot = document.getElementById('connDot');
        const title = document.getElementById('connTitle');
        const detailEl = document.getElementById('connDetail');
        
        if (connected) {
            dot.classList.add('connected');
            title.textContent = 'Connected';
            detailEl.textContent = detail || 'Ready';
        } else {
            dot.classList.remove('connected');
            title.textContent = 'Disconnected';
            detailEl.textContent = 'Click inject to start';
        }
    }
    
    updateStats() {
        document.getElementById('statFindings').textContent = this.state.stats.findings;
        document.getElementById('statKeys').textContent = this.state.stats.apiKeys;
        document.getElementById('statTokens').textContent = this.state.stats.tokens;
    }
    
    log(message, type = 'info') {
        const container = document.getElementById('activityLog');
        const entry = document.createElement('div');
        entry.className = 'log-entry ' + type;
        const time = new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' });
        entry.innerHTML = '<span class="time">' + time + '</span>' + this.escapeHtml(message);
        container.appendChild(entry);
        container.scrollTop = container.scrollHeight;
        
        // Keep only last 50 entries
        while (container.children.length > 50) {
            container.removeChild(container.firstChild);
        }
    }
    
    clearLog() {
        const container = document.getElementById('activityLog');
        container.innerHTML = '<div class="log-entry info"><span class="time">--:--</span>Log cleared</div>';
    }
    
    notify(message, isError = false) {
        if (!this.state.settings.notifications) return;
        
        const el = document.getElementById('notification');
        el.textContent = message;
        el.className = 'notification show' + (isError ? ' error' : '');
        
        setTimeout(() => {
            el.classList.remove('show');
        }, 2500);
    }
    
    escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }
}

// Initialize on DOM load
document.addEventListener('DOMContentLoaded', () => {
    window.nexusPopup = new NexusPopup();
});

