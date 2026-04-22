import type {
    CharacterMemory,
    CharacterView,
    DiegeticTimestamp,
    PlanState,
    UID
} from "@siftystudio/viv-runtime";

import type { VivSnapshot } from "./snapshot.js";

/** Default number of snapshots retained in memory by {@link SnapshotRing}. */
export const DEFAULT_HISTORY_CAPACITY = 500;

/**
 * One frame in the history ring.
 *
 * `index` is absolute across the lifetime of the ring — it does not shift when
 * the oldest frame is dropped. Panes use this for "frame 312/1200" style labels
 * and for time-axis stability across re-renders.
 */
export interface HistoryFrame {
    readonly snapshot: VivSnapshot;
    readonly index: number;
    readonly receivedAt: number;
}

/**
 * Bounded ring buffer of {@link VivSnapshot}s addressable by absolute index.
 *
 * Live sources append into the ring; the UI steps through it by index. When the
 * ring is full, the oldest frame is dropped; absolute indices keep climbing so
 * callers holding an older index can still tell it has scrolled out of window.
 */
export class SnapshotRing {
    readonly capacity: number;
    private readonly frames: HistoryFrame[] = [];
    private nextIndex = 0;

    constructor(capacity: number = DEFAULT_HISTORY_CAPACITY) {
        if (!Number.isFinite(capacity) || capacity < 1) {
            throw new Error(`SnapshotRing capacity must be >= 1, got ${capacity}`);
        }
        this.capacity = Math.floor(capacity);
    }

    /** Appends a snapshot; returns the frame assigned. */
    append(snapshot: VivSnapshot): HistoryFrame {
        const frame: HistoryFrame = {
            snapshot,
            index: this.nextIndex++,
            receivedAt: Date.now()
        };
        this.frames.push(frame);
        if (this.frames.length > this.capacity) this.frames.shift();
        return frame;
    }

    /** Retained frames, oldest-first. */
    all(): readonly HistoryFrame[] {
        return this.frames;
    }

    /** Total frames appended ever (may exceed `length` once the ring wraps). */
    get totalAppended(): number {
        return this.nextIndex;
    }

    /** Retained frame count. */
    get length(): number {
        return this.frames.length;
    }

    /** Oldest retained absolute index, or null when empty. */
    get oldestIndex(): number | null {
        return this.frames.length === 0 ? null : this.frames[0]!.index;
    }

    /** Newest retained absolute index, or null when empty. */
    get newestIndex(): number | null {
        return this.frames.length === 0
            ? null
            : this.frames[this.frames.length - 1]!.index;
    }

    /** Frame at absolute index, or null if it has scrolled out of the retained window. */
    byIndex(index: number): HistoryFrame | null {
        if (this.frames.length === 0) return null;
        const offset = index - this.frames[0]!.index;
        if (offset < 0 || offset >= this.frames.length) return null;
        return this.frames[offset]!;
    }
}

/** Per-character memory diff between two consecutive frames. */
export interface MemoryDiff {
    readonly formed: ReadonlySet<UID>;
    readonly dropped: ReadonlySet<UID>;
    readonly forgottenNow: ReadonlySet<UID>;
    readonly unforgottenNow: ReadonlySet<UID>;
    readonly salienceChanged: ReadonlyMap<UID, { readonly from: number; readonly to: number }>;
}

/**
 * Structural diff of a frame vs. its predecessor.
 *
 * Used by panes to highlight what changed "since last tick" without having to
 * re-diff themselves. Entity diffing is coarse (added/removed/changed); the
 * Memories pane cares about per-field changes so those get their own
 * {@link MemoryDiff} map, and plans also get their own tracking since they're
 * inside vivInternalState rather than the entities map.
 */
export interface FrameDiff {
    readonly fromIndex: number | null;
    readonly toIndex: number;
    readonly addedEntityIDs: ReadonlySet<UID>;
    readonly removedEntityIDs: ReadonlySet<UID>;
    readonly changedEntityIDs: ReadonlySet<UID>;
    readonly memoryDiffs: ReadonlyMap<UID, MemoryDiff>;
    readonly addedPlanIDs: ReadonlySet<UID>;
    readonly removedPlanIDs: ReadonlySet<UID>;
    readonly changedPlanIDs: ReadonlySet<UID>;
}

const EMPTY_DIFF_MEMORY: MemoryDiff = {
    formed: new Set(),
    dropped: new Set(),
    forgottenNow: new Set(),
    unforgottenNow: new Set(),
    salienceChanged: new Map()
};

export function emptyFrameDiff(toIndex: number): FrameDiff {
    return {
        fromIndex: null,
        toIndex,
        addedEntityIDs: new Set(),
        removedEntityIDs: new Set(),
        changedEntityIDs: new Set(),
        memoryDiffs: new Map(),
        addedPlanIDs: new Set(),
        removedPlanIDs: new Set(),
        changedPlanIDs: new Set()
    };
}

/** Computes a {@link FrameDiff} from `prev` to `curr`. */
export function computeFrameDiff(
    prev: HistoryFrame | null,
    curr: HistoryFrame
): FrameDiff {
    if (prev === null) return emptyFrameDiff(curr.index);

    const prevSnap = prev.snapshot;
    const currSnap = curr.snapshot;

    const added = new Set<UID>();
    const removed = new Set<UID>();
    const changed = new Set<UID>();
    const memoryDiffs = new Map<UID, MemoryDiff>();

    for (const id of Object.keys(currSnap.entities)) {
        const prevEntity = prevSnap.entities[id];
        const currEntity = currSnap.entities[id]!;
        if (prevEntity === undefined) {
            added.add(id);
            continue;
        }
        if (prevEntity === currEntity) continue;
        if (!shallowEntityEquals(prevEntity, currEntity)) {
            changed.add(id);
        }
        if (prevEntity.entityType === "character" && currEntity.entityType === "character") {
            const md = diffCharacterMemories(
                prevEntity as CharacterView,
                currEntity as CharacterView
            );
            if (!isEmptyMemoryDiff(md)) memoryDiffs.set(id, md);
        }
    }
    for (const id of Object.keys(prevSnap.entities)) {
        if (!(id in currSnap.entities)) removed.add(id);
    }

    const prevPlans = prevSnap.vivInternalState.activePlans ?? {};
    const currPlans = currSnap.vivInternalState.activePlans ?? {};
    const addedPlans = new Set<UID>();
    const removedPlans = new Set<UID>();
    const changedPlans = new Set<UID>();
    for (const id of Object.keys(currPlans)) {
        if (!(id in prevPlans)) {
            addedPlans.add(id);
            continue;
        }
        if (!samePlanState(prevPlans[id]!, currPlans[id]!)) {
            changedPlans.add(id);
        }
    }
    for (const id of Object.keys(prevPlans)) {
        if (!(id in currPlans)) removedPlans.add(id);
    }

    return {
        fromIndex: prev.index,
        toIndex: curr.index,
        addedEntityIDs: added,
        removedEntityIDs: removed,
        changedEntityIDs: changed,
        memoryDiffs,
        addedPlanIDs: addedPlans,
        removedPlanIDs: removedPlans,
        changedPlanIDs: changedPlans
    };
}

function shallowEntityEquals(a: unknown, b: unknown): boolean {
    if (a === b) return true;
    try {
        return JSON.stringify(a) === JSON.stringify(b);
    } catch {
        return false;
    }
}

function isEmptyMemoryDiff(md: MemoryDiff): boolean {
    return (
        md.formed.size === 0 &&
        md.dropped.size === 0 &&
        md.forgottenNow.size === 0 &&
        md.unforgottenNow.size === 0 &&
        md.salienceChanged.size === 0
    );
}

function diffCharacterMemories(prev: CharacterView, curr: CharacterView): MemoryDiff {
    const formed = new Set<UID>();
    const dropped = new Set<UID>();
    const forgottenNow = new Set<UID>();
    const unforgottenNow = new Set<UID>();
    const salienceChanged = new Map<UID, { from: number; to: number }>();

    for (const [actionID, mem] of Object.entries(curr.memories)) {
        const prior = prev.memories[actionID];
        if (prior === undefined) {
            formed.add(actionID);
            continue;
        }
        if (prior.forgotten !== mem.forgotten) {
            if (mem.forgotten) forgottenNow.add(actionID);
            else unforgottenNow.add(actionID);
        }
        if (Math.abs(prior.salience - mem.salience) > 1e-9) {
            salienceChanged.set(actionID, { from: prior.salience, to: mem.salience });
        }
    }
    for (const actionID of Object.keys(prev.memories)) {
        if (!(actionID in curr.memories)) dropped.add(actionID);
    }
    return { formed, dropped, forgottenNow, unforgottenNow, salienceChanged };
}

function samePlanState(a: PlanState, b: PlanState): boolean {
    if (a === b) return true;
    return (
        a.currentPhase === b.currentPhase &&
        a.programCounter === b.programCounter &&
        a.waitDeadline === b.waitDeadline &&
        a.resolved === b.resolved &&
        JSON.stringify(a.bindings) === JSON.stringify(b.bindings) &&
        JSON.stringify(a.loopStack) === JSON.stringify(b.loopStack) &&
        JSON.stringify(a.reactionWindowQueuedConstructs) ===
            JSON.stringify(b.reactionWindowQueuedConstructs)
    );
}

/** One sample in a memory's salience-over-time trace. */
export interface MemorySample {
    readonly frameIndex: number;
    readonly timestamp: DiegeticTimestamp;
    readonly salience: number;
    readonly forgotten: boolean;
}

/** A discrete transition in a memory's lifetime (formed, forgotten, dropped...). */
export interface MemoryEvent {
    readonly frameIndex: number;
    readonly timestamp: DiegeticTimestamp;
    readonly kind:
        | "formed"
        | "first-seen"
        | "dropped"
        | "restored"
        | "forgotten"
        | "unforgotten"
        | "salience-rose"
        | "salience-fell";
    readonly salience?: number;
    readonly delta?: number;
}

/** Full history of one memory, assembled by walking the ring. */
export interface MemoryTimeline {
    readonly characterID: UID;
    readonly actionID: UID;
    readonly samples: readonly MemorySample[];
    readonly events: readonly MemoryEvent[];
}

/** Minimum salience change that counts as a rise/fall event. */
const SALIENCE_EVENT_EPSILON = 1e-3;

/**
 * Walks the ring and assembles the full lifetime of `(characterID, actionID)`
 * in memory: samples of salience per retained frame, plus event markers for
 * formation, forgetting, dropping, and notable salience swings.
 *
 * Frames in which the character entity is missing are skipped; frames in which
 * the character is present but the memory isn't contribute nothing to samples
 * (but contribute to "dropped"/"restored" transitions).
 */
export function computeMemoryTimeline(
    ring: SnapshotRing,
    characterID: UID,
    actionID: UID
): MemoryTimeline {
    const samples: MemorySample[] = [];
    const events: MemoryEvent[] = [];
    let prior: CharacterMemory | null = null;
    let priorPresent = false;

    for (const frame of ring.all()) {
        const entity = frame.snapshot.entities[characterID];
        if (entity === undefined || entity.entityType !== "character") continue;
        const character = entity as CharacterView;
        const mem = character.memories[actionID];
        if (mem === undefined) {
            if (priorPresent) {
                events.push({
                    frameIndex: frame.index,
                    timestamp: frame.snapshot.timestamp,
                    kind: "dropped"
                });
                priorPresent = false;
                prior = null;
            }
            continue;
        }

        samples.push({
            frameIndex: frame.index,
            timestamp: frame.snapshot.timestamp,
            salience: mem.salience,
            forgotten: mem.forgotten
        });

        if (!priorPresent) {
            // Distinguish diegetic formation (the memory was genuinely formed
            // at this frame) from "first seen in the ring" (the memory existed
            // before the ring started retaining frames). Reporting the latter
            // as "formed" produces an event timestamp that contradicts
            // `mem.formationTimestamp` in the detail pane.
            const diegeticallyFormed =
                mem.formationTimestamp === frame.snapshot.timestamp;
            events.push({
                frameIndex: frame.index,
                timestamp: frame.snapshot.timestamp,
                kind:
                    prior === null
                        ? diegeticallyFormed
                            ? "formed"
                            : "first-seen"
                        : "restored",
                salience: mem.salience
            });
        } else if (prior !== null) {
            if (prior.forgotten !== mem.forgotten) {
                events.push({
                    frameIndex: frame.index,
                    timestamp: frame.snapshot.timestamp,
                    kind: mem.forgotten ? "forgotten" : "unforgotten",
                    salience: mem.salience
                });
            }
            const delta = mem.salience - prior.salience;
            if (Math.abs(delta) >= SALIENCE_EVENT_EPSILON) {
                events.push({
                    frameIndex: frame.index,
                    timestamp: frame.snapshot.timestamp,
                    kind: delta > 0 ? "salience-rose" : "salience-fell",
                    salience: mem.salience,
                    delta
                });
            }
        }

        prior = mem;
        priorPresent = true;
    }

    return { characterID, actionID, samples, events };
}

/** Convenience: the set of action-IDs the character has *ever* had a memory of in the ring. */
export function memoryActionIDsSeen(
    ring: SnapshotRing,
    characterID: UID
): ReadonlySet<UID> {
    const out = new Set<UID>();
    for (const frame of ring.all()) {
        const entity = frame.snapshot.entities[characterID];
        if (entity === undefined || entity.entityType !== "character") continue;
        const character = entity as CharacterView;
        for (const actionID of Object.keys(character.memories)) out.add(actionID);
    }
    return out;
}

/** Utility: does this diff affect the given character's memories? */
export function diffTouchesCharacter(diff: FrameDiff, characterID: UID): boolean {
    return diff.memoryDiffs.has(characterID);
}

/** Utility: total number of memory changes for a character in this diff. */
export function memoryChangeCount(diff: MemoryDiff): number {
    return (
        diff.formed.size +
        diff.dropped.size +
        diff.forgottenNow.size +
        diff.unforgottenNow.size +
        diff.salienceChanged.size
    );
}
