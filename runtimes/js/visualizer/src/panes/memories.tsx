import { Box, Text } from "ink";
import React, { useEffect, useMemo } from "react";

import type { ActionView, CharacterMemory, CharacterView, UID } from "@siftystudio/viv-runtime";

import {
    formatSalience,
    formatTimestamp,
    type LabelResolver
} from "../format.js";
import {
    computeMemoryTimeline,
    type FrameDiff,
    type MemoryDiff,
    type MemoryEvent,
    type MemoryTimeline,
    type SnapshotRing
} from "../history.js";
import type { VivSnapshot } from "../snapshot.js";
import { SelectableList, type SelectableListItem } from "../widgets/list.js";
import { Sparkline, type SparklineSample } from "../widgets/sparkline.js";
import { ActionDetail } from "./action-detail.js";

export interface MemoriesPaneProps {
    snapshot: VivSnapshot;
    resolveLabel: LabelResolver;
    /** Character whose memories we're browsing. Selected from the Characters pane. */
    characterID: UID | null;
    filter: string;
    selectedMemoryID: UID | null;
    onSelect: (actionID: UID) => void;
    focused: boolean;
    /** Diff of the current frame vs. its predecessor, for change badges. */
    diff?: FrameDiff;
    /** History ring, required for the per-memory timeline view. */
    history?: SnapshotRing | null;
    /** Toggle the per-memory history detail in place of the action detail. */
    historyView?: boolean;
}

/**
 * Per-character memory browser. The left list shows the character's memories
 * (rows = actions they know about) sorted by salience, descending. The right
 * pane shows either the full underlying action (default) or the per-memory
 * history timeline (toggled with `h`).
 */
export function MemoriesPane({
    snapshot,
    resolveLabel,
    characterID,
    filter,
    selectedMemoryID,
    onSelect,
    focused,
    diff,
    history = null,
    historyView = false
}: MemoriesPaneProps): React.ReactElement {
    if (characterID === null) {
        return <Text dimColor>Select a character from the Characters tab first.</Text>;
    }
    const character = snapshot.entities[characterID] as CharacterView | undefined;
    if (character === undefined || character.entityType !== "character") {
        return <Text color="red">{`No character found for id: ${characterID}`}</Text>;
    }

    const memDiff: MemoryDiff | null = diff?.memoryDiffs.get(characterID) ?? null;
    const entries: [UID, CharacterMemory][] = Object.entries(character.memories);
    const filtered = entries.filter(([actionID, mem]) =>
        matches(actionID, mem, snapshot, filter)
    );
    filtered.sort(([, a], [, b]) => b.salience - a.salience);

    const items: SelectableListItem[] = filtered.map(([actionID, mem]) => {
        const action = snapshot.entities[actionID] as ActionView | undefined;
        const name = action?.name ?? "?";
        const prefix = mem.forgotten ? "✗ " : "  ";
        const badge = memoryBadge(actionID, memDiff);
        return {
            key: actionID,
            label: `${prefix}${formatSalience(mem.salience)}  ${name.padEnd(14)} ${formatTimestamp(
                mem.formationTimestamp
            )}${badge}`
        };
    });

    const firstVisibleKey: UID | null = items.length > 0 ? items[0]!.key : null;
    const currentIsVisible =
        selectedMemoryID !== null && items.some((i) => i.key === selectedMemoryID);
    useEffect(() => {
        if (firstVisibleKey !== null && !currentIsVisible) onSelect(firstVisibleKey);
    }, [firstVisibleKey, currentIsVisible, onSelect]);

    const effectiveID = currentIsVisible ? selectedMemoryID : firstVisibleKey;
    const selectedAction =
        effectiveID !== null
            ? (snapshot.entities[effectiveID] as ActionView | undefined)
            : undefined;
    const selectedMemory =
        effectiveID !== null ? character.memories[effectiveID] : undefined;

    const timeline: MemoryTimeline | null = useMemo(() => {
        if (history === null || effectiveID === null) return null;
        return computeMemoryTimeline(history, characterID, effectiveID);
    }, [history, characterID, effectiveID]);

    const changedCount = memDiff !== null ? totalMemoryChanges(memDiff) : 0;

    return (
        <Box flexGrow={1} flexDirection="column">
            <Box marginBottom={1}>
                <Text>
                    <Text bold>memories of </Text>
                    <Text color="cyan">{resolveLabel(character.id)}</Text>
                    <Text dimColor>{`  (${entries.length} total, ${filtered.length} shown${
                        changedCount > 0 ? `, ${changedCount} changed` : ""
                    })`}</Text>
                    {historyView ? <Text color="yellow">{"  [history view]"}</Text> : null}
                </Text>
            </Box>
            <Box flexGrow={1}>
                <Box width="50%" flexDirection="column" marginRight={1}>
                    <SelectableList
                        items={items}
                        selectedKey={selectedMemoryID}
                        onSelect={onSelect}
                        focused={focused}
                    />
                </Box>
                <Box flexGrow={1} flexDirection="column">
                    {selectedMemory !== undefined && selectedAction !== undefined && effectiveID !== null ? (
                        historyView ? (
                            <MemoryHistoryView
                                characterID={characterID}
                                actionID={effectiveID}
                                memory={selectedMemory}
                                action={selectedAction}
                                timeline={timeline}
                                resolveLabel={resolveLabel}
                            />
                        ) : (
                            <>
                                <MemoryHeader
                                    memory={selectedMemory}
                                    resolveLabel={resolveLabel}
                                />
                                <Box marginTop={1}>
                                    <ActionDetail
                                        action={selectedAction}
                                        snapshot={snapshot}
                                        resolveLabel={resolveLabel}
                                    />
                                </Box>
                            </>
                        )
                    ) : (
                        <Text dimColor>Select a memory.</Text>
                    )}
                </Box>
            </Box>
        </Box>
    );
}

function MemoryHeader({
    memory,
    resolveLabel
}: {
    memory: CharacterMemory;
    resolveLabel: LabelResolver;
}): React.ReactElement {
    return (
        <Box flexDirection="column">
            <Text>
                <Text bold>salience:    </Text>
                <Text>{formatSalience(memory.salience)}</Text>
                {memory.forgotten ? <Text color="red">  [forgotten]</Text> : null}
            </Text>
            <Text>
                <Text bold>formed at:   </Text>
                <Text>{formatTimestamp(memory.formationTimestamp)}</Text>
            </Text>
            <Text>
                <Text bold>associations:</Text>
                <Text>
                    {memory.associations.length === 0
                        ? " (none)"
                        : ` ${memory.associations.join(", ")}`}
                </Text>
            </Text>
            <Text>
                <Text bold>sources:     </Text>
                <Text>
                    {memory.sources.length === 0
                        ? "(self-experience)"
                        : memory.sources.map(resolveLabel).join(" → ")}
                </Text>
            </Text>
        </Box>
    );
}

interface MemoryHistoryViewProps {
    characterID: UID;
    actionID: UID;
    memory: CharacterMemory;
    action: ActionView;
    timeline: MemoryTimeline | null;
    resolveLabel: LabelResolver;
}

/**
 * The per-memory history panel: current snapshot summary, a salience sparkline
 * across the retained ring, and a chronological event list (formed / forgotten /
 * dropped / salience swings).
 */
function MemoryHistoryView({
    actionID,
    memory,
    action,
    timeline,
    resolveLabel
}: MemoryHistoryViewProps): React.ReactElement {
    const samples: SparklineSample[] = (timeline?.samples ?? []).map((s, i, arr) => ({
        value: s.salience,
        muted: s.forgotten,
        ...(i === arr.length - 1 ? { color: "yellowBright" } : {})
    }));
    const peak = timeline
        ? timeline.samples.reduce((p, s) => Math.max(p, s.salience), 0)
        : memory.salience;
    const low = timeline && timeline.samples.length > 0
        ? timeline.samples.reduce((p, s) => Math.min(p, s.salience), Number.POSITIVE_INFINITY)
        : memory.salience;

    return (
        <Box flexDirection="column">
            <Text>
                <Text bold>memory of:  </Text>
                <Text>{action.name}</Text>
                <Text dimColor>{`  [${actionID}]`}</Text>
            </Text>
            <Text>
                <Text bold>initiator:  </Text>
                <Text>{resolveLabel(action.initiator)}</Text>
            </Text>
            <Text>
                <Text bold>current:    </Text>
                <Text>{formatSalience(memory.salience)}</Text>
                {memory.forgotten ? <Text color="red">  [forgotten]</Text> : null}
            </Text>
            <Text>
                <Text bold>formed at:  </Text>
                <Text>{formatTimestamp(memory.formationTimestamp)}</Text>
            </Text>

            <Box marginTop={1} flexDirection="column">
                <Text bold underline>
                    Salience over recorded history
                </Text>
                {timeline === null ? (
                    <Text dimColor>
                        (no history available — live with `--history` or replay a JSONL dump)
                    </Text>
                ) : timeline.samples.length === 0 ? (
                    <Text dimColor>(no samples in ring)</Text>
                ) : (
                    <>
                        <Sparkline samples={samples} max={1} />
                        <Text dimColor>
                            {`${timeline.samples.length} samples · min ${low.toFixed(2)} · max ${peak.toFixed(2)} · range T=${timeline.samples[0]!.timestamp}..${timeline.samples[timeline.samples.length - 1]!.timestamp}`}
                        </Text>
                    </>
                )}
            </Box>

            <Box marginTop={1} flexDirection="column">
                <Text bold underline>
                    Events
                </Text>
                {timeline === null || timeline.events.length === 0 ? (
                    <Text dimColor>(none)</Text>
                ) : (
                    timeline.events.slice(-12).map((ev, i) => (
                        <EventLine key={`${ev.frameIndex}-${i}-${ev.kind}`} event={ev} />
                    ))
                )}
            </Box>

            {memory.associations.length > 0 ? (
                <Box marginTop={1}>
                    <Text>
                        <Text bold>associations: </Text>
                        <Text>{memory.associations.join(", ")}</Text>
                    </Text>
                </Box>
            ) : null}
            {memory.sources.length > 0 ? (
                <Box>
                    <Text>
                        <Text bold>sources:      </Text>
                        <Text>{memory.sources.map(resolveLabel).join(" → ")}</Text>
                    </Text>
                </Box>
            ) : null}
        </Box>
    );
}

function EventLine({ event }: { event: MemoryEvent }): React.ReactElement {
    const color = eventColor(event.kind);
    const glyph = eventGlyph(event.kind);
    const salience =
        event.salience !== undefined ? `  sal=${event.salience.toFixed(2)}` : "";
    const delta =
        event.delta !== undefined
            ? `  Δ${event.delta > 0 ? "+" : ""}${event.delta.toFixed(2)}`
            : "";
    return (
        <Text>
            <Text color={color}>{glyph} </Text>
            <Text>{formatTimestamp(event.timestamp).padEnd(8)} </Text>
            <Text color={color}>{event.kind.padEnd(16)}</Text>
            <Text dimColor>{`  frame ${event.frameIndex}${salience}${delta}`}</Text>
        </Text>
    );
}

function eventColor(kind: MemoryEvent["kind"]): string {
    switch (kind) {
        case "formed":
        case "restored":
        case "unforgotten":
        case "salience-rose":
            return "green";
        case "forgotten":
        case "dropped":
        case "salience-fell":
            return "red";
    }
}

function eventGlyph(kind: MemoryEvent["kind"]): string {
    switch (kind) {
        case "formed":
            return "＋";
        case "restored":
            return "↻";
        case "unforgotten":
            return "↑";
        case "salience-rose":
            return "▲";
        case "salience-fell":
            return "▼";
        case "forgotten":
            return "✗";
        case "dropped":
            return "⌫";
    }
}

function memoryBadge(actionID: UID, md: MemoryDiff | null): string {
    if (md === null) return "";
    if (md.formed.has(actionID)) return "  [NEW]";
    if (md.forgottenNow.has(actionID)) return "  [forgotten]";
    if (md.unforgottenNow.has(actionID)) return "  [restored]";
    const delta = md.salienceChanged.get(actionID);
    if (delta !== undefined) {
        const d = delta.to - delta.from;
        const sign = d > 0 ? "+" : "";
        return `  [${sign}${d.toFixed(2)}]`;
    }
    return "";
}

function totalMemoryChanges(md: MemoryDiff): number {
    return (
        md.formed.size +
        md.dropped.size +
        md.forgottenNow.size +
        md.unforgottenNow.size +
        md.salienceChanged.size
    );
}

function matches(
    actionID: UID,
    memory: CharacterMemory,
    snapshot: VivSnapshot,
    filter: string
): boolean {
    if (filter.length === 0) return true;
    const needle = filter.toLowerCase();
    const action = snapshot.entities[actionID] as ActionView | undefined;
    if (memory.associations.some((a) => a.toLowerCase().includes(needle))) return true;
    if (action && action.name.toLowerCase().includes(needle)) return true;
    return false;
}
