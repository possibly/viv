import { describe, expect, it } from "vitest";

import {
    formatSalience,
    formatTimestamp,
    formatValue,
    forgottenCount,
    hostProperties,
    makeLabelResolver,
    vivKnownFieldsFor
} from "../src/format.js";

describe("makeLabelResolver", () => {
    const entities = {
        alice: { entityType: "character" as const, id: "alice", name: "Alice" },
        tavern: { entityType: "location" as const, id: "tavern", name: "The Tavern" }
    };

    it("returns the UID when labelField is null", () => {
        const resolve = makeLabelResolver(entities, null);
        expect(resolve("alice")).toBe("alice");
        expect(resolve("unknown")).toBe("unknown");
    });

    it("resolves using the requested host field when present", () => {
        const resolve = makeLabelResolver(entities, "name");
        expect(resolve("alice")).toBe("Alice");
        expect(resolve("tavern")).toBe("The Tavern");
    });

    it("falls back to the UID when the field is missing", () => {
        const resolve = makeLabelResolver(entities, "displayName");
        expect(resolve("alice")).toBe("alice");
    });

    it("falls back to the UID for unknown entities", () => {
        const resolve = makeLabelResolver(entities, "name");
        expect(resolve("unknown-id")).toBe("unknown-id");
    });
});

describe("hostProperties", () => {
    it("returns only fields Viv does not know about", () => {
        const character = {
            entityType: "character" as const,
            id: "alice",
            location: "tavern",
            memories: {},
            name: "Alice",
            mood: 3
        };
        const props = hostProperties(character);
        expect(props.map(([k]) => k).sort()).toEqual(["mood", "name"]);
    });
});

describe("vivKnownFieldsFor", () => {
    it("includes the expected structural fields per type", () => {
        expect(vivKnownFieldsFor("character" as never).has("memories")).toBe(true);
        expect(vivKnownFieldsFor("action" as never).has("causes")).toBe(true);
        expect(vivKnownFieldsFor("action" as never).has("descendants")).toBe(true);
    });
});

describe("formatters", () => {
    it("formats timestamps with a T= prefix", () => {
        expect(formatTimestamp(42 as never)).toBe("T=42");
    });

    it("renders salience as a bar + numeric", () => {
        const s = formatSalience(0.5);
        expect(s).toMatch(/0\.50$/);
        expect(s.length).toBeGreaterThan(10);
    });

    it("truncates long JSON values", () => {
        const longArray = Array.from({ length: 50 }).map((_, i) => `item-${i}`);
        expect(formatValue(longArray).endsWith("...")).toBe(true);
    });
});

describe("forgottenCount", () => {
    it("counts memories marked forgotten", () => {
        const character = {
            entityType: "character" as const,
            id: "x",
            location: "y",
            memories: {
                a: {
                    action: "a",
                    formationTimestamp: 0 as never,
                    salience: 0.1,
                    associations: [],
                    sources: [],
                    forgotten: true
                },
                b: {
                    action: "b",
                    formationTimestamp: 0 as never,
                    salience: 0.9,
                    associations: [],
                    sources: [],
                    forgotten: false
                }
            }
        };
        expect(forgottenCount(character)).toBe(1);
    });
});
