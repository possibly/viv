/**
 * Setup for the plan-trailing-conditional fixture.
 *
 * Creates two actors: one with `flag: true` and one with `flag: false`. Tests
 * precast-bind whichever actor exercises the branch they care about.
 */

import type { SetupResult } from "../utils";
import { addCharacter, addLocation, createTestAdapter, createTestState } from "../utils";

export const LOCATION_ID = "loc-home";
export const TRUE_ACTOR_ID = "cid-actor-true";
export const FALSE_ACTOR_ID = "cid-actor-false";

/**
 * Returns a fresh test state and adapter for the plan-trailing-conditional fixture.
 *
 * @returns An object containing the test state and a compatible adapter.
 */
export function setup(): SetupResult {
    const state = createTestState();
    addLocation(state, LOCATION_ID, "Home");
    addCharacter(state, TRUE_ACTOR_ID, "True Actor", LOCATION_ID, { flag: true });
    addCharacter(state, FALSE_ACTOR_ID, "False Actor", LOCATION_ID, { flag: false });
    const adapter = createTestAdapter(state);
    return { state, adapter };
}
