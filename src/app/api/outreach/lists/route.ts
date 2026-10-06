import { NextRequest } from "next/server";
import { newId, readDB, writeDB } from "@/lib/db";
import { readSession, requireAdmin, requireOutreach } from "@/lib/sales/access";
import { handle, required } from "@/lib/sales/http";
import { cleanUsername } from "@/lib/outreach";
import type { OutreachContact, OutreachList, OutreachStatus } from "@/lib/types";

export const dynamic = "force-dynamic";

export interface OutreachListRow extends OutreachList {
  total: number;
  counts: Record<OutreachStatus, number>;
}

function summarize(db: ReturnType<typeof readDB>, list: OutreachList): OutreachListRow {
  const counts: Record<OutreachStatus, number> = { "to-contact": 0, contacted: 0, replied: 0, issue: 0 };
  let total = 0;
  for (const c of db.outreachContacts) {
    if (c.listId !== list.id) continue;
    total += 1;
    counts[c.status] = (counts[c.status] ?? 0) + 1;
  }
  return { ...list, total, counts };
}

/** Toutes les listes avec leur avancement, la plus recente en premier. */
export async function GET(req: NextRequest) {
  return handle(() => {
    requireOutreach(readSession(req));
    const db = readDB();
    const lists = db.outreachLists
      .slice()
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((l) => summarize(db, l));
    return { lists };
  });
}

/**
 * Import d'un CSV deja lu par le navigateur : une liste neuve, ses contacts.
 *
 * Reserve a l'admin. Le pseudo est renettoye ici : on ne fait pas confiance
 * au navigateur pour ce qui finit en base, et un doublon dans le fichier ne
 * donne qu'une ligne.
 */
export async function POST(req: NextRequest) {
  return handle(async () => {
    const session = requireAdmin(readSession(req));
    const body = (await req.json()) as { name?: unknown; fileName?: unknown; contacts?: unknown };
    const name = required(body.name, "Le nom de la liste").slice(0, 120);
    const raw = Array.isArray(body.contacts) ? (body.contacts as Record<string, unknown>[]) : [];
    if (!raw.length) throw new Error("Le fichier ne contient aucun pseudo Instagram exploitable.");
    if (raw.length > 20_000) throw new Error("Trop de contacts d'un coup : découpe le fichier (20 000 lignes maximum).");

    const db = readDB();
    if (db.outreachLists.some((l) => l.name.trim().toLowerCase() === name.trim().toLowerCase())) {
      throw new Error("Une liste porte déjà ce nom. Choisis-en un autre pour ne pas les confondre.");
    }
    const now = new Date().toISOString();
    const list: OutreachList = {
      id: newId(),
      name: name.trim(),
      fileName: typeof body.fileName === "string" ? body.fileName.slice(0, 200) : "",
      createdAt: now,
      createdBy: session.memberId,
    };
    const seen = new Set<string>();
    const contacts: OutreachContact[] = [];
    for (const r of raw) {
      const username = cleanUsername(String(r.username ?? ""));
      if (!username || seen.has(username)) continue;
      seen.add(username);
      const extraIn = r.extra && typeof r.extra === "object" ? (r.extra as Record<string, unknown>) : {};
      const extra: Record<string, string> = {};
      for (const [k, v] of Object.entries(extraIn).slice(0, 30)) {
        if (typeof v === "string" && v.trim()) extra[String(k).slice(0, 60)] = v.trim().slice(0, 300);
      }
      contacts.push({
        id: newId(),
        listId: list.id,
        username,
        name: typeof r.name === "string" ? r.name.trim().slice(0, 120) : "",
        extra,
        status: "to-contact",
        statusAt: "",
        order: contacts.length,
        createdAt: now,
      });
    }
    if (!contacts.length) throw new Error("Aucun pseudo Instagram valide dans ce fichier.");

    db.outreachLists.unshift(list);
    db.outreachContacts.push(...contacts);
    db.activityLogs.unshift({
      id: newId(),
      at: now,
      actorId: session.memberId,
      actorName: session.memberName || "Moi",
      action: "outreach.import",
      entity: "outreach",
      entityId: list.id,
      summary: `Liste de prospection « ${list.name} » importée : ${contacts.length} contact${contacts.length > 1 ? "s" : ""}`,
    });
    writeDB(db);
    return { list: summarize(db, list) };
  });
}
