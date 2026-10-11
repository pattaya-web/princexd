import fs from "fs";
import path from "path";

const DIR = path.join(process.cwd(), "data", "webhooks");
const MAX_BYTES = 1_000_000;

/**
 * Journal brut des webhooks recus (Systeme.io, iClosed…), un fichier JSONL
 * par service dans data/webhooks. Sert a voir le format exactement recu
 * quand une integration ne fait pas ce qu'on attend. Jamais bloquant, borne
 * en taille.
 */
export function logWebhook(service: string, entry: Record<string, unknown>) {
  try {
    fs.mkdirSync(DIR, { recursive: true });
    const file = path.join(DIR, `${service.replace(/[^a-z0-9_-]/gi, "")}.jsonl`);
    fs.appendFileSync(file, JSON.stringify({ at: new Date().toISOString(), ...entry }).slice(0, 8000) + "\n");
    if (fs.statSync(file).size > MAX_BYTES) {
      const lines = fs.readFileSync(file, "utf8").split("\n");
      fs.writeFileSync(file, lines.slice(-200).join("\n"));
    }
  } catch {
    // le journal n'est qu'une aide au diagnostic
  }
}
