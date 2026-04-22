import { Box, Text } from "ink";
import React from "react";

import type { PlanState, UID } from "@siftystudio/viv-runtime";

import { fit, formatTimestamp, formatValue, type LabelResolver } from "../format.js";
import type { FrameDiff } from "../history.js";
import type { VivSnapshot } from "../snapshot.js";
import { SelectableList, type SelectableListItem } from "../widgets/list.js";

export interface PlansPaneProps {
    snapshot: VivSnapshot;
    resolveLabel: LabelResolver;
    filter: string;
    selectedID: UID | null;
    onSelect: (id: UID) => void;
    focused: boolean;
    diff?: FrameDiff;
}

/**
 * Active plans held in VivInternalState.activePlans. Each plan is mid-execution
 * with a current phase, a program counter into that phase's instruction tape,
 * and possibly a wait deadline.
 */
export function PlansPane({
    snapshot,
    resolveLabel,
    filter,
    selectedID,
    onSelect,
    focused,
    diff
}: PlansPaneProps): React.ReactElement {
    const activePlans = snapshot.vivInternalState.activePlans ?? {};
    const entries: [UID, PlanState][] = Object.entries(activePlans);
    const needle = filter.trim().toLowerCase();
    const filtered = entries.filter(([, plan]) =>
        needle.length === 0 ? true : plan.planName.toLowerCase().includes(needle)
    );
    filtered.sort(([, a], [, b]) => a.planName.localeCompare(b.planName));

    const items: SelectableListItem[] = filtered.map(([id, plan]) => {
        const isNew = diff?.addedPlanIDs.has(id) ?? false;
        const isChanged = diff?.changedPlanIDs.has(id) ?? false;
        const marker = isNew ? "＋" : isChanged ? "●" : " ";
        return {
            key: id,
            label: `${marker} ${fit(plan.planName, 18)} ${fit(plan.currentPhase, 14)} pc=${plan.programCounter}`
        };
    });

    const changedCount =
        (diff?.addedPlanIDs.size ?? 0) + (diff?.changedPlanIDs.size ?? 0);

    const selected =
        selectedID !== null ? (activePlans[selectedID] as PlanState | undefined) : undefined;

    return (
        <Box flexGrow={1} flexDirection="column">
            {changedCount > 0 ? (
                <Text color="yellow">{`${changedCount} plan${changedCount === 1 ? "" : "s"} changed since prev frame`}</Text>
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
                        <PlanDetail plan={selected} resolveLabel={resolveLabel} />
                    ) : (
                        <Text dimColor>Select a plan.</Text>
                    )}
                </Box>
            </Box>
        </Box>
    );
}

function PlanDetail({
    plan,
    resolveLabel
}: {
    plan: PlanState;
    resolveLabel: LabelResolver;
}): React.ReactElement {
    return (
        <Box flexDirection="column">
            <Text>
                <Text bold>plan:    </Text>
                <Text>{plan.planName}</Text>
                <Text dimColor>{`  [${plan.id}]`}</Text>
            </Text>
            <Text>
                <Text bold>phase:   </Text>
                <Text>{plan.currentPhase}</Text>
            </Text>
            <Text>
                <Text bold>pc:      </Text>
                <Text>{plan.programCounter}</Text>
            </Text>
            <Text>
                <Text bold>wait:    </Text>
                <Text>
                    {plan.waitDeadline === null
                        ? "(none)"
                        : `until ${formatTimestamp(plan.waitDeadline)}`}
                </Text>
            </Text>
            <Text>
                <Text bold>resolved:</Text>
                <Text> {plan.resolved ? "yes" : "no"}</Text>
            </Text>

            <Box marginTop={1} flexDirection="column">
                <Text bold underline>
                    Bindings
                </Text>
                {Object.keys(plan.bindings).length === 0 ? (
                    <Text dimColor>(none)</Text>
                ) : (
                    Object.entries(plan.bindings).map(([role, value]) => {
                        const vals = Array.isArray(value) ? value : [value];
                        const rendered = vals
                            .map((v) => (typeof v === "string" ? resolveLabel(v) : formatValue(v)))
                            .join(", ");
                        return (
                            <Text key={role}>
                                <Text color="cyan">{fit(role, 14)}</Text>
                                <Text>{rendered}</Text>
                            </Text>
                        );
                    })
                )}
            </Box>

            {plan.loopStack.length > 0 ? (
                <Box marginTop={1} flexDirection="column">
                    <Text bold underline>
                        Loop stack
                    </Text>
                    {plan.loopStack.map((frame, i) => (
                        <Text key={i}>{formatValue(frame)}</Text>
                    ))}
                </Box>
            ) : null}

            {plan.reactionWindowQueuedConstructs !== null ? (
                <Box marginTop={1} flexDirection="column">
                    <Text bold underline>
                        Reaction window (pending constructs)
                    </Text>
                    {plan.reactionWindowQueuedConstructs.length === 0 ? (
                        <Text dimColor>(empty window)</Text>
                    ) : (
                        plan.reactionWindowQueuedConstructs.map((id) => (
                            <Text key={id}>  {id}</Text>
                        ))
                    )}
                </Box>
            ) : null}
        </Box>
    );
}
