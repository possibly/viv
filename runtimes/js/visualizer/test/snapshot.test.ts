import { readFile } from "node:fs/promises";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { loadSnapshot, partitionEntities } from "../src/snapshot.js";

const FIXTURE = new URL("./fixtures/snapshot-hello.json", import.meta.url).pathname;

describe("loadSnapshot", () => {
    it("loads a well-formed snapshot", async () => {
        const snap = await loadSnapshot(FIXTURE);
        expect(snap.timestamp).toBe(20);
        expect(snap.schemaVersion).toBe("0.10.2");
        expect(Object.keys(snap.entities).length).toBeGreaterThan(0);
    });

    it("gives a clear error when the file is missing", async () => {
        await expect(loadSnapshot("/definitely/does/not/exist.json")).rejects.toThrow(
            /Could not read snapshot/
        );
    });

    it("rejects non-JSON files", async () => {
        const dir = await mkdtemp(join(tmpdir(), "viv-viz-"));
        const path = join(dir, "bad.json");
        await writeFile(path, "not json at all");
        await expect(loadSnapshot(path)).rejects.toThrow(/is not valid JSON/);
    });

    it("rejects missing required fields (e.g. a content bundle by mistake)", async () => {
        const dir = await mkdtemp(join(tmpdir(), "viv-viz-"));
        const path = join(dir, "bundle.json");
        await writeFile(path, JSON.stringify({ actions: {}, plans: {} }));
        await expect(loadSnapshot(path)).rejects.toThrow(/content bundle/);
    });
});

describe("partitionEntities", () => {
    it("splits entities by type", async () => {
        const raw = await readFile(FIXTURE, "utf8");
        const { entities } = JSON.parse(raw);
        const part = partitionEntities(entities);
        expect(part.characters.map((c) => c.id).sort()).toEqual(["alice", "bob", "carol"]);
        expect(part.actions.map((a) => a.id).sort()).toEqual(["act_1", "act_2"]);
        expect(part.locations.map((l) => l.id)).toEqual(["tavern"]);
        expect(part.items).toEqual([]);
    });
});
