"use client";

/**
 * Fiche lead 360° en panneau lateral : tout ce qu'on sait du prospect, en
 * une lecture, et les gestes du quotidien a portee de clic. Lit la fiche
 * existante (/api/sales/leads/[id]) : une seule source de verite.
 *
 * Quatre notions distinctes, affichees cote a cote : la source
 * d'acquisition, le responsable actuel, le setter a l'origine du
 * rendez-vous, le closer.
 */
import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { api } from "@/lib/client";
import { fmtDualDateTime, isoToParisInput, parisToIso } from "@/lib/format";
import { useToast } from "@/components/ui";
import type { Lead } from "@/lib/types";
import { Avatar, ContactButtons, money, Pill, SETTING_OPTIONS, useOpsAction, when } from "./shared";
import { contactOf, initials } from "@/lib/sales/ops/views";

interface Appt {
  id: string;
  scheduledAt: string;
  status: string;
  closerName: string;
  setterName?: string;
  confirmation: string;
  timezone: string;
  source: string;
  closerNotes: string;
  noShow?: { state: string; attempts: number } | null;
}

interface Payload {
  lead: Lead;
  setterName: string;
  ownerName?: string;
  appointments: Appt[];
  followUps?: { id: string; dueAt: string; status: string; notes: string; objection: string; heat: string }[];
  sale: { contractValue: number; cashCollected: number; currency: string; offer: string; closerName: string; refundAmount: number; status: string; payment: { remaining: number; summary: string; state: string }; paymentFollow?: { state: string; note: string; promisedFor?: string } } | null;
  meta: { campaignName: string; adsetName: string; adName: string } | null;
  timeline: { id: string; at: string; title: string; detail: string; by: string }[];
}

const STATUS_FR: Record<string, string> = {
  booked: "Réservé",
  confirmed: "Confirmé",
  rescheduled: "Reprogrammé",
  completed: "Call fait",
  "no-show": "No-show",
  cancelled: "Annulé",
  "follow-up": "En attente (relance)",
  "closed-won": "Closé",
  "closed-lost": "Perdu",
};

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="py-3" style={{ borderTop: "1px solid var(--border)" }}>
      <h3 className="label-xs mb-2">{title}</h3>
      {children}
    </section>
  );
}

function Row({ k, v }: { k: string; v: ReactNode }) {
  if (v === "" || v === null || v === undefined) return null;
  return (
    <div className="flex gap-2 text-[12.5px] py-0.5">
      <span className="dim w-[130px] shrink-0">{k}</span>
      <span className="min-w-0 break-words">{v}</span>
    </div>
  );
}

export function LeadPanel({
  leadId,
  today,
  members,
  canManage,
  objections,
  onClose,
  onChanged,
  onOpenSheet,
}: {
  leadId: string | null;
  today: string;
  members: { id: string; name: string }[];
  canManage: boolean;
  objections: { key: string; label: string }[];
  onClose: () => void;
  onChanged: () => void;
  onOpenSheet: (leadId: string) => void;
}) {
  const toast = useToast();
  const [data, setData] = useState<Payload | null>(null);
  const [mounted, setMounted] = useState(false);
  const [version, setVersion] = useState(0);
  const [nextText, setNextText] = useState("");
  const [nextAt, setNextAt] = useState("");
  const [nurtureAt, setNurtureAt] = useState("");
  const [nurtureWhy, setNurtureWhy] = useState("");
  const [moveAt, setMoveAt] = useState("");
  const { run, busy } = useOpsAction(() => {
    setVersion((v) => v + 1);
    onChanged();
  });

  useEffect(() => setMounted(true), []);
  useEffect(() => {
    if (!leadId) {
      setData(null);
      return;
    }
    let alive = true;
    api<Payload>(`/api/sales/leads/${leadId}`)
      .then((d) => alive && setData(d))
      .catch((e: Error) => toast(e.message, "err"));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leadId, version]);

  useEffect(() => {
    if (!leadId) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [leadId, onClose]);

  if (!mounted || !leadId) return null;
  const l = data?.lead;
  const lead = (op: string, extra: Record<string, unknown> = {}, ok?: string) => run({ type: "lead", leadId, op, ...extra }, ok);
  const upcoming = (data?.appointments ?? []).filter((a) => ["booked", "confirmed", "rescheduled"].includes(a.status));
  const objLabel = new Map(objections.map((o) => [o.key, o.label]));

  return createPortal(
    <div className="fixed inset-0 z-[60] flex justify-end" role="dialog" aria-modal="true" aria-label="Fiche du lead">
      <button type="button" className="absolute inset-0 cursor-default" style={{ background: "rgba(10,12,20,.35)" }} onClick={onClose} aria-label="Fermer" />
      <aside className="relative h-full w-full max-w-[560px] overflow-y-auto px-4 sm:px-5 pb-10" style={{ background: "var(--surface)", boxShadow: "var(--shadow-lg)" }}>
        <header className="sticky top-0 z-10 flex items-center gap-3 py-3" style={{ background: "var(--surface)" }}>
          <Avatar initials={initials(l?.name ?? "?")} size={38} />
          <div className="min-w-0 flex-1">
            <div className="text-[16px] font-semibold truncate">{l?.name ?? "Chargement…"}</div>
            <div className="dim text-[12px] truncate">
              {l?.settingStatus ? SETTING_OPTIONS.find((o) => o.value === l.settingStatus)?.label : "À contacter"}
              {l?.doNotContact ? " · ne plus contacter" : ""}
              {l?.heat ? ` · ${l.heat === "hot" ? "🔥 chaud" : l.heat === "warm" ? "🌤 tiède" : "❄️ froid"}` : ""}
            </div>
          </div>
          <button type="button" className="btn btn-sm" onClick={() => onOpenSheet(leadId)} title="Fiche complète du CRM : statuer un call, encaisser">
            Fiche complète
          </button>
          <button type="button" className="btn btn-sm btn-ghost" onClick={onClose} aria-label="Fermer">
            ✕
          </button>
        </header>

        {!data || !l ? (
          <div className="py-10 text-center">
            <span className="spinner" />
          </div>
        ) : (
          <>
            {/* Gestes rapides */}
            <div className="flex flex-wrap gap-1.5 pb-3">
              <ContactButtons contact={contactOf(l)} />
              <button type="button" className="btn btn-sm btn-primary" disabled={busy} onClick={() => void lead("contacted", {}, "Contact enregistré.")}>
                ✓ Marquer contacté
              </button>
            </div>

            <Section title="Commercial">
              <Row k="Source d'acquisition" v={[l.sourceChannel, l.funnelSource].filter(Boolean).join(" · ") || l.source || "Inconnue"} />
              <Row
                k="Responsable actuel"
                v={
                  canManage ? (
                    <select className="select select-xs" value={l.ownerId ?? ""} disabled={busy} onChange={(e) => e.target.value && void lead("owner", { ownerId: e.target.value }, "Lead transféré.")}>
                      <option value="">Non attribué</option>
                      {members.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name}
                        </option>
                      ))}
                    </select>
                  ) : (
                    data.ownerName || "Non attribué"
                  )
                }
              />
              <Row k="Setter du rendez-vous" v={[...new Set(data.appointments.map((a) => a.setterName).filter(Boolean))].join(", ") || data.setterName || "—"} />
              <Row k="Closer" v={[...new Set(data.appointments.map((a) => a.closerName).filter(Boolean))].join(", ") || "—"} />
              <Row k="Stade" v={l.stage} />
              <Row k="Dernier contact" v={l.lastContactAt ? when(l.lastContactAt, today) : "Jamais"} />
              <Row k="Prochaine action" v={l.nextAction && l.nextActionAt ? `${l.nextAction} — ${when(l.nextActionAt, today)}` : ""} />
              <Row k="Nurturing" v={l.settingStatus === "nurturing" && l.nurtureUntil ? `reprise le ${l.nurtureUntil.split("-").reverse().join("/")}${l.nurtureReason ? ` · ${l.nurtureReason}` : ""}` : ""} />
              <Row k="Objections" v={(data.followUps ?? []).map((f) => objLabel.get(f.objection) || "").filter(Boolean).join(", ")} />
              <div className="flex flex-wrap gap-1 mt-2">
                <select className="select select-xs" value={l.settingStatus ?? "to-contact"} disabled={busy} onChange={(e) => void lead("status", { settingStatus: e.target.value, reason: ["lost", "not-qualified"].includes(e.target.value) ? (window.prompt("Raison (optionnel)") ?? "") : "" }, "Statut mis à jour.")} aria-label="Statut de setting">
                  {SETTING_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
                {(["hot", "warm", "cold"] as const).map((h) => (
                  <button key={h} type="button" className={`btn btn-sm ${l.heat === h ? "btn-primary" : ""}`} disabled={busy} onClick={() => void lead("heat", { heat: l.heat === h ? "" : h })}>
                    {h === "hot" ? "🔥 Chaud" : h === "warm" ? "🌤 Tiède" : "❄️ Froid"}
                  </button>
                ))}
              </div>
              <div className="flex flex-wrap items-center gap-1 mt-2">
                <input className="input !h-[28px] text-[12px] flex-1 min-w-[140px]" placeholder="Prochaine action (ex. Relancer après son salaire)" value={nextText} onChange={(e) => setNextText(e.target.value)} />
                <input type="datetime-local" className="input !h-[28px] !w-auto text-[12px]" value={nextAt} onChange={(e) => setNextAt(e.target.value)} aria-label="Date de la prochaine action" />
                <button type="button" className="btn btn-sm btn-primary" disabled={busy || !nextAt} onClick={() => void lead("next", { text: nextText, at: parisToIso(nextAt) }, "Relance planifiée.").then((ok) => ok && (setNextText(""), setNextAt("")))}>
                  Planifier
                </button>
              </div>
              <div className="flex flex-wrap items-center gap-1 mt-1.5">
                <input type="date" className="input !h-[28px] !w-auto text-[12px]" value={nurtureAt} onChange={(e) => setNurtureAt(e.target.value)} aria-label="Date de reprise" />
                <input className="input !h-[28px] text-[12px] flex-1 min-w-[140px]" placeholder="Pourquoi (attend son salaire, démarre le mois prochain…)" value={nurtureWhy} onChange={(e) => setNurtureWhy(e.target.value)} />
                <button type="button" className="btn btn-sm" disabled={busy || !nurtureAt} onClick={() => void lead("nurture", { until: nurtureAt, reason: nurtureWhy }, "Passé en nurturing.")}>
                  Nurturing
                </button>
              </div>
              <div className="flex flex-wrap gap-1 mt-1.5">
                <button type="button" className="btn btn-sm" disabled={busy} onClick={() => void lead("status", { settingStatus: "not-qualified", reason: window.prompt("Pourquoi non qualifié ?") ?? "" }, "Marqué non qualifié.")}>
                  Non qualifié
                </button>
                <button type="button" className="btn btn-sm" disabled={busy} onClick={() => {
                  const r = window.prompt("Raison de la perte ?");
                  if (r !== null) void lead("status", { settingStatus: "lost", reason: r }, "Marqué perdu.");
                }}>
                  Perdu (raison)
                </button>
                <button type="button" className="btn btn-sm" style={{ color: "var(--critical)" }} disabled={busy} onClick={() => window.confirm(l.doNotContact ? "Le rendre à nouveau contactable ?" : "Il ne veut plus être contacté : plus aucune tâche ni relance. Confirmer ?") && void lead("dnc", { value: !l.doNotContact })}>
                  {l.doNotContact ? "Rendre contactable" : "Ne plus contacter"}
                </button>
              </div>
            </Section>

            <Section title="Rendez-vous">
              {data.appointments.length === 0 ? (
                <p className="dim text-[12.5px]">Aucun rendez-vous.</p>
              ) : (
                <ul className="space-y-2">
                  {data.appointments.map((a) => (
                    <li key={a.id} className="text-[12.5px]">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="font-medium">{fmtDualDateTime(a.scheduledAt)}</span>
                        <Pill tone={a.status === "no-show" ? "bad" : a.status === "closed-won" ? "good" : "info"}>{STATUS_FR[a.status] ?? a.status}</Pill>
                        {["booked", "confirmed", "rescheduled"].includes(a.status) && (
                          <Pill tone={a.confirmation === "confirmed" ? "good" : a.confirmation === "no-answer" ? "bad" : "warn"}>
                            {a.confirmation === "confirmed" ? "Confirmé par le prospect" : a.confirmation === "awaiting" ? "Confirmation envoyée" : a.confirmation === "no-answer" ? "Sans réponse" : "À confirmer"}
                          </Pill>
                        )}
                        {a.noShow && <span className="dim">récupération : {a.noShow.state} · {a.noShow.attempts} tentative(s)</span>}
                      </div>
                      <div className="dim text-[11.5px]">
                        Setter : {a.setterName || "—"} · Closer : {a.closerName || "—"} · fuseau du prospect : {l.timezone || a.timezone}
                      </div>
                      {a.closerNotes && <div className="muted text-[11.5px] mt-0.5 whitespace-pre-line">{a.closerNotes.slice(0, 300)}</div>}
                    </li>
                  ))}
                </ul>
              )}
              {upcoming[0] && (
                <div className="flex flex-wrap items-center gap-1 mt-2">
                  <button type="button" className="btn btn-sm btn-primary" disabled={busy} onClick={() => void run({ type: "appointment", appointmentId: upcoming[0].id, op: "confirm", confirmation: "confirmed" }, "Confirmé par le prospect.")}>
                    ✓ Confirmé
                  </button>
                  <button type="button" className="btn btn-sm" disabled={busy} onClick={() => void run({ type: "appointment", appointmentId: upcoming[0].id, op: "confirm", confirmation: "awaiting" }, "Confirmation envoyée, en attente.")}>
                    Confirmation envoyée
                  </button>
                  <input type="datetime-local" className="input !h-[28px] !w-auto text-[12px]" value={moveAt || isoToParisInput(upcoming[0].scheduledAt)} onChange={(e) => setMoveAt(e.target.value)} aria-label="Nouvelle date" />
                  <button type="button" className="btn btn-sm" disabled={busy || !moveAt} onClick={() => void run({ type: "appointment", appointmentId: upcoming[0].id, op: "reschedule", at: parisToIso(moveAt) }, "Call reprogrammé (heure de Paris).")}>
                    Reprogrammer
                  </button>
                </div>
              )}
            </Section>

            {data.sale && (
              <Section title="Financier">
                <Row k="Offre" v={data.sale.offer} />
                <Row k="Prix convenu" v={money(data.sale.contractValue, data.sale.currency)} />
                <Row k="Encaissé" v={money(data.sale.cashCollected, data.sale.currency)} />
                <Row k="Reste dû" v={money(data.sale.payment.remaining, data.sale.currency)} />
                <Row k="Remboursé" v={data.sale.refundAmount ? money(data.sale.refundAmount, data.sale.currency) : ""} />
                <Row k="Paiement" v={data.sale.payment.summary} />
                <p className="dim text-[11.5px] mt-1">L'encaissement s'enregistre dans la fiche complète (admin ou closer). Un « j'ai payé » du prospect passe en vérification.</p>
              </Section>
            )}

            <Section title="Identité">
              <Row k="Email" v={l.email} />
              <Row k="Téléphone" v={l.phone} />
              <Row k="Instagram" v={l.igUsername ? `@${l.igUsername}` : ""} />
              <Row k="Fuseau" v={l.timezone} />
              <Row k="Créé le" v={fmtDualDateTime(l.createdAt)} />
              <Row k="Identifiant" v={<span className="mono text-[11px]">{l.id}</span>} />
            </Section>

            <Section title="Acquisition">
              <Row k="Premier canal" v={l.firstTouchSourceChannel || l.sourceChannel} />
              <Row k="Dernier canal" v={l.lastTouchSourceChannel} />
              <Row k="Campagne Meta" v={data.meta?.campaignName || l.campaignName || l.campaignId} />
              <Row k="Ad set / Ad" v={[data.meta?.adsetName || l.adsetName, data.meta?.adName || l.adName].filter(Boolean).join(" · ")} />
              <Row k="UTM" v={[l.firstTouchUtmSource, l.firstTouchUtmMedium, l.firstTouchUtmCampaign, l.firstTouchUtmContent].filter(Boolean).join(" / ")} />
              <Row k="Page" v={l.sourceUrl} />
              <Row k="Entrée" v={l.optInAt ? fmtDualDateTime(l.optInAt) : ""} />
            </Section>

            <Section title="Historique">
              <ol className="space-y-1.5">
                {data.timeline.slice(0, 40).map((t) => (
                  <li key={t.id} className="text-[12px]">
                    <span className="dim mono">{when(t.at, today)}</span> · <span className="font-medium">{t.title}</span>
                    {t.detail && <span className="muted"> — {t.detail}</span>}
                    {t.by && <span className="dim"> ({t.by})</span>}
                  </li>
                ))}
              </ol>
            </Section>
          </>
        )}
      </aside>
    </div>,
    document.body,
  );
}
