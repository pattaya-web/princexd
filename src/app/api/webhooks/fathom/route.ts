import { NextRequest, NextResponse } from "next/server";
import { getSettings } from "@/lib/db";
import { getFathomKey, processMeeting, verifyFathomSignature, type FathomMeeting, type FathomReport } from "@/lib/fathom";

export const dynamic = "force-dynamic";

/**
 * Webhook Fathom « new meeting content ready » : une reunion terminee, avec
 * son resume. Signature verifiee quand le secret du webhook est en reglages
 * (pose automatiquement par « Créer le webhook »). Reponse 200 des que le
 * message est compris : un echec de rattachement est journalise, pas
 * renvoye en erreur, pour que Fathom ne coupe pas le webhook.
 */
export async function POST(req: NextRequest) {
  const raw = await req.text();
  const secret = (process.env.FATHOM_WEBHOOK_SECRET?.trim() || getSettings().fathomWebhookSecret || "").trim();
  if (secret) {
    const ok = verifyFathomSignature({ id: req.headers.get("webhook-id"), timestamp: req.headers.get("webhook-timestamp"), signature: req.headers.get("webhook-signature") }, raw, secret);
    if (!ok) return NextResponse.json({ error: "Signature invalide." }, { status: 401 });
  } else if (!getFathomKey()) {
    return NextResponse.json({ error: "Fathom n'est pas configuré." }, { status: 401 });
  }
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Corps illisible." }, { status: 400 });
  }
  const o = (body && typeof body === "object" ? (body as Record<string, unknown>) : {}) as Record<string, unknown>;
  // Le corps est la reunion elle-meme ; on accepte aussi { meeting } / { data } par prudence.
  const meeting = ((o.meeting as FathomMeeting | undefined) ?? (o.data as FathomMeeting | undefined) ?? (o as FathomMeeting)) as FathomMeeting;
  if (!meeting || (!meeting.recording_id && !meeting.id && !meeting.title)) return NextResponse.json({ ok: true, ignored: true });
  const report: FathomReport = { examined: 0, attached: 0, skipped: 0, unmatched: [] };
  try {
    await processMeeting(meeting, report);
  } catch (e) {
    console.warn("[fathom] webhook :", (e as Error).message);
  }
  return NextResponse.json({ ok: true, ...report });
}
