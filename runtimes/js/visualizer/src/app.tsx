import { Box, Text, useApp, useInput } from "ink";
import React, { useEffect, useMemo, useState } from "react";

import type { UID } from "@siftystudio/viv-runtime";

import { makeLabelResolver, formatTimestamp } from "./format.js";
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
     * Optional live source. When present, the app subscribes to it and
     * replaces `snapshot` with each update. Used by the CLI to keep the TUI
     * in sync with a running host over HTTP or IPC.
     */
    source?: SnapshotSource | null;
}

export function App({ snapshot: initialSnapshot, labelField, source = null }: AppProps): React.ReactElement {
    const { exit } = useApp();
    const [snapshot, setSnapshot] = useState<VivSnapshot>(initialSnapshot);
    const [liveUpdates, setLiveUpdates] = useState(0);

    useEffect(() => {
        setSnapshot(initialSnapshot);
    }, [initialSnapshot]);

    useEffect(() => {
        if (source === null) return;
        const unsubscribe = source.subscribe((next) => {
            setSnapshot(next);
            setLiveUpdates((n) => n + 1);
        });
        return unsubscribe;
    }, [source]);

    const resolveLabel = useMemo(
        () => makeLabelResolver(snapshot.entities, labelField),
        [snapshot.entities, labelField]
    );

    const [view, setView] = useState<View>("characters");
    const [filter, setFilter] = useState<string>("");
    const [filterEditing, setFilterEditing] = useState(false);

    // Per-view selection state, lifted so switching panes is cheap.
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
        }
    });

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
                    />
                ) : view === "chronicle" ? (
                    <ChroniclePane
                        snapshot={snapshot}
                        resolveLabel={resolveLabel}
                        filter={filter}
                        selectedID={selectedActionID}
                        onSelect={setSelectedActionID}
                        focused={paneFocused}
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
                    keys={[
                        { key: "tab", desc: "next view" },
                        { key: "↑↓", desc: "select" },
                        { key: "/", desc: "filter" },
                        { key: "esc", desc: "clear" },
                        { key: "q", desc: "quit" }
                    ]}
                    right={`${formatTimestamp(snapshot.timestamp)}  schema ${
                        snapshot.schemaVersion
                    }${source !== null ? `  live (${liveUpdates})` : ""}`}
                />
            </Box>
        </Box>
    );
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
