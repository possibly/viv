// Launches Chrome headless with CDP, loads the example, waits for window.__VIV_DONE__,
// and asserts the chronicle rendered. Exits non-zero on failure.
//
// Usage: node cdp-test.mjs [url]
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const URL_ = process.argv[2] || "http://localhost:8765/";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const DEBUG_PORT = 9222;

const userDataDir = mkdtempSync(join(tmpdir(), "viv-cdp-"));
const chrome = spawn(CHROME, [
    "--headless=new",
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    `--remote-debugging-port=${DEBUG_PORT}`,
    `--user-data-dir=${userDataDir}`,
    "about:blank",
], { stdio: ["ignore", "pipe", "pipe"] });

const cleanup = () => {
    try { chrome.kill("SIGTERM"); } catch {}
    try { rmSync(userDataDir, { recursive: true, force: true }); } catch {}
};
process.on("exit", cleanup);
process.on("SIGINT", () => { cleanup(); process.exit(130); });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForDevtools() {
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
        try {
            const r = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/version`);
            if (r.ok) return (await r.json()).webSocketDebuggerUrl;
        } catch {}
        await sleep(100);
    }
    throw new Error("Chrome devtools endpoint did not come up");
}

class CDP {
    constructor(ws) {
        this.ws = ws;
        this.id = 0;
        this.pending = new Map();
        this.listeners = new Set();
        ws.addEventListener("message", (ev) => {
            const msg = JSON.parse(ev.data);
            if (msg.id != null && this.pending.has(msg.id)) {
                const { resolve, reject } = this.pending.get(msg.id);
                this.pending.delete(msg.id);
                msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
            } else if (msg.method) {
                for (const l of this.listeners) l(msg);
            }
        });
    }
    send(method, params = {}, sessionId) {
        const id = ++this.id;
        const payload = { id, method, params };
        if (sessionId) payload.sessionId = sessionId;
        this.ws.send(JSON.stringify(payload));
        return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
    }
    on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
}

async function openWs(url) {
    const ws = new WebSocket(url);
    await new Promise((resolve, reject) => {
        ws.addEventListener("open", resolve, { once: true });
        ws.addEventListener("error", reject, { once: true });
    });
    return ws;
}

async function main() {
    const browserWsUrl = await waitForDevtools();
    const browserWs = await openWs(browserWsUrl);
    const browser = new CDP(browserWs);

    const { targetId } = await browser.send("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await browser.send("Target.attachToTarget", { targetId, flatten: true });

    const consoleLines = [];
    const pageErrors = [];
    browser.on((m) => {
        if (m.sessionId !== sessionId) return;
        if (m.method === "Runtime.consoleAPICalled") {
            const text = m.params.args.map((a) => a.value ?? a.description ?? "").join(" ");
            consoleLines.push(`[${m.params.type}] ${text}`);
        } else if (m.method === "Runtime.exceptionThrown") {
            pageErrors.push(m.params.exceptionDetails.exception?.description
                || m.params.exceptionDetails.text);
        }
    });

    await browser.send("Page.enable", {}, sessionId);
    await browser.send("Runtime.enable", {}, sessionId);
    await browser.send("Page.navigate", { url: URL_ }, sessionId);

    // Poll for __VIV_DONE__
    const deadline = Date.now() + 30_000;
    let result = null;
    while (Date.now() < deadline) {
        const { result: r } = await browser.send("Runtime.evaluate", {
            expression: "JSON.stringify(window.__VIV_DONE__ || null)",
            returnByValue: true,
        }, sessionId);
        if (r.value && r.value !== "null") { result = JSON.parse(r.value); break; }
        await sleep(200);
    }

    console.log("--- console ---");
    for (const l of consoleLines) console.log(l);
    if (pageErrors.length) {
        console.log("--- page errors ---");
        for (const e of pageErrors) console.log(e);
    }
    console.log("--- result ---");
    console.log(JSON.stringify(result, null, 2));

    if (!result) throw new Error("timed out waiting for window.__VIV_DONE__");
    if (result.error) throw new Error(`page errored: ${result.error}`);
    if (!result.actionCount || result.actionCount < 1) {
        throw new Error(`expected actions, got ${result.actionCount}`);
    }
    console.log(`OK — ${result.actionCount} actions rendered`);
}

main().catch((err) => {
    console.error("FAIL:", err.message);
    cleanup();
    process.exit(1);
}).then(() => { cleanup(); process.exit(0); });
