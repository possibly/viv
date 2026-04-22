import { readFile } from "node:fs/promises";
import { createConnection } from "node:net";

import type { VivSnapshot } from "./snapshot.js";
import { validateSnapshotPayload } from "./snapshot.js";

/**
 * A live (or one-shot) source of Viv snapshots.
 *
 * The visualizer works in one of two modes:
 *   - **one-shot**: call getLatest() once, render, and idle until the user quits.
 *   - **live**: call getLatest() once for the first frame, then subscribe() to
 *     receive subsequent snapshots as the host app's state evolves.
 *
 * Implementations decide whether `subscribe` is meaningful; file-backed
 * sources just return a no-op unsubscribe.
 */
export interface SnapshotSource {
    readonly label: string;
    getLatest(): Promise<VivSnapshot>;
    subscribe(listener: SnapshotListener): () => void;
    dispose(): Promise<void>;
}

export type SnapshotListener = (snapshot: VivSnapshot) => void;

/**
 * Reads a snapshot from a JSON file. No live updates — `subscribe` is a no-op.
 */
export class FileSnapshotSource implements SnapshotSource {
    readonly label: string;
    private readonly path: string;

    constructor(path: string) {
        this.path = path;
        this.label = `file:${path}`;
    }

    async getLatest(): Promise<VivSnapshot> {
        let raw: string;
        try {
            raw = await readFile(this.path, "utf8");
        } catch (error) {
            const cause = error instanceof Error ? error.message : String(error);
            throw new Error(`Could not read snapshot file at ${this.path}: ${cause}`);
        }
        let parsed: unknown;
        try {
            parsed = JSON.parse(raw);
        } catch (error) {
            const cause = error instanceof Error ? error.message : String(error);
            throw new Error(`Snapshot at ${this.path} is not valid JSON: ${cause}`);
        }
        return validateSnapshotPayload(parsed, `file ${this.path}`);
    }

    subscribe(_listener: SnapshotListener): () => void {
        return () => {};
    }

    async dispose(): Promise<void> {
        /* nothing to clean up */
    }
}

export interface HttpSnapshotSourceOptions {
    /** Polling interval in ms. Set to 0 to disable polling (one-shot). */
    pollIntervalMs?: number;
    /** Optional fetch override, for tests. */
    fetchFn?: typeof fetch;
}

/**
 * Fetches snapshots from an HTTP(S) endpoint. Live updates are delivered by
 * polling the endpoint; the server is expected to respond with the full
 * snapshot JSON each time. ETag/If-None-Match is honoured to avoid re-parsing
 * unchanged payloads.
 */
export class HttpSnapshotSource implements SnapshotSource {
    readonly label: string;
    private readonly url: string;
    private readonly pollIntervalMs: number;
    private readonly fetchFn: typeof fetch;
    private readonly listeners = new Set<SnapshotListener>();
    private poller: ReturnType<typeof setInterval> | null = null;
    private lastEtag: string | null = null;
    private lastSnapshot: VivSnapshot | null = null;
    private disposed = false;

    constructor(url: string, options: HttpSnapshotSourceOptions = {}) {
        this.url = url;
        this.pollIntervalMs = options.pollIntervalMs ?? 1000;
        this.fetchFn = options.fetchFn ?? globalThis.fetch;
        this.label = `http:${url}`;
        if (typeof this.fetchFn !== "function") {
            throw new Error(
                "HttpSnapshotSource requires a global fetch (Node 18+) or an explicit fetchFn."
            );
        }
    }

    async getLatest(): Promise<VivSnapshot> {
        const snap = await this.fetchOnce();
        if (snap !== null) return snap;
        if (this.lastSnapshot !== null) return this.lastSnapshot;
        throw new Error(`No snapshot available from ${this.url}`);
    }

    subscribe(listener: SnapshotListener): () => void {
        if (this.disposed) {
            throw new Error("Cannot subscribe to a disposed HttpSnapshotSource.");
        }
        this.listeners.add(listener);
        if (this.poller === null && this.pollIntervalMs > 0) {
            this.poller = setInterval(() => {
                void this.pollTick();
            }, this.pollIntervalMs);
            // Node: don't keep the event loop alive just to poll.
            if (typeof this.poller.unref === "function") this.poller.unref();
        }
        return () => {
            this.listeners.delete(listener);
            if (this.listeners.size === 0 && this.poller !== null) {
                clearInterval(this.poller);
                this.poller = null;
            }
        };
    }

    async dispose(): Promise<void> {
        this.disposed = true;
        this.listeners.clear();
        if (this.poller !== null) {
            clearInterval(this.poller);
            this.poller = null;
        }
    }

    private async pollTick(): Promise<void> {
        try {
            const snap = await this.fetchOnce();
            if (snap !== null) {
                for (const listener of this.listeners) listener(snap);
            }
        } catch {
            // Swallow transient errors so a flaky server doesn't crash the TUI.
            // The last-known-good snapshot stays on screen.
        }
    }

    private async fetchOnce(): Promise<VivSnapshot | null> {
        const headers: Record<string, string> = { Accept: "application/json" };
        if (this.lastEtag !== null) headers["If-None-Match"] = this.lastEtag;
        const response = await this.fetchFn(this.url, { headers });
        if (response.status === 304) return null;
        if (!response.ok) {
            throw new Error(
                `Snapshot endpoint ${this.url} returned HTTP ${response.status} ${response.statusText}`
            );
        }
        const etag = response.headers.get("etag");
        if (etag !== null) this.lastEtag = etag;
        const body = await response.text();
        let parsed: unknown;
        try {
            parsed = JSON.parse(body);
        } catch (error) {
            const cause = error instanceof Error ? error.message : String(error);
            throw new Error(`Snapshot from ${this.url} is not valid JSON: ${cause}`);
        }
        const snap = validateSnapshotPayload(parsed, `HTTP ${this.url}`);
        this.lastSnapshot = snap;
        return snap;
    }
}

export interface IpcSnapshotSourceOptions {
    /** Polling interval in ms for request/response mode. Set to 0 to disable. */
    pollIntervalMs?: number;
}

/**
 * Reads snapshots from a Unix-domain socket (or Windows named pipe).
 *
 * Supports two protocols on the same transport:
 *   - **push**: the server sends one JSON snapshot per line as they happen,
 *     no prompting required. Ideal for tightly-coupled hosts.
 *   - **poll**: the client sends a newline-terminated `"snapshot\n"` request
 *     and the server responds with one JSON snapshot line. Used when
 *     pollIntervalMs > 0.
 *
 * The client speaks both: it always reads incoming lines as pushed snapshots,
 * and (optionally) sends periodic requests.
 */
export class IpcSnapshotSource implements SnapshotSource {
    readonly label: string;
    private readonly path: string;
    private readonly pollIntervalMs: number;
    private readonly listeners = new Set<SnapshotListener>();
    private socket: ReturnType<typeof createConnection> | null = null;
    private connectPromise: Promise<void> | null = null;
    private poller: ReturnType<typeof setInterval> | null = null;
    private buffer = "";
    private lastSnapshot: VivSnapshot | null = null;
    private pendingFirst: {
        resolve: (snap: VivSnapshot) => void;
        reject: (err: Error) => void;
    } | null = null;
    private disposed = false;

    constructor(path: string, options: IpcSnapshotSourceOptions = {}) {
        this.path = path;
        this.pollIntervalMs = options.pollIntervalMs ?? 0;
        this.label = `ipc:${path}`;
    }

    async getLatest(): Promise<VivSnapshot> {
        await this.ensureConnected();
        if (this.lastSnapshot !== null) return this.lastSnapshot;
        // Request a snapshot and wait for the first line.
        return new Promise<VivSnapshot>((resolve, reject) => {
            this.pendingFirst = { resolve, reject };
            this.sendRequest();
            setTimeout(() => {
                if (this.pendingFirst !== null) {
                    const pending = this.pendingFirst;
                    this.pendingFirst = null;
                    pending.reject(
                        new Error(`Timed out waiting for snapshot from ${this.path}`)
                    );
                }
            }, 5000).unref?.();
        });
    }

    subscribe(listener: SnapshotListener): () => void {
        if (this.disposed) {
            throw new Error("Cannot subscribe to a disposed IpcSnapshotSource.");
        }
        this.listeners.add(listener);
        if (this.poller === null && this.pollIntervalMs > 0) {
            this.poller = setInterval(() => {
                this.sendRequest();
            }, this.pollIntervalMs);
            if (typeof this.poller.unref === "function") this.poller.unref();
        }
        return () => {
            this.listeners.delete(listener);
            if (this.listeners.size === 0 && this.poller !== null) {
                clearInterval(this.poller);
                this.poller = null;
            }
        };
    }

    async dispose(): Promise<void> {
        this.disposed = true;
        this.listeners.clear();
        if (this.poller !== null) {
            clearInterval(this.poller);
            this.poller = null;
        }
        if (this.socket !== null) {
            this.socket.destroy();
            this.socket = null;
        }
    }

    private ensureConnected(): Promise<void> {
        if (this.socket !== null) return Promise.resolve();
        if (this.connectPromise !== null) return this.connectPromise;
        this.connectPromise = new Promise<void>((resolve, reject) => {
            const sock = createConnection({ path: this.path });
            sock.setEncoding("utf8");
            sock.once("error", (err) => {
                this.connectPromise = null;
                reject(new Error(`Could not connect to IPC socket ${this.path}: ${err.message}`));
            });
            sock.once("connect", () => {
                this.socket = sock;
                sock.on("data", (chunk: string) => this.onData(chunk));
                sock.on("close", () => {
                    this.socket = null;
                });
                resolve();
            });
        });
        return this.connectPromise;
    }

    private sendRequest(): void {
        if (this.socket === null) return;
        this.socket.write("snapshot\n");
    }

    private onData(chunk: string): void {
        this.buffer += chunk;
        let idx: number;
        while ((idx = this.buffer.indexOf("\n")) !== -1) {
            const line = this.buffer.slice(0, idx).trim();
            this.buffer = this.buffer.slice(idx + 1);
            if (line.length === 0) continue;
            this.handleLine(line);
        }
    }

    private handleLine(line: string): void {
        let parsed: unknown;
        try {
            parsed = JSON.parse(line);
        } catch {
            return;
        }
        let snap: VivSnapshot;
        try {
            snap = validateSnapshotPayload(parsed, `IPC ${this.path}`);
        } catch {
            return;
        }
        this.lastSnapshot = snap;
        if (this.pendingFirst !== null) {
            const { resolve } = this.pendingFirst;
            this.pendingFirst = null;
            resolve(snap);
        }
        for (const listener of this.listeners) listener(snap);
    }
}
