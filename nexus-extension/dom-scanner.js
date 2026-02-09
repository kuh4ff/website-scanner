/**
 * NEXUS Scanner Pro - CSP-Safe DOM Scanner
 * This scanner runs in CONTENT SCRIPT context which BYPASSES ALL CSP
 * It can read the entire DOM and find secrets/vulnerabilities without needing eval
 * 
 * Used as fallback for strict CSP sites like GitHub
 */

(function () {
    'use strict';

    // Prevent double initialization
    if (window.__NEXUS_DOM_SCANNER__) return;
    window.__NEXUS_DOM_SCANNER__ = true;

    console.log('%c[NEXUS] DOM Scanner Active (CSP-Safe Mode)',
        'color: #f59e0b; font-weight: bold; font-size: 12px');

    // ═══════════════════════════════════════════════════════════════════════════
    // SECRET DETECTION PATTERNS
    // ═══════════════════════════════════════════════════════════════════════════
    const SECRET_PATTERNS = {
        // API Keys
        'AWS Access Key': /AKIA[0-9A-Z]{16}/g,
        'AWS Secret Key': /[A-Za-z0-9\/+=]{40}/g,
        'Google API Key': /AIza[0-9A-Za-z\-_]{35}/g,
        'GitHub Token': /gh[pousr]_[A-Za-z0-9_]{36,255}/g,
        'GitLab Token': /glpat-[A-Za-z0-9\-_]{20}/g,
        'Slack Token': /xox[baprs]-[0-9A-Za-z]{10,}/g,
        'Slack Webhook': /hooks\.slack\.com\/services\/T[A-Z0-9]+\/B[A-Z0-9]+\/[A-Za-z0-9]+/g,
        'Discord Token': /[MN][A-Za-z\d]{23,}\.[\w-]{6}\.[\w-]{27}/g,
        'Discord Webhook': /discord(?:app)?\.com\/api\/webhooks\/[0-9]+\/[A-Za-z0-9_-]+/g,
        'Stripe API Key': /sk_live_[0-9a-zA-Z]{24,}/g,
        'Stripe Publishable': /pk_live_[0-9a-zA-Z]{24,}/g,
        'PayPal Client ID': /AY[a-zA-Z0-9_-]{70,80}/g,
        'Twilio SID': /AC[a-f0-9]{32}/gi,
        'Twilio Token': /SK[a-f0-9]{32}/gi,
        'SendGrid API': /SG\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}/g,
        'Mailgun API': /key-[0-9a-zA-Z]{32}/g,
        'OpenAI API Key': /sk-[A-Za-z0-9]{20}T3BlbkFJ[A-Za-z0-9]{20}|sk-proj-[A-Za-z0-9_-]{80,}/g,
        'Groq API Key': /gsk_[A-Za-z0-9]{52}/g,
        'Anthropic API Key': /sk-ant-[A-Za-z0-9\-_]{90,}/g,
        'Firebase URL': /[a-z0-9-]+\.firebaseio\.com/gi,
        'Firebase API': /AIza[0-9A-Za-z\-_]{35}/g,
        'Heroku API Key': /[h|H][e|E][r|R][o|O][k|K][u|U].{0,30}[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}/gi,
        'DigitalOcean Token': /dop_v1_[a-f0-9]{64}/g,
        'NPM Token': /npm_[A-Za-z0-9]{36}/g,
        'Shopify Access Token': /shpat_[a-fA-F0-9]{32}/g,
        'Shopify Shared Secret': /shpss_[a-fA-F0-9]{32}/g,
        'Square Access Token': /sq0atp-[0-9A-Za-z\-_]{22}/g,
        'Square OAuth Secret': /sq0csp-[0-9A-Za-z\-_]{43}/g,
        'Telegram Bot Token': /[0-9]{9,10}:[a-zA-Z0-9_-]{35}/g,
        'JWT Token': /eyJ[A-Za-z0-9-_]+\.eyJ[A-Za-z0-9-_]+\.[A-Za-z0-9-_.+/=]+/g,
        'Private Key': /-----BEGIN (RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/g,
        'SSH Private Key': /-----BEGIN OPENSSH PRIVATE KEY-----/g,
        'PGP Private Key': /-----BEGIN PGP PRIVATE KEY BLOCK-----/g,
        'Generic API Key': /['"](api[_-]?key|apikey|api[_-]?secret)['"]\s*[:=]\s*['"][a-zA-Z0-9_\-]{16,}['"]/gi,
        'Generic Secret': /['"](secret[_-]?key|secret|password|passwd|pwd)['"]\s*[:=]\s*['"][^'"]{8,}['"]/gi,
        'Basic Auth': /[a-zA-Z0-9+/]{20,}={0,2}:[a-zA-Z0-9+/]{20,}={0,2}@/g,
        'Bearer Token': /Bearer\s+[A-Za-z0-9\-_\.~\+\/]+=*/gi,
        'Authorization Header': /[Aa]uthorization['":\s]+['"]?(Bearer|Basic|Token)\s+[A-Za-z0-9\-_\.~\+\/]+=*/g
    };

    // ═══════════════════════════════════════════════════════════════════════════
    // VULNERABILITY PATTERNS
    // ═══════════════════════════════════════════════════════════════════════════
    const VULN_PATTERNS = {
        'DOM XSS Sink': /\.innerHTML\s*=|\.outerHTML\s*=|document\.write\(|\.insertAdjacentHTML\(/g,
        'Eval Sink': /eval\s*\(|new\s+Function\s*\(|setTimeout\s*\(\s*['"]/g,
        'URL Manipulation': /location\s*=|location\.href\s*=|location\.replace\s*\(|window\.open\s*\(/g,
        'PostMessage Handler': /addEventListener\s*\(\s*['"]message['"]/g,
        'PostMessage Origin': /event\.origin|e\.origin|message\.origin/g,
        'JSONP Callback': /callback\s*=|jsonp\s*=|cb\s*=/gi,
        'Prototype Pollution': /__proto__|constructor\s*\[|Object\.assign\s*\([^,]+,\s*[^)]+\)/g,
        'Open Redirect': /[?&](url|redirect|next|return|goto|link|target)\s*=/gi,
        'SQL Injection': /['"].*?(SELECT|INSERT|UPDATE|DELETE|DROP|UNION).*?['"]|`.*?\$\{.*?\}.*?`/gi,
        'Command Injection': /exec\s*\(|spawn\s*\(|system\s*\(/g,
        'Path Traversal': /\.\.\/|\.\.\\|%2e%2e%2f/gi,
        'SSRF Pattern': /(url|uri|path|endpoint|target|dest|redirect|proxy)\s*[:=]/gi,
        'Insecure Cookie': /document\.cookie/g,
        'LocalStorage Access': /localStorage\.(getItem|setItem|removeItem)|sessionStorage\./g,
        'WebSocket URL': /wss?:\/\/[^\s'"]+/g,
        'GraphQL Endpoint': /\/graphql|\/v1\/graphql|mutation\s*\{|query\s*\{/g,
        'Debug Mode': /debug\s*[:=]\s*(true|1|on)|console\.(log|debug|info)/gi,
        'Hardcoded Password': /(password|passwd|pwd)\s*[:=]\s*['"][^'"]+['"]/gi,
        'Internal IP': /\b(10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3})\b/g,
        'AWS S3 Bucket': /[a-z0-9][a-z0-9\-]{1,61}[a-z0-9]\.s3\.amazonaws\.com|s3\.amazonaws\.com\/[a-z0-9][a-z0-9\-]{1,61}[a-z0-9]/gi,
        'CORS Wildcard': /Access-Control-Allow-Origin:\s*\*/g
    };

    // ═══════════════════════════════════════════════════════════════════════════
    // ENDPOINT PATTERNS  
    // ═══════════════════════════════════════════════════════════════════════════
    const ENDPOINT_PATTERNS = {
        'API Endpoint': /['"`](\/api\/[^'"`\s]+|https?:\/\/[^'"`\s]*\/api\/[^'"`\s]+)['"`]/g,
        'REST Endpoint': /['"`](\/v[0-9]+\/[^'"`\s]+)['"`]/g,
        'GraphQL': /['"`](\/graphql[^'"`\s]*)['"`]/g,
        'Webhook': /['"`](\/webhook[s]?\/[^'"`\s]+|https?:\/\/[^'"`\s]*webhook[^'"`\s]*)['"`]/g,
        'Admin Panel': /['"`](\/admin[^'"`\s]*|\/dashboard[^'"`\s]*|\/manage[^'"`\s]*)['"`]/gi,
        'Config Endpoint': /['"`](\/config[^'"`\s]*|\/settings[^'"`\s]*)['"`]/gi,
        'Auth Endpoint': /['"`](\/auth[^'"`\s]*|\/login[^'"`\s]*|\/oauth[^'"`\s]*|\/token[^'"`\s]*)['"`]/gi,
        'Upload Endpoint': /['"`](\/upload[^'"`\s]*|\/file[^'"`\s]*)['"`]/gi,
        'Internal Path': /['"`](\/internal\/[^'"`\s]+|\/private\/[^'"`\s]+|\/debug\/[^'"`\s]+)['"`]/gi
    };

    // ═══════════════════════════════════════════════════════════════════════════
    // SCANNER CLASS
    // ═══════════════════════════════════════════════════════════════════════════
    class DOMScanner {
        constructor() {
            this.findings = [];
            this.secrets = [];
            this.vulnerabilities = [];
            this.endpoints = [];
            this.stats = { total: 0, secrets: 0, vulns: 0, endpoints: 0, critical: 0, high: 0, medium: 0, low: 0 };
        }

        // Main scan entry point
        async scan(type = 'full') {
            console.log('[NEXUS DOM] Starting scan:', type);
            this.reset();

            try {
                // Scan inline scripts
                this.scanInlineScripts();

                // Scan external script sources
                this.scanExternalScripts();

                // Scan HTML attributes
                this.scanHTMLAttributes();

                // Scan forms
                this.scanForms();

                // Scan cookies
                this.scanCookies();

                // Scan storage
                this.scanStorage();

                // Scan meta tags
                this.scanMetaTags();

                // Scan comments
                this.scanComments();

                // Scan links
                this.scanLinks();

                this.updateStats();
                console.log('[NEXUS DOM] Scan complete:', this.stats);

                return {
                    success: true,
                    stats: this.stats,
                    findings: this.findings.length,
                    method: 'dom-scanner'
                };
            } catch (e) {
                console.error('[NEXUS DOM] Scan error:', e);
                return { success: false, error: e.message };
            }
        }

        reset() {
            this.findings = [];
            this.secrets = [];
            this.vulnerabilities = [];
            this.endpoints = [];
            this.stats = { total: 0, secrets: 0, vulns: 0, endpoints: 0, critical: 0, high: 0, medium: 0, low: 0 };
        }

        // Scan inline scripts
        scanInlineScripts() {
            const scripts = document.querySelectorAll('script:not([src])');
            scripts.forEach((script, idx) => {
                const content = script.textContent;
                if (content) {
                    this.scanContent(content, `Inline Script #${idx + 1}`, 'script');
                }
            });
        }

        // Scan external script URLs
        scanExternalScripts() {
            const scripts = document.querySelectorAll('script[src]');
            scripts.forEach(script => {
                const src = script.src;
                if (src) {
                    // Check for interesting patterns in URLs
                    if (/\.(env|config|secret|key)/i.test(src)) {
                        this.addFinding('Suspicious Script URL', src, 'medium', 'endpoint', script.outerHTML);
                    }
                    this.endpoints.push({ type: 'script', url: src, element: 'script' });
                }
            });
        }

        // Scan HTML attributes
        scanHTMLAttributes() {
            // Scan data-* attributes
            const allElements = document.querySelectorAll('*');
            allElements.forEach(el => {
                // Check data attributes
                for (const attr of el.attributes) {
                    if (attr.name.startsWith('data-')) {
                        this.scanContent(attr.value, `data-attribute: ${attr.name}`, 'attribute');
                    }
                    // Check for potential secrets in any attribute
                    if (attr.value.length > 20) {
                        this.scanContent(attr.value, `attribute: ${attr.name}`, 'attribute');
                    }
                }

                // Check onclick and other event handlers (DOM XSS sinks)
                const eventAttrs = ['onclick', 'onload', 'onerror', 'onmouseover', 'onfocus', 'onblur'];
                eventAttrs.forEach(evt => {
                    if (el.hasAttribute(evt)) {
                        this.addFinding('Inline Event Handler', el.getAttribute(evt), 'low', 'vuln', el.outerHTML.substring(0, 200));
                    }
                });
            });
        }

        // Scan forms
        scanForms() {
            const forms = document.querySelectorAll('form');
            forms.forEach((form, idx) => {
                const action = form.action;
                const method = form.method;

                // Check for interesting form actions
                if (action) {
                    this.endpoints.push({ type: 'form', url: action, method: method });

                    if (/api|graphql|webhook|upload|admin/i.test(action)) {
                        this.addFinding('Interesting Form Action', action, 'medium', 'endpoint', form.outerHTML.substring(0, 300));
                    }
                }

                // Check for password fields without HTTPS
                const passwordFields = form.querySelectorAll('input[type="password"]');
                if (passwordFields.length > 0 && window.location.protocol !== 'https:') {
                    this.addFinding('Password Over HTTP', window.location.href, 'critical', 'vuln', 'Password field submitted over HTTP');
                }

                // Check for hidden fields with potential secrets
                const hiddenFields = form.querySelectorAll('input[type="hidden"]');
                hiddenFields.forEach(field => {
                    if (field.value && field.value.length > 10) {
                        this.scanContent(field.value, `Hidden field: ${field.name}`, 'form');
                    }
                });
            });
        }

        // Scan cookies
        scanCookies() {
            try {
                const cookies = document.cookie.split(';');
                cookies.forEach(cookie => {
                    const [name, value] = cookie.trim().split('=');
                    if (value) {
                        // Check for JWT in cookies
                        if (/^eyJ/.test(value)) {
                            this.addFinding('JWT in Cookie', `${name}=${value.substring(0, 50)}...`, 'medium', 'secret', 'JWT token found in cookie');
                        }
                        // Check for potential session tokens
                        if (/session|token|auth|sid/i.test(name) && value.length > 20) {
                            this.addFinding('Session Token', `${name}=${value.substring(0, 30)}...`, 'low', 'info', 'Session token in cookie');
                        }
                    }
                });
            } catch (e) {
                // Cookie access might be restricted
            }
        }

        // Scan localStorage and sessionStorage
        scanStorage() {
            try {
                // Scan localStorage
                for (let i = 0; i < localStorage.length; i++) {
                    const key = localStorage.key(i);
                    const value = localStorage.getItem(key);
                    if (value) {
                        this.scanContent(value, `localStorage: ${key}`, 'storage');
                    }
                }

                // Scan sessionStorage
                for (let i = 0; i < sessionStorage.length; i++) {
                    const key = sessionStorage.key(i);
                    const value = sessionStorage.getItem(key);
                    if (value) {
                        this.scanContent(value, `sessionStorage: ${key}`, 'storage');
                    }
                }
            } catch (e) {
                // Storage access might be restricted
            }
        }

        // Scan meta tags
        scanMetaTags() {
            const metas = document.querySelectorAll('meta');
            metas.forEach(meta => {
                const content = meta.content;
                const name = meta.name || meta.getAttribute('property');

                if (content) {
                    // Check CSP
                    if (meta.httpEquiv === 'Content-Security-Policy') {
                        this.addFinding('CSP Meta Tag', content.substring(0, 200), 'info', 'info', 'Content Security Policy found');
                    }

                    // Scan content for secrets
                    this.scanContent(content, `meta: ${name}`, 'meta');
                }
            });
        }

        // Scan HTML comments
        scanComments() {
            const walker = document.createTreeWalker(document.body || document.documentElement, NodeFilter.SHOW_COMMENT);
            let comment;
            while (comment = walker.nextNode()) {
                const content = comment.textContent;
                if (content && content.length > 10) {
                    this.scanContent(content, 'HTML Comment', 'comment');

                    // Check for TODO/FIXME with sensitive info
                    if (/TODO|FIXME|HACK|XXX|DEBUG/i.test(content)) {
                        this.addFinding('Developer Comment', content.substring(0, 200), 'low', 'info', 'Developer comment found');
                    }
                }
            }
        }

        // Scan links
        scanLinks() {
            const links = document.querySelectorAll('a[href]');
            links.forEach(link => {
                const href = link.href;
                if (href) {
                    // Check for interesting endpoints
                    if (/api|admin|dashboard|internal|private|debug|config/i.test(href)) {
                        this.addFinding('Interesting Link', href, 'low', 'endpoint', link.outerHTML.substring(0, 200));
                        this.endpoints.push({ type: 'link', url: href });
                    }

                    // Check for potential open redirects
                    if (/[?&](url|redirect|next|return|goto)=/i.test(href)) {
                        this.addFinding('Potential Open Redirect', href, 'medium', 'vuln', 'URL parameter that may allow open redirect');
                    }
                }
            });
        }

        // Generic content scanner
        scanContent(content, source, type) {
            if (!content || typeof content !== 'string') return;

            // Scan for secrets
            for (const [name, pattern] of Object.entries(SECRET_PATTERNS)) {
                const matches = content.match(pattern);
                if (matches) {
                    matches.forEach(match => {
                        // Dedupe
                        if (!this.secrets.some(s => s.value === match)) {
                            this.secrets.push({ type: name, value: match, source });
                            this.addFinding(name, match, this.getSeverity(name, 'secret'), 'secret', source);
                        }
                    });
                }
            }

            // Scan for vulnerabilities
            for (const [name, pattern] of Object.entries(VULN_PATTERNS)) {
                const matches = content.match(pattern);
                if (matches) {
                    matches.forEach(match => {
                        this.addFinding(name, match, this.getSeverity(name, 'vuln'), 'vuln', source);
                    });
                }
            }

            // Scan for endpoints
            for (const [name, pattern] of Object.entries(ENDPOINT_PATTERNS)) {
                const matches = content.match(pattern);
                if (matches) {
                    matches.forEach(match => {
                        const url = match.replace(/^['"`]|['"`]$/g, '');
                        if (!this.endpoints.some(e => e.url === url)) {
                            this.endpoints.push({ type: name, url, source });
                            this.addFinding(name, url, 'low', 'endpoint', source);
                        }
                    });
                }
            }
        }

        // Get severity for finding type
        getSeverity(name, category) {
            const criticalPatterns = ['AWS Access Key', 'AWS Secret Key', 'Private Key', 'SSH Private Key', 'Password Over HTTP'];
            const highPatterns = ['GitHub Token', 'Stripe API Key', 'OpenAI API Key', 'Groq API Key', 'JWT Token', 'Bearer Token', 'DOM XSS'];
            const mediumPatterns = ['Google API Key', 'Generic API Key', 'Generic Secret', 'Firebase', 'Eval Sink', 'URL Manipulation'];

            if (criticalPatterns.some(p => name.includes(p))) return 'critical';
            if (highPatterns.some(p => name.includes(p))) return 'high';
            if (mediumPatterns.some(p => name.includes(p))) return 'medium';
            return 'low';
        }

        // Add finding
        addFinding(type, value, severity, category, context = '') {
            const finding = {
                id: this.findings.length + 1,
                type,
                value: typeof value === 'string' ? value.substring(0, 500) : String(value),
                severity,
                category,
                context: context.substring(0, 300),
                url: window.location.href,
                timestamp: new Date().toISOString()
            };

            // Dedupe
            if (!this.findings.some(f => f.type === type && f.value === finding.value)) {
                this.findings.push(finding);
            }
        }

        // Update stats
        updateStats() {
            this.stats.total = this.findings.length;
            this.stats.secrets = this.secrets.length;
            this.stats.vulns = this.vulnerabilities.length;
            this.stats.endpoints = this.endpoints.length;
            this.stats.critical = this.findings.filter(f => f.severity === 'critical').length;
            this.stats.high = this.findings.filter(f => f.severity === 'high').length;
            this.stats.medium = this.findings.filter(f => f.severity === 'medium').length;
            this.stats.low = this.findings.filter(f => f.severity === 'low').length;
        }

        // Get all findings
        getFindings() {
            return {
                findings: this.findings,
                secrets: this.secrets,
                vulnerabilities: this.vulnerabilities,
                endpoints: this.endpoints,
                stats: this.stats
            };
        }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // EXPOSE SCANNER GLOBALLY
    // ═══════════════════════════════════════════════════════════════════════════
    window.__NEXUS_DOM_SCANNER_INSTANCE__ = new DOMScanner();

    // Signal that DOM scanner is ready
    window.postMessage({
        type: 'NEXUS_SCANNER_READY',
        method: 'dom-scanner',
        cspSafe: true
    }, '*');

    console.log('[NEXUS] DOM Scanner ready for commands');
})();
