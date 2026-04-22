import { readFile } from "node:fs/promises";

import { render } from "ink-testing-library";
import React from "react";
import { describe, expect, it } from "vitest";

import { App } from "../src/app.js";
import { SnapshotRing } from "../src/history.js";
import type { VivSnapshot } from "../src/snapshot.js";
import type { SnapshotListener, SnapshotSource } from "../src/source.js";

const FIXTURE = new URL("./fixtures/snapshot-hello.json", import.meta.url).pathname;

async function loadFixture(): Promise<VivSnapshot> {
    return JSON.parse(await readFile(FIXTURE, "utf8")) as VivSnapshot;
}

function deepClone<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T;
}

class FakeSource implements SnapshotSource {
    readonly label = "fake";
    private listeners = new Set<SnapshotListener>();
    constructor(private current: VivSnapshot) {}
    async getLatest(): Promise<VivSnapshot> {
        return this.current;
    }
    subscribe(listener: SnapshotListener): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }
    async dispose(): Promise<void> {
        this.listeners.clear();
    }
    emit(next: VivSnapshot): void {
        this.current = next;
        for (const listener of this.listeners) listener(next);
    }
    listenerCount(): number {
        return this.listeners.size;
    }
}

async function waitFor(predicate: () => boolean, timeoutMs = 500): Promise<void> {
    const start = Date.now();
    while (!predicate() && Date.now() - start < timeoutMs) {
        await new Promise((resolve) => setTimeout(resolve, 10));
    }
    if (!predicate()) throw new Error("waitFor timeout");
}

describe("App — time-travel navigation", () => {
    it("pauses when the user steps back with `[` and shows a frame label", async () => {
        const base = await loadFixture();
        const source = new FakeSource(base);
        const ring = new SnapshotRing(10);
        ring.append(base);

        const { lastFrame, stdin, unmount } = render(
            <App snapshot={base} labelField="name" source={source} history={ring} />
        );
        await waitFor(() => source.listenerCount() > 0);

        const updated = { ...deepClone(base), timestamp: 42 } as VivSnapshot;
        source.emit(updated);
        await waitFor(() => (lastFrame() ?? "").includes("T=42"));

        // Step back one frame.
        stdin.write("[");
        await waitFor(() => (lastFrame() ?? "").includes("paused"));
        const frame = lastFrame() ?? "";
        expect(frame).toContain("T=20");
        expect(frame).toContain("paused");
        expect(frame).toContain("frame 1/2");

        unmount();
        await source.dispose();
    });

    it("resumes following the latest frame when the user presses `}`", async () => {
        const base = await loadFixture();
        const source = new FakeSource(base);
        const ring = new SnapshotRing(10);
        ring.append(base);

        const { lastFrame, stdin, unmount } = render(
            <App snapshot={base} labelField="name" source={source} history={ring} />
        );
        await waitFor(() => source.listenerCount() > 0);

        source.emit({ ...deepClone(base), timestamp: 42 } as VivSnapshot);
        await waitFor(() => (lastFrame() ?? "").includes("T=42"));

        stdin.write("["); // pause and step back
        await waitFor(() => (lastFrame() ?? "").includes("paused"));

        stdin.write("}"); // jump to latest + resume
        await waitFor(
            () =>
                (lastFrame() ?? "").includes("T=42") && !(lastFrame() ?? "").includes("paused")
        );
        const frame = lastFrame() ?? "";
        expect(frame).toContain("T=42");
        expect(frame).not.toContain("paused");

        unmount();
        await source.dispose();
    });

    it("freezes the viewed frame under new live updates while paused", async () => {
        const base = await loadFixture();
        const source = new FakeSource(base);
        const ring = new SnapshotRing(10);
        ring.append(base);

        const { lastFrame, stdin, unmount } = render(
            <App snapshot={base} labelField="name" source={source} history={ring} />
        );
        await waitFor(() => source.listenerCount() > 0);

        source.emit({ ...deepClone(base), timestamp: 42 } as VivSnapshot);
        await waitFor(() => (lastFrame() ?? "").includes("T=42"));

        stdin.write("["); // pause at T=20
        await waitFor(() => (lastFrame() ?? "").includes("paused"));
        expect(lastFrame() ?? "").toContain("T=20");

        // Another live update arrives; view should stay on the paused frame.
        // In historical mode the right-status shows `frame N/M paused`; M
        // grows to 3 once the new snapshot is appended to the ring.
        source.emit({ ...deepClone(base), timestamp: 99 } as VivSnapshot);
        await waitFor(() => (lastFrame() ?? "").includes("frame 1/3"));
        const paused = lastFrame() ?? "";
        expect(paused).toContain("T=20");
        expect(paused).toContain("paused");
        expect(paused).not.toContain("T=99");

        unmount();
        await source.dispose();
    });
});

describe("Memories pane — per-memory history", () => {
    it("toggles the per-memory history view with `h` and shows a sparkline + events", async () => {
        const base = await loadFixture();
        const source = new FakeSource(base);
        const ring = new SnapshotRing(10);
        ring.append(base);

        const { lastFrame, stdin, unmount } = render(
            <App snapshot={base} labelField="name" source={source} history={ring} />
        );
        await waitFor(() => source.listenerCount() > 0);

        // Push a couple of frames where Alice's salience of act_1 changes,
        // so the timeline has multiple samples.
        const f1 = deepClone(base);
        (f1.entities["alice"]! as {
            memories: Record<string, { salience: number }>;
        }).memories["act_1"]!.salience = 0.6;
        f1.timestamp = 25;
        source.emit(f1);

        const f2 = deepClone(base);
        (f2.entities["alice"]! as {
            memories: Record<string, { salience: number }>;
        }).memories["act_1"]!.salience = 0.4;
        f2.timestamp = 30;
        source.emit(f2);

        await waitFor(() => (lastFrame() ?? "").includes("T=30"));

        // Navigate: characters → memories (one tab press).
        stdin.write("\t");
        await waitFor(() => (lastFrame() ?? "").includes("memories of"));

        // Toggle history view.
        stdin.write("h");
        await waitFor(() => (lastFrame() ?? "").includes("[history view]"));

        const frame = lastFrame() ?? "";
        expect(frame).toContain("Salience over recorded history");
        expect(frame).toContain("Events");
        // The "formed" event fires on the very first frame in which Alice has
        // a memory of act_1, which is present from the seed snapshot onward.
        expect(frame).toMatch(/formed|salience-fell|salience-rose/);

        unmount();
        await source.dispose();
    });

    it("shows a change badge for a character whose memory salience moved", async () => {
        const base = await loadFixture();
        const source = new FakeSource(base);
        const ring = new SnapshotRing(10);
        ring.append(base);

        const { lastFrame, unmount } = render(
            <App snapshot={base} labelField="name" source={source} history={ring} />
        );
        await waitFor(() => source.listenerCount() > 0);

        // Move Bob's salience upward so the characters pane shows a badge.
        const f1 = deepClone(base);
        (f1.entities["bob"]! as {
            memories: Record<string, { salience: number }>;
        }).memories["act_1"]!.salience = 0.95;
        f1.timestamp = 30;
        source.emit(f1);

        await waitFor(() => (lastFrame() ?? "").includes("T=30"));
        const frame = lastFrame() ?? "";
        // Bob's row should carry a "★N" badge indicating memory changes.
        expect(frame).toMatch(/Bob\s+@The Tavern\s+★/);

        unmount();
        await source.dispose();
    });
});
