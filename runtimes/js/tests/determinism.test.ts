/**
 * Tests for host-supplied determinism.
 *
 * When the adapter exposes an `rng: () => number` function, the runtime threads
 * it through every random callsite (chance gates, role casting, candidate
 * shuffles, embargo ID generation). These tests pass a stub `rng` and assert
 * observable behavior that depends on its return values.
 */

import { beforeEach, describe, expect, it } from "vitest";

import { attemptAction, initializeVivRuntime } from "../src";
import { loadBundle, resetActionIDCounter } from "./fixtures/utils";
import { ALICE_ID, BOB_ID, setup } from "./fixtures/action-with-determinism-probes/setup";
import { INITIATOR_ID, setup as setupRoleCurves } from "./fixtures/action-with-random-role-counts/setup";

const bundle = loadBundle("action-with-determinism-probes");
const roleCurvesBundle = loadBundle("action-with-random-role-counts");

describe("host-supplied rng", () => {
    beforeEach(() => { resetActionIDCounter(); });

    it("threads the host rng through chance expressions", async () => {
        // First, an `rng` that always returns 0.3 must satisfy a 50% chance condition (0.3 < 0.5)
        const { adapter: passingAdapter } = setup();
        (passingAdapter as any).rng = (): number => 0.3;
        initializeVivRuntime({
            contentBundle: bundle,
            adapter: passingAdapter,
        });
        const passingResult = await attemptAction({
            actionName: "gamble",
            initiatorID: ALICE_ID,
            precastBindings: { actor: [ALICE_ID] },
        });
        expect(passingResult).not.toBeNull();
        // Now, an `rng` that always returns 0.7 must fail the same 50% chance condition (0.7 > 0.5)
        resetActionIDCounter();
        const { adapter: failingAdapter } = setup();
        (failingAdapter as any).rng = (): number => 0.7;
        initializeVivRuntime({
            contentBundle: bundle,
            adapter: failingAdapter,
        });
        const failingResult = await attemptAction({
            actionName: "gamble",
            initiatorID: ALICE_ID,
            precastBindings: { actor: [ALICE_ID] },
        });
        expect(failingResult).toBeNull();
    });

    it("threads the host rng through embargo ID generation", async () => {
        // `randomID()` draws 6 characters from a 62-character alphabet via `floor(rng() * 62)`.
        // With `rng` pinned at 0.5, each draw lands on index 31, which is "f" in
        // "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789", so the
        // recorded embargo ID must be "ffffff".
        const { state, adapter } = setup();
        (adapter as any).rng = (): number => 0.5;
        initializeVivRuntime({
            contentBundle: bundle,
            adapter,
        });
        await attemptAction({
            actionName: "announce",
            initiatorID: ALICE_ID,
            precastBindings: {
                speaker: [ALICE_ID],
                listener: [BOB_ID],
            },
        });
        const embargo = state.vivInternalState?.actionEmbargoes["announce"]?.[0];
        expect(embargo?.id).toBe("ffffff");
    });

    it("threads the host rng through optional-role chance directives", async () => {
        // The `recruits` role declares `n: 0-5 [50%]`, so each of 5 optional slots is filled by an
        // independent coin flip against a 0.5 threshold. With `rng` pinned at 0.3, every flip lands
        // below the threshold and all 5 slots fill.
        const { state: fillingState, adapter: fillingAdapter } = setupRoleCurves();
        (fillingAdapter as any).rng = (): number => 0.3;
        initializeVivRuntime({
            contentBundle: roleCurvesBundle,
            adapter: fillingAdapter,
        });
        await attemptAction({
            actionName: "recruit",
            initiatorID: INITIATOR_ID,
            precastBindings: { recruiter: [INITIATOR_ID] },
        });
        const fillingAction = fillingState.entities[fillingState.actions[0]] as any;
        expect(fillingAction.bindings.recruits).toHaveLength(5);
        // Now, with `rng` pinned at 0.7, every flip lands at or above the threshold and no
        // optional slot fills.
        resetActionIDCounter();
        const { state: skippingState, adapter: skippingAdapter } = setupRoleCurves();
        (skippingAdapter as any).rng = (): number => 0.7;
        initializeVivRuntime({
            contentBundle: roleCurvesBundle,
            adapter: skippingAdapter,
        });
        await attemptAction({
            actionName: "recruit",
            initiatorID: INITIATOR_ID,
            precastBindings: { recruiter: [INITIATOR_ID] },
        });
        const skippingAction = skippingState.entities[skippingState.actions[0]] as any;
        expect(skippingAction.bindings.recruits).toHaveLength(0);
    });

    it("threads the host rng through optional-role mean directives", async () => {
        // The `crowd` role declares `n: 2-10 [~5]`, for which the compiler derives sd = 2.08.
        // With `rng` pinned at 0.3, the Marsaglia polar method draws u = v = -0.4 and accepts
        // s = 0.32 on its first iteration, yielding a normal sample of ~2.78. Rounded, that gives
        // an effective max of 3, so the crowd contains 3 bystanders -- the 2 required by the
        // quorum plus 1 optional slot.
        const { state, adapter } = setupRoleCurves();
        (adapter as any).rng = (): number => 0.3;
        initializeVivRuntime({
            contentBundle: roleCurvesBundle,
            adapter,
        });
        await attemptAction({
            actionName: "rally",
            initiatorID: INITIATOR_ID,
            precastBindings: { leader: [INITIATOR_ID] },
        });
        const action = state.entities[state.actions[0]] as any;
        expect(action.bindings.crowd).toHaveLength(3);
    });
});
