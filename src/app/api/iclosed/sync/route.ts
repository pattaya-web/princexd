import { NextRequest, NextResponse } from "next/server";
import { readDB, writeDB } from "@/lib/db";
import { fetchCalls, IclosedError, mapCallStatus, toCallEvent, toLead } from "@/lib/iclosed";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Synchronisation iClosed via l'API publique.
 * Les appels et les leads sont identifiés par l'ID iClosed, donc une resynchro
 * met à jour l'existant au lieu de le dupliquer. Les champs que j'ai édités à la
 * main dans le tool (montant closé, notes perso, étape avancée) sont préservés.
 */
export async function POST(req: NextRequest) {
  // Par défaut on ne ramène QUE le calendrier et les réponses au questionnaire.
  // Le CRM se remplit à la main : un call booké n'est pas encore un lead qualifié.
  const { months = 6, withLeads = false } = (await req.json().catch(() => ({}))) as {
    months?: number;
    withLeads?: boolean;
  };

  try {
    const [upcoming, past] = await Promise.all([
      fetchCalls("UPCOMING", 6),
      // ~50 appels par page ; 12 pages couvrent 600 appels, largement l'historique utile.
      fetchCalls("PAST", months >= 24 ? 20 : 12),
    ]);

    const cutoff = Date.now() - months * 30 * 86_400_000;
    const calls = [...upcoming, ...past].filter(
      (c) => c.dateTimeUTC && new Date(c.dateTimeUTC).getTime() >= cutoff,
    );

    const db = readDB();
    let callsCreated = 0;
    let callsUpdated = 0;
    let leadsCreated = 0;
    let leadsUpdated = 0;

    for (const raw of calls) {
      const mapped = toCallEvent(raw);
      const existing = db.calls.find((c) => c.id === mapped.id);

      if (existing) {
        existing.title = mapped.title;
        existing.contact = mapped.contact;
        existing.at = mapped.at;
        existing.durationMin = mapped.durationMin;
        existing.status = mapped.status;
        existing.url = mapped.url;
        if (mapped.outcome) existing.outcome = mapped.outcome;
        // Un montant saisi à la main dans le tool prime sur le 0 renvoyé par l'API.
        if (mapped.value > 0) existing.value = mapped.value;
        callsUpdated++;
      } else {
        db.calls.unshift(mapped);
        callsCreated++;
      }

      if (!withLeads) continue;

      const lead = toLead(raw, mapCallStatus(raw));
      const known = db.leads.find((l) => l.id === lead.id);
      if (known) {
        known.callAt = lead.callAt;
        known.painPoint = lead.painPoint || known.painPoint;
        known.notes = lead.notes || known.notes;
        // Je ne redescends jamais une étape que j'ai fait avancer moi-même.
        const advanced = known.stage === "closed-won" || known.stage === "closed-lost";
        if (!advanced) known.stage = lead.stage;
        if (!known.dealValue && lead.dealValue) known.dealValue = lead.dealValue;
        leadsUpdated++;
      } else {
        db.leads.unshift(lead);
        leadsCreated++;
      }
    }

    writeDB(db);

    return NextResponse.json({
      fetched: upcoming.length + past.length,
      retenus: calls.length,
      callsCreated,
      callsUpdated,
      leadsCreated,
      leadsUpdated,
    });
  } catch (e) {
    const err = e as IclosedError;
    return NextResponse.json({ error: err.message }, { status: err.code === 401 ? 401 : 502 });
  }
}
