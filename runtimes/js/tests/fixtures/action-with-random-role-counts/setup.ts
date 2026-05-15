/**
 * Setup for the action-with-random-role-counts fixture.
 *
 * Creates a world with one location, one designated initiator, and ten follower
 * candidates, suitable for exercising role cardinality curves (`[50%]` and `[~5]`)
 * where the casting pool must be large enough to fill the full upper bound.
 */

import type { SetupResult } from "../utils";
import { addCharacter, addLocation, createTestAdapter, createTestState } from "../utils";

export const LOCATION_ID = "loc-square";
export const INITIATOR_ID = "cid-init";
export const FOLLOWER_IDS: readonly string[] = [
    "cid-1",
    "cid-2",
    "cid-3",
    "cid-4",
    "cid-5",
    "cid-6",
    "cid-7",
    "cid-8",
    "cid-9",
    "cid-10",
];

export function setup(): SetupResult {
    const state = createTestState();
    addLocation(state, LOCATION_ID, "Square");
    addCharacter(state, INITIATOR_ID, "Initiator", LOCATION_ID);
    for (let i = 0; i < FOLLOWER_IDS.length; i++) {
        addCharacter(state, FOLLOWER_IDS[i], `Follower ${i + 1}`, LOCATION_ID);
    }
    const adapter = createTestAdapter(state);
    return { state, adapter };
}
