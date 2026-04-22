import { Box, Text } from "ink";
import React from "react";

import type { CharacterView, UID } from "@siftystudio/viv-runtime";

import {
    fit,
    forgottenCount,
    formatSalience,
    formatTimestamp,
    hostProperties,
    formatValue,
    type LabelResolver
} from "../format.js";
import type { VivSnapshot } from "../snapshot.js";
import { SelectableList, type SelectableListItem } from "../widgets/list.js";

export interface CharactersPaneProps {
    snapshot: VivSnapshot;
    resolveLabel: LabelResolver;
    filter: string;
    selectedID: UID | null;
    onSelect: (id: UID) => void;
    focused: boolean;
}

export function CharactersPane({
    snapshot,
    resolveLabel,
    filter,
    selectedID,
    onSelect,
    focused
}: CharactersPaneProps): React.ReactElement {
    const all = Object.values(snapshot.entities).filter(
        (e): e is CharacterView => e.entityType === "character"
    );
    const filtered = all.filter((c) =>
        filter.length === 0 ? true : matches(c, filter, resolveLabel)
    );
    filtered.sort((a, b) => resolveLabel(a.id).localeCompare(resolveLabel(b.id)));

    const items: SelectableListItem[] = filtered.map((c) => ({
        key: c.id,
        label: `${resolveLabel(c.id).padEnd(16)} @${resolveLabel(c.location)}`
    }));

    const selected = selectedID ? (snapshot.entities[selectedID] as CharacterView | undefined) : undefined;

    return (
        <Box flexGrow={1}>
            <Box width="40%" flexDirection="column" marginRight={1}>
                <SelectableList
                    items={items}
                    selectedKey={selectedID}
                    onSelect={onSelect}
                    focused={focused}
                />
            </Box>
            <Box flexGrow={1} flexDirection="column">
                {selected !== undefined ? (
                    <CharacterDetail
                        character={selected}
                        snapshot={snapshot}
                        resolveLabel={resolveLabel}
                    />
                ) : (
                    <Text dimColor>Select a character.</Text>
                )}
            </Box>
        </Box>
    );
}

function matches(c: CharacterView, filter: string, resolveLabel: LabelResolver): boolean {
    const needle = filter.toLowerCase();
    return (
        c.id.toLowerCase().includes(needle) ||
        resolveLabel(c.id).toLowerCase().includes(needle) ||
        resolveLabel(c.location).toLowerCase().includes(needle)
    );
}

interface CharacterDetailProps {
    character: CharacterView;
    snapshot: VivSnapshot;
    resolveLabel: LabelResolver;
}

function CharacterDetail({
    character,
    snapshot,
    resolveLabel
}: CharacterDetailProps): React.ReactElement {
    const memoryList = Object.entries(character.memories);
    memoryList.sort(([, a], [, b]) => b.salience - a.salience);
    const top = memoryList.slice(0, 8);
    const total = memoryList.length;
    const forgotten = forgottenCount(character);

    const props = hostProperties(character);

    return (
        <Box flexDirection="column">
            <Text>
                <Text bold>id:       </Text>
                <Text>{character.id}</Text>
            </Text>
            <Text>
                <Text bold>location: </Text>
                <Text>{resolveLabel(character.location)}</Text>
                {resolveLabel(character.location) !== character.location ? (
                    <Text dimColor>{` (${character.location})`}</Text>
                ) : null}
            </Text>
            <Text>
                <Text bold>memories: </Text>
                <Text>{`${total} (${forgotten} forgotten)`}</Text>
            </Text>
            <Box marginTop={1} flexDirection="column">
                <Text bold underline>
                    Top memories by salience
                </Text>
                {top.length === 0 ? (
                    <Text dimColor>(none)</Text>
                ) : (
                    top.map(([actionID, mem]) => {
                        const action = snapshot.entities[actionID];
                        const name = action && "name" in action ? String(action.name) : "?";
                        const prefix = mem.forgotten ? "✗ " : "  ";
                        return (
                            <Text key={actionID}>
                                {prefix}
                                {formatSalience(mem.salience)}{"  "}
                                {fit(name, 16)} {formatTimestamp(mem.formationTimestamp)}
                            </Text>
                        );
                    })
                )}
            </Box>
            {props.length > 0 ? (
                <Box marginTop={1} flexDirection="column">
                    <Text bold underline>
                        Host properties
                    </Text>
                    {props.map(([key, value]) => (
                        <Text key={key}>
                            <Text color="magenta">{key}: </Text>
                            <Text>{formatValue(value)}</Text>
                        </Text>
                    ))}
                </Box>
            ) : null}
        </Box>
    );
}
