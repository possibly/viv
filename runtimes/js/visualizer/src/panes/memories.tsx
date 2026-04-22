import { Box, Text } from "ink";
import React from "react";

import type { ActionView, CharacterMemory, CharacterView, UID } from "@siftystudio/viv-runtime";

import {
    formatSalience,
    formatTimestamp,
    type LabelResolver
} from "../format.js";
import type { VivSnapshot } from "../snapshot.js";
import { SelectableList, type SelectableListItem } from "../widgets/list.js";
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
}

/**
 * Per-character memory browser. The left list shows the character's memories
 * (rows = actions they know about) sorted by salience, descending. The right
 * pane shows the full underlying action. Both `forgotten` and live memories
 * are shown; forgotten ones are labelled.
 *
 * Relies on the character being selected elsewhere (Characters pane).
 */
export function MemoriesPane({
    snapshot,
    resolveLabel,
    characterID,
    filter,
    selectedMemoryID,
    onSelect,
    focused
}: MemoriesPaneProps): React.ReactElement {
    if (characterID === null) {
        return <Text dimColor>Select a character from the Characters tab first.</Text>;
    }
    const character = snapshot.entities[characterID] as CharacterView | undefined;
    if (character === undefined || character.entityType !== "character") {
        return <Text color="red">{`No character found for id: ${characterID}`}</Text>;
    }

    const entries: [UID, CharacterMemory][] = Object.entries(character.memories);
    const filtered = entries.filter(([actionID, mem]) =>
        matches(actionID, mem, snapshot, filter)
    );
    filtered.sort(([, a], [, b]) => b.salience - a.salience);

    const items: SelectableListItem[] = filtered.map(([actionID, mem]) => {
        const action = snapshot.entities[actionID] as ActionView | undefined;
        const name = action?.name ?? "?";
        const prefix = mem.forgotten ? "✗ " : "  ";
        return {
            key: actionID,
            label: `${prefix}${formatSalience(mem.salience)}  ${name.padEnd(14)} ${formatTimestamp(
                mem.formationTimestamp
            )}`
        };
    });

    const selectedAction =
        selectedMemoryID !== null
            ? (snapshot.entities[selectedMemoryID] as ActionView | undefined)
            : undefined;
    const selectedMemory =
        selectedMemoryID !== null ? character.memories[selectedMemoryID] : undefined;

    return (
        <Box flexGrow={1} flexDirection="column">
            <Box marginBottom={1}>
                <Text>
                    <Text bold>memories of </Text>
                    <Text color="cyan">{resolveLabel(character.id)}</Text>
                    <Text dimColor>{`  (${entries.length} total, ${filtered.length} shown)`}</Text>
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
                    {selectedMemory !== undefined && selectedAction !== undefined ? (
                        <>
                            <MemoryHeader memory={selectedMemory} resolveLabel={resolveLabel} />
                            <Box marginTop={1}>
                                <ActionDetail
                                    action={selectedAction}
                                    snapshot={snapshot}
                                    resolveLabel={resolveLabel}
                                />
                            </Box>
                        </>
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
