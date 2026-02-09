<div align="center">

<!-- Animated Header -->
<img src="https://capsule-render.vercel.app/api?type=waving&color=gradient&customColorList=6,11,20&height=180&section=header&text=🔒%20NEXUS%20SCANNER&fontSize=42&fontColor=fff&animation=twinkling&fontAlignY=32&desc=Professional%20Security%20Scanner%20%7C%20Bug%20Bounty%20Grade&descSize=18&descAlignY=52"/>

<!-- Badges -->
<p>
  <img src="https://img.shields.io/badge/Version-4.0%20PRO-8b5cf6?style=for-the-badge&logo=rocket&logoColor=white"/>
  <img src="https://img.shields.io/badge/Chrome-Extension%20v3.0-22c55e?style=for-the-badge&logo=googlechrome&logoColor=white"/>
  <img src="https://img.shields.io/badge/Node.js-Terminal%20Server-339933?style=for-the-badge&logo=nodedotjs&logoColor=white"/>
</p>
<p>
  <img src="https://img.shields.io/github/stars/kuh4ff/website-scanner?style=for-the-badge&color=f59e0b&logo=github"/>
  <img src="https://img.shields.io/github/forks/kuh4ff/website-scanner?style=for-the-badge&color=3b82f6&logo=github"/>
  <img src="https://img.shields.io/github/license/kuh4ff/website-scanner?style=for-the-badge&color=ef4444"/>
</p>

<!-- Typing Animation -->
<img src="https://readme-typing-svg.demolab.com?font=Fira+Code&weight=600&size=22&pause=1000&color=8B5CF6&center=true&vCenter=true&multiline=true&repeat=true&width=600&height=100&lines=🎯+250%2B+Security+Patterns;🔑+Auto+API+Key+Detection;💀+Live+Vulnerability+Testing;🤖+AI-Powered+Analysis"/>

</div>

---

## 🌟 **What is NEXUS Scanner?**

NEXUS Scanner is a **professional-grade security scanner** designed for bug bounty hunters and security researchers. It automatically detects:

<table>
<tr>
<td width="50%">

### 🔍 **Detection Capabilities**
- 🔑 **API Keys** (AWS, Google, Stripe, etc.)
- 🎫 **Auth Tokens** (JWT, OAuth, Session)
- 🔐 **Secrets** (Private Keys, Passwords)
- 📧 **Credentials** (Database, SMTP, SSH)
- 🌐 **Endpoints** (Hidden APIs, Admin Panels)

</td>
<td width="50%">

### 💀 **Vulnerability Scanning**
- 🎯 **DOM XSS** Detection
- 🔄 **CORS** Misconfigurations
- 🌐 **SSRF** Indicators
- 📨 **PostMessage** Vulnerabilities
- 🔓 **Security Headers** Analysis

</td>
</tr>
</table>

---

## ⚡ **Quick Start**

### **Method 1: Chrome Extension (Recommended)**

<img src="https://img.shields.io/badge/Easiest%20Method-One%20Click%20Install-22c55e?style=for-the-badge"/>

```
1. Download the nexus-extension folder
2. Go to chrome://extensions/
3. Enable "Developer mode" (top right)
4. Click "Load unpacked"
5. Select the nexus-extension folder
6. Click the extension icon → Inject Scanner
```

### **Method 2: Console Injection**

<img src="https://img.shields.io/badge/Manual-Copy%20%26%20Paste-3b82f6?style=for-the-badge"/>

```javascript
// Open DevTools (F12) → Console → Paste this:
fetch('https://raw.githubusercontent.com/kuh4ff/website-scanner/main/all_phases.js')
  .then(r => r.text())
  .then(eval);
```

### **Method 3: Bookmarklet**

<img src="https://img.shields.io/badge/Bookmark-One%20Click-f59e0b?style=for-the-badge"/>

```javascript
javascript:(function(){fetch('https://raw.githubusercontent.com/kuh4ff/website-scanner/main/all_phases.js').then(r=>r.text()).then(eval)})();
```

---

## 🎮 **Commands Reference**

<details>
<summary><b>📌 Click to expand full command list</b></summary>

### 🚀 **Scan Control**
| Command | Description |
|---------|-------------|
| `start()` | Start scanning |
| `stop()` | Stop scanning |
| `STOP()` | Emergency stop all |

### 🎯 **Bug Bounty Analysis**
| Command | Description |
|---------|-------------|
| `bounty()` | 🔥 One-click professional analysis |
| `bounty({ai:true})` | With AI enhancement |
| `quickBounty(value)` | Quick check single value |
| `proAnalyze()` | Full 7-step analysis |

### 🔐 **Secret Detection**
| Command | Description |
|---------|-------------|
| `patterns()` | Show all 250+ patterns |
| `findings()` | Show detected secrets |
| `exploitable()` | Show live/exploitable keys |
| `results()` | Validation results |

### 💀 **Vulnerability Dashboard**
| Command | Description |
|---------|-------------|
| `dashboard()` / `vulns()` | Full vulnerability dashboard |
| `domxss()` / `xss()` | DOM XSS analysis |
| `cors()` | CORS misconfiguration |
| `ssrf()` | SSRF indicators |
| `headers()` | Security headers |
| `postmessage()` | PostMessage vulns |

### 🤖 **AI Features**
| Command | Description |
|---------|-------------|
| `setAI(key)` | Set AI API key |
| `ai()` | Run AI analysis |
| `aiClassify(finding)` | AI classification |
| `aiChains()` | AI attack chains |

### 🚀 **Auto Exploitation**
| Command | Description |
|---------|-------------|
| `autoExploit()` | Full automation |
| `deepExploit(idx)` | Deep exploit by index |
| `quickTest(key, type)` | Test single key |
| `fullReport()` | Generate report |

</details>

---

## 📁 **Project Structure**

```
website-scanner/
│
├── 📄 all_phases.js          # Main scanner script (26K+ lines)
│   ├── Phase 1: Core Engine
│   ├── Phase 2: Secret Detection (250+ patterns)
│   ├── Phase 3: Vulnerability Scanner
│   ├── Phase 4: Auto Exploitation
│   └── Phase 5: AI Analysis & Reporting
│
├── 📄 nexus-terminal.js      # Terminal server with AI
│   ├── WebSocket Server
│   ├── Cloudflare Tunnel Support
│   ├── Multi-AI Integration (Groq, Gemini, OpenAI)
│   └── ThreadPool & AsyncQueue
│
└── 📁 nexus-extension/       # Chrome Extension v3.0
    ├── manifest.json         # Extension manifest
    ├── popup.html            # Professional UI
    ├── popup.js              # Controller logic
    ├── background.js         # Service worker
    └── content.js            # Page bridge
```

---

## 🔌 **Chrome Extension Features**

<div align="center">
<table>
<tr>
<td align="center" width="25%">
<img src="https://img.icons8.com/fluency/96/rocket.png" width="48"/>
<br><b>One-Click Inject</b>
<br><sub>Auto-fetch from GitHub</sub>
</td>
<td align="center" width="25%">
<img src="https://img.icons8.com/fluency/96/search.png" width="48"/>
<br><b>Quick/Deep Scan</b>
<br><sub>Multiple scan modes</sub>
</td>
<td align="center" width="25%">
<img src="https://img.icons8.com/fluency/96/console.png" width="48"/>
<br><b>Terminal Connect</b>
<br><sub>WebSocket relay</sub>
</td>
<td align="center" width="25%">
<img src="https://img.icons8.com/fluency/96/ai.png" width="48"/>
<br><b>AI Analysis</b>
<br><sub>Smart detection</sub>
</td>
</tr>
</table>
</div>

### Extension Tabs:
- **🔍 Scanner** - Inject, scan, view stats
- **💻 Terminal** - Connect to nexus-terminal server
- **🛠️ Tools** - AI analysis, export reports
- **⚙️ Settings** - Configure GitHub URL, options

---

## 🖥️ **Terminal Server Setup**

```bash
# Install dependencies
npm install ws groq-sdk @google/generative-ai openai

# Run the server
node nexus-terminal.js

# With Cloudflare Tunnel (public access)
# The server auto-creates tunnel URL
```

### Terminal Features:
- 🌐 WebSocket Server (port 8080)
- ☁️ Cloudflare Tunnel Integration
- 🤖 Multi-AI Support (Groq, Gemini, OpenAI, Claude)
- ⚡ ThreadPool for parallel processing
- 📊 Real-time scan results relay

---

## 🎯 **Supported Patterns (250+)**

<details>
<summary><b>🔑 API Keys & Tokens</b></summary>

| Provider | Pattern Type |
|----------|--------------|
| AWS | Access Key, Secret Key, Session Token |
| Google | API Key, OAuth, Service Account |
| Azure | Subscription Key, SAS Token |
| Stripe | Secret Key, Publishable Key |
| GitHub | Personal Token, OAuth Token |
| Firebase | API Key, Auth Token |
| Twilio | Account SID, Auth Token |
| SendGrid | API Key |
| Slack | Bot Token, Webhook |
| Discord | Bot Token, Webhook |
| ... and 200+ more |

</details>

<details>
<summary><b>💀 Vulnerability Types</b></summary>

- DOM-based XSS (innerHTML, document.write, eval)
- Reflected XSS indicators
- CORS misconfigurations
- SSRF endpoints
- Open redirects
- PostMessage vulnerabilities
- Prototype pollution
- SQL injection patterns
- Path traversal
- Security header issues

</details>

---

## ⚠️ **Disclaimer**

<div align="center">

```
╔══════════════════════════════════════════════════════════════════╗
║  ⚠️  FOR AUTHORIZED SECURITY TESTING ONLY  ⚠️                    ║
║                                                                   ║
║  This tool is intended for:                                       ║
║  • Bug bounty programs you're authorized to test                  ║
║  • Security assessments with written permission                   ║
║  • Educational purposes on your own systems                       ║
║                                                                   ║
║  Unauthorized use is ILLEGAL and UNETHICAL                        ║
║  The author is NOT responsible for misuse                         ║
╚══════════════════════════════════════════════════════════════════╝
```

</div>

---

## 🤝 **Contributing**

<div align="center">

Contributions are welcome! Feel free to:

[![Issues](https://img.shields.io/badge/Report-Issues-ef4444?style=for-the-badge&logo=github)](https://github.com/kuh4ff/website-scanner/issues)
[![Pull Requests](https://img.shields.io/badge/Submit-PR-22c55e?style=for-the-badge&logo=github)](https://github.com/kuh4ff/website-scanner/pulls)

</div>

---

## 📜 **License**

<div align="center">

This project is licensed under the **MIT License**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=for-the-badge)](https://opensource.org/licenses/MIT)

</div>

---

## 👨‍💻 **Author**

<div align="center">

<img src="https://github.com/kuh4ff.png" width="100" style="border-radius: 50%"/>

**kuh4ff**

[![GitHub](https://img.shields.io/badge/GitHub-kuh4ff-181717?style=for-the-badge&logo=github)](https://github.com/kuh4ff)

</div>

---

<div align="center">

<!-- Footer Wave -->
<img src="https://capsule-render.vercel.app/api?type=waving&color=gradient&customColorList=6,11,20&height=100&section=footer"/>

<p>
<b>⭐ Star this repo if you find it useful! ⭐</b>
</p>

<img src="https://img.shields.io/badge/Made%20with-❤️-ef4444?style=for-the-badge"/>

</div>
