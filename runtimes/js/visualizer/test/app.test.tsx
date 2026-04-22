import { readFile } from "node:fs/promises";

import { render } from "ink-testing-library";
import React from "react";
import { describe, expect, it } from "vitest";

import { App } from "../src/app.js";
import type { VivSnapshot } from "../src/snapshot.js";

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
});
