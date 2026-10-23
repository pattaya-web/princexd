/**
 * Construit les guides PDF « Education » (plateforme élèves Scale X).
 *
 *   node scripts/build-education.mjs            tous les guides
 *   node scripts/build-education.mjs 03         un seul (préfixe du fichier)
 *
 * Source : content/education/NN-slug.html (gabarit : _template.html).
 * Sortie : public/formation/education/NN-slug.pdf, servie aux élèves.
 * Rendu par Edge ou Chrome en mode headless (impression PDF, A4, sans
 * en-tête ni pied de page du navigateur).
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..");
const SRC = path.join(ROOT, "content", "education");
const OUT = path.join(ROOT, "public", "formation", "education");

const CANDIDATES = [
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
];
const browser = process.env.BROWSER_BIN || CANDIDATES.find((p) => fs.existsSync(p));
if (!browser) {
  console.error("Aucun navigateur Chromium trouvé (Edge ou Chrome). Définis BROWSER_BIN.");
  process.exit(1);
}

fs.mkdirSync(OUT, { recursive: true });
const only = process.argv[2] ?? "";
const files = fs
  .readdirSync(SRC)
  .filter((f) => f.endsWith(".html") && !f.startsWith("_") && f.startsWith(only))
  .sort();

for (const f of files) {
  const html = path.join(SRC, f);
  const pdf = path.join(OUT, f.replace(/\.html$/, ".pdf"));
  execFileSync(
    browser,
    [
      "--headless=new",
      "--disable-gpu",
      "--no-first-run",
      "--no-default-browser-check",
      "--run-all-compositor-stages-before-draw",
      "--virtual-time-budget=4000",
      "--no-pdf-header-footer",
      `--print-to-pdf=${pdf}`,
      pathToFileURL(html).href,
    ],
    { stdio: "ignore", timeout: 120_000 },
  );
  const kb = Math.round(fs.statSync(pdf).size / 1024);
  console.log(`${f} → ${path.relative(ROOT, pdf)} (${kb} Ko)`);
}
console.log(`${files.length} guide(s) construit(s).`);
