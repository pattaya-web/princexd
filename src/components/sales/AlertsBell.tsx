"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/client";
import { fmtDay, fmtDualTime, fmtDate, relative } from "@/lib/format";
import { useToast } from "@/components/ui";
import { FOLLOWUP_HEAT_ICON, FOLLOWUP_HEAT_LABEL } from "@/lib/types";
import type { AlertItem, AlertsPayload } from "@/app/api/sales/alerts/route";

const KIND_COLOR: Record<AlertItem["kind"], string> = {
  "follow-up-overdue": "var(--critical)",
  "follow-up-today": "var(--warning)",
  "follow-up-upcoming": "var(--text-3)",
  "payment-overdue": "var(--critical)",
  "payment-due": "var(--warning)",
  "call-unconfirmed": "var(--warning)",
  "call-tomorrow": "var(--warning)",
  "call-soon": "var(--critical)",
};

const HEAT_COLOR = { hot: "var(--critical)", warm: "var(--warning)", cold: "var(--accent)" } as const;

/** Reports rapides depuis la cloche, sans ouvrir la fiche : « je te réponds dans deux semaines ». */
const QUICK: { label: string; days?: number; months?: number }[] = [
  { label: "+1 j", days: 1 },
  { label: "+2 j", days: 2 },
  { label: "+3 j", days: 3 },
  { label: "+1 sem", days: 7 },
  { label: "+2 sem", days: 14 },
  { label: "+1 mois", months: 1 },
];

/** A partir d'aujourd'hui, a l'heure de la relance d'origine. */
function later(from: string, q: { days?: number; months?: number }): string {
  const d = new Date();
  if (q.days) d.setDate(d.getDate() + q.days);
  if (q.months) d.setMonth(d.getMonth() + q.months);
  const src = new Date(from);
  d.setHours(src.getHours(), src.getMinutes(), 0, 0);
  return d.toISOString();
}

/**
 * Cloche en haut a droite : les gens a relancer.
 *
 * Une ligne par prospect a relancer aujourd'hui (ou en retard), avec sa
 * fiche : chaleur, telephone a copier, ce qu'il a dit en sortant du call,
 * date du call, objection, relances deja faites. Depuis la ligne : relance
 * notee, faite, sans reponse, reportee (+1 j … +1 mois). Le nom ouvre la
 * fiche du lead, ou tout se statue. En bas, les prochaines relances pour
 * voir venir. Rechargee toutes les deux minutes, a chaque retour sur
 * l'onglet et a chaque changement dans le CRM.
 */
export function AlertsBell() {
  const toast = useToast();
  const [data, setData] = useState<AlertsPayload | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState("");
  const [reschedule, setReschedule] = useState<string | null>(null);
  const [copied, setCopied] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  const load = async () => {
    try {
      setData(await api("/api/sales/alerts"));
    } catch {
      /* hors perimetre (monteur, eleve…) ou reseau : pas de cloche */
    }
  };

  useEffect(() => {
    void load();
    const t = setInterval(() => document.visibilityState === "visible" && void load(), 120_000);
    const onVisible = () => document.visibilityState === "visible" && void load();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    // Une relance modifiee ailleurs (fiche, CRM) rafraichit la cloche.
    window.addEventListener("sales:changed", onVisible);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
      window.removeEventListener("sales:changed", onVisible);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const noReply = async (item: AlertItem) => {
    if (!item.followUpId) return;
    setBusy(item.id);
    try {
      const r = await api<{ cold: boolean }>(`/api/sales/followups/${item.followUpId}/no-reply`, { method: "POST" });
      toast(r.cold ? `${item.leadName} classé lead froid.` : "Pas de réponse : dernière relance dans 2 jours.");
      await load();
      window.dispatchEvent(new Event("sales:changed"));
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setBusy("");
    }
  };

  const act = async (item: AlertItem, body: Record<string, unknown>, ok: string) => {
    if (!item.followUpId) return;
    setBusy(item.id);
    try {
      await api(`/api/sales/followups/${item.followUpId}`, { method: "PATCH", body: JSON.stringify(body) });
      toast(ok);
      setReschedule(null);
      await load();
      window.dispatchEvent(new Event("sales:changed"));
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setBusy("");
    }
  };

  const copyPhone = async (item: AlertItem) => {
    if (!item.phone) return;
    try {
      await navigator.clipboard.writeText(item.phone);
      setCopied(item.id);
      setTimeout(() => setCopied(""), 1500);
    } catch {
      window.prompt("Copie ce numéro :", item.phone);
    }
  };

  const total = data?.items.length ?? 0;
  const overdue = data?.counts.overdue ?? 0;
  const upcoming = data?.upcoming ?? [];
  /* Le nom ouvre la fiche du lead (bloc Statuer, relances, timeline) ; un paiement ouvre la fiche du call. */
  const href = (i: AlertItem) => (i.followUpId ? `/sales/rendez-vous?view=followup&lead=${i.leadId}&t=${Date.now()}` : i.appointmentId ? `/sales/rendez-vous?open=${i.appointmentId}&t=${Date.now()}` : "/sales/rendez-vous");

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        className="btn btn-ghost btn-sm relative !px-2"
        onClick={() => setOpen((v) => !v)}
        title={total ? `${total} personne${total > 1 ? "s" : ""} à relancer` : "Personne à relancer pour l'instant"}
        aria-label="Relances"
      >
        <span className="text-[16px] leading-none">🔔</span>
        {total > 0 && (
          <span
            className="absolute -top-0.5 -right-0.5 rounded-full min-w-[18px] h-[18px] px-1 text-[10.5px] font-semibold num flex items-center justify-center"
            style={{ background: overdue ? "var(--critical)" : "var(--warning)", color: "#fff" }}
          >
            {total}
          </span>
        )}
      </button>

      {open && (
        <div className="card absolute right-0 top-full mt-2 w-[400px] max-w-[calc(100vw-24px)] z-50 overflow-hidden" style={{ boxShadow: "var(--shadow-lg)" }}>
          <div className="flex items-center justify-between px-3.5 py-2.5" style={{ borderBottom: "1px solid var(--border)" }}>
            <span className="text-[13px] font-semibold">À relancer</span>
            <span className="dim text-[11.5px] num">
              {overdue ? `${overdue} en retard · ` : ""}
              {total} aujourd&apos;hui
            </span>
          </div>
          <ul className="max-h-[65vh] overflow-y-auto">
            {total === 0 && <li className="dim text-[12.5px] px-3.5 py-5 text-center">Personne à relancer aujourd&apos;hui ✓</li>}
            {data?.items.map((i) => (
              <li key={i.id} className="px-3.5 py-2.5" style={{ borderBottom: "1px solid var(--border)", borderLeft: `3px solid ${KIND_COLOR[i.kind]}` }}>
                {/* Qui, et quand le rappeler */}
                <div className="flex items-start gap-2">
                  <Link href={href(i)} className="block min-w-0 flex-1" onClick={() => setOpen(false)} title="Ouvrir la fiche">
                    <div className="text-[12.5px] font-semibold truncate flex items-center gap-1.5">
                      {i.heat && (
                        <span className="badge !text-[10px] !py-0 shrink-0" style={{ color: HEAT_COLOR[i.heat], borderColor: `color-mix(in srgb, ${HEAT_COLOR[i.heat]} 40%, transparent)` }} title={`Prospect ${FOLLOWUP_HEAT_LABEL[i.heat].toLowerCase()}`}>
                          {FOLLOWUP_HEAT_ICON[i.heat]} {FOLLOWUP_HEAT_LABEL[i.heat]}
                        </span>
                      )}
                      <span className="truncate">{i.followUpId ? i.leadName : i.title}</span>
                      {i.step === 2 && <span className="badge badge-warn !text-[10px] !py-0 shrink-0">dernière</span>}
                    </div>
                    <div className="text-[11.5px] num" style={{ color: KIND_COLOR[i.kind] }}>
                      {i.followUpId ? (i.kind === "follow-up-overdue" ? "À rappeler depuis le " : "À rappeler ") : ""}
                      {fmtDay(i.at)} · {fmtDualTime(i.at)} · {relative(i.at)}
                    </div>
                  </Link>
                  {i.phone && (
                    <button type="button" className="btn btn-sm !h-[24px] !px-1.5 !text-[11px] shrink-0 num" onClick={() => void copyPhone(i)} title={`Copier ${i.phone} pour WhatsApp`}>
                      {copied === i.id ? "Copié ✓" : `📞 ${i.phone}`}
                    </button>
                  )}
                </div>

                {/* Ce qu'il a dit, et le contexte du call */}
                {i.followUpId ? (
                  <div className="mt-1 text-[12px] flex flex-col gap-0.5">
                    {i.said ? (
                      <div className="whitespace-pre-wrap" style={{ color: "var(--text-1)" }}>
                        <span className="dim">Il a dit : </span>« {i.said} »
                      </div>
                    ) : (
                      <div className="dim italic">Rien noté en sortant du call</div>
                    )}
                    {i.callNotes && (
                      <div className="dim line-clamp-2" title={i.callNotes}>
                        Call : {i.callNotes}
                      </div>
                    )}
                    <div className="dim text-[11px] flex flex-wrap gap-x-2">
                      {i.callAt && <span>Call du {fmtDate(i.callAt)}</span>}
                      {i.objection && <span>· {i.objection}</span>}
                      {i.objective && <span>· {i.objective}</span>}
                      {i.handle && <span>· @{i.handle.replace(/^@/, "")}</span>}
                    </div>
                    {(i.contacts ?? 0) > 0 && i.lastContactAt && (
                      <div className="text-[11px]" style={{ color: "var(--good)" }}>
                        Déjà relancé {i.contacts} fois · dernier message {relative(i.lastContactAt)}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="mt-0.5 text-[11.5px]">
                    <div className="dim">{i.detail}</div>
                    {i.callNotes && (
                      <div className="dim line-clamp-2" title={i.callNotes}>
                        Call : {i.callNotes}
                      </div>
                    )}
                  </div>
                )}

                {/* Actions sur la relance */}
                {i.followUpId && (
                  <div className="flex items-center gap-1 mt-1.5 flex-wrap">
                    {reschedule === i.id ? (
                      <>
                        <span className="dim text-[11px]">Reporter :</span>
                        {QUICK.map((q) => (
                          <button key={q.label} className="btn btn-sm !h-[22px] !px-1.5 !text-[11px]" disabled={busy === i.id} onClick={() => void act(i, { dueAt: later(i.at, q) }, `Relance reportée (${q.label}).`)}>
                            {q.label}
                          </button>
                        ))}
                        <button className="btn btn-ghost btn-sm !h-[22px] !px-1.5 !text-[11px]" onClick={() => setReschedule(null)}>
                          ✕
                        </button>
                      </>
                    ) : (
                      <>
                        <button className="btn btn-sm !h-[22px] !px-1.5 !text-[11px]" disabled={busy === i.id} onClick={() => void act(i, { contact: true }, "Relance notée, pense à la reporter.")} title="Noter que tu viens de le relancer">
                          ✉ J&apos;ai relancé
                        </button>
                        <button className="btn btn-sm !h-[22px] !px-1.5 !text-[11px]" disabled={busy === i.id} onClick={() => void act(i, { status: "done" }, "Relance clôturée.")} title="Il a répondu, c'est réglé (va statuer sur la fiche s'il a closé)">
                          ✓ Faite
                        </button>
                        <button className="btn btn-sm !h-[22px] !px-1.5 !text-[11px]" style={{ color: "var(--critical)" }} disabled={busy === i.id} onClick={() => void noReply(i)} title="Sans réponse : relance suivante, ou lead froid après la dernière">
                          ✗ Pas de réponse
                        </button>
                        <button className="btn btn-sm !h-[22px] !px-1.5 !text-[11px]" onClick={() => setReschedule(i.id)} title="Il demande encore du temps : reporter la relance">
                          ↻ Reporter
                        </button>
                      </>
                    )}
                  </div>
                )}
              </li>
            ))}

            {upcoming.length > 0 && (
              <>
                <li className="px-3.5 pt-2.5 pb-1 label-xs" style={{ background: "var(--surface-2)" }}>
                  À venir · {upcoming.length} relance{upcoming.length > 1 ? "s" : ""} dans les 2 semaines
                </li>
                {upcoming.map((i) => (
                  <li key={i.id} className="px-3.5 py-1.5" style={{ borderBottom: "1px solid var(--border)", background: "var(--surface-2)" }}>
                    <Link href={href(i)} className="block" onClick={() => setOpen(false)}>
                      <div className="flex items-center gap-1.5 text-[12px]">
                        {i.heat && (
                          <span style={{ color: HEAT_COLOR[i.heat] }} title={FOLLOWUP_HEAT_LABEL[i.heat]}>
                            {FOLLOWUP_HEAT_ICON[i.heat]}
                          </span>
                        )}
                        <span className="font-semibold truncate">{i.leadName}</span>
                        <span className="dim num shrink-0 ml-auto">
                          {fmtDay(i.at)} · {relative(i.at)}
                        </span>
                      </div>
                      {i.said && <div className="dim text-[11.5px] truncate">« {i.said} »</div>}
                    </Link>
                  </li>
                ))}
              </>
            )}
          </ul>
          <div className="px-3.5 py-2 flex justify-between items-center" style={{ background: "var(--surface-2)", borderTop: "1px solid var(--border)" }}>
            <Link href="/sales/rendez-vous?view=followup" className="link text-[12px]" onClick={() => setOpen(false)}>
              Toutes les relances →
            </Link>
            <button className="btn btn-ghost btn-sm !h-[24px] !text-[11.5px]" onClick={() => void load()}>
              ↻
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
