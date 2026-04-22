import { readFile } from "node:fs/promises";

import type {
    ActionView,
    CharacterView,
    DiegeticTimestamp,
    EntityView,
    HostApplicationAdapter,
    ItemView,
    LocationView,
    UID,
    VivInternalState
} from "@siftystudio/viv-runtime";
import { EntityType } from "@siftystudio/viv-runtime";

/**
 * A JSON-serializable snapshot of a Viv-powered simulation at one point in time.
 *
 * Every field here corresponds to data already managed by the host app through
 * the HostApplicationAdapter; this type is a convention, not a new runtime surface.
 */
export interface VivSnapshot {
    readonly schemaVersion: string;
    readonly timestamp: DiegeticTimestamp;
    readonly entities: Record<UID, EntityView>;
    readonly vivInternalState: VivInternalState;
}

/**
 * Builds a VivSnapshot from a host application's adapter.
 *
 * Walks every known entity type, fetches each entity view, and bundles the
 * result with the current timestamp and the runtime's internal state. Safe
 * to call repeatedly; the snapshot is a deep structural copy as far as the
 * adapter's getEntityView and getVivInternalState choose to clone.
 *
 * Throws if the runtime has not yet initialized (no internal state).
 */
export async function exportVivSnapshot(
    adapter: HostApplicationAdapter,
    options: { schemaVersion?: string } = {}
): Promise<VivSnapshot> {
    const entities: Record<UID, EntityView> = {};
    const types: EntityType[] = [
        EntityType.Character,
        EntityType.Item,
        EntityType.Location,
        EntityType.Action
    ];
    for (const type of types) {
        const ids = await adapter.getEntityIDs(type);
        for (const id of ids) {
            entities[id] = await adapter.getEntityView(id);
        }
    }
    const vivInternalState = await adapter.getVivInternalState();
    if (vivInternalState === null) {
        throw new Error(
            "Cannot export Viv snapshot: the runtime has not been initialized yet " +
                "(no internal state has been persisted)."
        );
    }
    const timestamp = await adapter.getCurrentTimestamp();
    return {
        schemaVersion: options.schemaVersion ?? "unknown",
        timestamp,
        entities,
        vivInternalState
    };
}

/**
 * Loads a VivSnapshot from a JSON file and validates its shape well enough to
 * give clear errors before the TUI tries to render something it cannot handle.
 *
 * Does not deeply validate every field against the runtime schema; the goal
 * is to catch obvious mistakes like passing a content bundle or a half-written
 * host-app dump.
 */
export async function loadSnapshot(path: string): Promise<VivSnapshot> {
    let raw: string;
    try {
        raw = await readFile(path, "utf8");
    } catch (error) {
        const cause = error instanceof Error ? error.message : String(error);
        throw new Error(`Could not read snapshot file at ${path}: ${cause}`);
    }
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch (error) {
        const cause = error instanceof Error ? error.message : String(error);
        throw new Error(`Snapshot at ${path} is not valid JSON: ${cause}`);
    }
    return validateSnapshotShape(parsed, path);
}

function validateSnapshotShape(value: unknown, path: string): VivSnapshot {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        throw new Error(`Snapshot at ${path} must be a JSON object.`);
    }
    const obj = value as Record<string, unknown>;
    for (const key of ["timestamp", "entities", "vivInternalState"]) {
        if (!(key in obj)) {
            throw new Error(
                `Snapshot at ${path} is missing the required field "${key}". ` +
                    `Did you pass a content bundle by mistake?`
            );
        }
    }
    if (typeof obj["timestamp"] !== "number") {
        throw new Error(`Snapshot at ${path}: "timestamp" must be a number.`);
    }
    if (
        typeof obj["entities"] !== "object" ||
        obj["entities"] === null ||
        Array.isArray(obj["entities"])
    ) {
        throw new Error(`Snapshot at ${path}: "entities" must be an object keyed by UID.`);
    }
    if (
        typeof obj["vivInternalState"] !== "object" ||
        obj["vivInternalState"] === null ||
        Array.isArray(obj["vivInternalState"])
    ) {
        throw new Error(`Snapshot at ${path}: "vivInternalState" must be an object.`);
    }
    return {
        schemaVersion: typeof obj["schemaVersion"] === "string" ? obj["schemaVersion"] : "unknown",
        timestamp: obj["timestamp"] as DiegeticTimestamp,
        entities: obj["entities"] as Record<UID, EntityView>,
        vivInternalState: obj["vivInternalState"] as VivInternalState
    };
}

/**
 * Helpers for partitioning the entities map by type. The snapshot stores
 * all entities in one record because that's how the host adapter exposes
 * them; the panes want them grouped.
 */
export function partitionEntities(entities: Record<UID, EntityView>): {
    characters: CharacterView[];
    actions: ActionView[];
    locations: LocationView[];
    items: ItemView[];
} {
    const characters: CharacterView[] = [];
    const actions: ActionView[] = [];
    const locations: LocationView[] = [];
    const items: ItemView[] = [];
    for (const entity of Object.values(entities)) {
        switch (entity.entityType) {
            case EntityType.Character:
                characters.push(entity as CharacterView);
                break;
            case EntityType.Action:
                actions.push(entity as ActionView);
                break;
            case EntityType.Location:
                locations.push(entity as LocationView);
                break;
            case EntityType.Item:
                items.push(entity as ItemView);
                break;
            default:
                break;
        }
    }
    return { characters, actions, locations, items };
}
