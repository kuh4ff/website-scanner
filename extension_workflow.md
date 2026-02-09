# NEXUS Scanner Pro - Extension Architecture & Workflow

This document details the complete technical workflow of the NEXUS Scanner Pro browser extension.

## 1. Extension Architecture Overview

The extension follows the **Manifest V3** architecture with four main components:

1.  **Popup (UI Layer)**: `popup.html` / `popup.js` - The user interface.
2.  **Background Service Worker**: `background.js` - Persistent logic, network requests, and coordination.
3.  **Content Script**: `content.js` - The bridge between the extension and the web page.
4.  **Scanner Payload**: `all_phases.js` - The actual security scanning logic (fetched remotely).

---

## 2. Initialization Flow

When the extension is installed or browser starts:

1.  **Background Initialization (`background.js`)**:
    *   Service worker starts.
    *   Fetches **Remote Config** from `raw.githubusercontent.com`.
    *   Initialize WebSocket state (disconnected by default).
    *   Sets up listeners for messages (`chrome.runtime.onMessage`).

2.  **Popup Initialization (`popup.js`)**:
    *   User clicks extension icon.
    *   `init()` runs:
        *   Loads settings from `chrome.storage.local`.
        *   Checks `background.js` for existing Terminal connection.
        *   Injects status check into current tab to see if Scanner is already running.
        *   Updates UI state (buttons, toggles, status indicators).

---

## 3. Script Injection Workflow (The Core)

This is the most critical flow - how the scanner gets into the page.

### Step 1: User Action
*   User clicks **"Inject Scanner"** button in Popup.
*   `popup.js` calls `injectScript()`.

### Step 2: Fetching the Payload
*   `popup.js` checks the `githubUrl` setting.
*   Default URL: `https://raw.githubusercontent.com/kuh4ff/website-scanner/main/all_phases.js`.
*   **Crucial Step**: The extension fetches the *latest* code directly from GitHub. This allows "Hot Updates" without reinstalling the extension.

### Step 3: Sending to Background
*   `popup.js` sends `INJECT_SCRIPT` message to `background.js` with the fetched code.

### Step 4: Execution (`background.js`)
*   `background.js` receives `INJECT_SCRIPT`.
*   It uses `chrome.scripting.executeScript` to inject the code into the **MAIN world** of the target tab.
    *   **Why MAIN world?** So the scanner has full access to `window` variables, React/Vue internals, and can hook into network requests.

### Step 5: Activation
*   The injected code (`all_phases.js`) runs in the page.
*   It initializes `window.NexusEnvironment`.
*   It establishes a `postMessage` bridge with `content.js`.

---

## 4. Communication Bridge (CSP Bypass)

Websites with strict Content Security Policy (CSP) block inline scripts and `eval()`. NEXUS bypasses this using a standardized bridge.

1.  **Scanner (Page Context)**:
    *   Cannot talk to Extension directly.
    *   Sends data via `window.postMessage({ type: 'NEXUS_RESPONSE', ... })`.

2.  **Content Script (`content.js`)**:
    *   Sits in the middle.
    *   Listens for `message` events from `window`.
    *   Relays valid messages to Extension via `chrome.runtime.sendMessage()`.

3.  **Extension (`background.js` / `popup.js`)**:
    *   Receives message.
    *   Processes data (e.g., specific findings, stats).

**Flow:** `Scanner` -> `postMessage` -> `content.js` -> `runtime.sendMessage` -> `Extension`

---

## 5. Terminal Integration Flow

How the extension talks to the local terminal (Node.js).

1.  **Connection**:
    *   User enters WebSocket URL (e.g., `ws://localhost:8080`) in Popup.
    *   `popup.js` sends `CONNECT_TERMINAL` to `background.js`.
    *   `background.js` opens actual WebSocket connection.

2.  **Command Relay (Extension -> Terminal)**:
    *   User clicks "Exploit" or runs command in Extension.
    *   Extension sends JSON command to `background.js`.
    *   `background.js` forwards it over WebSocket to `nexus-terminal.js`.

3.  **Reverse Shell / Output (Terminal -> Extension)**:
    *   `nexus-terminal.js` sends output over WebSocket.
    *   `background.js` receives it.
    *   Forwards to `popup.js` to display in the UI "Terminal Output" window.

---

## 6. AI Integration Flow

1.  **User Request**: User clicks "Analyze with AI".
2.  **Popup**: Collects findings/context.
3.  **API Call**:
    *   Extension sends request to configured provider (Groq/OpenAI).
    *   **CSP Bypass**: `background.js` makes the `fetch()` call (Extension context is not limited by Page CSP).
4.  **Response**: AI analysis returned to Popup -> Content Script -> Page (if needed).

---

## 7. Storage & State Management

*   **Settings**: Stored in `chrome.storage.local` (persistent).
*   **Session**: Usage state (tabs, connections) in `background.js` memory (resets on browser restart).
*   **Cache**: `scriptCache` in storage to speed up injection if GitHub is slow.

---

## Diagrammatic Summary

```mermaid
graph TD
    User[User] -->|Click Inject| Popup[Popup.js]
    Popup -->|Fetch Code| GitHub[GitHub Raw]
    GitHub -->|Return JS| Popup
    Popup -->|INJECT_SCRIPT| Background[Background.js]
    Background -->|executeScript| Page[Web Page (MAIN World)]
    
    subgraph Browser Context
        Page
        Content[Content.js]
    end
    
    Page <-->|postMessage| Content
    Content <-->|runtime.sendMessage| Background
    Background <-->|WebSocket| Terminal[Local Terminal (Node.js)]
```
