import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
    EntityType,
    type EntityView,
    type HostApplicationAdapter,
    type UID,
    type VivInternalState
} from "@siftystudio/viv-runtime";

import { startHttpSnapshotServer, startIpcSnapshotServer } from "../src/server.js";
import { HttpSnapshotSource, IpcSnapshotSource } from "../src/source.js";
import type { VivSnapshot } from "../src/snapshot.js";

/**
 * A minimal in-memory "viv world" for end-to-end tests of the HTTP/IPC
 * communication path. We implement just enough of HostApplicationAdapter for
 * exportVivSnapshot() to produce a real snapshot (the other adapter methods
 * would only be touched by the runtime during action selection, which these
 * tests don't exercise).
 */
class InMemoryVivWorld {
    timestamp = 0;
    readonly entities: Record<UID, EntityView> = {};
    readonly ids: Record<EntityType, UID[]> = {
        [EntityType.Character]: [],
        [EntityType.Item]: [],
        [EntityType.Location]: [],
        [EntityType.Action]: []
    };
    vivInternalState: VivInternalState = {
        activePlans: {},
        activeQueues: {},
        perceptualQueues: {},
        pendingCommitments: {},
        pendingPlans: {}
    } as unknown as VivInternalState;

    addLocation(id: UID, name: string): void {
        this.entities[id] = { entityType: EntityType.Location, id, name } as unknown as EntityView;
        this.ids[EntityType.Location].push(id);
    }

    addCharacter(id: UID, name: string, locationID: UID, props: Record<string, unknown> = {}): void {
        this.entities[id] = {
            entityType: EntityType.Character,
            id,
            name,
            location: locationID,
            memories: {},
            ...props
        } as unknown as EntityView;
        this.ids[EntityType.Character].push(id);
    }

    updateProp(id: UID, key: string, value: unknown): void {
        const entity = this.entities[id] as unknown as Record<string, unknown>;
        entity[key] = value;
    }

    adapter(): HostApplicationAdapter {
        const world = this;
        // We fill only the methods exportVivSnapshot reads; the rest would be
        // needed for live simulation but not for serving snapshots.
        return {
            getEntityView: (id: UID) => {
                const view = world.entities[id];
                if (view === undefined) throw new Error(`no entity ${id}`);
                return structuredClone(view);
            },
            getEntityIDs: (type: EntityType) => [...world.ids[type]],
            getCurrentTimestamp: () => world.timestamp,
            getVivInternalState: () => world.vivInternalState
        } as unknown as HostApplicationAdapter;
    }
}

async function waitFor(predicate: () => boolean, timeoutMs: number): Promise<void> {
    const start = Date.now();
    while (!predicate()) {
        if (Date.now() - start > timeoutMs) {
            throw new Error(`Timed out after ${timeoutMs}ms waiting for condition`);
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
    }
}

describe("live integration — real adapter, real HTTP", () => {
    it("streams snapshots of a mutating viv world over HTTP", async () => {
        const world = new InMemoryVivWorld();
        world.addLocation("tavern", "The Tavern");
        world.addCharacter("alice", "Alice", "tavern", { mood: 3 });
        world.addCharacter("bob", "Bob", "tavern", { mood: 1 });

        const server = await startHttpSnapshotServer(world.adapter(), 0, "127.0.0.1", {
            schemaVersion: "test-0"
        });
        const source = new HttpSnapshotSource(`${server.url}/snapshot`, { pollIntervalMs: 25 });
        try {
            const first = await source.getLatest();
            expect(first.timestamp).toBe(0);
            expect(first.schemaVersion).toBe("test-0");
            expect(Object.keys(first.entities).sort()).toEqual(["alice", "bob", "tavern"]);
            expect((first.entities["alice"] as unknown as { mood: number }).mood).toBe(3);

            const received: VivSnapshot[] = [];
            const unsubscribe = source.subscribe((snap) => received.push(snap));

            // Mutate the world as a running simulation would.
            world.timestamp = 10;
            world.updateProp("alice", "mood", 7);
            await waitFor(
                () =>
                    received.some(
                        (s) =>
                            s.timestamp === 10 &&
                            (s.entities["alice"] as unknown as { mood: number }).mood === 7
                    ),
                1500
            );

            world.timestamp = 20;
            world.addCharacter("carol", "Carol", "tavern");
            await waitFor(
                () =>
                    received.some(
                        (s) => s.timestamp === 20 && "carol" in s.entities
                    ),
                1500
            );

            unsubscribe();
            await source.dispose();
        } finally {
            await server.close();
        }
    });
});

describe("live integration — real adapter, real IPC", () => {
    it("streams snapshots of a mutating viv world over a Unix socket", async () => {
        if (process.platform === "win32") return;

        const world = new InMemoryVivWorld();
        world.addLocation("tavern", "The Tavern");
        world.addCharacter("alice", "Alice", "tavern", { mood: 3 });

        const dir = await mkdtemp(join(tmpdir(), "viv-viz-int-"));
        const sockPath = join(dir, "viv.sock");
        const server = await startIpcSnapshotServer(world.adapter(), sockPath, {
            schemaVersion: "test-ipc"
        });
        const source = new IpcSnapshotSource(sockPath, { pollIntervalMs: 0 });
        try {
            const first = await source.getLatest();
            expect(first.timestamp).toBe(0);
            expect(first.schemaVersion).toBe("test-ipc");
            expect("alice" in first.entities).toBe(true);

            const received: VivSnapshot[] = [];
            const unsubscribe = source.subscribe((snap) => received.push(snap));

            // Server-push path: world mutates, host chooses to broadcast.
            world.timestamp = 5;
            world.updateProp("alice", "mood", 9);
            // Re-export a fresh snapshot and push it to all IPC clients.
            const { exportVivSnapshot } = await import("../src/snapshot.js");
            const pushed = await exportVivSnapshot(world.adapter(), { schemaVersion: "test-ipc" });
            server.push(pushed);

            await waitFor(
                () =>
                    received.some(
                        (s) =>
                            s.timestamp === 5 &&
                            (s.entities["alice"] as unknown as { mood: number }).mood === 9
                    ),
                1500
            );

            unsubscribe();
            await source.dispose();
        } finally {
            await server.close();
        }
    });
});
