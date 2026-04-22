#!/usr/bin/env node
import { render } from "ink";
import React from "react";

import { App } from "./app.js";
import {
    FileSnapshotSource,
    HttpSnapshotSource,
    IpcSnapshotSource,
    type SnapshotSource
} from "./source.js";

type SourceSpec =
    | { kind: "file"; path: string }
    | { kind: "http"; url: string }
    | { kind: "ipc"; path: string };

interface ParsedArgs {
    source: SourceSpec | null;
    labelField: string | null;
    pollIntervalMs: number;
    live: boolean;
    showHelp: boolean;
    showVersion: boolean;
}

const DEFAULT_POLL_MS = 1000;

const USAGE = `viv-viz — browse a Viv runtime snapshot as a TUI.

Usage:
  viv-viz <snapshot.json> [--label-field <field>]
  viv-viz --http <url> [--poll <ms>] [--no-watch] [--label-field <field>]
  viv-viz --ipc <path> [--poll <ms>] [--no-watch] [--label-field <field>]
  viv-viz --help | --version

Input modes (pick one):
  <snapshot.json>         Read a snapshot from a JSON file (one-shot).
  --http <url>            Fetch snapshots from an HTTP endpoint, e.g.
                          http://127.0.0.1:4477/snapshot. Updates live by
                          polling the endpoint every --poll ms.
  --ipc <path>            Connect to a Unix-domain socket / named pipe serving
                          line-delimited JSON snapshots. Updates live as the
                          server pushes new snapshots.

Options:
  --label-field <field>   Host-entity field to use as display label (default: name).
                          Pass "" or --no-label-field to show UIDs verbatim.
  --poll <ms>             Polling interval in ms for --http/--ipc (default: ${DEFAULT_POLL_MS}).
                          Set to 0 to disable polling entirely.
  --no-watch              One-shot: render the first snapshot and do not
                          subscribe to updates.
  --help, -h              Show this help.
  --version               Print version.

See also:
  exportVivSnapshot() from @siftystudio/viv-visualizer/snapshot — produces
  snapshot payloads in the shape this tool consumes.
  startHttpSnapshotServer() / startIpcSnapshotServer() from
  @siftystudio/viv-visualizer/server — host-side helpers that expose a live
  runtime over the --http / --ipc transports.
`;

export function parseArgs(argv: string[]): ParsedArgs | { error: string } {
    let filePath: string | null = null;
    let httpUrl: string | null = null;
    let ipcPath: string | null = null;
    let labelField: string | null = "name";
    let pollIntervalMs = DEFAULT_POLL_MS;
    let live = true;
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
        } else if (arg === "--http") {
            const next = argv[++i];
            if (next === undefined) {
                return { error: "--http requires a URL" };
            }
            httpUrl = next;
        } else if (arg === "--ipc") {
            const next = argv[++i];
            if (next === undefined) {
                return { error: "--ipc requires a socket path" };
            }
            ipcPath = next;
        } else if (arg === "--poll") {
            const next = argv[++i];
            if (next === undefined) {
                return { error: "--poll requires a value (ms)" };
            }
            const parsedMs = Number(next);
            if (!Number.isFinite(parsedMs) || parsedMs < 0) {
                return { error: `--poll must be a non-negative number, got ${next}` };
            }
            pollIntervalMs = parsedMs;
        } else if (arg === "--no-watch") {
            live = false;
        } else if (arg === "--watch") {
            live = true;
        } else if (arg.startsWith("--")) {
            return { error: `Unknown option: ${arg}` };
        } else if (filePath === null) {
            filePath = arg;
        } else {
            return { error: `Unexpected argument: ${arg}` };
        }
    }

    if (showHelp || showVersion) {
        return {
            source: null,
            labelField,
            pollIntervalMs,
            live,
            showHelp,
            showVersion
        };
    }

    const specified = [filePath !== null, httpUrl !== null, ipcPath !== null].filter(Boolean).length;
    if (specified === 0) {
        return { error: "A snapshot source is required: <snapshot.json>, --http <url>, or --ipc <path>." };
    }
    if (specified > 1) {
        return { error: "Pick only one of: <snapshot.json>, --http, --ipc." };
    }

    let source: SourceSpec;
    if (filePath !== null) {
        source = { kind: "file", path: filePath };
    } else if (httpUrl !== null) {
        source = { kind: "http", url: httpUrl };
    } else {
        source = { kind: "ipc", path: ipcPath! };
    }

    return {
        source,
        labelField,
        pollIntervalMs,
        live,
        showHelp,
        showVersion
    };
}

export function createSourceFromSpec(
    spec: SourceSpec,
    opts: { pollIntervalMs: number; live: boolean }
): SnapshotSource {
    const effectivePoll = opts.live ? opts.pollIntervalMs : 0;
    switch (spec.kind) {
        case "file":
            return new FileSnapshotSource(spec.path);
        case "http":
            return new HttpSnapshotSource(spec.url, { pollIntervalMs: effectivePoll });
        case "ipc":
            return new IpcSnapshotSource(spec.path, { pollIntervalMs: effectivePoll });
    }
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

    const source = createSourceFromSpec(parsed.source!, {
        pollIntervalMs: parsed.pollIntervalMs,
        live: parsed.live
    });

    let initial;
    try {
        initial = await source.getLatest();
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        process.stderr.write(`${message}\n`);
        await source.dispose();
        return 1;
    }

    const { waitUntilExit } = render(
        React.createElement(App, {
            snapshot: initial,
            labelField: parsed.labelField,
            source: parsed.live ? source : null
        })
    );
    try {
        await waitUntilExit();
    } finally {
        await source.dispose();
    }
    return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
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
