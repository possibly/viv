import { Box, Text } from "ink";
import React from "react";

import type { ActionView, UID } from "@siftystudio/viv-runtime";

import type { LabelResolver } from "../format.js";

export interface CausalTreeProps {
    /** The action this tree is rooted at. */
    actionID: UID;
    /** Full actions map, for looking up cause/caused references. */
    actions: Record<UID, ActionView>;
    /** "causes" walks upstream; "caused" walks downstream. */
    direction: "causes" | "caused";
    resolveLabel: LabelResolver;
    /** How many levels deep to descend. */
    maxDepth?: number;
}

/**
 * ASCII tree rendered from an action's direct cause/caused links. Walks only
 * one edge type (causes OR caused) so upstream and downstream can be shown
 * as separate trees. Guards against cycles and runaway fan-out.
 */
export function CausalTree({
    actionID,
    actions,
    direction,
    resolveLabel,
    maxDepth = 4
}: CausalTreeProps): React.ReactElement {
    const lines = renderTree(actionID, actions, direction, resolveLabel, maxDepth);
    if (lines.length === 0) {
        return (
            <Text dimColor>{direction === "causes" ? "(no causes)" : "(no effects)"}</Text>
        );
    }
    return (
        <Box flexDirection="column">
            {lines.map((line, i) => (
                <Text key={i}>{line}</Text>
            ))}
        </Box>
    );
}

function renderTree(
    rootID: UID,
    actions: Record<UID, ActionView>,
    direction: "causes" | "caused",
    resolveLabel: LabelResolver,
    maxDepth: number
): string[] {
    const out: string[] = [];
    const visited = new Set<UID>();
    walk(rootID, "", true, 0);
    return out;

    function walk(id: UID, prefix: string, isLast: boolean, depth: number): void {
        const action = actions[id];
        const label = action
            ? `${action.name} — ${resolveLabel(action.initiator)} @T=${action.timestamp}`
            : `<missing ${id}>`;
        const connector = depth === 0 ? "" : isLast ? "└─ " : "├─ ";
        out.push(`${prefix}${connector}${label}`);
        if (depth >= maxDepth || visited.has(id) || !action) return;
        visited.add(id);
        const nextIDs = direction === "causes" ? action.causes : action.caused;
        const childPrefix = depth === 0 ? "" : prefix + (isLast ? "   " : "│  ");
        nextIDs.forEach((nextID, i) => {
            walk(nextID, childPrefix, i === nextIDs.length - 1, depth + 1);
        });
    }
}
