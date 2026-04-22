import { describe, expect, it } from "vitest";

import { parseArgs } from "../src/cli.js";

describe("parseArgs", () => {
    it("accepts a single snapshot path", () => {
        const got = parseArgs(["snap.json"]);
        expect(got).toMatchObject({
            source: { kind: "file", path: "snap.json" },
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

    it("returns an error when no source is given", () => {
        const got = parseArgs([]);
        expect(got).toMatchObject({ error: expect.stringMatching(/snapshot source/) });
    });

    it("returns an error on unknown flags", () => {
        const got = parseArgs(["snap.json", "--zap"]);
        expect(got).toMatchObject({ error: expect.stringMatching(/Unknown option/) });
    });

    it("accepts --help without requiring a path", () => {
        const got = parseArgs(["--help"]);
        expect(got).toMatchObject({ showHelp: true });
    });

    it("accepts --http <url> and defaults to polling at 1s", () => {
        const got = parseArgs(["--http", "http://127.0.0.1:4477/snapshot"]);
        expect(got).toMatchObject({
            source: { kind: "http", url: "http://127.0.0.1:4477/snapshot" },
            pollIntervalMs: 1000,
            live: true
        });
    });

    it("accepts --ipc <path> and --poll", () => {
        const got = parseArgs(["--ipc", "/tmp/viv.sock", "--poll", "250"]);
        expect(got).toMatchObject({
            source: { kind: "ipc", path: "/tmp/viv.sock" },
            pollIntervalMs: 250
        });
    });

    it("rejects negative --poll", () => {
        const got = parseArgs(["--http", "http://x", "--poll", "-5"]);
        expect(got).toMatchObject({ error: expect.stringMatching(/--poll/) });
    });

    it("rejects multiple source specifiers", () => {
        const got = parseArgs(["snap.json", "--http", "http://x"]);
        expect(got).toMatchObject({ error: expect.stringMatching(/only one of/) });
    });

    it("--no-watch disables live updates", () => {
        const got = parseArgs(["--http", "http://x", "--no-watch"]);
        expect(got).toMatchObject({ live: false });
    });
});
