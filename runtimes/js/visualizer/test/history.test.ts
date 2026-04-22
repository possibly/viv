import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import {
    computeFrameDiff,
    computeMemoryTimeline,
    emptyFrameDiff,
    memoryActionIDsSeen,
    memoryChangeCount,
    SnapshotRing
} from "../src/history.js";
import type { VivSnapshot } from "../src/snapshot.js";

const FIXTURE = new URL("./fixtures/snapshot-hello.json", import.meta.url).pathname;

async function loadBase(): Promise<VivSnapshot> {
    const raw = await readFile(FIXTURE, "utf8");
    return JSON.parse(raw) as VivSnapshot;
}

/** Produces a deep-cloned snapshot so callers can mutate safely. */
function clone(snap: VivSnapshot): VivSnapshot {
    return JSON.parse(JSON.stringify(snap)) as VivSnapshot;
}

describe("SnapshotRing", () => {
    it("rejects non-positive capacity", () => {
        expect(() => new SnapshotRing(0)).toThrow(/capacity/);
        expect(() => new SnapshotRing(-5)).toThrow(/capacity/);
    });

    it("assigns absolute indices and tracks totalAppended", async () => {
        const base = await loadBase();
        const ring = new SnapshotRing(10);
        const a = ring.append(clone(base));
        const b = ring.append(clone(base));
        const c = ring.append(clone(base));
        expect(a.index).toBe(0);
        expect(b.index).toBe(1);
        expect(c.index).toBe(2);
        expect(ring.totalAppended).toBe(3);
        expect(ring.length).toBe(3);
        expect(ring.oldestIndex).toBe(0);
        expect(ring.newestIndex).toBe(2);
    });

    it("drops oldest frames when capacity is exceeded but preserves absolute indices", async () => {
        const base = await loadBase();
        const ring = new SnapshotRing(2);
        ring.append(clone(base));
        ring.append(clone(base));
        ring.append(clone(base));
        ring.append(clone(base));
        expect(ring.length).toBe(2);
        expect(ring.totalAppended).toBe(4);
        expect(ring.oldestIndex).toBe(2);
        expect(ring.newestIndex).toBe(3);
        // Scrolled-out indices return null
        expect(ring.byIndex(0)).toBeNull();
        expect(ring.byIndex(1)).toBeNull();
        expect(ring.byIndex(2)).not.toBeNull();
        expect(ring.byIndex(3)).not.toBeNull();
    });

    it("byIndex returns null for out-of-range indices", async () => {
        const base = await loadBase();
        const ring = new SnapshotRing(5);
        ring.append(clone(base));
        expect(ring.byIndex(-1)).toBeNull();
        expect(ring.byIndex(5)).toBeNull();
        expect(ring.byIndex(0)?.index).toBe(0);
    });
});

describe("computeFrameDiff — memory changes", () => {
    it("returns an empty diff against a null predecessor", async () => {
        const base = await loadBase();
        const ring = new SnapshotRing(2);
        const first = ring.append(clone(base));
        const diff = computeFrameDiff(null, first);
        expect(diff.fromIndex).toBeNull();
        expect(diff.addedEntityIDs.size).toBe(0);
        expect(diff.changedEntityIDs.size).toBe(0);
        expect(diff.memoryDiffs.size).toBe(0);
    });

    it("spots newly formed, forgotten, and salience-changed memories", async () => {
        const base = await loadBase();
        const prevSnap = clone(base);
        const currSnap = clone(base);

        // Bob: raise salience of act_1 from 0.7 → 0.85
        (currSnap.entities["bob"]! as { memories: Record<string, { salience: number }> })
            .memories["act_1"]!.salience = 0.85;
        // Alice: forget act_1 (was not forgotten in base)
        (currSnap.entities["alice"]! as {
            memories: Record<string, { forgotten: boolean }>;
        }).memories["act_1"]!.forgotten = true;
        // Carol: form a fresh memory of act_2
        (currSnap.entities["carol"]! as {
            memories: Record<string, unknown>;
        }).memories["act_2"] = {
            action: "act_2",
            formationTimestamp: 15,
            salience: 0.3,
            associations: [],
            sources: [],
            forgotten: false
        };
        currSnap.timestamp = 25;

        const ring = new SnapshotRing(10);
        const prev = ring.append(prevSnap);
        const curr = ring.append(currSnap);
        const diff = computeFrameDiff(prev, curr);

        const bob = diff.memoryDiffs.get("bob")!;
        expect(bob).toBeDefined();
        expect(bob.salienceChanged.get("act_1")).toEqual({ from: 0.7, to: 0.85 });
        expect(bob.formed.size).toBe(0);

        const alice = diff.memoryDiffs.get("alice")!;
        expect(alice).toBeDefined();
        expect(alice.forgottenNow.has("act_1")).toBe(true);

        const carol = diff.memoryDiffs.get("carol")!;
        expect(carol).toBeDefined();
        expect(carol.formed.has("act_2")).toBe(true);

        expect(memoryChangeCount(bob)).toBe(1);
        expect(memoryChangeCount(alice)).toBeGreaterThanOrEqual(1);
        expect(memoryChangeCount(carol)).toBe(1);
    });

    it("detects added / removed entities and plan changes", async () => {
        const base = await loadBase();
        const prevSnap = clone(base);
        const currSnap = clone(base);

        // Remove carol, add a new action, and introduce an active plan.
        delete (currSnap.entities as Record<string, unknown>)["carol"];
        (currSnap.entities as Record<string, unknown>)["act_3"] = {
            entityType: "action",
            id: "act_3",
            name: "wave",
            gloss: "Alice waves goodbye",
            report: null,
            importance: 0.4,
            tags: [],
            bindings: {},
            scratch: {},
            location: "tavern",
            timestamp: 30,
            timeOfDay: null,
            causes: [],
            caused: [],
            ancestors: [],
            descendants: [],
            relayedActions: [],
            initiator: "alice",
            partners: [],
            recipients: [],
            bystanders: [],
            active: ["alice"],
            present: ["alice"]
        };
        (currSnap.vivInternalState as unknown as { activePlans: Record<string, unknown> }).activePlans = {
            plan_a: {
                id: "plan_a",
                planName: "wander",
                currentPhase: "explore",
                programCounter: 2,
                waitDeadline: null,
                resolved: false,
                bindings: { who: "alice" },
                loopStack: [],
                reactionWindowQueuedConstructs: null
            }
        };

        const ring = new SnapshotRing(5);
        const prev = ring.append(prevSnap);
        const curr = ring.append(currSnap);
        const diff = computeFrameDiff(prev, curr);

        expect(diff.addedEntityIDs.has("act_3")).toBe(true);
        expect(diff.removedEntityIDs.has("carol")).toBe(true);
        expect(diff.addedPlanIDs.has("plan_a")).toBe(true);
    });

    it("flags plans whose program counter advanced", async () => {
        const base = await loadBase();
        const prevSnap = clone(base);
        (prevSnap.vivInternalState as unknown as { activePlans: Record<string, unknown> }).activePlans = {
            plan_a: {
                id: "plan_a",
                planName: "wander",
                currentPhase: "explore",
                programCounter: 2,
                waitDeadline: null,
                resolved: false,
                bindings: {},
                loopStack: [],
                reactionWindowQueuedConstructs: null
            }
        };
        const currSnap = clone(prevSnap);
        (currSnap.vivInternalState as unknown as {
            activePlans: Record<string, { programCounter: number }>;
        }).activePlans["plan_a"]!.programCounter = 3;

        const ring = new SnapshotRing(5);
        const prev = ring.append(prevSnap);
        const curr = ring.append(currSnap);
        const diff = computeFrameDiff(prev, curr);

        expect(diff.changedPlanIDs.has("plan_a")).toBe(true);
        expect(diff.addedPlanIDs.has("plan_a")).toBe(false);
    });
});

describe("computeMemoryTimeline", () => {
    it("returns empty results for a memory that never appears", async () => {
        const base = await loadBase();
        const ring = new SnapshotRing(5);
        ring.append(clone(base));
        const tl = computeMemoryTimeline(ring, "alice", "act_never");
        expect(tl.samples).toEqual([]);
        expect(tl.events).toEqual([]);
    });

    it("traces formation, salience rise, forgetting, and dropping across the ring", async () => {
        const base = await loadBase();

        // Frame 0: carol has no memory of act_1. Frame 1: she forms it at 0.4.
        // Frame 2: salience rises to 0.8. Frame 3: she forgets. Frame 4: memory dropped.
        const f0 = clone(base);
        const f1 = clone(base);
        (f1.entities["carol"]! as {
            memories: Record<string, unknown>;
        }).memories["act_1"] = {
            action: "act_1",
            formationTimestamp: 5,
            salience: 0.4,
            associations: [],
            sources: [],
            forgotten: false
        };
        f1.timestamp = 5;

        const f2 = clone(f1);
        (f2.entities["carol"]! as {
            memories: Record<string, { salience: number }>;
        }).memories["act_1"]!.salience = 0.8;
        f2.timestamp = 10;

        const f3 = clone(f2);
        (f3.entities["carol"]! as {
            memories: Record<string, { forgotten: boolean }>;
        }).memories["act_1"]!.forgotten = true;
        f3.timestamp = 15;

        const f4 = clone(f3);
        delete (f4.entities["carol"]! as {
            memories: Record<string, unknown>;
        }).memories["act_1"];
        f4.timestamp = 20;

        const ring = new SnapshotRing(10);
        ring.append(f0);
        ring.append(f1);
        ring.append(f2);
        ring.append(f3);
        ring.append(f4);

        const tl = computeMemoryTimeline(ring, "carol", "act_1");
        expect(tl.samples.map((s) => s.salience)).toEqual([0.4, 0.8, 0.8]);
        expect(tl.samples[2]!.forgotten).toBe(true);

        const kinds = tl.events.map((e) => e.kind);
        expect(kinds).toContain("formed");
        expect(kinds).toContain("salience-rose");
        expect(kinds).toContain("forgotten");
        expect(kinds).toContain("dropped");
    });
});

describe("emptyFrameDiff / helpers", () => {
    it("emptyFrameDiff has all empty sets and the given toIndex", () => {
        const d = emptyFrameDiff(7);
        expect(d.toIndex).toBe(7);
        expect(d.fromIndex).toBeNull();
        expect(d.addedEntityIDs.size).toBe(0);
        expect(d.removedEntityIDs.size).toBe(0);
        expect(d.changedEntityIDs.size).toBe(0);
        expect(d.memoryDiffs.size).toBe(0);
    });

    it("memoryActionIDsSeen unions every action-id present in the ring", async () => {
        const base = await loadBase();
        const f0 = clone(base);
        const f1 = clone(base);
        (f1.entities["alice"]! as {
            memories: Record<string, unknown>;
        }).memories["act_new"] = {
            action: "act_new",
            formationTimestamp: 1,
            salience: 0.1,
            associations: [],
            sources: [],
            forgotten: false
        };

        const ring = new SnapshotRing(5);
        ring.append(f0);
        ring.append(f1);

        const seen = memoryActionIDsSeen(ring, "alice");
        expect(seen.has("act_1")).toBe(true);
        expect(seen.has("act_2")).toBe(true);
        expect(seen.has("act_new")).toBe(true);
    });
});
