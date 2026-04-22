import { createHash } from "node:crypto";
import { createServer as createHttpServer, IncomingMessage, ServerResponse } from "node:http";
import { createServer as createNetServer, Socket } from "node:net";
import { unlink } from "node:fs/promises";

import type { HostApplicationAdapter } from "@siftystudio/viv-runtime";

import { exportVivSnapshot, type VivSnapshot } from "./snapshot.js";

export interface SnapshotServerOptions {
    /** Schema version recorded in each snapshot payload. Passed through to exportVivSnapshot. */
    schemaVersion?: string;
    /**
     * Optional override that builds the snapshot. Useful when the host has
     * richer context than the adapter (e.g. caching). Defaults to exportVivSnapshot.
     */
    getSnapshot?: () => Promise<VivSnapshot>;
}

export interface HttpSnapshotServer {
    readonly url: string;
    close(): Promise<void>;
}

export interface IpcSnapshotServer {
    readonly path: string;
    /** Push a snapshot to every connected client without being polled. */
    push(snapshot: VivSnapshot): void;
    close(): Promise<void>;
}

/**
 * Starts an HTTP server that responds to `GET /snapshot` with the current
 * VivSnapshot as JSON. An ETag derived from the JSON payload is emitted so
 * polling clients can short-circuit unchanged payloads with 304.
 *
 * Any other path returns 404; any other method returns 405. This is a
 * deliberately minimal surface — the visualizer is the only consumer, and a
 * host app that wants a richer debug API should build its own.
 */
export async function startHttpSnapshotServer(
    adapter: HostApplicationAdapter,
    port = 0,
    host = "127.0.0.1",
    options: SnapshotServerOptions = {}
): Promise<HttpSnapshotServer> {
    const getSnapshot = options.getSnapshot ?? (() => exportVivSnapshot(adapter, {
        ...(options.schemaVersion !== undefined ? { schemaVersion: options.schemaVersion } : {})
    }));

    const server = createHttpServer((req: IncomingMessage, res: ServerResponse) => {
        handleHttpRequest(req, res, getSnapshot).catch((error) => {
            const message = error instanceof Error ? error.message : String(error);
            if (!res.headersSent) {
                res.writeHead(500, { "Content-Type": "application/json" });
            }
            res.end(JSON.stringify({ error: message }));
        });
    });

    await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, host, () => {
            server.off("error", reject);
            resolve();
        });
    });

    const address = server.address();
    const actualPort = typeof address === "object" && address !== null ? address.port : port;
    const url = `http://${host}:${actualPort}`;

    return {
        url,
        close: () =>
            new Promise<void>((resolve, reject) => {
                server.close((err) => (err ? reject(err) : resolve()));
            })
    };
}

async function handleHttpRequest(
    req: IncomingMessage,
    res: ServerResponse,
    getSnapshot: () => Promise<VivSnapshot>
): Promise<void> {
    if (req.method !== "GET" && req.method !== "HEAD") {
        res.writeHead(405, { Allow: "GET, HEAD", "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: `Method ${req.method} not allowed` }));
        return;
    }
    const url = req.url ?? "/";
    const pathname = url.split("?")[0];
    if (pathname !== "/snapshot" && pathname !== "/") {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: `Not found: ${pathname}` }));
        return;
    }

    const snapshot = await getSnapshot();
    const body = JSON.stringify(snapshot);
    const etag = `"${createHash("sha1").update(body).digest("hex")}"`;
    const ifNoneMatch = req.headers["if-none-match"];
    if (ifNoneMatch === etag) {
        res.writeHead(304, { ETag: etag });
        res.end();
        return;
    }
    res.writeHead(200, {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
        ETag: etag
    });
    if (req.method === "HEAD") {
        res.end();
    } else {
        res.end(body);
    }
}

/**
 * Starts a Unix-domain-socket (or Windows named pipe) server that speaks the
 * line-delimited JSON protocol the IpcSnapshotSource expects.
 *
 * Clients may either:
 *   - send `"snapshot\n"` and receive one JSON line with the current snapshot,
 *     or
 *   - stay connected and receive snapshots pushed via `server.push(...)`.
 *
 * The path is deleted on close so a restart won't trip over a stale inode.
 */
export async function startIpcSnapshotServer(
    adapter: HostApplicationAdapter,
    path: string,
    options: SnapshotServerOptions = {}
): Promise<IpcSnapshotServer> {
    const getSnapshot = options.getSnapshot ?? (() => exportVivSnapshot(adapter, {
        ...(options.schemaVersion !== undefined ? { schemaVersion: options.schemaVersion } : {})
    }));
    const clients = new Set<Socket>();

    const server = createNetServer((sock: Socket) => {
        sock.setEncoding("utf8");
        clients.add(sock);
        let buffer = "";
        sock.on("data", (chunk: string) => {
            buffer += chunk;
            let idx: number;
            while ((idx = buffer.indexOf("\n")) !== -1) {
                const request = buffer.slice(0, idx).trim();
                buffer = buffer.slice(idx + 1);
                if (request === "snapshot") {
                    void getSnapshot()
                        .then((snap) => {
                            if (!sock.destroyed) sock.write(JSON.stringify(snap) + "\n");
                        })
                        .catch((error) => {
                            const message =
                                error instanceof Error ? error.message : String(error);
                            if (!sock.destroyed) {
                                sock.write(JSON.stringify({ error: message }) + "\n");
                            }
                        });
                }
            }
        });
        sock.on("error", () => {
            clients.delete(sock);
        });
        sock.on("close", () => {
            clients.delete(sock);
        });
    });

    await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(path, () => {
            server.off("error", reject);
            resolve();
        });
    });

    return {
        path,
        push(snapshot: VivSnapshot) {
            const line = JSON.stringify(snapshot) + "\n";
            for (const sock of clients) {
                if (!sock.destroyed) sock.write(line);
            }
        },
        close: async () => {
            for (const sock of clients) sock.destroy();
            clients.clear();
            await new Promise<void>((resolve, reject) => {
                server.close((err) => (err ? reject(err) : resolve()));
            });
            try {
                await unlink(path);
            } catch {
                /* nothing to clean up */
            }
        }
    };
}
