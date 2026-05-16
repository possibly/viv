# viv-demos-wip: Structure Plan

## Goal

A new repo with multiple demo subfolders, each with their own viv host app and viv
simulation code, sharing a single reference to the browser runtime from `possibly/viv`.
Each demo gets its own GitHub Pages sub-URL; the repo root serves as a landing page
linking to all of them.

---

## Recommended folder structure

    viv-demos-wip/
      viv/                      ← git submodule → possibly/viv @ browser/runtime
      shared/
        viv-runtime.js          ← built from viv/dist/index.browser.js (build artifact, tracked)
        ui/
          chronicle.js          ← shared debug UI: scrolling event log
          state-inspector.js    ← shared debug UI: live entity/world state tree
          debug-panel.js        ← composes the above into a collapsible overlay
          shared.css            ← common styles (debug panel, fonts, reset)
      demos/
        01-hello-world/
          index.html            ← served at /demos/01-hello-world/
          main.js               ← demo-specific host app and UI
          style.css             ← demo-specific styles
          sim.viv               ← viv source (checked in)
          bundle.json           ← pre-compiled bytecode (checked in)
        02-chatbot/
          index.html            ← served at /demos/02-chatbot/
          main.js
          style.css
          sim.viv
          bundle.json
          ui/                   ← demo-specific UI components if needed
            chat-panel.js
      index.html                ← landing page listing all demos with links
      Makefile
      .gitmodules
      .github/
        workflows/
          deploy.yml            ← builds runtime, deploys repo to GitHub Pages

---

## Why browser/runtime as the submodule ref

The `browser/runtime` branch is rebased on top of `main`, so it contains everything:
the compiler and the browser bundle, from a single branch. One submodule gives you both.

Checking in `bundle.json` means demos work without recompiling. Only recompile when
`.viv` source changes.

---

## Key tradeoff: submodule vs subtree

**Git submodule** (recommended): the demos repo stores a pointer to `browser/runtime`.
Contributors run `git submodule update --init` to get the runtime source, then build it.
Update the runtime with `git submodule update --remote`.

**Git subtree**: copies the runtime source into the demos repo. Simpler for contributors
(no init step), but harder to push changes back upstream. Wrong here since you don't want
to develop the runtime inside the demos repo.

---

## Key tradeoff: pre-built bundle vs build-on-clone

**Check in shared/viv-runtime.js** (recommended): contributors open `index.html` directly
in a browser with zero build step. Update the bundle deliberately via `make runtime` when
the runtime changes — a conscious act, like bumping a dependency.

**Build from submodule on clone**: cleaner source-of-truth, but adds a Node/npm
prerequisite for anyone who just wants to run the demos.

---

## Makefile targets

    runtime:
        cd viv && npm ci && npm run build
        cp viv/dist/index.browser.js shared/viv-runtime.js

    compile:
        for d in demos/*/; do \
            viv/compiler/compile $$d/sim.viv > $$d/bundle.json; \
        done

    serve:
        python3 -m http.server 8080

---

## Setup commands for a new clone

    git clone <url> viv-demos-wip
    cd viv-demos-wip
    git submodule update --init
    make runtime          # builds shared/viv-runtime.js from the submodule
    make serve            # serves on localhost:8080

## Adding the submodule (first-time repo setup)

    git submodule add -b browser/runtime https://github.com/possibly/viv viv

---

## UI structure: per-demo vs shared

Each demo owns its primary UI entirely — layout, visuals, interaction model. These live
in the demo's own `main.js` and `style.css` and are not shared.

Debugging UIs that are useful across demos live in `shared/ui/` as plain ES modules.
A demo opts in by importing what it wants:

    import { DebugPanel } from "../../shared/ui/debug-panel.js";
    import { initializeVivRuntime } from "../../shared/viv-runtime.js";

No build step. The browser resolves the relative imports natively since everything is
`type="module"`.

### Likely shared debug components

- `chronicle.js` — renders the viv event log (mirrors the terminal visualizer's chronicle
  pane but in HTML); wraps an auto-scrolling `<pre>` or `<ul>` fed by the runtime's
  chronicle callback
- `state-inspector.js` — live tree view of the current world state (entities, items,
  locations and their fields); useful for any demo
- `debug-panel.js` — collapsible overlay that composes the above; toggled with a keyboard
  shortcut (e.g. backtick) so it doesn't interfere with the demo's own UI

### Per-demo UI

Each demo's `main.js` wires up the demo-specific presentation: whatever HTML the demo
renders in response to viv events. A chatbot demo might render a chat bubble list; a
map demo might update SVG positions. That code stays in the demo folder.

If a demo needs its own reusable sub-components (e.g. a chat panel used across multiple
files in that demo), put them in `demos/<name>/ui/`.

---

## What each demo needs

- `index.html` — loads `main.js` as a module, links `style.css`
- `main.js` — wires up the runtime, renders demo-specific UI, optionally mounts DebugPanel
- `style.css` — demo-specific styles (import `../../shared/ui/shared.css` at the top)
- `sim.viv` — viv simulation source
- `bundle.json` — pre-compiled viv bytecode (compile with `make compile`)

The `hello-viv-browser` example in `viv/examples/hello-viv-browser/` is a good
template for the host app pattern (`main.js` + `index.html`).

---

## GitHub Pages deployment

GitHub Pages serves the repo as static files, so the folder structure maps directly
to URLs with no extra configuration:

    https://possibly.github.io/viv-demos-wip/                        ← root index.html (demo listing)
    https://possibly.github.io/viv-demos-wip/demos/01-hello-world/   ← demo 1
    https://possibly.github.io/viv-demos-wip/demos/02-chatbot/       ← demo 2

The relative import path `../../shared/viv-runtime.js` from inside a demo subfolder
resolves correctly under GitHub Pages — no path adjustments needed.

### GitHub Actions workflow (deploy.yml)

    name: Deploy to GitHub Pages
    on:
      push:
        branches: [main]

    permissions:
      contents: read
      pages: write
      id-token: write

    jobs:
      deploy:
        runs-on: ubuntu-latest
        environment:
          name: github-pages
          url: ${{ steps.deployment.outputs.page_url }}
        steps:
          - uses: actions/checkout@v4
            with:
              submodules: true

          - uses: actions/setup-node@v4
            with:
              node-version: 20

          - name: Build runtime bundle
            run: |
              cd viv && npm ci && npm run build
              cp viv/dist/index.browser.js shared/viv-runtime.js

          - uses: actions/configure-pages@v4
          - uses: actions/upload-pages-artifact@v3
            with:
              path: .
          - uses: actions/deploy-pages@v4
            id: deployment

The workflow checks out submodules, builds the runtime from source, copies it into
`shared/`, then deploys the whole repo. The tracked `shared/viv-runtime.js` is only
used locally; CI always builds fresh from the submodule.

### Enable GitHub Pages in repo settings

Go to Settings > Pages > Source: GitHub Actions (not a branch).
