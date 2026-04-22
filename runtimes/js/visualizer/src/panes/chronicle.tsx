import { Box, Text } from "ink";
import React from "react";

import type { ActionView, UID } from "@siftystudio/viv-runtime";

import { formatTimestamp, type LabelResolver } from "../format.js";
import type { FrameDiff } from "../history.js";
import type { VivSnapshot } from "../snapshot.js";
import { SelectableList, type SelectableListItem } from "../widgets/list.js";
import { ActionDetail } from "./action-detail.js";

export interface ChroniclePaneProps {
    snapshot: VivSnapshot;
    resolveLabel: LabelResolver;
    filter: string;
    selectedID: UID | null;
    onSelect: (id: UID) => void;
    focused: boolean;
    diff?: FrameDiff;
}

/**
 * The action ledger. Lists actions in chronological order on the left;
 * the right pane shows full detail for the selected action.
 *
 * Filter syntax:
 *   :p <label>   show only actions where <label> is a participant
 *   :t <tag>     show only actions carrying <tag>
 *   <text>       substring match against name/gloss/report
 */
export function ChroniclePane({
    snapshot,
    resolveLabel,
    filter,
    selectedID,
    onSelect,
    focused,
    diff
}: ChroniclePaneProps): React.ReactElement {
    const actions = Object.values(snapshot.entities).filter(
        (e): e is ActionView => e.entityType === "action"
    );
    const filtered = actions.filter((a) => matches(a, filter, resolveLabel));
    filtered.sort((a, b) => a.timestamp - b.timestamp);

    const items: SelectableListItem[] = filtered.map((a) => {
        const isNew = diff?.addedEntityIDs.has(a.id) ?? false;
        const marker = isNew ? "＋" : " ";
        return {
            key: a.id,
            label: `${marker} ${formatTimestamp(a.timestamp).padEnd(8)} ${a.name.padEnd(14)} ${resolveLabel(
                a.initiator
            )}`
        };
    });

    const newCount = diff
        ? [...diff.addedEntityIDs].filter((id) => {
              const e = snapshot.entities[id];
              return e !== undefined && e.entityType === "action";
          }).length
        : 0;

    const selected = selectedID
        ? (snapshot.entities[selectedID] as ActionView | undefined)
        : undefined;

    return (
        <Box flexGrow={1} flexDirection="column">
            {newCount > 0 ? (
                <Text color="green">{`+${newCount} new action${newCount === 1 ? "" : "s"} since prev frame`}</Text>
            ) : null}
            <Box flexGrow={1}>
                <Box width="45%" flexDirection="column" marginRight={1}>
                    <SelectableList
                        items={items}
                        selectedKey={selectedID}
                        onSelect={onSelect}
                        focused={focused}
                    />
                </Box>
                <Box flexGrow={1} flexDirection="column">
                    {selected !== undefined ? (
                        <ActionDetail
                            action={selected}
                            snapshot={snapshot}
                            resolveLabel={resolveLabel}
                        />
                    ) : (
                        <Text dimColor>Select an action.</Text>
                    )}
                </Box>
            </Box>
        </Box>
    );
}

function matches(action: ActionView, filter: string, resolveLabel: LabelResolver): boolean {
    if (filter.length === 0) return true;
    const trimmed = filter.trim();
    if (trimmed.startsWith(":p ")) {
        const needle = trimmed.slice(3).toLowerCase();
        const participants = [
            action.initiator,
            ...action.partners,
            ...action.recipients,
            ...action.bystanders
        ];
        return participants.some(
            (uid) =>
                uid.toLowerCase().includes(needle) ||
                resolveLabel(uid).toLowerCase().includes(needle)
        );
    }
    if (trimmed.startsWith(":t ")) {
        const needle = trimmed.slice(3).toLowerCase();
        return action.tags.some((t) => t.toLowerCase().includes(needle));
    }
    const needle = trimmed.toLowerCase();
    return (
        action.name.toLowerCase().includes(needle) ||
        (action.gloss ?? "").toLowerCase().includes(needle) ||
        (action.report ?? "").toLowerCase().includes(needle)
    );
}
