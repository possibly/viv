# viv-demos-wip: Structure Plan

## Goal

A new repo with multiple demo subfolders, each with their own viv host app and viv
simulation code, sharing a single reference to the browser runtime from `possibly/viv`.

---

## Recommended folder structure

    viv-demos-wip/
      viv/                      ← git submodule → possibly/viv @ browser/runtime
      shared/
        viv-runtime.js          ← built from viv/dist/index.browser.js (build artifact, tracked)
      demos/
        01-hello-world/
          index.html
          main.js               ← host app, imports from ../../shared/viv-runtime.js
          sim.viv               ← viv source (checked in)
          bundle.json           ← pre-compiled bytecode (checked in)
        02-chatbot/
          ...
      Makefile
      .gitmodules

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

## What each demo needs

- `index.html` — loads main.js as a module
- `main.js` — host app, imports `initializeVivRuntime` from `../../shared/viv-runtime.js`
- `sim.viv` — viv simulation source
- `bundle.json` — pre-compiled viv bytecode (compile with `make compile`)

The `hello-viv-browser` example in `viv/examples/hello-viv-browser/` is a good
template for the host app pattern (`main.js` + `index.html`).
