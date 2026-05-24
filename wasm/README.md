# vivc on WASM — browser demo

Proof-of-concept showing the Viv compiler (`vivc`) running entirely client-side
in the browser via [Pyodide](https://pyodide.org) (CPython compiled to WASM).
No server-side compilation, no Python install required by the end user.

## Quick start

```bash
# From this directory (wasm/):
npm run setup          # installs pyodide locally, builds compiler wheel, patches hashes
cd .. && python3 -m http.server 8080
# open http://localhost:8080/wasm/index.html
```

`npm run setup` requires `poetry` (for building the compiler wheel) and internet
access to PyPI / files.pythonhosted.org.

## How it works

```
index.html
  └─ loads /wasm/node_modules/pyodide/pyodide.js   (local npm install, no CDN)
       └─ loadPackage("micropip")                   (fetched from local node_modules/)
            └─ micropip.install("Arpeggio-*.whl")   (pure-Python dep, served from wasm/)
            └─ micropip.install("viv_compiler-*.whl") (built from compiler/, served from wasm/)
                 └─ compile_from_string(vivSource)  → JSON ContentBundle
```

Key points:

- **No compiler changes needed.** `compile_from_string` works unmodified in Pyodide
  because the compiler is pure Python and its only dependency (arpeggio) is too.

- **Local pyodide via npm.** CDN loading (`cdn.jsdelivr.net`) is blocked in some
  environments. The `pyodide` npm package bundles `pyodide.asm.wasm` and
  `python_stdlib.zip`, so the page loads fully offline after setup.

- **SHA-256 hash patching.** `pyodide-lock.json` ships with hashes for wheels
  served from the Pyodide CDN. When loading from local npm those files aren't
  present — only the WASM binary and stdlib are. `setup.js` downloads the same
  wheel versions from PyPI, places them next to `pyodide.js`, and updates
  the hashes so Pyodide's SRI check passes.

- **CDN shortcut.** If your environment can reach `cdn.jsdelivr.net`, you can
  replace the local pyodide setup with a single CDN script tag:
  ```html
  <script src="https://cdn.jsdelivr.net/pyodide/v0.27.5/full/pyodide.js"></script>
  ```
  and remove the `indexURL` override in `index.html`. micropip and arpeggio
  still need to be reachable (either from CDN or hosted).

## Files

| File | Purpose |
|------|---------|
| `index.html` | Split-pane editor + compiler UI |
| `package.json` | Pins pyodide version |
| `setup.js` | Builds wheel, downloads deps, patches hashes |
| `test_browser.py` | Playwright smoke test (requires `pip install playwright && playwright install chromium`) |

Wheels (`*.whl`) and `node_modules/` are gitignored — `npm run setup` produces them.
