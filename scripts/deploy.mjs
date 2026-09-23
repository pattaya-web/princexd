/**
 * Redéploie le site en ligne (mvdyprince.fr) via l'API Coolify.
 *
 *   node scripts/deploy.mjs          lance un déploiement et attend la fin
 *   node scripts/deploy.mjs --status affiche seulement le dernier déploiement
 *
 * Le jeton d'API est lu dans ~/.princexd-coolify-token (jamais dans le dépôt).
 * Coolify reconstruit l'image depuis GitHub : pense à pousser avant.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const COOLIFY = "http://185.97.146.171:8000/api/v1";
const APP_UUID = "3ebdarupnoajyk3ygbvebial";
const TOKEN_FILE = path.join(os.homedir(), ".princexd-coolify-token");

function token() {
  try {
    return fs.readFileSync(TOKEN_FILE, "utf8").trim();
  } catch {
    console.error(`Jeton introuvable : ${TOKEN_FILE}`);
    process.exit(1);
  }
}

async function api(route, init = {}) {
  const res = await fetch(`${COOLIFY}/${route}`, {
    ...init,
    headers: { Authorization: `Bearer ${token()}`, Accept: "application/json", ...(init.headers ?? {}) },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${route} → HTTP ${res.status} ${JSON.stringify(body).slice(0, 200)}`);
  return body;
}

async function lastDeployment() {
  const list = await api("deployments");
  return list.find((d) => d.application_id === APP_UUID || d.application_name?.includes("princexd")) ?? list[0] ?? null;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  if (process.argv.includes("--status")) {
    const d = await lastDeployment();
    console.log(d ? `${d.status} · ${d.commit?.slice(0, 7) ?? ""} · ${d.created_at}` : "aucun déploiement");
    return;
  }

  const started = await api(`deploy?uuid=${APP_UUID}&force=false`, { method: "POST" });
  const uuid = started.deployments?.[0]?.deployment_uuid;
  console.log(started.deployments?.[0]?.message ?? "Déploiement demandé.");
  if (!uuid) return;

  // Un build prend 2 a 4 minutes : on suit jusqu'au bout.
  const t0 = Date.now();
  for (;;) {
    await sleep(10_000);
    const d = await api(`deployments/${uuid}`);
    const sec = Math.round((Date.now() - t0) / 1000);
    process.stdout.write(`\r${d.status} (${sec}s)   `);
    if (d.status === "finished") {
      console.log("\n✓ En ligne : https://mvdyprince.fr");
      return;
    }
    if (d.status === "failed" || d.status === "cancelled-by-user") {
      console.log(`\n✗ Déploiement ${d.status}. Logs dans Coolify.`);
      process.exit(1);
    }
    if (sec > 900) {
      console.log("\nToujours en cours après 15 min : regarde Coolify.");
      process.exit(1);
    }
  }
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
