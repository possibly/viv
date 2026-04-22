import { Box, Text } from "ink";
import React from "react";

import type {
    ActionQueue,
    PlanQueue,
    QueuedAction,
    QueuedActionSelector,
    QueuedPlan,
    QueuedPlanSelector,
    UID
} from "@siftystudio/viv-runtime";
import { QueuedConstructDiscriminator } from "@siftystudio/viv-runtime";

import { type LabelResolver } from "../format.js";
import type { VivSnapshot } from "../snapshot.js";

export interface QueuesPaneProps {
    snapshot: VivSnapshot;
    resolveLabel: LabelResolver;
    filter: string;
}

/**
 * Shows the two queue stores held in VivInternalState:
 *   - actionQueues: per-character priority queue of actions/action-selectors
 *   - planQueue:   global FIFO of plans/plan-selectors
 *
 * Read-only view. Filter matches against character labels and construct names.
 */
export function QueuesPane({
    snapshot,
    resolveLabel,
    filter
}: QueuesPaneProps): React.ReactElement {
    const actionQueues = snapshot.vivInternalState.actionQueues ?? {};
    const planQueue = snapshot.vivInternalState.planQueue ?? [];
    const needle = filter.trim().toLowerCase();

    const characterIDs = Object.keys(actionQueues).filter((characterID) => {
        if (needle.length === 0) return true;
        if (characterID.toLowerCase().includes(needle)) return true;
        if (resolveLabel(characterID).toLowerCase().includes(needle)) return true;
        return actionQueues[characterID]!.some((q) =>
            q.constructName.toLowerCase().includes(needle)
        );
    });
    characterIDs.sort((a, b) => resolveLabel(a).localeCompare(resolveLabel(b)));

    return (
        <Box flexDirection="column" flexGrow={1}>
            <Text bold underline>
                Action queues (per character)
            </Text>
            {characterIDs.length === 0 ? (
                <Text dimColor>(no characters have queued actions)</Text>
            ) : (
                characterIDs.map((characterID) => (
                    <CharacterQueue
                        key={characterID}
                        characterID={characterID}
                        queue={actionQueues[characterID]!}
                        resolveLabel={resolveLabel}
                    />
                ))
            )}

            <Box marginTop={1} flexDirection="column">
                <Text bold underline>
                    Plan queue (global)
                </Text>
                <PlanQueueList queue={planQueue} resolveLabel={resolveLabel} filter={needle} />
            </Box>
        </Box>
    );
}

function CharacterQueue({
    characterID,
    queue,
    resolveLabel
}: {
    characterID: UID;
    queue: ActionQueue;
    resolveLabel: LabelResolver;
}): React.ReactElement {
    return (
        <Box flexDirection="column" marginTop={1}>
            <Text>
                <Text color="cyan" bold>
                    {resolveLabel(characterID)}
                </Text>
                <Text dimColor>{`  (${queue.length} queued)`}</Text>
            </Text>
            {queue.length === 0 ? (
                <Text dimColor>  (empty)</Text>
            ) : (
                queue.map((q, i) => (
                    <Text key={q.id}>
                        {`  ${String(i).padStart(2, " ")}. `}
                        {q.urgent ? <Text color="red">! </Text> : <Text>  </Text>}
                        <Text>{describeAction(q)}</Text>
                    </Text>
                ))
            )}
        </Box>
    );
}

function PlanQueueList({
    queue,
    resolveLabel,
    filter
}: {
    queue: PlanQueue;
    resolveLabel: LabelResolver;
    filter: string;
}): React.ReactElement {
    const filtered = filter.length === 0
        ? queue
        : queue.filter((q) => q.constructName.toLowerCase().includes(filter));
    if (filtered.length === 0) {
        return <Text dimColor>(empty)</Text>;
    }
    return (
        <Box flexDirection="column">
            {filtered.map((q, i) => (
                <Text key={q.id}>
                    {`  ${String(i).padStart(2, " ")}. `}
                    {q.urgent ? <Text color="red">! </Text> : <Text>  </Text>}
                    <Text>{describePlan(q, resolveLabel)}</Text>
                </Text>
            ))}
        </Box>
    );
}

function describeAction(q: QueuedAction | QueuedActionSelector): string {
    const kind =
        q.type === QueuedConstructDiscriminator.Action ? "action" : "action-selector";
    return `[${kind}] ${q.constructName}  pri=${q.priority}`;
}

function describePlan(q: QueuedPlan | QueuedPlanSelector, resolveLabel: LabelResolver): string {
    const kind = q.type === QueuedConstructDiscriminator.Plan ? "plan" : "plan-selector";
    const roles = Object.entries(q.precastBindings);
    const bindings =
        roles.length === 0
            ? ""
            : `  { ${roles
                  .map(([role, value]) => {
                      const vals = Array.isArray(value) ? value : [value];
                      const labels = vals
                          .map((v) => (typeof v === "string" ? resolveLabel(v) : String(v)))
                          .join(", ");
                      return `${role}: ${labels}`;
                  })
                  .join("; ")} }`;
    return `[${kind}] ${q.constructName}${bindings}`;
}
