import { readFile } from "node:fs/promises";

import { render } from "ink-testing-library";
import React from "react";
import { describe, expect, it } from "vitest";

import { App } from "../src/app.js";
import type { VivSnapshot } from "../src/snapshot.js";
import type { SnapshotListener, SnapshotSource } from "../src/source.js";

const FIXTURE = new URL("./fixtures/snapshot-hello.json", import.meta.url).pathname;

async function loadFixture(): Promise<VivSnapshot> {
    const raw = await readFile(FIXTURE, "utf8");
    return JSON.parse(raw) as VivSnapshot;
}

describe("App — smoke renders per pane", () => {
    it("renders the characters pane by default with resolved labels", async () => {
        const snapshot = await loadFixture();
        const { lastFrame, unmount } = render(<App snapshot={snapshot} labelField="name" />);
        const frame = lastFrame() ?? "";
        expect(frame).toContain("Alice");
        expect(frame).toContain("Bob");
        expect(frame).toContain("Carol");
        expect(frame).toContain("@The Tavern");
        unmount();
    });

    it("shows UIDs verbatim when labelField is null", async () => {
        const snapshot = await loadFixture();
        const { lastFrame, unmount } = render(
            <App snapshot={snapshot} labelField={null} />
        );
        const frame = lastFrame() ?? "";
        expect(frame).toContain("alice");
        expect(frame).toContain("@tavern");
        expect(frame).not.toContain("The Tavern");
        unmount();
    });

    it("renders the top bar with view labels and entity counts", async () => {
        const snapshot = await loadFixture();
        const { lastFrame, unmount } = render(<App snapshot={snapshot} labelField="name" />);
        const frame = lastFrame() ?? "";
        expect(frame).toContain("characters");
        expect(frame).toContain("memories");
        expect(frame).toContain("chronicle");
        expect(frame).toContain("queues");
        expect(frame).toContain("plans");
        expect(frame).toMatch(/3 chars/);
        expect(frame).toMatch(/2 actions/);
        unmount();
    });

    it("shows host properties for the selected character", async () => {
        const snapshot = await loadFixture();
        const { lastFrame, unmount } = render(<App snapshot={snapshot} labelField="name" />);
        const frame = lastFrame() ?? "";
        expect(frame).toContain("Host properties");
        expect(frame).toContain("mood");
        expect(frame).toContain("name");
        unmount();
    });

    it("exposes the schema version and timestamp on the status bar", async () => {
        const snapshot = await loadFixture();
        const { lastFrame, unmount } = render(<App snapshot={snapshot} labelField="name" />);
        const frame = lastFrame() ?? "";
        expect(frame).toContain("T=20");
        expect(frame).toContain("0.10.2");
        unmount();
    });

    it("updates its rendered timestamp when a live source emits a new snapshot", async () => {
        const snapshot = await loadFixture();
        const source = new FakeSource(snapshot);
        const { lastFrame, unmount } = render(
            <App snapshot={snapshot} labelField="name" source={source} />
        );
        expect(lastFrame() ?? "").toContain("T=20");
        expect(lastFrame() ?? "").toContain("live (0)");

        // Wait for React's useEffect to run and subscribe.
        for (let i = 0; i < 20; i++) {
            if (source.listenerCount() > 0) break;
            await new Promise((resolve) => setTimeout(resolve, 10));
        }
        expect(source.listenerCount()).toBeGreaterThan(0);

        source.emit({ ...snapshot, timestamp: 42 });
        for (let i = 0; i < 20; i++) {
            if ((lastFrame() ?? "").includes("T=42")) break;
            await new Promise((resolve) => setTimeout(resolve, 10));
        }
        expect(lastFrame() ?? "").toContain("T=42");
        expect(lastFrame() ?? "").toContain("live (1)");

        unmount();
    });
});

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
