import { Box, Text, useApp, useInput } from "ink";
import React, { useEffect, useMemo, useRef, useState } from "react";

import type { UID } from "@siftystudio/viv-runtime";

import { makeLabelResolver, formatTimestamp } from "./format.js";
import {
    computeFrameDiff,
    DEFAULT_HISTORY_CAPACITY,
    emptyFrameDiff,
    SnapshotRing,
    type FrameDiff,
    type HistoryFrame
} from "./history.js";
import type { VivSnapshot } from "./snapshot.js";
import type { SnapshotSource } from "./source.js";
import { CharactersPane } from "./panes/characters.js";
import { ChroniclePane } from "./panes/chronicle.js";
import { MemoriesPane } from "./panes/memories.js";
import { PlansPane } from "./panes/plans.js";
import { QueuesPane } from "./panes/queues.js";
import { FilterInput } from "./widgets/filter.js";
import { StatusBar } from "./widgets/statusbar.js";

type View = "characters" | "memories" | "chronicle" | "queues" | "plans";

const VIEW_ORDER: View[] = ["characters", "memories", "chronicle", "queues", "plans"];

export interface AppProps {
    snapshot: VivSnapshot;
    labelField: string | null;
    /**
     * Optional live source. When present, the app subscribes to it and appends
     * each update into `history` (creating one lazily if needed).
     */
    source?: SnapshotSource | null;
    /**
     * Optional snapshot ring. If omitted, the app lazily creates one seeded
     * with `snapshot`. When a ring is supplied it is the caller's responsibility
     * to have appended `snapshot` already (or not — the app will append the
     * initial snapshot itself if the ring is empty).
     */
    history?: SnapshotRing | null;
    /**
     * Whether the Memories pane should default to showing per-memory history
     * (sparkline + events) instead of the action detail. Useful for tests.
     */
    initialMemoryHistoryView?: boolean;
}

export function App({
    snapshot: initialSnapshot,
    labelField,
    source = null,
    history: providedHistory = null,
    initialMemoryHistoryView = false
}: AppProps): React.ReactElement {
    const { exit } = useApp();

    // Ring ownership. If a ring wasn't provided, make one and seed it.
    const ringRef = useRef<SnapshotRing | null>(null);
    if (ringRef.current === null) {
        if (providedHistory !== null) {
            ringRef.current = providedHistory;
            if (providedHistory.length === 0) providedHistory.append(initialSnapshot);
        } else {
            const ring = new SnapshotRing(DEFAULT_HISTORY_CAPACITY);
            ring.append(initialSnapshot);
            ringRef.current = ring;
        }
    }
    const ring = ringRef.current;

    // viewIndex is the absolute ring index currently displayed. `sticky` means
    // "follow the newest frame" — when a new snapshot arrives, the view jumps
    // to it. Stepping through history turns sticky off.
    const initialView = ring.newestIndex ?? 0;
    const [viewIndex, setViewIndex] = useState<number>(initialView);
    const [sticky, setSticky] = useState(true);
    const [liveUpdates, setLiveUpdates] = useState(0);
    // Force a re-render each time the ring changes even when the view sticks
    // to the same absolute index (e.g., ring freshly reseeded with same index).
    const [, bumpTick] = useState(0);

    useEffect(() => {
        if (initialSnapshot !== ring.byIndex(ring.newestIndex ?? -1)?.snapshot) {
            ring.append(initialSnapshot);
            if (sticky) setViewIndex(ring.newestIndex ?? 0);
            bumpTick((n) => n + 1);
        }
        // Intentionally run only when the `initialSnapshot` identity changes.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [initialSnapshot]);

    // Keep the subscription stable across renders so we only ever hold one
    // listener on the source. State that the listener consults but does not
    // depend on for its identity (`sticky`) is read through a ref so the
    // latest value is always observed without re-subscribing.
    const stickyRef = useRef(sticky);
    stickyRef.current = sticky;
    useEffect(() => {
        if (source === null) return;
        const unsubscribe = source.subscribe((next) => {
            ring.append(next);
            setLiveUpdates((n) => n + 1);
            if (stickyRef.current) setViewIndex(ring.newestIndex ?? 0);
            bumpTick((n) => n + 1);
        });
        return unsubscribe;
    }, [source, ring]);

    // Resolve the current frame. If the absolute index scrolled out of the
    // retained window (ring overflowed), clamp to the oldest retained frame.
    const currentFrame: HistoryFrame =
        ring.byIndex(viewIndex) ??
        (ring.oldestIndex !== null ? ring.byIndex(ring.oldestIndex)! : fallbackFrame(initialSnapshot));
    const snapshot = currentFrame.snapshot;

    const prevFrame: HistoryFrame | null =
        currentFrame.index > 0 ? ring.byIndex(currentFrame.index - 1) : null;
    const diff: FrameDiff = useMemo(
        () =>
            prevFrame === null
                ? emptyFrameDiff(currentFrame.index)
                : computeFrameDiff(prevFrame, currentFrame),
        [prevFrame, currentFrame]
    );

    const resolveLabel = useMemo(
        () => makeLabelResolver(snapshot.entities, labelField),
        [snapshot.entities, labelField]
    );

    const [view, setView] = useState<View>("characters");
    const [filter, setFilter] = useState<string>("");
    const [filterEditing, setFilterEditing] = useState(false);
    const [memoryHistoryView, setMemoryHistoryView] = useState(initialMemoryHistoryView);

    const [selectedCharacterID, setSelectedCharacterID] = useState<UID | null>(() =>
        firstCharacterID(snapshot)
    );
    const [selectedMemoryID, setSelectedMemoryID] = useState<UID | null>(null);
    const [selectedActionID, setSelectedActionID] = useState<UID | null>(() =>
        firstActionID(snapshot)
    );
    const [selectedPlanID, setSelectedPlanID] = useState<UID | null>(() =>
        firstPlanID(snapshot)
    );

    // `view` flips frequently and is consulted by the keybinding handler below
    // for view-scoped keys (e.g. `h` only meaningful in the memories pane).
    // Reading it through a ref avoids rebuilding the input handler each render
    // and avoids the stale-closure trap that bit the prior pane-local approach.
    const viewRef = useRef(view);
    viewRef.current = view;

    useInput((input, key) => {
        if (filterEditing) return;
        if (input === "q") {
            exit();
        } else if (key.tab && !key.shift) {
            setFilter("");
            setView(VIEW_ORDER[(VIEW_ORDER.indexOf(view) + 1) % VIEW_ORDER.length]!);
        } else if (key.tab && key.shift) {
            setFilter("");
            setView(
                VIEW_ORDER[
                    (VIEW_ORDER.indexOf(view) - 1 + VIEW_ORDER.length) % VIEW_ORDER.length
                ]!
            );
        } else if (input === "/") {
            setFilterEditing(true);
        } else if (key.escape) {
            setFilter("");
        } else if (input === "[") {
            stepBy(-1);
        } else if (input === "]") {
            stepBy(+1);
        } else if (input === "{") {
            jumpToOldest();
        } else if (input === "}") {
            jumpToNewest();
        } else if (input === "p") {
            setSticky((s) => !s);
        } else if (input === "h" && viewRef.current === "memories") {
            setMemoryHistoryView((v) => !v);
        }
    });

    function stepBy(delta: number): void {
        if (ring.length <= 1) return;
        const target = clampToRing(viewIndex + delta, ring);
        if (target === viewIndex) return;
        setViewIndex(target);
        // Any manual step freezes the view; user must press `}` to resume tailing.
        if (sticky) setSticky(false);
    }

    function jumpToOldest(): void {
        if (ring.oldestIndex === null) return;
        setViewIndex(ring.oldestIndex);
        setSticky(false);
    }

    function jumpToNewest(): void {
        if (ring.newestIndex === null) return;
        setViewIndex(ring.newestIndex);
        setSticky(true);
    }

    const paneFocused = !filterEditing;

    return (
        <Box flexDirection="column" padding={1}>
            <Header view={view} snapshot={snapshot} />
            <Box marginTop={1} flexGrow={1}>
                {view === "characters" ? (
                    <CharactersPane
                        snapshot={snapshot}
                        resolveLabel={resolveLabel}
                        filter={filter}
                        selectedID={selectedCharacterID}
                        onSelect={setSelectedCharacterID}
                        focused={paneFocused}
                        diff={diff}
                    />
                ) : view === "memories" ? (
                    <MemoriesPane
                        snapshot={snapshot}
                        resolveLabel={resolveLabel}
                        characterID={selectedCharacterID}
                        filter={filter}
                        selectedMemoryID={selectedMemoryID}
                        onSelect={setSelectedMemoryID}
                        focused={paneFocused}
                        diff={diff}
                        history={ring}
                        historyView={memoryHistoryView}
                    />
                ) : view === "chronicle" ? (
                    <ChroniclePane
                        snapshot={snapshot}
                        resolveLabel={resolveLabel}
                        filter={filter}
                        selectedID={selectedActionID}
                        onSelect={setSelectedActionID}
                        focused={paneFocused}
                        diff={diff}
                    />
                ) : view === "queues" ? (
                    <QueuesPane
                        snapshot={snapshot}
                        resolveLabel={resolveLabel}
                        filter={filter}
                    />
                ) : (
                    <PlansPane
                        snapshot={snapshot}
                        resolveLabel={resolveLabel}
                        filter={filter}
                        selectedID={selectedPlanID}
                        onSelect={setSelectedPlanID}
                        focused={paneFocused}
                        diff={diff}
                    />
                )}
            </Box>
            <Box marginTop={1} flexDirection="column">
                {filterEditing ? (
                    <FilterInput
                        value={filter}
                        onChange={setFilter}
                        onSubmit={() => setFilterEditing(false)}
                        onCancel={() => {
                            setFilterEditing(false);
                            setFilter("");
                        }}
                        focused={filterEditing}
                    />
                ) : filter.length > 0 ? (
                    <Text dimColor>{`filter: /${filter}  (esc to clear)`}</Text>
                ) : null}
                <StatusBar
                    keys={statusKeys(view, ring.length > 1)}
                    right={statusRight(snapshot, ring, currentFrame, sticky, source, liveUpdates)}
                />
            </Box>
        </Box>
    );
}

function statusKeys(view: View, multiFrame: boolean): { key: string; desc: string }[] {
    const base: { key: string; desc: string }[] = [
        { key: "tab", desc: "next view" },
        { key: "↑↓", desc: "select" }
    ];
    if (multiFrame) {
        base.push({ key: "[]", desc: "step" }, { key: "p", desc: "pause" });
    }
    if (view === "memories") base.push({ key: "h", desc: "history" });
    base.push({ key: "/", desc: "filter" }, { key: "q", desc: "quit" });
    return base;
}

function statusRight(
    snapshot: VivSnapshot,
    ring: SnapshotRing,
    currentFrame: HistoryFrame,
    sticky: boolean,
    source: SnapshotSource | null,
    liveUpdates: number
): string {
    // The right status has two "modes" so it never wraps in an 80-column terminal:
    //   - live / one-shot: `T=X  schema V.V.V  live (N)`
    //   - historical (paused or viewing not-latest): drop schema and the live
    //     counter, show `T=X  frame N/M paused` — the user's attention is on
    //     navigation, and `M` keeps growing so live arrivals are still visible.
    const isHistorical =
        ring.length > 1 &&
        (!sticky || (ring.newestIndex !== null && currentFrame.index < ring.newestIndex));
    if (isHistorical) {
        const pauseLabel = sticky ? "" : " paused";
        return `${formatTimestamp(snapshot.timestamp)}  frame ${currentFrame.index + 1}/${ring.totalAppended}${pauseLabel}`;
    }
    const liveLabel = source !== null ? `  live (${liveUpdates})` : "";
    return `${formatTimestamp(snapshot.timestamp)}  schema ${snapshot.schemaVersion}${liveLabel}`;
}

function Header({ view, snapshot }: { view: View; snapshot: VivSnapshot }): React.ReactElement {
    const counts = useMemo(() => countEntities(snapshot), [snapshot]);
    return (
        <Box justifyContent="space-between">
            <Box>
                {VIEW_ORDER.map((v) => (
                    <Text key={v}>
                        {v === view ? (
                            <Text color="cyan" bold>
                                [{v}]
                            </Text>
                        ) : (
                            <Text dimColor>{` ${v} `}</Text>
                        )}
                    </Text>
                ))}
            </Box>
            <Text dimColor>
                {counts.characters} chars · {counts.actions} actions · {counts.locations} locs
            </Text>
        </Box>
    );
}

function countEntities(snapshot: VivSnapshot): {
    characters: number;
    actions: number;
    locations: number;
} {
    let characters = 0;
    let actions = 0;
    let locations = 0;
    for (const e of Object.values(snapshot.entities)) {
        if (e.entityType === "character") characters++;
        else if (e.entityType === "action") actions++;
        else if (e.entityType === "location") locations++;
    }
    return { characters, actions, locations };
}

function firstCharacterID(snapshot: VivSnapshot): UID | null {
    for (const e of Object.values(snapshot.entities)) {
        if (e.entityType === "character") return e.id;
    }
    return null;
}

function firstActionID(snapshot: VivSnapshot): UID | null {
    let earliest: { id: UID; timestamp: number } | null = null;
    for (const e of Object.values(snapshot.entities)) {
        if (e.entityType === "action") {
            const ts = (e as unknown as { timestamp: number }).timestamp;
            if (earliest === null || ts < earliest.timestamp) {
                earliest = { id: e.id, timestamp: ts };
            }
        }
    }
    return earliest?.id ?? null;
}

function firstPlanID(snapshot: VivSnapshot): UID | null {
    const ids = Object.keys(snapshot.vivInternalState.activePlans ?? {});
    return ids.length > 0 ? ids[0]! : null;
}

function clampToRing(index: number, ring: SnapshotRing): number {
    if (ring.oldestIndex === null || ring.newestIndex === null) return index;
    return Math.max(ring.oldestIndex, Math.min(ring.newestIndex, index));
}

function fallbackFrame(snapshot: VivSnapshot): HistoryFrame {
    return { snapshot, index: 0, receivedAt: Date.now() };
}
