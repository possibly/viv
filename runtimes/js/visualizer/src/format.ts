import type {
    ActionView,
    CharacterView,
    DiegeticTimestamp,
    EntityView,
    UID
} from "@siftystudio/viv-runtime";
import { EntityType } from "@siftystudio/viv-runtime";

/**
 * Viv-known field names per entity type. Used to split an EntityView's keys
 * into "structural" (rendered semantically by the pane) and "host-custom"
 * (rendered as opaque key/value pairs).
 */
const VIV_CHARACTER_FIELDS = new Set(["id", "entityType", "location", "memories"]);
const VIV_ITEM_FIELDS = new Set(["id", "entityType", "location", "inscriptions"]);
const VIV_LOCATION_FIELDS = new Set(["id", "entityType"]);
const VIV_ACTION_FIELDS = new Set([
    "id",
    "entityType",
    "name",
    "gloss",
    "report",
    "importance",
    "tags",
    "bindings",
    "scratch",
    "location",
    "timestamp",
    "timeOfDay",
    "causes",
    "caused",
    "ancestors",
    "descendants",
    "relayedActions",
    "initiator",
    "partners",
    "recipients",
    "bystanders",
    "active",
    "present"
]);

export function vivKnownFieldsFor(entityType: EntityType): Set<string> {
    switch (entityType) {
        case EntityType.Character:
            return VIV_CHARACTER_FIELDS;
        case EntityType.Item:
            return VIV_ITEM_FIELDS;
        case EntityType.Location:
            return VIV_LOCATION_FIELDS;
        case EntityType.Action:
            return VIV_ACTION_FIELDS;
        default:
            return new Set(["id", "entityType"]);
    }
}

/**
 * Returns the host-custom properties of an entity — everything that isn't a
 * field Viv knows about — so a detail pane can dump them verbatim.
 */
export function hostProperties(entity: EntityView): [string, unknown][] {
    const known = vivKnownFieldsFor(entity.entityType);
    const out: [string, unknown][] = [];
    for (const key of Object.keys(entity)) {
        if (!known.has(key)) out.push([key, (entity as Record<string, unknown>)[key]]);
    }
    out.sort((a, b) => a[0].localeCompare(b[0]));
    return out;
}

export interface LabelResolver {
    (uid: UID): string;
}

/**
 * Builds a label resolver using an optional host-defined field (e.g. "name")
 * on entities. Falls back to the UID when no label is available.
 */
export function makeLabelResolver(
    entities: Record<UID, EntityView>,
    labelField: string | null
): LabelResolver {
    if (labelField === null) {
        return (uid: UID) => uid;
    }
    return (uid: UID) => {
        const entity = entities[uid];
        if (entity === undefined) return uid;
        const value = (entity as Record<string, unknown>)[labelField];
        return typeof value === "string" && value.length > 0 ? value : uid;
    };
}

/**
 * Renders a timestamp as "T=<minutes>". Keeps it short enough to fit in
 * a column. Timestamps are diegetic minutes since the simulation's epoch.
 */
export function formatTimestamp(ts: DiegeticTimestamp): string {
    return `T=${ts}`;
}

/**
 * Renders a salience as a fixed-width bar + numeric value.
 */
export function formatSalience(salience: number, max = 1): string {
    const clamped = Math.max(0, Math.min(max, salience));
    const width = 10;
    const filled = Math.round((clamped / max) * width);
    const bar = "█".repeat(filled) + "·".repeat(width - filled);
    return `${bar} ${salience.toFixed(2)}`;
}

/**
 * Compact one-line summary of an action for list views.
 */
export function summarizeAction(action: ActionView, resolveLabel: LabelResolver): string {
    const initiator = resolveLabel(action.initiator);
    const tail = action.gloss ?? action.report ?? "";
    const compact = tail.length > 60 ? tail.slice(0, 57) + "..." : tail;
    return `${initiator} ${action.name}${compact ? `  — ${compact}` : ""}`;
}

/**
 * Character list row: "<label>  @<location-label>".
 */
export function summarizeCharacter(
    character: CharacterView,
    resolveLabel: LabelResolver
): string {
    const name = resolveLabel(character.id);
    const loc = resolveLabel(character.location);
    return `${name.padEnd(16)} @${loc}`;
}

/**
 * Pretty-prints a value (from hostProperties()) as a single-line string
 * suitable for a detail pane row. Keeps output short.
 */
export function formatValue(value: unknown): string {
    if (value === null) return "null";
    if (typeof value === "string") return JSON.stringify(value);
    if (typeof value === "number" || typeof value === "boolean") return String(value);
    if (Array.isArray(value)) {
        const s = JSON.stringify(value);
        return s.length > 80 ? s.slice(0, 77) + "..." : s;
    }
    const s = JSON.stringify(value);
    return s.length > 80 ? s.slice(0, 77) + "..." : s;
}

/**
 * Counts forgotten memories on a character.
 */
export function forgottenCount(character: CharacterView): number {
    let n = 0;
    for (const mem of Object.values(character.memories)) {
        if (mem.forgotten) n++;
    }
    return n;
}
