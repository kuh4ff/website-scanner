<p align="center">
  <img src="https://img.shields.io/badge/Version-5.0-blueviolet?style=for-the-badge" alt="Version">
  <img src="https://img.shields.io/badge/Node.js-18+-green?style=for-the-badge&logo=node.js" alt="Node.js">
  <img src="https://img.shields.io/badge/License-MIT-blue?style=for-the-badge" alt="License">
  <img src="https://img.shields.io/badge/AI-Powered-red?style=for-the-badge&logo=openai" alt="AI Powered">
</p>

<h1 align="center">⚡ NEXUS SCANNER PRO</h1>

<p align="center">
  <strong>Advanced AI-Powered Web Security Scanner & Terminal Commander</strong>
</p>

<p align="center">
  Enterprise-grade security assessment toolkit with multi-AI integration, <br>
  real-time browser communication, and autonomous vulnerability exploitation.
</p>

---

## 🚀 Features

### 🔍 **Security Scanning**
- **200+ Secret Patterns** - Detects API keys, tokens, credentials across all major providers
- **DOM XSS Detection** - Advanced sink/source analysis
- **CORS Misconfiguration** - Identifies exploitable CORS policies
- **SSRF Indicators** - Server-side request forgery detection
- **Open Redirect** - URL manipulation vulnerabilities
- **Prototype Pollution** - JavaScript prototype chain attacks
- **GraphQL Vulnerabilities** - Introspection, injection points

### 🤖 **AI Integration**
| Provider | Models | Features |
|----------|--------|----------|
| **Groq** | Llama 3.1, Mixtral | Ultra-fast inference |
| **OpenAI** | GPT-4, GPT-3.5 | Advanced analysis |
| **Gemini** | 1.5 Flash, 1.5 Pro | Google AI |
| **DeepSeek** | DeepSeek Chat/Coder | Specialized coding |
| **Anthropic** | Claude 3 | Detailed reasoning |
| **Mistral** | Mistral 7B | Open source |

### 💻 **Terminal Commander**
- **WebSocket Bridge** - Real-time browser ↔ terminal communication
- **HTTP Polling Bridge** - Works through strict CSP
- **Auto-Healing System** - Port conflicts, missing dependencies auto-resolved
- **Cloudflare Tunnel** - Bypass CSP restrictions with HTTPS tunneling
- **Remote Shell Execution** - Execute commands from browser extension

### 🔥 **Browser Extension**
- **One-Click Injection** - Seamless script deployment
- **Live Findings Dashboard** - Real-time vulnerability updates
- **Auto-Exploit** - Autonomous vulnerability exploitation
- **Terminal Remote Control** - Deploy/update scripts remotely
- **Multi-Tab Sync** - Synchronized scanning across tabs

---

## 📦 Installation

### Terminal Commander
```bash
# Clone repository
git clone https://github.com/kuh4ff/website-scanner.git
cd website-scanner

# Install dependencies
npm install ws

# Run terminal
node nexus-terminal.js
```

### Browser Extension
1. Open Chrome/Edge → `chrome://extensions`
2. Enable **Developer Mode**
3. Click **Load Unpacked**
4. Select the `nexus-extension` folder

---

## ⚡ Quick Start

### 1. Start Terminal Commander
```bash
node nexus-terminal.js

# With AI key
node nexus-terminal.js --ai-key YOUR_GEMINI_KEY

# Custom port
node nexus-terminal.js --port 8888
```

### 2. Connect Extension
1. Click NEXUS extension icon
2. Go to **Terminal** tab
3. Enter WebSocket URL: `ws://YOUR_IP:8080`
4. Enter Auth Token (shown in terminal)
5. Click **Connect**

### 3. Inject & Scan
1. Navigate to target website
2. Click **Inject** → **Start**
3. Watch findings appear in real-time!

---

## 🛠️ Terminal Commands

| Command | Description |
|---------|-------------|
| `help` | Show all commands |
| `status` | Server status & statistics |
| `findings` | List all findings |
| `secrets` | Show extracted secrets |
| `exploit <index>` | Exploit specific finding |
| `autoexploit` | Auto-exploit all findings |
| `ai <query>` | Ask AI about findings |
| `curl <index>` | Generate exploit curl command |
| `clear` | Clear terminal |

---

## 🔒 Remote Terminal Control

Control the terminal remotely from the browser extension:

### Deploy Script
```javascript
// Fetches latest nexus-terminal.js from GitHub and deploys
btnDeployScript → Fetches from GitHub → Sends to terminal → Auto-executes
```

### Remote Shell
```javascript
// Execute any command on the terminal machine
remoteShellCmd: "npm install ws"  → Executes on terminal
```

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    NEXUS SCANNER PRO                        │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌─────────────┐    WebSocket/HTTP    ┌─────────────────┐  │
│  │   Browser   │ ◄─────────────────► │    Terminal     │  │
│  │  Extension  │                      │   Commander     │  │
│  └─────────────┘                      └─────────────────┘  │
│        │                                      │            │
│        ▼                                      ▼            │
│  ┌─────────────┐                      ┌─────────────────┐  │
│  │ all_phases  │                      │  AI Providers   │  │
│  │   Scanner   │                      │ (Multi-Model)   │  │
│  └─────────────┘                      └─────────────────┘  │
│        │                                      │            │
│        ▼                                      ▼            │
│  ┌─────────────────────────────────────────────────────┐   │
│  │              Unified Findings Store                 │   │
│  │         (Secrets, Vulns, Endpoints, Exploits)       │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 🔐 Security Patterns Detected

<details>
<summary><b>API Keys & Tokens (50+)</b></summary>

- Google API Keys (`AIza...`)
- AWS Access Keys (`AKIA...`)
- GitHub Tokens (`ghp_...`, `github_pat_...`)
- Stripe Keys (`sk_live_...`, `pk_live_...`)
- OpenAI Keys (`sk-...`)
- Slack Tokens (`xox...`)
- Firebase Keys
- Twilio Credentials
- SendGrid API Keys
- And many more...

</details>

<details>
<summary><b>Vulnerabilities (30+)</b></summary>

- DOM XSS (innerHTML, document.write, eval)
- Reflected XSS
- CORS Misconfigurations
- SSRF Indicators
- Open Redirects
- Prototype Pollution
- PostMessage Vulnerabilities
- WebSocket Hijacking
- GraphQL Introspection
- SQL Injection Points

</details>

---

## ⚠️ Disclaimer

**FOR AUTHORIZED SECURITY TESTING ONLY**

This tool is designed for:
- ✅ Authorized penetration testing
- ✅ Bug bounty programs
- ✅ Security research
- ✅ Educational purposes

**NOT for:**
- ❌ Unauthorized access
- ❌ Malicious activities
- ❌ Systems you don't own/have permission to test

Always obtain proper authorization before testing any system.

---

## 📄 License

MIT License - See [LICENSE](LICENSE) for details.

---

<p align="center">
  Made with ❤️ by <a href="https://github.com/kuh4ff">kuh4ff</a>
</p>

<p align="center">
  <a href="https://github.com/kuh4ff/website-scanner/issues">Report Bug</a> •
  <a href="https://github.com/kuh4ff/website-scanner/issues">Request Feature</a>
</p>
