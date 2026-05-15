/**
 * Setup for the plan-trailing-loop fixture.
 *
 * Creates a traveler whose `destinations` property is an array of three other
 * character IDs. The plans iterate over that array in a phase-terminal loop.
 */

import type { SetupResult } from "../utils";
import { addCharacter, addLocation, createTestAdapter, createTestState } from "../utils";

export const LOCATION_ID = "loc-home";
export const TRAVELER_ID = "cid-traveler";
export const DEST_A_ID = "cid-dest-a";
export const DEST_B_ID = "cid-dest-b";
export const DEST_C_ID = "cid-dest-c";

/**
 * Returns a fresh test state and adapter for the plan-trailing-loop fixture.
 *
 * @returns An object containing the test state and a compatible adapter.
 */
export function setup(): SetupResult {
    const state = createTestState();
    addLocation(state, LOCATION_ID, "Home");
    addCharacter(state, DEST_A_ID, "Destination A", LOCATION_ID);
    addCharacter(state, DEST_B_ID, "Destination B", LOCATION_ID);
    addCharacter(state, DEST_C_ID, "Destination C", LOCATION_ID);
    addCharacter(state, TRAVELER_ID, "Traveler", LOCATION_ID, {
        destinations: [DEST_A_ID, DEST_B_ID, DEST_C_ID],
    });
    const adapter = createTestAdapter(state);
    return { state, adapter };
}
