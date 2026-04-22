import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import {
    FileSnapshotSource,
    HttpSnapshotSource,
    IpcSnapshotSource
} from "../src/source.js";
import type { VivSnapshot } from "../src/snapshot.js";
import { startHttpSnapshotServer, startIpcSnapshotServer } from "../src/server.js";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const FIXTURE = new URL("./fixtures/snapshot-hello.json", import.meta.url).pathname;

async function loadFixtureSnapshot(): Promise<VivSnapshot> {
    return JSON.parse(await readFile(FIXTURE, "utf8")) as VivSnapshot;
}

function makeAdapterStub(snapshot: VivSnapshot): { getSnapshot: () => Promise<VivSnapshot> } {
    // startHttpSnapshotServer/startIpcSnapshotServer accept a getSnapshot override,
    // letting us skip the HostApplicationAdapter entirely in tests.
    return { getSnapshot: async () => snapshot };
}

describe("FileSnapshotSource", () => {
    it("loads a snapshot from disk", async () => {
        const source = new FileSnapshotSource(FIXTURE);
        const snap = await source.getLatest();
        expect(snap.timestamp).toBe(20);
        await source.dispose();
    });

    it("reports a helpful error for a missing file", async () => {
        const source = new FileSnapshotSource("/definitely/does/not/exist.json");
        await expect(source.getLatest()).rejects.toThrow(/Could not read snapshot/);
    });
});

describe("HttpSnapshotSource <-> startHttpSnapshotServer", () => {
    it("round-trips a snapshot over HTTP", async () => {
        const fixture = await loadFixtureSnapshot();
        const stub = makeAdapterStub(fixture);
        // startHttpSnapshotServer's first arg is typed as HostApplicationAdapter,
        // but the getSnapshot override means we never touch it.
        const server = await startHttpSnapshotServer(null as never, 0, "127.0.0.1", {
            getSnapshot: stub.getSnapshot
        });
        try {
            const source = new HttpSnapshotSource(`${server.url}/snapshot`, {
                pollIntervalMs: 0
            });
            const snap = await source.getLatest();
            expect(snap.timestamp).toBe(fixture.timestamp);
            expect(snap.schemaVersion).toBe(fixture.schemaVersion);
            await source.dispose();
        } finally {
            await server.close();
        }
    });

    it("returns 404 for unknown paths", async () => {
        const fixture = await loadFixtureSnapshot();
        const server = await startHttpSnapshotServer(null as never, 0, "127.0.0.1", {
            getSnapshot: async () => fixture
        });
        try {
            const response = await fetch(`${server.url}/nonsense`);
            expect(response.status).toBe(404);
        } finally {
            await server.close();
        }
    });

    it("returns 304 when the payload is unchanged", async () => {
        const fixture = await loadFixtureSnapshot();
        const server = await startHttpSnapshotServer(null as never, 0, "127.0.0.1", {
            getSnapshot: async () => fixture
        });
        try {
            const first = await fetch(`${server.url}/snapshot`);
            expect(first.status).toBe(200);
            const etag = first.headers.get("etag");
            expect(etag).not.toBeNull();
            await first.text();
            const second = await fetch(`${server.url}/snapshot`, {
                headers: { "If-None-Match": etag! }
            });
            expect(second.status).toBe(304);
        } finally {
            await server.close();
        }
    });

    it("delivers updates to subscribers when the server's snapshot changes", async () => {
        const fixture = await loadFixtureSnapshot();
        let current: VivSnapshot = { ...fixture, timestamp: 100 };
        const server = await startHttpSnapshotServer(null as never, 0, "127.0.0.1", {
            getSnapshot: async () => current
        });
        try {
            const source = new HttpSnapshotSource(`${server.url}/snapshot`, {
                pollIntervalMs: 30
            });
            const first = await source.getLatest();
            expect(first.timestamp).toBe(100);

            const received: number[] = [];
            const unsubscribe = source.subscribe((snap) => received.push(snap.timestamp));

            current = { ...fixture, timestamp: 200 };
            await waitFor(() => received.includes(200), 1000);
            expect(received).toContain(200);

            unsubscribe();
            await source.dispose();
        } finally {
            await server.close();
        }
    });
});

describe("IpcSnapshotSource <-> startIpcSnapshotServer", () => {
    it("round-trips a snapshot over a Unix domain socket", async () => {
        if (process.platform === "win32") return;
        const fixture = await loadFixtureSnapshot();
        const dir = await mkdtemp(join(tmpdir(), "viv-viz-ipc-"));
        const sockPath = join(dir, "viv.sock");
        const server = await startIpcSnapshotServer(null as never, sockPath, {
            getSnapshot: async () => fixture
        });
        try {
            const source = new IpcSnapshotSource(sockPath, { pollIntervalMs: 0 });
            const snap = await source.getLatest();
            expect(snap.timestamp).toBe(fixture.timestamp);
            await source.dispose();
        } finally {
            await server.close();
        }
    });

    it("pushes snapshots to subscribed clients", async () => {
        if (process.platform === "win32") return;
        const fixture = await loadFixtureSnapshot();
        const dir = await mkdtemp(join(tmpdir(), "viv-viz-ipc-"));
        const sockPath = join(dir, "viv.sock");
        const server = await startIpcSnapshotServer(null as never, sockPath, {
            getSnapshot: async () => fixture
        });
        try {
            const source = new IpcSnapshotSource(sockPath, { pollIntervalMs: 0 });
            await source.getLatest();

            const received: number[] = [];
            const unsubscribe = source.subscribe((snap) => received.push(snap.timestamp));

            server.push({ ...fixture, timestamp: 777 });
            server.push({ ...fixture, timestamp: 888 });
            await waitFor(() => received.includes(888), 1000);
            expect(received).toEqual(expect.arrayContaining([777, 888]));

            unsubscribe();
            await source.dispose();
        } finally {
            await server.close();
        }
    });
});

async function waitFor(predicate: () => boolean, timeoutMs: number): Promise<void> {
    const start = Date.now();
    while (!predicate()) {
        if (Date.now() - start > timeoutMs) {
            throw new Error(`Timed out after ${timeoutMs}ms waiting for condition`);
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
    }
}
