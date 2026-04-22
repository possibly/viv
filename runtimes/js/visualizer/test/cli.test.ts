import { describe, expect, it } from "vitest";

import { parseArgs } from "../src/cli.js";

describe("parseArgs", () => {
    it("accepts a single snapshot path", () => {
        const got = parseArgs(["snap.json"]);
        expect(got).toMatchObject({
            snapshotPath: "snap.json",
            labelField: "name",
            showHelp: false,
            showVersion: false
        });
    });

    it("accepts --label-field", () => {
        const got = parseArgs(["snap.json", "--label-field", "displayName"]);
        expect(got).toMatchObject({ labelField: "displayName" });
    });

    it("accepts --no-label-field to show UIDs", () => {
        const got = parseArgs(["snap.json", "--no-label-field"]);
        expect(got).toMatchObject({ labelField: null });
    });

    it("returns an error when no path is given", () => {
        const got = parseArgs([]);
        expect(got).toMatchObject({ error: expect.stringMatching(/snapshot path/) });
    });

    it("returns an error on unknown flags", () => {
        const got = parseArgs(["snap.json", "--zap"]);
        expect(got).toMatchObject({ error: expect.stringMatching(/Unknown option/) });
    });

    it("accepts --help without requiring a path", () => {
        const got = parseArgs(["--help"]);
        expect(got).toMatchObject({ showHelp: true });
    });
});
