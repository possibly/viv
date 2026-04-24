import { initializeVivRuntime, selectAction, EntityType } from "./viv-runtime.js";

const statusEl = document.getElementById("status");
const chronicleEl = document.getElementById("chronicle");

const setIn = (obj, path, value) => {
    const parts = Array.isArray(path) ? path : String(path).split(".");
    let cur = obj;
    for (let i = 0; i < parts.length - 1; i++) {
        const k = parts[i];
        if (cur[k] == null || typeof cur[k] !== "object") cur[k] = {};
        cur = cur[k];
    }
    cur[parts[parts.length - 1]] = value;
};

const STATE = {
    timestamp: 0,
    entities: {},
    characters: [],
    locations: [],
    items: [],
    actions: [],
    vivInternalState: null,
};

const ADAPTER = {
    provisionActionID: () => crypto.randomUUID(),
    getEntityView: (id) => {
        if (STATE.entities[id] === undefined) throw new Error(`no entity: ${id}`);
        return structuredClone(STATE.entities[id]);
    },
    getEntityLabel: (id) => {
        if (STATE.entities[id] === undefined) throw new Error(`no entity: ${id}`);
        return STATE.entities[id].name;
    },
    updateEntityProperty: (id, path, value) => {
        if (STATE.entities[id] === undefined) throw new Error(`no entity: ${id}`);
        setIn(STATE.entities[id], path, value);
    },
    saveActionData: (id, data) => {
        if (STATE.entities[id] === undefined) STATE.actions.push(id);
        STATE.entities[id] = data;
    },
    getCurrentTimestamp: () => STATE.timestamp,
    getEntityIDs: (type, locationID) => {
        if (locationID) {
            if (type === EntityType.Character) {
                return STATE.characters.filter((id) => STATE.entities[id].location === locationID);
            }
            if (type === EntityType.Item) {
                return STATE.items.filter((id) => STATE.entities[id].location === locationID);
            }
            throw new Error(`invalid type for location query: ${type}`);
        }
        switch (type) {
            case EntityType.Character: return [...STATE.characters];
            case EntityType.Item: return [...STATE.items];
            case EntityType.Location: return [...STATE.locations];
            case EntityType.Action: return [...STATE.actions];
            default: throw new Error(`invalid entity type: ${type}`);
        }
    },
    getVivInternalState: () => structuredClone(STATE.vivInternalState),
    saveVivInternalState: (s) => { STATE.vivInternalState = structuredClone(s); },
    saveCharacterMemory: (characterID, actionID, memory) => {
        STATE.entities[characterID].memories[actionID] = memory;
    },
    saveItemInscriptions: (itemID, inscriptions) => {
        STATE.entities[itemID].inscriptions = inscriptions;
    },
    debug: { validateAPICalls: true, watchlists: {} },
};

function createWorld() {
    const locationID = "tavern";
    STATE.locations.push(locationID);
    STATE.entities[locationID] = { entityType: EntityType.Location, id: locationID, name: "The Tavern" };
    for (const [id, name] of [["alice", "Alice"], ["bob", "Bob"], ["carol", "Carol"]]) {
        STATE.characters.push(id);
        STATE.entities[id] = {
            entityType: EntityType.Character,
            id,
            name,
            location: locationID,
            mood: 0,
            memories: {},
        };
    }
}

async function main() {
    statusEl.textContent = "fetching bundle…";
    const bundle = await fetch("./bundle.json").then((r) => r.json());

    statusEl.textContent = "initializing runtime…";
    initializeVivRuntime({ contentBundle: bundle, adapter: ADAPTER });

    createWorld();

    statusEl.textContent = "simulating…";
    for (let t = 0; t < 3; t++) {
        for (const cid of STATE.characters) {
            await selectAction({ initiatorID: cid });
        }
        STATE.timestamp += 10;
    }

    const lines = ["=== Chronicle ==="];
    for (const actionID of STATE.actions) {
        const action = STATE.entities[actionID];
        const summary = action.report ?? action.gloss ?? "(no summary)";
        lines.push(`  [T=${action.timestamp}] ${summary}`);
    }
    chronicleEl.textContent = lines.join("\n");
    statusEl.textContent = `done — ${STATE.actions.length} actions`;
    // Signal for CDP harness:
    window.__VIV_DONE__ = { actionCount: STATE.actions.length, chronicle: lines };
    console.log("VIV_DONE", JSON.stringify(window.__VIV_DONE__));
}

main().catch((err) => {
    console.error(err);
    statusEl.className = "err";
    statusEl.textContent = `error: ${err.message}`;
    chronicleEl.textContent = String(err.stack || err);
    window.__VIV_DONE__ = { error: String(err.stack || err) };
});
