import { Box, Text } from "ink";
import React from "react";

import type { ActionView, UID } from "@siftystudio/viv-runtime";

import {
    fit,
    formatTimestamp,
    formatValue,
    hostProperties,
    type LabelResolver
} from "../format.js";
import type { VivSnapshot } from "../snapshot.js";
import { CausalTree } from "../widgets/causal-tree.js";

export interface ActionDetailProps {
    action: ActionView;
    snapshot: VivSnapshot;
    resolveLabel: LabelResolver;
}

/**
 * Renders a single action's Viv-known fields, its participants, and upstream
 * and downstream causal trees. Host properties are dumped at the bottom as
 * opaque key/value pairs.
 */
export function ActionDetail({
    action,
    snapshot,
    resolveLabel
}: ActionDetailProps): React.ReactElement {
    const actions = getActionsMap(snapshot);
    const props = hostProperties(action);

    return (
        <Box flexDirection="column">
            <Text>
                <Text bold>name:       </Text>
                <Text>{action.name}</Text>
                <Text dimColor>{`  [${action.id}]`}</Text>
            </Text>
            <Text>
                <Text bold>when:       </Text>
                <Text>{formatTimestamp(action.timestamp)}</Text>
                {action.timeOfDay ? (
                    <Text>{`  (${pad2(action.timeOfDay.hour)}:${pad2(action.timeOfDay.minute)})`}</Text>
                ) : null}
            </Text>
            <Text>
                <Text bold>where:      </Text>
                <Text>{resolveLabel(action.location)}</Text>
            </Text>
            <Text>
                <Text bold>importance: </Text>
                <Text>{action.importance.toFixed(2)}</Text>
            </Text>
            {action.tags.length > 0 ? (
                <Text>
                    <Text bold>tags:       </Text>
                    <Text>{action.tags.join(", ")}</Text>
                </Text>
            ) : null}

            {action.gloss ? (
                <Box marginTop={1}>
                    <Text italic>{action.gloss}</Text>
                </Box>
            ) : null}
            {action.report ? (
                <Box marginTop={1}>
                    <Text>{action.report}</Text>
                </Box>
            ) : null}

            <Box marginTop={1} flexDirection="column">
                <Text bold underline>
                    Participants
                </Text>
                <ParticipantRow label="initiator" ids={[action.initiator]} resolveLabel={resolveLabel} />
                <ParticipantRow label="partners" ids={action.partners} resolveLabel={resolveLabel} />
                <ParticipantRow label="recipients" ids={action.recipients} resolveLabel={resolveLabel} />
                <ParticipantRow label="bystanders" ids={action.bystanders} resolveLabel={resolveLabel} />
            </Box>

            <Box marginTop={1} flexDirection="column">
                <Text bold underline>
                    Bindings
                </Text>
                <BindingsTable bindings={action.bindings} resolveLabel={resolveLabel} />
            </Box>

            <Box marginTop={1} flexDirection="column">
                <Text bold underline>
                    Causes (upstream)
                </Text>
                <CausalTree
                    actionID={action.id}
                    actions={actions}
                    direction="causes"
                    resolveLabel={resolveLabel}
                />
            </Box>

            <Box marginTop={1} flexDirection="column">
                <Text bold underline>
                    Effects (downstream)
                </Text>
                <CausalTree
                    actionID={action.id}
                    actions={actions}
                    direction="caused"
                    resolveLabel={resolveLabel}
                />
            </Box>

            {Object.keys(action.scratch).length > 0 ? (
                <Box marginTop={1} flexDirection="column">
                    <Text bold underline>
                        Scratch
                    </Text>
                    {Object.entries(action.scratch).map(([k, v]) => (
                        <Text key={k}>
                            <Text color="cyan">{k}: </Text>
                            <Text>{formatValue(v)}</Text>
                        </Text>
                    ))}
                </Box>
            ) : null}

            {props.length > 0 ? (
                <Box marginTop={1} flexDirection="column">
                    <Text bold underline>
                        Host properties
                    </Text>
                    {props.map(([k, v]) => (
                        <Text key={k}>
                            <Text color="magenta">{k}: </Text>
                            <Text>{formatValue(v)}</Text>
                        </Text>
                    ))}
                </Box>
            ) : null}
        </Box>
    );
}

function ParticipantRow({
    label,
    ids,
    resolveLabel
}: {
    label: string;
    ids: UID[];
    resolveLabel: LabelResolver;
}): React.ReactElement {
    return (
        <Text>
            <Text color="cyan">{fit(label, 14)}</Text>
            {ids.length === 0 ? (
                <Text dimColor>(none)</Text>
            ) : (
                <Text>{ids.map(resolveLabel).join(", ")}</Text>
            )}
        </Text>
    );
}

function BindingsTable({
    bindings,
    resolveLabel
}: {
    bindings: Record<string, unknown>;
    resolveLabel: LabelResolver;
}): React.ReactElement {
    const entries = Object.entries(bindings);
    if (entries.length === 0) {
        return <Text dimColor>(no bindings)</Text>;
    }
    return (
        <Box flexDirection="column">
            {entries.map(([role, value]) => (
                <Text key={role}>
                    <Text color="cyan">{fit(role, 14)}</Text>
                    <Text>{renderBinding(value, resolveLabel)}</Text>
                </Text>
            ))}
        </Box>
    );
}

function renderBinding(value: unknown, resolveLabel: LabelResolver): string {
    if (typeof value === "string") return resolveLabel(value);
    if (Array.isArray(value)) {
        return value
            .map((v) => (typeof v === "string" ? resolveLabel(v) : formatValue(v)))
            .join(", ");
    }
    return formatValue(value);
}

function getActionsMap(snapshot: VivSnapshot): Record<UID, ActionView> {
    const out: Record<UID, ActionView> = {};
    for (const entity of Object.values(snapshot.entities)) {
        if (entity.entityType === "action") out[entity.id] = entity as ActionView;
    }
    return out;
}

function pad2(n: number): string {
    return n.toString().padStart(2, "0");
}
