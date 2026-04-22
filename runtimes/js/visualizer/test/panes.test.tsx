import { readFile } from "node:fs/promises";

import { render } from "ink-testing-library";
import React from "react";
import { describe, expect, it } from "vitest";

import { makeLabelResolver } from "../src/format.js";
import { ChroniclePane } from "../src/panes/chronicle.js";
import { MemoriesPane } from "../src/panes/memories.js";
import { PlansPane } from "../src/panes/plans.js";
import { QueuesPane } from "../src/panes/queues.js";
import type { VivSnapshot } from "../src/snapshot.js";

const FIXTURE = new URL("./fixtures/snapshot-hello.json", import.meta.url).pathname;

async function loadFixture(): Promise<VivSnapshot> {
    const raw = await readFile(FIXTURE, "utf8");
    return JSON.parse(raw) as VivSnapshot;
}

describe("ChroniclePane", () => {
    it("lists actions in chronological order with initiators", async () => {
        const snapshot = await loadFixture();
        const resolveLabel = makeLabelResolver(snapshot.entities, "name");
        const { lastFrame, unmount } = render(
            <ChroniclePane
                snapshot={snapshot}
                resolveLabel={resolveLabel}
                filter=""
                selectedID="act_1"
                onSelect={() => {}}
                focused={false}
            />
        );
        const frame = lastFrame() ?? "";
        expect(frame).toContain("greet");
        expect(frame).toContain("reply");
        // Action detail for act_1 should show its caused -> act_2 effect
        expect(frame).toContain("Effects");
        expect(frame).toContain("Alice greets Bob");
        unmount();
    });

    it("filters actions by :t <tag>", async () => {
        const snapshot = await loadFixture();
        const resolveLabel = makeLabelResolver(snapshot.entities, "name");
        const { lastFrame, unmount } = render(
            <ChroniclePane
                snapshot={snapshot}
                resolveLabel={resolveLabel}
                filter=":t social"
                selectedID={null}
                onSelect={() => {}}
                focused={false}
            />
        );
        const frame = lastFrame() ?? "";
        expect(frame).toContain("greet");
        expect(frame).toContain("reply");
        unmount();
    });
});

describe("MemoriesPane", () => {
    it("shows memories for the selected character, sorted by salience", async () => {
        const snapshot = await loadFixture();
        const resolveLabel = makeLabelResolver(snapshot.entities, "name");
        // act_2 is the forgotten memory in the fixture; selecting it should
        // surface the [forgotten] marker in the header.
        const { lastFrame, unmount } = render(
            <MemoriesPane
                snapshot={snapshot}
                resolveLabel={resolveLabel}
                characterID="alice"
                filter=""
                selectedMemoryID="act_2"
                onSelect={() => {}}
                focused={false}
            />
        );
        const frame = lastFrame() ?? "";
        expect(frame).toContain("memories of");
        expect(frame).toContain("Alice");
        expect(frame).toContain("greet");
        expect(frame).toContain("reply");
        expect(frame).toContain("[forgotten]");
        unmount();
    });

    it("prompts when no character is selected", async () => {
        const snapshot = await loadFixture();
        const resolveLabel = makeLabelResolver(snapshot.entities, "name");
        const { lastFrame, unmount } = render(
            <MemoriesPane
                snapshot={snapshot}
                resolveLabel={resolveLabel}
                characterID={null}
                filter=""
                selectedMemoryID={null}
                onSelect={() => {}}
                focused={false}
            />
        );
        expect(lastFrame() ?? "").toContain("Select a character");
        unmount();
    });
});

describe("QueuesPane", () => {
    it("shows per-character action queues and plan queue", async () => {
        const snapshot = await loadFixture();
        const resolveLabel = makeLabelResolver(snapshot.entities, "name");
        const { lastFrame, unmount } = render(
            <QueuesPane snapshot={snapshot} resolveLabel={resolveLabel} filter="" />
        );
        const frame = lastFrame() ?? "";
        expect(frame).toContain("Action queues");
        expect(frame).toContain("Alice");
        expect(frame).toContain("greet");
        expect(frame).toContain("pri=5");
        expect(frame).toContain("Plan queue");
        unmount();
    });
});

describe("PlansPane", () => {
    it("renders an empty state when no plans are active", async () => {
        const snapshot = await loadFixture();
        const resolveLabel = makeLabelResolver(snapshot.entities, "name");
        const { lastFrame, unmount } = render(
            <PlansPane
                snapshot={snapshot}
                resolveLabel={resolveLabel}
                filter=""
                selectedID={null}
                onSelect={() => {}}
                focused={false}
            />
        );
        const frame = lastFrame() ?? "";
        expect(frame).toContain("(empty)");
        expect(frame).toContain("Select a plan");
        unmount();
    });
});
