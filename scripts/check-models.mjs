/**
 * Verifie que chaque champ declare dans src/lib/models.ts existe vraiment dans
 * le schema KIE du modele.
 *
 * Pourquoi : KIE ne rejette PAS un champ inconnu. Il l'ignore et generate
 * quand meme — un `image_urls` envoye a un modele qui attend `image_input`
 * produit une image sans aucun rapport avec les sources, sans le moindre
 * message d'erreur. C'est passe inapercu deux fois. Ce script rend la faute
 * visible.
 *
 *   node scripts/check-models.mjs
 */

import fs from "node:fs/promises";
import path from "node:path";

const SITEMAP = "https://docs.kie.ai/sitemap.xml";
const CACHE = path.join(process.cwd(), ".cache", "kie-docs");

/** Champs acceptes par l'enveloppe createTask, hors `input`. */
const ENVELOPE = new Set(["model", "callBackUrl"]);

async function fetchText(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} sur ${url}`);
  return res.text();
}

/** Telecharge une page de doc, avec cache disque : la doc bouge peu. */
async function doc(slug) {
  const file = path.join(CACHE, `${slug.replaceAll("/", "_")}.md`);
  try {
    return await fs.readFile(file, "utf8");
  } catch {
    const text = await fetchText(`https://docs.kie.ai/market/${slug}.md`);
    await fs.mkdir(CACHE, { recursive: true });
    await fs.writeFile(file, text);
    return text;
  }
}

/**
 * Noms de proprietes de premier niveau du bloc `input:`.
 *
 * Un schema peut porter plusieurs blocs `properties:` : les variantes `oneOf`
 * sont au meme niveau, les objets imbriques (items d'un tableau) plus profond.
 * On retient la profondeur la moins indentee, ce qui garde toutes les variantes
 * et exclut les sous-objets.
 */
function inputKeys(md) {
  const m = /\n(\s+)input:\n/.exec(md);
  if (!m) return null;
  const base = m[1].length;

  const lines = [];
  for (const line of md.slice(m.index + m[0].length).split("\n")) {
    if (!line.trim()) continue;
    if (line.length - line.trimStart().length <= base) break;
    lines.push(line);
  }

  const depths = lines
    .filter((l) => l.trim() === "properties:")
    .map((l) => l.length - l.trimStart().length);
  if (!depths.length) return null;
  const top = Math.min(...depths) + 2;

  const keys = new Set();
  for (const line of lines) {
    if (line.length - line.trimStart().length !== top) continue;
    const k = /^([A-Za-z_][A-Za-z0-9_ ]*):$/.exec(line.trim());
    if (k) keys.add(k[1].trim());
  }
  return keys;
}

/**
 * Valeurs autorisees, par champ, quand le schema declare un `enum:`.
 * Un champ sans enum accepte du texte libre : on ne verifie alors rien.
 */
function inputEnums(md) {
  const m = /\n(\s+)input:\n/.exec(md);
  if (!m) return new Map();
  const base = m[1].length;
  const lines = [];
  for (const line of md.slice(m.index + m[0].length).split("\n")) {
    if (!line.trim()) continue;
    if (line.length - line.trimStart().length <= base) break;
    lines.push(line);
  }
  const depths = lines
    .filter((l) => l.trim() === "properties:")
    .map((l) => l.length - l.trimStart().length);
  if (!depths.length) return new Map();
  const top = Math.min(...depths) + 2;

  const out = new Map();
  let field = null;
  let collecting = false;
  for (const line of lines) {
    const ind = line.length - line.trimStart().length;
    const t = line.trim();
    if (ind === top) {
      const k = /^([A-Za-z_][A-Za-z0-9_ ]*):$/.exec(t);
      if (k) {
        field = k[1].trim();
        collecting = false;
        continue;
      }
    }
    if (!field) continue;
    if (ind === top + 2 && t === "enum:") {
      collecting = true;
      out.set(field, new Set());
      continue;
    }
    if (collecting) {
      const v = /^- '?(.*?)'?$/.exec(t);
      if (v && t.startsWith("- ")) out.get(field).add(v[1]);
      else collecting = false;
    }
  }
  return out;
}

/**
 * Modele dont la page fait autorite.
 *
 * On lit le `default:` de la propriete `model` du schema de requete, et pas
 * n'importe quelle occurrence : les pages Omni citent d'autres modeles dans
 * leurs exemples, ce qui faisait s'ecraser les entrees de l'index.
 */
function declaredModel(md) {
  const m = /\n\s+model:\n\s+type: string\n(?:.*\n)*?\s+default: ([A-Za-z0-9._/-]+)\n/.exec(md);
  return m ? m[1] : null;
}

async function main() {
  const sitemap = await fetchText(SITEMAP);
  const slugs = [...sitemap.matchAll(/<loc>https:\/\/docs\.kie\.ai\/market\/([^<]+)<\/loc>/g)]
    .map((m) => m[1])
    .filter((s) => !s.startsWith("cn/") && s !== "quickstart" && !s.startsWith("common/"));

  process.stdout.write(`Indexation de ${slugs.length} pages de doc…\n`);

  // model id -> cles d'input, et model id -> valeurs autorisees par champ
  const index = new Map();
  const enums = new Map();
  const CONCURRENCY = 12;
  for (let i = 0; i < slugs.length; i += CONCURRENCY) {
    await Promise.all(
      slugs.slice(i, i + CONCURRENCY).map(async (slug) => {
        try {
          const md = await doc(slug);
          const id = declaredModel(md);
          const keys = inputKeys(md);
          if (id && keys?.size) {
            index.set(id, keys);
            enums.set(id, inputEnums(md));
          }
        } catch {
          // Une page absente n'invalide pas la verification des autres.
        }
      }),
    );
  }

  const src = await fs.readFile(path.join(process.cwd(), "src", "lib", "models.ts"), "utf8");

  // Decoupe le fichier par modele, puis releve les `key:` de chaque bloc.
  const blocks = [...src.matchAll(/\n  \{\n\s+id: "([^"]+)",\n\s+name: "([^"]+)",[\s\S]*?\n  \},/g)];
  let problems = 0;
  let checked = 0;

  for (const [block, id, name] of blocks) {
    const known = index.get(id);
    if (!known) {
      process.stdout.write(`?  ${name} [${id}] — pas de doc trouvee, non verifie\n`);
      continue;
    }
    checked++;
    const used = [...block.matchAll(/\bkey: "([^"]+)"/g)].map((m) => m[1]);
    // Les champs poses par les fabriques partagees (prompt, duration…) comptent aussi.
    if (/promptField\(/.test(block)) used.push("prompt");
    if (/durationSel\(/.test(block)) used.push("duration");
    if (/resolutionSel\(/.test(block)) used.push("resolution");
    if (/aspectVid\(/.test(block)) used.push("aspect_ratio");

    /*
     * Un modele qui declare `withImages` couvre deux endpoints : ses champs
     * peuvent appartenir a l'un ou a l'autre, la route choisissant selon la
     * presence d'images. On valide donc contre l'union des deux schemas.
     */
    const twin = /withImages: "([^"]+)"/.exec(block)?.[1];
    const accepted = new Set([...known, ...(twin ? (index.get(twin) ?? []) : [])]);

    const bad = used.filter((k) => !accepted.has(k) && !ENVELOPE.has(k));
    // Les valeurs comptent autant que les noms : un `mode: "720p"` la ou le
    // modele attend "pro" est refuse ou silencieusement ignore.
    const wrongValues = [];
    for (const [, key, list] of block.matchAll(
      /key: "([^"]+)",[^}]*?options: \[([^\]]*)\]/g,
    )) {
      const declared = enums.get(id)?.get(key);
      if (!declared?.size) continue;
      // Derogation assumee, justifiee en commentaire dans le catalogue.
      if (block.includes(`check-models: allow ${key}`)) continue;
      const mine = [...list.matchAll(/"([^"]*)"/g)].map((m) => m[1]);
      const off = mine.filter((v) => !declared.has(v));
      if (off.length) wrongValues.push([key, off, [...declared]]);
    }

    if (bad.length || wrongValues.length) {
      problems++;
      process.stdout.write(`\n✗  ${name} [${id}]\n`);
      for (const k of bad) process.stdout.write(`     champ inconnu : ${k}\n`);
      if (bad.length) process.stdout.write(`     attendus      : ${[...accepted].join(", ")}\n`);
      for (const [key, off, declared] of wrongValues) {
        process.stdout.write(`     ${key} : valeurs refusées ${off.join(", ")}\n`);
        process.stdout.write(`     ${" ".repeat(key.length)}   attendues ${declared.join(", ")}\n`);
      }
    }
  }

  process.stdout.write(
    `\n${checked} modeles verifies, ${problems} en faute.\n`,
  );
  process.exitCode = problems ? 1 : 0;
}

main().catch((e) => {
  process.stderr.write(`${e.message}\n`);
  process.exitCode = 1;
});
