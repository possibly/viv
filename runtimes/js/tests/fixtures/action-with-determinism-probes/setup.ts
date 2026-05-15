/**
 * Setup for the action-with-determinism-probes fixture.
 *
 * Creates a world with one location and two characters, suitable for exercising
 * the runtime's random callsites (chance gates and embargo ID generation).
 */

import type { SetupResult } from "../utils";
import { addCharacter, addLocation, createTestAdapter, createTestState } from "../utils";

export const LOCATION_ID = "loc-square";
export const ALICE_ID = "cid-alice";
export const BOB_ID = "cid-bob";

export function setup(): SetupResult {
    const state = createTestState();
    addLocation(state, LOCATION_ID, "Square");
    addCharacter(state, ALICE_ID, "Alice", LOCATION_ID);
    addCharacter(state, BOB_ID, "Bob", LOCATION_ID);
    const adapter = createTestAdapter(state);
    return { state, adapter };
}
