#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { render } from "ink";
import React from "react";

import { App } from "./app.js";
import { DEFAULT_HISTORY_CAPACITY, SnapshotRing } from "./history.js";
import {
    FileSnapshotSource,
    HttpSnapshotSource,
    IpcSnapshotSource,
    RecordingSnapshotSource,
    ReplaySnapshotSource,
    type SnapshotSource
} from "./source.js";

type SourceSpec =
    | { kind: "file"; path: string }
    | { kind: "http"; url: string }
    | { kind: "ipc"; path: string }
    | { kind: "replay"; path: string };

interface ParsedArgs {
    source: SourceSpec | null;
    labelField: string | null;
    pollIntervalMs: number;
    live: boolean;
    historyCapacity: number;
    recordPath: string | null;
    showHelp: boolean;
    showVersion: boolean;
}

const DEFAULT_POLL_MS = 1000;

const USAGE = `viv-viz — browse a Viv runtime snapshot as a TUI.

Usage:
  viv-viz <snapshot.json> [--label-field <field>]
  viv-viz --http <url> [--poll <ms>] [--no-watch] [--label-field <field>]
  viv-viz --ipc <path> [--poll <ms>] [--no-watch] [--label-field <field>]
  viv-viz --replay <path.jsonl> [--label-field <field>] [--history <N>]
  viv-viz --help | --version

Input modes (pick one):
  <snapshot.json>         Read a snapshot from a JSON file (one-shot).
  --http <url>            Fetch snapshots from an HTTP endpoint, e.g.
                          http://127.0.0.1:4477/snapshot. Updates live by
                          polling the endpoint every --poll ms.
  --ipc <path>            Connect to a Unix-domain socket / named pipe serving
                          line-delimited JSON snapshots. Updates live as the
                          server pushes new snapshots.
  --replay <path.jsonl>   Replay a previously-recorded JSONL dump. The whole
                          file is loaded into the history ring; bracket keys
                          let you step through frames.

Options:
  --label-field <field>   Host-entity field to use as display label (default: name).
                          Pass "" or --no-label-field to show UIDs verbatim.
  --poll <ms>             Polling interval in ms for --http/--ipc (default: ${DEFAULT_POLL_MS}).
                          Set to 0 to disable polling entirely.
  --no-watch              One-shot: render the first snapshot and do not
                          subscribe to updates.
  --history <N>           Retain at most N snapshots in the history ring
                          (default: ${DEFAULT_HISTORY_CAPACITY}). Must be >= 1.
  --record <path.jsonl>   Write every received snapshot to a JSONL file for
                          later inspection with --replay. Works with any
                          live source (--http / --ipc).
  --help, -h              Show this help.
  --version               Print version.

Navigation (in the TUI):
  tab / shift+tab         cycle panes
  [ / ]                   step one frame back / forward
  { / }                   jump to oldest retained frame / latest
  p                       toggle pause (freeze view on current frame)
  h                       in Memories pane, toggle per-memory history view
  / , esc, q              filter, clear filter, quit

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
    let replayPath: string | null = null;
    let labelField: string | null = "name";
    let pollIntervalMs = DEFAULT_POLL_MS;
    let historyCapacity = DEFAULT_HISTORY_CAPACITY;
    let recordPath: string | null = null;
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
        } else if (arg === "--replay") {
            const next = argv[++i];
            if (next === undefined) {
                return { error: "--replay requires a JSONL path" };
            }
            replayPath = next;
        } else if (arg === "--record") {
            const next = argv[++i];
            if (next === undefined) {
                return { error: "--record requires a JSONL path" };
            }
            recordPath = next;
        } else if (arg === "--history") {
            const next = argv[++i];
            if (next === undefined) {
                return { error: "--history requires a value (count)" };
            }
            const parsed = Number(next);
            if (!Number.isFinite(parsed) || parsed < 1) {
                return { error: `--history must be a positive integer, got ${next}` };
            }
            historyCapacity = Math.floor(parsed);
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
            historyCapacity,
            recordPath,
            showHelp,
            showVersion
        };
    }

    const specified = [
        filePath !== null,
        httpUrl !== null,
        ipcPath !== null,
        replayPath !== null
    ].filter(Boolean).length;
    if (specified === 0) {
        return {
            error:
                "A snapshot source is required: <snapshot.json>, --http <url>, --ipc <path>, or --replay <path.jsonl>."
        };
    }
    if (specified > 1) {
        return { error: "Pick only one of: <snapshot.json>, --http, --ipc, --replay." };
    }

    if (recordPath !== null && (filePath !== null || replayPath !== null)) {
        return { error: "--record only makes sense with a live source (--http / --ipc)." };
    }

    let source: SourceSpec;
    if (filePath !== null) {
        source = { kind: "file", path: filePath };
    } else if (httpUrl !== null) {
        source = { kind: "http", url: httpUrl };
    } else if (ipcPath !== null) {
        source = { kind: "ipc", path: ipcPath };
    } else {
        source = { kind: "replay", path: replayPath! };
    }

    return {
        source,
        labelField,
        pollIntervalMs,
        live,
        historyCapacity,
        recordPath,
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
        case "replay":
            return new ReplaySnapshotSource(spec.path);
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

    const rawSource = createSourceFromSpec(parsed.source!, {
        pollIntervalMs: parsed.pollIntervalMs,
        live: parsed.live
    });
    const source: SnapshotSource =
        parsed.recordPath !== null
            ? new RecordingSnapshotSource(rawSource, parsed.recordPath)
            : rawSource;

    let initial;
    try {
        initial = await source.getLatest();
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        process.stderr.write(`${message}\n`);
        await source.dispose();
        return 1;
    }

    const ring = new SnapshotRing(parsed.historyCapacity);
    ring.append(initial);

    const { waitUntilExit } = render(
        React.createElement(App, {
            snapshot: initial,
            labelField: parsed.labelField,
            source: parsed.live ? source : null,
            history: ring
        })
    );
    try {
        await waitUntilExit();
    } finally {
        await source.dispose();
    }
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
