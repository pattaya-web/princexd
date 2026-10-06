import { NextRequest, NextResponse } from "next/server";
import { getSettings, saveSettings } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * Bloc-notes personnel de la to-do flottante.
 *
 * Un seul texte libre, enregistre tel quel : ce qu'on griffonne entre deux
 * ecrans sans vouloir en faire une tache. Route a part pour ne pas faire
 * transiter tous les reglages (et leurs masques de cles) a chaque frappe.
 */
export async function GET() {
  const s = getSettings();
  return NextResponse.json({ notes: s.todoNotes ?? "", updatedAt: s.todoNotesAt ?? "" });
}

export async function PATCH(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { notes?: unknown };
  const notes = typeof body.notes === "string" ? body.notes.slice(0, 200_000) : "";
  const updatedAt = new Date().toISOString();
  saveSettings({ todoNotes: notes, todoNotesAt: updatedAt });
  return NextResponse.json({ notes, updatedAt });
}
