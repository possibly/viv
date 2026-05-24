/**
 * One-time setup for the vivc-on-WASM demo.
 *
 * Does three things:
 *
 * 1. Builds the viv-compiler wheel from ../compiler/ (requires `poetry`).
 * 2. Downloads the arpeggio wheel from PyPI (the compiler's only dependency).
 * 3. Downloads micropip + packaging into the local pyodide installation and
 *    patches pyodide-lock.json with the correct SHA-256 hashes.
 *
 * Why step 3?  pyodide-lock.json ships with hashes for wheels fetched from
 * the Pyodide CDN.  When serving pyodide locally (via npm) the browser still
 * tries to load micropip/packaging from the local indexURL, but the wheel
 * files aren't included in the npm package — only the WASM binary and stdlib
 * are.  We fetch the same versions from PyPI, place them alongside pyodide.js,
 * and update the hashes so Pyodide's SRI check passes.
 */

const { execSync } = require("child_process");
const https = require("https");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = path.resolve(__dirname, "..");
const COMPILER_DIR = path.join(ROOT, "compiler");
const WASM_DIR = __dirname;
const PYODIDE_DIR = path.join(WASM_DIR, "node_modules", "pyodide");
const LOCK_PATH = path.join(PYODIDE_DIR, "pyodide-lock.json");

// Wheels fetched from PyPI and placed next to pyodide.js so loadPackage() finds them.
const PYODIDE_WHEELS = {
  micropip: {
    filename: "micropip-0.8.0-py3-none-any.whl",
    url: "https://files.pythonhosted.org/packages/85/14/c80ceaf54395af2b698e1df4b33c55abff5e024391526d385cd84c132493/micropip-0.8.0-py3-none-any.whl",
  },
  packaging: {
    filename: "packaging-24.2-py3-none-any.whl",
    url: "https://files.pythonhosted.org/packages/88/ef/eb23f262cca3c0c4eb7ab1933c3b1f03d021f2c48f54763065b6f0e321be/packaging-24.2-py3-none-any.whl",
  },
};

// Wheels placed in wasm/ and served to micropip.install() by the demo page.
const DEMO_WHEELS = {
  arpeggio: {
    filename: "Arpeggio-2.0.3-py2.py3-none-any.whl",
    url: "https://files.pythonhosted.org/packages/84/4d/53b8186b41842f7a5e971b1d1c28e678364dcf841e4170f5d14d38ac1e2a/Arpeggio-2.0.3-py2.py3-none-any.whl",
  },
};

// ─── helpers ──────────────────────────────────────────────────────────────────

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        file.close();
        fs.unlinkSync(dest);
        return download(res.headers.location, dest).then(resolve).catch(reject);
      }
      res.pipe(file);
      file.on("finish", () => file.close(resolve));
    }).on("error", (err) => { fs.unlinkSync(dest); reject(err); });
  });
}

function sha256hex(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

// ─── steps ────────────────────────────────────────────────────────────────────

function buildCompilerWheel() {
  console.log("Building viv-compiler wheel…");
  execSync("poetry build --format wheel", { cwd: COMPILER_DIR, stdio: "inherit" });
  const dist = path.join(COMPILER_DIR, "dist");
  const whl = fs.readdirSync(dist).find((f) => f.endsWith(".whl"));
  if (!whl) throw new Error("No wheel found in compiler/dist/");
  const src = path.join(dist, whl);
  const dest = path.join(WASM_DIR, whl);
  fs.copyFileSync(src, dest);
  console.log(`  → ${whl}`);
}

async function fetchDemoWheels() {
  for (const { filename, url } of Object.values(DEMO_WHEELS)) {
    const dest = path.join(WASM_DIR, filename);
    if (fs.existsSync(dest)) { console.log(`${filename} already present`); continue; }
    process.stdout.write(`Downloading ${filename}…`);
    await download(url, dest);
    console.log(" done");
  }
}

async function fetchAndPatchPyodideWheels() {
  const lock = JSON.parse(fs.readFileSync(LOCK_PATH, "utf8"));
  for (const [pkg, { filename, url }] of Object.entries(PYODIDE_WHEELS)) {
    const dest = path.join(PYODIDE_DIR, filename);
    if (!fs.existsSync(dest)) {
      process.stdout.write(`Downloading ${filename}…`);
      await download(url, dest);
      console.log(" done");
    } else {
      console.log(`${filename} already present`);
    }
    lock.packages[pkg].sha256 = sha256hex(dest);
  }
  fs.writeFileSync(LOCK_PATH, JSON.stringify(lock, null, 1));
  console.log("pyodide-lock.json patched.");
}

// ─── main ─────────────────────────────────────────────────────────────────────

(async () => {
  buildCompilerWheel();
  await fetchDemoWheels();
  await fetchAndPatchPyodideWheels();
  console.log("\nSetup complete. Serve the repo root and open /wasm/index.html.");
})().catch((e) => { console.error(e); process.exit(1); });
