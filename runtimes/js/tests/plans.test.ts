/**
 * Tests for plan queueing and execution.
 */

import { describe, it, expect, beforeEach } from "vitest";

import { initializeVivRuntime, queuePlan, tickPlanner, selectAction } from "../src";
import { loadBundle, resetActionIDCounter } from "./fixtures/utils";
import { setup, PLOTTER_ID, TARGET_ID } from "./fixtures/plan-single-phase/setup";
import { setup as setupMulti, AGENT_ID } from "./fixtures/plan-multi-phase/setup";
import { setup as setupWait, PATIENT_ID } from "./fixtures/plan-with-wait/setup";
import { setup as setupReactionWindow, OPERATOR_ID } from "./fixtures/plan-with-reaction-window/setup";
import { setup as setupTrailingLoop, TRAVELER_ID } from "./fixtures/plan-trailing-loop/setup";
import {
    setup as setupTrailingConditional,
    FALSE_ACTOR_ID,
    TRUE_ACTOR_ID,
} from "./fixtures/plan-trailing-conditional/setup";

const bundle = loadBundle("plan-single-phase");
const multiBundle = loadBundle("plan-multi-phase");
const waitBundle = loadBundle("plan-with-wait");
const reactionWindowBundle = loadBundle("plan-with-reaction-window");
const trailingLoopBundle = loadBundle("plan-trailing-loop");
const trailingConditionalBundle = loadBundle("plan-trailing-conditional");

describe("plans", () => {
    beforeEach(() => {
        resetActionIDCounter();
    });

    it("queues a plan and returns its UID", async () => {
        const { adapter } = setup();
        initializeVivRuntime({
            contentBundle: bundle,
            adapter,
        });
        const planID = await queuePlan({
            planName: "scheme",
            precastBindings: {
                plotter: [PLOTTER_ID],
                target: [TARGET_ID],
            },
        });
        expect(planID).toBeDefined();
        expect(typeof planID).toBe("string");
    });

    it("executes a plan that queues a reserved action", async () => {
        const { state, adapter } = setup();
        initializeVivRuntime({
            contentBundle: bundle,
            adapter,
        });
        await queuePlan({
            planName: "scheme",
            precastBindings: {
                plotter: [PLOTTER_ID],
                target: [TARGET_ID],
            },
        });
        // Tick the planner to target and execute the queued plan
        await tickPlanner();
        // The plan should have queued the ambush action for the target.
        // Select for the plotter to perform the queued action.
        const result = await selectAction({ initiatorID: PLOTTER_ID });
        expect(result).not.toBeNull();
        expect(state.actions).toHaveLength(1);
        const actionView = state.entities[state.actions[0]] as any;
        expect(actionView.name).toBe("ambush");
    });

    it("immediately targets a plan when urgent is set", async () => {
        const { state, adapter } = setup();
        initializeVivRuntime({
            contentBundle: bundle,
            adapter,
        });
        await queuePlan({
            planName: "scheme",
            precastBindings: {
                plotter: [PLOTTER_ID],
                target: [TARGET_ID],
            },
            urgent: true,
        });
        // No tickPlanner call -- the plan should have been immediately targeted
        // upon queueing, so the ambush action should already be queued
        const result = await selectAction({ initiatorID: PLOTTER_ID });
        expect(result).not.toBeNull();
        expect(state.actions).toHaveLength(1);
        const actionView = state.entities[state.actions[0]] as any;
        expect(actionView.name).toBe("ambush");
    });

    it("throws for an unknown plan name", async () => {
        const { adapter } = setup();
        initializeVivRuntime({
            contentBundle: bundle,
            adapter,
        });
        await expect(
            queuePlan({ planName: "nonexistent" })
        ).rejects.toThrow("Cannot queue plan");
    });
});

describe("multi-phase plans", () => {
    beforeEach(() => {
        resetActionIDCounter();
    });

    it("advances through phases to completion", async () => {
        const { state, adapter } = setupMulti();
        initializeVivRuntime({
            contentBundle: multiBundle,
            adapter,
        });
        await queuePlan({
            planName: "operation",
            precastBindings: { agent: [AGENT_ID] },
        });
        // Phase 1: queue prepare action
        await tickPlanner();
        await selectAction({ initiatorID: AGENT_ID });
        expect(state.actions).toHaveLength(1);
        expect((state.entities[state.actions[0]] as any).name).toBe("prepare");
        // Phase 2: queue execute action
        await tickPlanner();
        await selectAction({ initiatorID: AGENT_ID });
        expect(state.actions).toHaveLength(2);
        expect((state.entities[state.actions[1]] as any).name).toBe("execute");
    });

    it("resumes a plan after a wait deadline elapses", async () => {
        const { state, adapter } = setupWait();
        initializeVivRuntime({
            contentBundle: waitBundle,
            adapter,
        });
        await queuePlan({
            planName: "rest-plan",
            precastBindings: { patient: [PATIENT_ID] },
        });
        // Tick at timestamp 0 -- the wait has a 3-day timeout (4320 minutes), so it should block
        await tickPlanner();
        expect(state.actions).toHaveLength(0);
        // Fast-forward past the deadline
        state.timestamp = 5000;
        // Tick again -- the wait should clear and the plan should queue the recover action
        await tickPlanner();
        await selectAction({ initiatorID: PATIENT_ID });
        expect(state.actions).toHaveLength(1);
        expect((state.entities[state.actions[0]] as any).name).toBe("recover");
    });

    it("resumes a plan after all reaction-window constructs succeed", async () => {
        const { state, adapter } = setupReactionWindow();
        initializeVivRuntime({
            contentBundle: reactionWindowBundle,
            adapter,
        });
        await queuePlan({
            planName: "parallel-tasks",
            precastBindings: { operator: [OPERATOR_ID] },
        });
        // Tick -- the plan queues task-a and task-b, then blocks on the reaction window
        await tickPlanner();
        expect(state.actions).toHaveLength(0);
        // Perform the queued actions
        await selectAction({ initiatorID: OPERATOR_ID });
        await selectAction({ initiatorID: OPERATOR_ID });
        expect(state.actions).toHaveLength(2);
        // Tick again -- the reaction window should see both constructs succeeded and resolve the plan
        await tickPlanner();
        // The plan had no next phase after dispatch, so it should have succeeded.
        // Verify no further actions are queued.
        const result = await selectAction({ initiatorID: OPERATOR_ID });
        expect(result).toBeNull();
    });

    it("terminates on fail without advancing to further phases", async () => {
        const { state, adapter } = setupMulti();
        initializeVivRuntime({
            contentBundle: multiBundle,
            adapter,
        });
        await queuePlan({
            planName: "doomed",
            precastBindings: { agent: [AGENT_ID] },
        });
        // Tick planner -- plan should queue prepare then fail
        await tickPlanner();
        await selectAction({ initiatorID: AGENT_ID });
        expect(state.actions).toHaveLength(1);
        expect((state.entities[state.actions[0]] as any).name).toBe("prepare");
        // Tick again -- plan should be terminated, nothing more queued
        await tickPlanner();
        const result = await selectAction({ initiatorID: AGENT_ID });
        expect(result).toBeNull();
        expect(state.actions).toHaveLength(1);
    });
});

describe("plans whose phases end in loops", () => {
    beforeEach(() => {
        resetActionIDCounter();
    });

    it("resolves a single-phase plan whose only phase ends in a loop", async () => {
        const { state, adapter } = setupTrailingLoop();
        initializeVivRuntime({
            contentBundle: trailingLoopBundle,
            adapter,
        });
        await queuePlan({
            planName: "tour-once",
            precastBindings: { traveler: [TRAVELER_ID] },
        });
        // Tick the planner -- the loop queues one visit action per destination
        await tickPlanner();
        // Drain the queued visits
        for (let i = 0; i < 3; i++) {
            await selectAction({ initiatorID: TRAVELER_ID });
        }
        expect(state.actions).toHaveLength(3);
        for (const actionID of state.actions) {
            expect((state.entities[actionID] as any).name).toBe("visit");
        }
    });

    it("advances past a non-final phase whose tape ends in a loop", async () => {
        const { state, adapter } = setupTrailingLoop();
        initializeVivRuntime({
            contentBundle: trailingLoopBundle,
            adapter,
        });
        await queuePlan({
            planName: "tour-and-finish",
            precastBindings: { traveler: [TRAVELER_ID] },
        });
        // Tick the planner -- phase one runs the loop, phase two queues finish
        await tickPlanner();
        // Drain the three visits plus the finish
        for (let i = 0; i < 4; i++) {
            await selectAction({ initiatorID: TRAVELER_ID });
        }
        expect(state.actions).toHaveLength(4);
        const actionNames = state.actions.map(id => (state.entities[id] as any).name);
        expect(actionNames.filter(name => name === "visit")).toHaveLength(3);
        expect(actionNames.filter(name => name === "finish")).toHaveLength(1);
    });
});

describe("plans whose phases end in conditionals", () => {
    beforeEach(() => {
        resetActionIDCounter();
    });

    it("resolves a single-phase plan whose only phase ends in `if` (condition true)", async () => {
        const { state, adapter } = setupTrailingConditional();
        initializeVivRuntime({
            contentBundle: trailingConditionalBundle,
            adapter,
        });
        await queuePlan({
            planName: "trailing-if",
            precastBindings: { actor: [TRUE_ACTOR_ID] },
        });
        // Tick the planner -- the if-branch fires and queues body
        await tickPlanner();
        for (let i = 0; i < 2; i++) {
            await selectAction({ initiatorID: TRUE_ACTOR_ID });
        }
        expect(state.actions).toHaveLength(2);
        const actionNames = state.actions.map(id => (state.entities[id] as any).name);
        expect(actionNames).toContain("gate");
        expect(actionNames).toContain("body");
    });

    it("resolves a single-phase plan whose only phase ends in `if` (condition false)", async () => {
        const { state, adapter } = setupTrailingConditional();
        initializeVivRuntime({
            contentBundle: trailingConditionalBundle,
            adapter,
        });
        await queuePlan({
            planName: "trailing-if",
            precastBindings: { actor: [FALSE_ACTOR_ID] },
        });
        // Tick the planner -- the if-branch is skipped, only gate is queued
        await tickPlanner();
        await selectAction({ initiatorID: FALSE_ACTOR_ID });
        expect(state.actions).toHaveLength(1);
        expect((state.entities[state.actions[0]] as any).name).toBe("gate");
    });

    it("resolves a single-phase plan whose only phase ends in `if/else` (if-branch taken)", async () => {
        const { state, adapter } = setupTrailingConditional();
        initializeVivRuntime({
            contentBundle: trailingConditionalBundle,
            adapter,
        });
        await queuePlan({
            planName: "trailing-if-else",
            precastBindings: { actor: [TRUE_ACTOR_ID] },
        });
        // Tick the planner -- the if-branch fires, the else-branch is skipped
        await tickPlanner();
        for (let i = 0; i < 2; i++) {
            await selectAction({ initiatorID: TRUE_ACTOR_ID });
        }
        expect(state.actions).toHaveLength(2);
        const actionNames = state.actions.map(id => (state.entities[id] as any).name);
        expect(actionNames).toContain("gate");
        expect(actionNames).toContain("body");
        expect(actionNames).not.toContain("alt");
    });

    it("resolves a single-phase plan whose only phase ends in `if/else` (else-branch taken)", async () => {
        const { state, adapter } = setupTrailingConditional();
        initializeVivRuntime({
            contentBundle: trailingConditionalBundle,
            adapter,
        });
        await queuePlan({
            planName: "trailing-if-else",
            precastBindings: { actor: [FALSE_ACTOR_ID] },
        });
        // Tick the planner -- the else-branch fires, the if-branch is skipped
        await tickPlanner();
        for (let i = 0; i < 2; i++) {
            await selectAction({ initiatorID: FALSE_ACTOR_ID });
        }
        expect(state.actions).toHaveLength(2);
        const actionNames = state.actions.map(id => (state.entities[id] as any).name);
        expect(actionNames).toContain("gate");
        expect(actionNames).toContain("alt");
        expect(actionNames).not.toContain("body");
    });

    it("advances past a non-final phase whose tape ends in `if` (condition true)", async () => {
        const { state, adapter } = setupTrailingConditional();
        initializeVivRuntime({
            contentBundle: trailingConditionalBundle,
            adapter,
        });
        await queuePlan({
            planName: "trailing-if-then-finish",
            precastBindings: { actor: [TRUE_ACTOR_ID] },
        });
        // Tick the planner -- phase one runs the if-branch, phase two queues finish
        await tickPlanner();
        for (let i = 0; i < 3; i++) {
            await selectAction({ initiatorID: TRUE_ACTOR_ID });
        }
        expect(state.actions).toHaveLength(3);
        const actionNames = state.actions.map(id => (state.entities[id] as any).name);
        expect(actionNames).toContain("gate");
        expect(actionNames).toContain("body");
        expect(actionNames).toContain("finish");
    });

    it("executes an instruction following an `if` in the same phase (condition true)", async () => {
        const { state, adapter } = setupTrailingConditional();
        initializeVivRuntime({
            contentBundle: trailingConditionalBundle,
            adapter,
        });
        await queuePlan({
            planName: "if-with-tail",
            precastBindings: { actor: [TRUE_ACTOR_ID] },
        });
        // Tick the planner -- the if-branch fires and queues body, then the trailing instruction queues finish
        await tickPlanner();
        for (let i = 0; i < 3; i++) {
            await selectAction({ initiatorID: TRUE_ACTOR_ID });
        }
        expect(state.actions).toHaveLength(3);
        const actionNames = state.actions.map(id => (state.entities[id] as any).name);
        expect(actionNames).toContain("gate");
        expect(actionNames).toContain("body");
        expect(actionNames).toContain("finish");
    });
});
