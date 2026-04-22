#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { render } from "ink";
import React from "react";

import { App } from "./app.js";
import { loadSnapshot } from "./snapshot.js";

interface ParsedArgs {
    snapshotPath: string;
    labelField: string | null;
    showHelp: boolean;
    showVersion: boolean;
}

const USAGE = `viv-viz — browse a Viv runtime snapshot as a TUI.

Usage:
  viv-viz <snapshot.json> [--label-field <field>]
  viv-viz --help | --version

Options:
  --label-field <field>   Host-entity field to use as display label (default: name).
                          Pass "" or --no-label-field to show UIDs verbatim.
  --help, -h              Show this help.
  --version               Print version.

See also:
  exportVivSnapshot() from @siftystudio/viv-visualizer/snapshot — produces
  the JSON file this tool consumes.
`;

export function parseArgs(argv: string[]): ParsedArgs | { error: string } {
    let snapshotPath: string | null = null;
    let labelField: string | null = "name";
    let showHelp = false;
    let showVersion = false;

    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i]!;
        if (arg === "--help" || arg === "-h") {
            showHelp = true;
        } else if (arg === "--version") {
            showVersion = true;
        } else if (arg === "--label-field") {
            const next = argv[++i];
            if (next === undefined) {
                return { error: "--label-field requires a value" };
            }
            labelField = next.length === 0 ? null : next;
        } else if (arg === "--no-label-field") {
            labelField = null;
        } else if (arg.startsWith("--")) {
            return { error: `Unknown option: ${arg}` };
        } else if (snapshotPath === null) {
            snapshotPath = arg;
        } else {
            return { error: `Unexpected argument: ${arg}` };
        }
    }

    if (!showHelp && !showVersion && snapshotPath === null) {
        return { error: "A snapshot path is required." };
    }

    return {
        snapshotPath: snapshotPath ?? "",
        labelField,
        showHelp,
        showVersion
    };
}

export async function main(argv: string[]): Promise<number> {
    const parsed = parseArgs(argv);
    if ("error" in parsed) {
        process.stderr.write(`${parsed.error}\n\n${USAGE}`);
        return 2;
    }
    if (parsed.showHelp) {
        process.stdout.write(USAGE);
        return 0;
    }
    if (parsed.showVersion) {
        process.stdout.write("viv-viz 0.1.0\n");
        return 0;
    }

    let snapshot;
    try {
        snapshot = await loadSnapshot(parsed.snapshotPath);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        process.stderr.write(`${message}\n`);
        return 1;
    }

    const { waitUntilExit } = render(
        React.createElement(App, { snapshot, labelField: parsed.labelField })
    );
    await waitUntilExit();
    return 0;
}

function isMainModule(moduleUrl: string, entry: string | undefined): boolean {
    if (entry === undefined) return false;
    const modulePath = fileURLToPath(moduleUrl);
    try {
        return realpathSync(entry) === modulePath;
    } catch {
        return entry === modulePath;
    }
}

if (isMainModule(import.meta.url, process.argv[1])) {
    main(process.argv.slice(2)).then(
        (code) => {
            process.exit(code);
        },
        (error) => {
            process.stderr.write(`Unexpected error: ${error instanceof Error ? error.message : String(error)}\n`);
            process.exit(1);
        }
    );
}
