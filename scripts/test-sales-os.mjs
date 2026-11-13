#!/usr/bin/env node
/**
 * Tests du Sales OS (src/lib/sales/ops/*.test.ts).
 *
 * Le projet n'a pas de framework de test : on compile les tests (et ce
 * qu'ils importent) avec le TypeScript du projet vers un dossier temporaire,
 * en CommonJS, puis on les lance avec le runner integre de Node. Les alias
 * « @/ » sont resolus vers le dossier compile.
 *
 *   node scripts/test-sales-os.mjs
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = fs.mkdtempSync(path.join(os.tmpdir(), "sales-os-tests-"));
const tests = fs
  .readdirSync(path.join(root, "src/lib/sales/ops"))
  .filter((f) => f.endsWith(".test.ts"))
  .map((f) => path.join(root, "src/lib/sales/ops", f));

const tsconfig = path.join(out, "tsconfig.json");
fs.writeFileSync(
  tsconfig,
  JSON.stringify({
    extends: path.join(root, "tsconfig.json"),
    compilerOptions: { noEmit: false, outDir: path.join(out, "dist"), rootDir: path.join(root, "src"), module: "commonjs", moduleResolution: "node", incremental: false, jsx: "react-jsx", allowJs: false, plugins: [] },
    files: tests,
    include: [],
  }),
);

const tsc = path.join(root, "node_modules", "typescript", "bin", "tsc");
try {
  execFileSync(process.execPath, [tsc, "-p", tsconfig], { stdio: "inherit" });
} catch {
  console.error("Compilation des tests en échec.");
  process.exit(1);
}

// Alias « @/x » -> dist/x pour les modules compiles.
const hook = path.join(out, "alias.cjs");
fs.writeFileSync(
  hook,
  `const Module = require("module");
const path = require("path");
const base = ${JSON.stringify(path.join(out, "dist"))};
const orig = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (request.startsWith("@/")) request = path.join(base, request.slice(2));
  return orig.call(this, request, ...rest);
};
`,
);

const compiled = tests.map((t) => path.join(out, "dist", path.relative(path.join(root, "src"), t)).replace(/\.ts$/, ".js"));
try {
  execFileSync(process.execPath, ["--require", hook, "--test", ...compiled], { stdio: "inherit", cwd: out });
} catch {
  process.exitCode = 1;
} finally {
  fs.rmSync(out, { recursive: true, force: true });
}
