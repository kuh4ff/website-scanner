# NEXUS Scanner Pro - Complete Project Handoff Prompt

## 🎯 PROJECT OVERVIEW

You are taking over development of **NEXUS Scanner Pro** - an advanced browser-based security scanner and bug bounty hunting toolkit. This is a comprehensive system with:

1. **Browser Scanner (all_phases.js)** - ~27,000 lines, injects into websites via Chrome Extension
2. **Chrome Extension (nexus-extension/)** - Manifest V3, controls the scanner
3. **Node.js Terminal Server (nexus-terminal.js)** - ~11,000 lines, for remote control & AI analysis

---

## 📁 FILE STRUCTURE

```
c:\Users\Lenovo\Downloads\console\
├── all_phases.js          # Main scanner script (~27,042 lines) - INJECTED INTO BROWSER
├── nexus-terminal.js      # Node.js terminal server (~11,181 lines)
├── nexus.js               # Alternate/older version
├── nexus-extension/       # Chrome Extension (Manifest V3)
│   ├── manifest.json      # Extension manifest v4.0.0
│   ├── popup.html         # Extension popup UI (~1,259 lines)
│   ├── popup.js           # Popup controller (~1,275 lines)
│   ├── background.js      # Service worker
│   ├── content.js         # Content script (injects all_phases.js)
│   ├── remote-config.json # Remote configuration
│   └── icons/             # Extension icons
```

---

## 🔧 HOW THE SYSTEM WORKS

### Injection Flow:
1. User clicks extension popup → clicks "Inject"
2. `content.js` fetches `all_phases.js` from GitHub (or local)
3. Script is injected into page's `MAIN` world (not isolated)
4. All global functions become available on `window` object
5. Extension communicates via `chrome.scripting.executeScript()` with `world: 'MAIN'`

### CSP Bypass Methods (in content.js):
The extension uses 6 fallback methods to inject script despite Content Security Policy:
1. Direct `<script>` tag injection
2. TrustedTypes policy creation
3. Blob URL creation
4. Dynamic import
5. Function constructor
6. Inline script with nonce detection

---

## 🧠 MAJOR COMPONENTS IN all_phases.js

### Core Modules (const objects):

| Module | Line | Purpose |
|--------|------|---------|
| `AIAgent` | 9578 | AI provider integration (Gemini, OpenAI, Groq, DeepSeek, Anthropic, Mistral) |
| `PatternTracker` | 10726 | Tracks all findings, vulnerabilities, patterns |
| `AIAnalyzer` | 11370 | AI-powered analysis of findings |
| `AutoExploiter` | 12828 | Automated exploitation of found secrets |
| `ScanController` | 14078 | Main scan control (start/stop/status) |
| `MasterAutoExploit` | 15757 | Master exploitation orchestrator |
| `AIAgentPro` | 16022 | Advanced autonomous AI agent |
| `DeepScanner` | 17008 | Deep recursive scanning |
| `NetworkInterceptor` | 17166 | XHR/Fetch interception |
| `RealtimeScanner` | 17294 | Real-time DOM monitoring |
| `WebSocketInterceptor` | 17387 | WebSocket traffic capture |
| `APIDiscovery` | 17466 | API endpoint discovery |
| `CredentialCrafter` | 17580 | Credential generation/testing |
| `TokenClassifier` | 19103 | Token type classification |
| `ExploitabilityScorer` | 19295 | Vulnerability scoring |
| `FalsePositiveKiller` | 19484 | False positive elimination |
| `AttackChainBuilder` | 20022 | Builds multi-step attack chains |
| `POCGenerator` | 20263 | Proof of concept generation |
| `BugBountyReporter` | 20687 | Bug bounty report generation |
| `BountyEngine` | 21256 | Bounty calculation engine |
| `TerminalBridge` | 23214 | WebSocket bridge to nexus-terminal.js |
| `TerminalLive` | 25693 | Live terminal communication |

### API Testers (line ~8346):
Pre-built testers for major platforms:
- GitHub, GitLab, Stripe, OpenAI, Telegram, Slack, Discord
- Firebase, AWS S3, SendGrid, Twilio, Mailgun
- HuggingFace, Heroku, DigitalOcean, NPM

---

## 🌐 GLOBAL FUNCTIONS (window.*)

### Scanner Control:
```javascript
window.start()           // Start scanning
window.stop()            // Stop scanning
window.startScan()       // Alias for start
window.quickScan()       // Quick surface scan
window.deepScan()        // Deep recursive scan
```

### AI Functions:
```javascript
window.setAI(key, provider)     // Initialize AI (calls AIAgent.init())
window.setGroq(key)             // Set Groq as backup
window.setOpenAI(key)           // Set OpenAI as backup
window.setDeepSeek(key)         // Set DeepSeek as backup
window.setTogether(key)         // Set Together AI as backup
window.setMistral(key)          // Set Mistral as backup
window.setOpenRouter(key)       // Set OpenRouter as backup
window.showBackups()            // Show configured backup providers
window.ai()                     // Run full AI analysis
window.aiChat(question)         // Chat with AI
window.aiAgent()                // Start AI agent
window.aiMemory()               // Show AI memory/context
```

### Findings & Analysis:
```javascript
window.dashboard()              // Show vulnerability dashboard
window.findings()               // Show all findings
window.patterns()               // Show pattern status
window.exploitable()            // Show exploitable keys only
window.showCategory(cat)        // Filter by category
```

### Vulnerability Specific:
```javascript
window.domxss()                 // Show DOM XSS findings
window.cors()                   // Show CORS issues
window.ssrf()                   // Show SSRF indicators
window.headers()                // Show security headers
window.files()                  // Show sensitive files
window.postmessage()            // Show PostMessage vulns
```

### Exploitation:
```javascript
window.autoExploit()            // Run full auto-exploitation
window.deepExploit(idx)         // Deep exploit specific finding
window.fullReport()             // Generate full report
window.quickTest(key, type)     // Quick test a specific key
```

### Terminal Sync:
```javascript
window.syncFindings()           // Sync findings to terminal
window.TerminalBridge.connect(url, token)  // Connect to terminal
window.TerminalBridge.isConnected()        // Check connection
```

---

## 🔌 EXTENSION ↔ SCANNER COMMUNICATION

### How popup.js communicates with all_phases.js:

```javascript
// Execute function in page context (MAIN world)
await chrome.scripting.executeScript({
    target: { tabId: this.state.tabId },
    func: (args) => {
        // This runs in the page where all_phases.js is injected
        // Access window.* functions directly
        if (window.setAI) {
            window.setAI(args.key, args.provider);
        }
    },
    args: [{ key: 'xxx', provider: 'groq' }],
    world: 'MAIN'  // CRITICAL - must be MAIN, not ISOLATED
});
```

### Key Extension APIs Used:

| popup.js Method | Calls in all_phases.js |
|-----------------|------------------------|
| `setAIKey()` | `window.setAI(key, provider)` → `AIAgent.init()` |
| `executeCmd('start')` | `window.start()` or `ScanController.start()` |
| `executeCmd('stop')` | `window.stop()` |
| `executeCmd('dashboard')` | `window.dashboard()` |
| `connectTerminal()` | `window.TerminalBridge.connect(url, token)` |
| `refreshFindings()` | `window.Scanner.getFindings()` |
| `testAIConnection()` | `window.AIAgent.validateAPIKey()` |
| `syncFindingsToTerminal()` | `window.syncFindings()` |

---

## 🤖 AI SYSTEM ARCHITECTURE

### AIAgent Configuration (line 9578):
```javascript
AIAgent.config = {
    provider: 'gemini',      // Current provider
    apiKey: '',              // API key
    isActive: false,         // Is AI enabled
    isValidated: false,      // Has key been validated
    autoMode: true,          // Auto-analyze findings
    batchMode: true          // Batch findings for analysis
}
```

### Supported Providers:
1. **Gemini** (💎) - `gemini-2.0-flash` - Default
2. **OpenAI** (🧠) - `gpt-3.5-turbo`
3. **DeepSeek** (🔮) - `deepseek-chat`
4. **Anthropic** (🧬) - `claude-3-haiku`
5. **Groq** (⚡) - `llama-3.3-70b-versatile` - Ultra fast
6. **Together** (🤝) - `Meta-Llama-3.1-70B`
7. **Mistral** (🌪️) - `mistral-small-latest`
8. **OpenRouter** (🌐) - Multi-model gateway

### Key Detection (auto-detects provider from key format):
```javascript
AIAgent.detectProvider(key) {
    if (key.startsWith('sk-ant-')) return 'anthropic';
    if (key.startsWith('sk-or-')) return 'openrouter';
    if (key.startsWith('gsk_')) return 'groq';
    if (key.startsWith('sk-') && key.length > 45) return 'openai';
    if (key.startsWith('AIza')) return 'gemini';
    // etc.
}
```

### AI Initialization Flow:
1. Extension calls `window.setAI(key, provider)`
2. `AIAgent.init(key, provider)` is called
3. Provider is auto-detected from key format
4. Key is validated via test API call
5. On success: saved to localStorage, config updated
6. Status broadcast to extension via scripting response

---

## 📡 TERMINAL BRIDGE SYSTEM

### TerminalBridge (line 23214):
Connects browser scanner to Node.js terminal via WebSocket.

```javascript
TerminalBridge.connect(url, token)  // Connect to terminal
TerminalBridge.send(data)           // Send data to terminal
TerminalBridge.isConnected()        // Check connection status
```

### Message Types:
- `bulk_findings` - Send all findings
- `ai_query` - Send question to AI
- `exploitation_result` - Send exploitation results
- `scan_status` - Scanner status updates

### nexus-terminal.js Features:
- WebSocket server for browser connection
- Cloudflare Tunnel for CSP bypass
- AI integration (same providers as browser)
- Multi-threaded task execution
- Auto-healing (port conflicts, dependency install)
- Real-time collaboration mode

---

## 🖥️ EXTENSION UI STRUCTURE (popup.html)

### Pages (Navigation):
1. **Home** - Quick actions, inject, start/stop
2. **Scanner** - Scan controls, progress
3. **Secrets** - Found secrets/tokens
4. **Findings** - Detailed findings view (with live refresh)
5. **AI** - AI provider config, test, sync
6. **Terminal** - Terminal connection
7. **Settings** - Configuration

### Recent Updates to AI Page:
- Added **AI Status Indicator** (`#aiStatusIndicator`)
  - Shows ● CONNECTED (green) or ● DISCONNECTED (red)
  - Displays active provider name
- Added **Test Connection** button (`#btnTestAI`)
- Added **Sync to Terminal** button (`#btnSyncFindings`)
- Added more providers: Gemini, Claude, Mistral

### popup.js Key Methods:
```javascript
setAIKey()                    // Save & activate AI key
testAIConnection()            // Test AI connection
getAIStatus()                 // Get current AI status
updateAIStatusIndicator()     // Update UI indicator
syncFindingsToTerminal()      // Sync findings to terminal
refreshFindings()             // Refresh findings from scanner
executeCmd(cmd)               // Execute scanner command
```

---

## ⚠️ KNOWN ISSUES & IN-PROGRESS WORK

### Recently Fixed:
1. ✅ **AI not connecting** - Was calling `setGroq()` (backup key setter) instead of `setAI()` (proper init)
2. ✅ **CSP blocking injection** - Added 6 fallback injection methods with TrustedTypes support
3. ✅ **Findings not refreshing** - Added `Scanner.getFindings()` and `Scanner.getStats()` APIs

### May Need Work:
1. **Terminal connection** - TerminalBridge WebSocket connectivity to nexus-terminal.js
2. **AI validation** - Some providers may fail validation due to rate limits
3. **Button handlers** - Many `data-cmd` buttons in popup may not have corresponding window.* functions
4. **Sync to terminal** - `syncFindingsToTerminal()` requires terminal connected first

### Extension Buttons That Call window.* Functions:
Check these exist and work:
- `window.quickScan()` / `window.deepScan()`
- `window.autoExploit()`
- `window.brain()` / `window.brainStop()` / `window.brainStatus()`
- `window.aiAgent()`
- `window.fullReport()`

---

## 🔑 IMPORTANT CODE LOCATIONS

### AI Initialization:
- `all_phases.js:9578` - AIAgent definition
- `all_phases.js:9820` - `AIAgent.init()` method
- `all_phases.js:15009` - `window.setAI = (key, provider) => AIAgent.init(key, provider)`

### Scanner Core:
- `all_phases.js:14078` - ScanController
- `all_phases.js:15097` - `window.Scanner` API object

### Terminal Bridge:
- `all_phases.js:23214` - TerminalBridge definition
- `all_phases.js:14754` - `syncFindingsToTerminal()` function
- `all_phases.js:14916` - `window.syncFindings` export

### Extension Communication:
- `popup.js:551` - `setAIKey()` - AI initialization from extension
- `popup.js:620` - `testAIConnection()` - Tests AI connection
- `popup.js:687` - `getAIStatus()` - Gets current AI status
- `popup.js:735` - `syncFindingsToTerminal()` - Syncs findings

---

## 🚀 HOW TO TEST

### 1. Load Extension:
- Open `chrome://extensions`
- Enable Developer Mode
- Load unpacked → select `nexus-extension/` folder

### 2. Inject Scanner:
- Navigate to any website
- Click extension icon
- Click "Inject" button
- Check browser console for `🎯 NEXUS Scanner Loaded`

### 3. Test AI:
- Go to AI page in extension
- Select provider (Groq recommended - free & fast)
- Enter API key
- Click "Save & Activate AI"
- Click "Test Connection"
- Should show ● CONNECTED in green

### 4. Start Scan:
- Go to Home page
- Click "Start" or "Quick Scan"
- Check console for findings
- Go to Findings page, click "Refresh"

### 5. Terminal (requires nexus-terminal.js running):
```bash
node nexus-terminal.js --ai-key YOUR_KEY
```
- Copy the cloudflare URL
- Paste in extension Terminal page
- Click Connect
- Click "Sync to Terminal" on AI page

---

## 📋 TASK CHECKLIST FOR CONTINUATION

1. [ ] Verify all `data-cmd` buttons have working `window.*` handlers
2. [ ] Test terminal bridge connection end-to-end
3. [ ] Ensure findings sync includes AI analysis
4. [ ] Check all AI providers work (may need API keys)
5. [ ] Test CSP bypass on strict sites (Facebook, Google, etc.)
6. [ ] Verify auto-refresh on findings page works
7. [ ] Test AI Brain (autonomous) feature
8. [ ] Check export/report generation
9. [ ] Verify all scanner phases execute correctly

---

## 💡 ARCHITECTURE NOTES

### Data Flow:
```
User Action (popup button)
    ↓
popup.js method
    ↓
chrome.scripting.executeScript({ world: 'MAIN' })
    ↓
all_phases.js window.* function
    ↓
Internal module (AIAgent, Scanner, etc.)
    ↓
Results returned to popup via script result
    ↓
UI updated
```

### Findings Storage:
- `PatternTracker.findings` - Array of all findings
- `Vault.secrets` - Stored secrets/tokens
- `localStorage` - Persisted settings/keys

### AI Memory:
- `BrowserAIMemory` (line 9365) - Stores AI context
- Persisted in localStorage under `nexus_ai_memory`

---

This prompt contains everything needed to continue development. The system is complex but well-structured. Focus on testing existing functionality before adding new features.
