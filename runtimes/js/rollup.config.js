import { createRequire } from "node:module";

import sourcemaps from "rollup-plugin-sourcemaps";
import json from '@rollup/plugin-json';
import resolve from "@rollup/plugin-node-resolve";
import commonjs from "@rollup/plugin-commonjs";
import terser from "@rollup/plugin-terser";

const require = createRequire(import.meta.url);
const pkg = require("./package.json");

const onwarn = (warning, warn) => {
    if (warning.code === "CIRCULAR_DEPENDENCY") return;
    if (warning.code === "THIS_IS_UNDEFINED") return;
    warn(warning);
};

const basePlugins = [
    sourcemaps(),
    json(),
    resolve({ extensions: [".mjs", ".js", ".json"], browser: false }),
    commonjs(),
    terser({
        keep_classnames: true,
        keep_fnames: true,
        format: { comments: /^!|@preserve|@license|@cc_on/i }
    })
];

/** @type {import('rollup').RollupOptions[]} */
export default [
    {
        input: "temp/index.js",
        output: [
            {
                file: "dist/index.js",
                format: "esm",
                sourcemap: true
            },
            {
                file: "dist/index.cjs",
                format: "cjs",
                sourcemap: true,
                exports: "named"
            }
        ],
        onwarn,
        external: Object.keys(pkg.dependencies || {}),
        plugins: basePlugins
    },
    // Browser bundle: ESM with dependencies inlined. Targets browsers directly via a
    // plain <script type="module">, with no bare-specifier resolution required.
    {
        input: "temp/index.js",
        output: {
            file: "dist/index.browser.js",
            format: "esm",
            sourcemap: true,
            inlineDynamicImports: true
        },
        onwarn,
        plugins: [
            sourcemaps(),
            json(),
            resolve({ extensions: [".mjs", ".js", ".json"], browser: true, preferBuiltins: false }),
            commonjs(),
            terser({
                keep_classnames: true,
                keep_fnames: true,
                format: { comments: /^!|@preserve|@license|@cc_on/i }
            })
        ]
    }
];
