/**
 * Prospection Instagram par une VA : vocabulaire et lecture des CSV.
 *
 * Fichier pur, sans dependance Node : il sert au navigateur (lire le fichier
 * avant l'envoi, afficher les statuts) comme au serveur (reverifier ce qui
 * arrive). Quatre statuts, quatre couleurs, et un CSV qui se lit tout seul
 * quel que soit l'outil d'export.
 */
import type { OutreachStatus } from "./types";

export const OUTREACH_STATUSES: OutreachStatus[] = ["to-contact", "contacted", "replied", "issue"];

/** Libelles en anglais, comme demande : la VA travaille en anglais. */
export const OUTREACH_LABEL: Record<OutreachStatus, string> = {
  "to-contact": "To Contact",
  contacted: "Contacted",
  replied: "Replied",
  issue: "Issue",
};

/** Couleur de la ligne entiere : vert, jaune, rouge. « To Contact » reste neutre. */
export const OUTREACH_TONE: Record<OutreachStatus, string> = {
  "to-contact": "",
  contacted: "var(--good)",
  replied: "var(--warning)",
  issue: "var(--critical)",
};

export const isOutreachStatus = (s: unknown): s is OutreachStatus =>
  typeof s === "string" && (OUTREACH_STATUSES as string[]).includes(s);

/* --------------------------------- CSV ---------------------------------- */

/**
 * Decoupe un CSV en lignes de cellules.
 *
 * Le separateur est devine sur la premiere ligne (virgule, point-virgule ou
 * tabulation : les exports francais utilisent souvent le point-virgule), les
 * guillemets sont respectes (une virgule entre guillemets ne separe rien), et
 * le BOM d'Excel est ignore.
 */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, "");
  const firstLine = src.split(/\r?\n/, 1)[0] ?? "";
  const counts = { ",": (firstLine.match(/,/g) ?? []).length, ";": (firstLine.match(/;/g) ?? []).length, "\t": (firstLine.match(/\t/g) ?? []).length };
  const delim = (Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] as string) || ",";

  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += c;
      continue;
    }
    if (c === '"') quoted = true;
    else if (c === delim) {
      row.push(cell);
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(cell);
      cell = "";
      if (row.some((x) => x.trim())) rows.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x.trim())) rows.push(row);
  return rows;
}

/** Nom de colonne normalise : minuscules, sans accents ni espaces ni ponctuation. */
const norm = (h: string) =>
  h
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

const USERNAME_COLUMNS = ["username", "instagram", "instagramusername", "igusername", "ig", "handle", "user", "pseudo", "profile", "profileurl", "url", "link", "instagramurl", "account", "compte"];
const NAME_COLUMNS = ["fullname", "name", "nom", "fullnames", "displayname", "nomcomplet", "prenom", "firstname"];

/** « @Pseudo », « https://instagram.com/pseudo/ », « pseudo » : tous donnent « pseudo ». */
export function cleanUsername(raw: string): string {
  let v = raw.trim();
  if (!v) return "";
  const m = v.match(/instagram\.com\/([A-Za-z0-9._]+)/i);
  if (m) v = m[1];
  v = v.replace(/^@+/, "").replace(/\/+$/, "").trim().toLowerCase();
  if (!/^[a-z0-9._]{1,30}$/.test(v)) return "";
  return v;
}

export interface ParsedContact {
  username: string;
  name: string;
  extra: Record<string, string>;
}

export interface CsvMapping {
  contacts: ParsedContact[];
  usernameColumn: string;
  nameColumn: string;
  /** Lignes sans pseudo exploitable. */
  skipped: number;
  /** Pseudos vus deux fois dans le fichier : une seule ligne gardee. */
  duplicates: number;
  hasHeader: boolean;
}

/**
 * Trouve la colonne du pseudo Instagram et celle du nom, puis construit les
 * contacts. Sans en-tete reconnu, la premiere colonne qui ressemble a des
 * pseudos fait l'affaire : un simple fichier d'une colonne marche aussi.
 */
export function mapContacts(rows: string[][]): CsvMapping {
  if (!rows.length) return { contacts: [], usernameColumn: "", nameColumn: "", skipped: 0, duplicates: 0, hasHeader: false };
  const header = rows[0].map((h) => h.trim());
  const normHeader = header.map(norm);

  let userIdx = USERNAME_COLUMNS.map((k) => normHeader.indexOf(k)).find((i) => i >= 0) ?? -1;
  let nameIdx = NAME_COLUMNS.map((k) => normHeader.indexOf(k)).find((i) => i >= 0) ?? -1;
  // Un en-tete est un en-tete s'il a nomme au moins une colonne connue, ou
  // si sa premiere cellule n'est visiblement pas un pseudo.
  const hasHeader = userIdx >= 0 || nameIdx >= 0 || !cleanUsername(header[0] ?? "") || header.some((h) => /\s/.test(h));
  const body = hasHeader ? rows.slice(1) : rows;

  if (userIdx < 0) {
    // Colonne la plus riche en valeurs qui ressemblent a des pseudos.
    const width = Math.max(...rows.map((r) => r.length));
    let best = -1;
    let bestScore = 0;
    for (let i = 0; i < width; i++) {
      const score = body.reduce((a, r) => a + (cleanUsername(r[i] ?? "") ? 1 : 0), 0);
      if (score > bestScore) {
        bestScore = score;
        best = i;
      }
    }
    userIdx = best;
  }
  if (userIdx < 0) return { contacts: [], usernameColumn: "", nameColumn: "", skipped: body.length, duplicates: 0, hasHeader };

  const seen = new Set<string>();
  let skipped = 0;
  let duplicates = 0;
  const contacts: ParsedContact[] = [];
  for (const r of body) {
    const username = cleanUsername(r[userIdx] ?? "");
    if (!username) {
      skipped += 1;
      continue;
    }
    if (seen.has(username)) {
      duplicates += 1;
      continue;
    }
    seen.add(username);
    const extra: Record<string, string> = {};
    if (hasHeader) {
      r.forEach((v, i) => {
        if (i === userIdx || i === nameIdx || !header[i] || !v?.trim()) return;
        extra[header[i]] = v.trim().slice(0, 300);
      });
    }
    contacts.push({ username, name: nameIdx >= 0 ? (r[nameIdx] ?? "").trim().slice(0, 120) : "", extra });
  }
  return {
    contacts,
    usernameColumn: userIdx >= 0 && hasHeader ? header[userIdx] : `colonne ${userIdx + 1}`,
    nameColumn: nameIdx >= 0 && hasHeader ? header[nameIdx] : "",
    skipped,
    duplicates,
    hasHeader,
  };
}
