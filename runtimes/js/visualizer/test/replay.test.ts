import { readFile, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
    RecordingSnapshotSource,
    ReplaySnapshotSource,
    type SnapshotListener,
    type SnapshotSource
} from "../src/source.js";
import type { VivSnapshot } from "../src/snapshot.js";

const FIXTURE = new URL("./fixtures/snapshot-hello.json", import.meta.url).pathname;

async function loadFixture(): Promise<VivSnapshot> {
    return JSON.parse(await readFile(FIXTURE, "utf8")) as VivSnapshot;
}

function bumpTimestamp(snap: VivSnapshot, ts: number): VivSnapshot {
    return { ...snap, timestamp: ts };
}

async function writeJsonl(path: string, frames: VivSnapshot[]): Promise<void> {
    const body = frames.map((f) => JSON.stringify(f)).join("\n") + "\n";
    await writeFile(path, body);
}

describe("ReplaySnapshotSource", () => {
    it("returns the first recorded frame from getLatest", async () => {
        const base = await loadFixture();
        const dir = await mkdtemp(join(tmpdir(), "viv-viz-replay-"));
        const path = join(dir, "session.jsonl");
        await writeJsonl(path, [
            bumpTimestamp(base, 10),
            bumpTimestamp(base, 20),
            bumpTimestamp(base, 30)
        ]);

        const source = new ReplaySnapshotSource(path);
        const first = await source.getLatest();
        expect(first.timestamp).toBe(10);
        expect(await source.count()).toBe(3);
        await source.dispose();
    });

    it("drains remaining frames to subscribers in a burst", async () => {
        const base = await loadFixture();
        const dir = await mkdtemp(join(tmpdir(), "viv-viz-replay-"));
        const path = join(dir, "session.jsonl");
        await writeJsonl(path, [
            bumpTimestamp(base, 10),
            bumpTimestamp(base, 20),
            bumpTimestamp(base, 30)
        ]);

        const source = new ReplaySnapshotSource(path);
        await source.getLatest();

        const received: number[] = [];
        const unsubscribe = source.subscribe((snap) => received.push(snap.timestamp));
        await new Promise((resolve) => setImmediate(resolve));
        expect(received).toEqual([20, 30]);
        unsubscribe();
        await source.dispose();
    });

    it("surfaces a clear error when a line is not JSON", async () => {
        const dir = await mkdtemp(join(tmpdir(), "viv-viz-replay-"));
        const path = join(dir, "bad.jsonl");
        await writeFile(path, "not json\n");
        const source = new ReplaySnapshotSource(path);
        await expect(source.getLatest()).rejects.toThrow(/line 1 is not valid JSON/);
        await source.dispose();
    });

    it("ignores blank lines between snapshots", async () => {
        const base = await loadFixture();
        const dir = await mkdtemp(join(tmpdir(), "viv-viz-replay-"));
        const path = join(dir, "blank.jsonl");
        await writeFile(
            path,
            `${JSON.stringify(bumpTimestamp(base, 1))}\n\n${JSON.stringify(bumpTimestamp(base, 2))}\n`
        );
        const source = new ReplaySnapshotSource(path);
        expect((await source.getLatest()).timestamp).toBe(1);
        expect(await source.count()).toBe(2);
        await source.dispose();
    });

    it("reports an error when the file is missing", async () => {
        const source = new ReplaySnapshotSource("/definitely/does/not/exist.jsonl");
        await expect(source.getLatest()).rejects.toThrow(/Could not read replay file/);
        await source.dispose();
    });
});

class FakeSource implements SnapshotSource {
    readonly label = "fake";
    private listeners = new Set<SnapshotListener>();
    private latest: VivSnapshot;
    constructor(initial: VivSnapshot) {
        this.latest = initial;
    }
    async getLatest(): Promise<VivSnapshot> {
        return this.latest;
    }
    subscribe(listener: SnapshotListener): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }
    async dispose(): Promise<void> {
        this.listeners.clear();
    }
    emit(next: VivSnapshot): void {
        this.latest = next;
        for (const listener of this.listeners) listener(next);
    }
}

describe("RecordingSnapshotSource", () => {
    it("writes every seen snapshot to the target file as JSONL", async () => {
        const base = await loadFixture();
        const dir = await mkdtemp(join(tmpdir(), "viv-viz-record-"));
        const path = join(dir, "out.jsonl");

        const inner = new FakeSource(bumpTimestamp(base, 10));
        const rec = new RecordingSnapshotSource(inner, path);
        await rec.getLatest(); // writes T=10

        const received: number[] = [];
        const unsubscribe = rec.subscribe((snap) => received.push(snap.timestamp));

        inner.emit(bumpTimestamp(base, 20));
        inner.emit(bumpTimestamp(base, 30));

        // Give the serialized write chain a tick to flush.
        await new Promise((resolve) => setImmediate(resolve));
        await new Promise((resolve) => setImmediate(resolve));

        unsubscribe();
        await rec.dispose();

        const raw = await readFile(path, "utf8");
        const lines = raw.trim().split("\n");
        const timestamps = lines.map((l) => (JSON.parse(l) as VivSnapshot).timestamp);
        expect(timestamps).toEqual([10, 20, 30]);
        expect(received).toEqual([20, 30]);
    });

    it("does not persist frames after dispose", async () => {
        const base = await loadFixture();
        const dir = await mkdtemp(join(tmpdir(), "viv-viz-record-"));
        const path = join(dir, "out.jsonl");

        const inner = new FakeSource(bumpTimestamp(base, 10));
        const rec = new RecordingSnapshotSource(inner, path);
        await rec.getLatest();
        const unsub = rec.subscribe(() => {});
        unsub();
        await rec.dispose();

        inner.emit(bumpTimestamp(base, 999));
        await new Promise((resolve) => setImmediate(resolve));

        const raw = await readFile(path, "utf8");
        const timestamps = raw
            .trim()
            .split("\n")
            .filter((l) => l.length > 0)
            .map((l) => (JSON.parse(l) as VivSnapshot).timestamp);
        expect(timestamps).toEqual([10]);
    });
});
