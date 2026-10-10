"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/client";
import { fmtDualTime, fmtDay, relative } from "@/lib/format";
import { useToast } from "@/components/ui";
import type { AlertItem } from "@/app/api/sales/alerts/route";

const KIND_COLOR: Record<AlertItem["kind"], string> = {
  "follow-up-overdue": "var(--critical)",
  "follow-up-today": "var(--warning)",
  "call-unconfirmed": "var(--warning)",
  "call-today": "var(--accent)",
  callback: "var(--accent)",
};

/** Reports rapides depuis la cloche, sans ouvrir la fiche. */
const QUICK = [
  { label: "+1 j", days: 1 },
  { label: "+2 j", days: 2 },
  { label: "+3 j", days: 3 },
  { label: "+5 j", days: 5 },
  { label: "+1 sem", days: 7 },
];

function plusDays(from: string, days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  const src = new Date(from);
  d.setHours(src.getHours(), src.getMinutes(), 0, 0);
  return d.toISOString();
}

/**
 * Cloche en haut a droite : ce qu'il y a a faire aujourd'hui (relances en
 * retard ou du jour, calls a confirmer, rappels). Rechargee toutes les deux
 * minutes et a chaque retour sur l'onglet. Depuis la liste on peut cloturer
 * ou reporter une relance, ou ouvrir la fiche.
 */
export function AlertsBell() {
  const toast = useToast();
  const [data, setData] = useState<{ items: AlertItem[]; counts: { overdue: number; today: number } } | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState("");
  const [reschedule, setReschedule] = useState<string | null>(null);
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
    // Une relance modifiee ailleurs (fiche, page Relances) rafraichit la cloche.
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

  const total = data?.items.length ?? 0;
  const overdue = data?.counts.overdue ?? 0;
  const href = (i: AlertItem) => (i.appointmentId ? `/sales/rendez-vous?open=${i.appointmentId}` : "/sales/leads");

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        className="btn btn-ghost btn-sm relative !px-2"
        onClick={() => setOpen((v) => !v)}
        title={total ? `${total} chose${total > 1 ? "s" : ""} à faire` : "Rien à faire pour l'instant"}
        aria-label="Alertes"
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
        <div className="card absolute right-0 top-full mt-2 w-[360px] max-w-[calc(100vw-24px)] z-50 overflow-hidden" style={{ boxShadow: "var(--shadow-lg)" }}>
          <div className="flex items-center justify-between px-3.5 py-2.5" style={{ borderBottom: "1px solid var(--border)" }}>
            <span className="text-[13px] font-semibold">À faire aujourd&apos;hui</span>
            <span className="dim text-[11.5px] num">
              {overdue ? `${overdue} en retard · ` : ""}
              {total} au total
            </span>
          </div>
          <ul className="max-h-[60vh] overflow-y-auto">
            {total === 0 && <li className="dim text-[12.5px] px-3.5 py-5 text-center">Rien en attente. Tout est à jour ✓</li>}
            {data?.items.map((i) => (
              <li key={i.id} className="px-3.5 py-2.5" style={{ borderBottom: "1px solid var(--border)", borderLeft: `3px solid ${KIND_COLOR[i.kind]}` }}>
                <Link href={href(i)} className="block" onClick={() => setOpen(false)}>
                  <div className="text-[12.5px] font-semibold truncate">{i.title}</div>
                  <div className="dim text-[11.5px] truncate">{i.detail}</div>
                  <div className="text-[11px] num" style={{ color: KIND_COLOR[i.kind] }}>
                    {fmtDay(i.at)} · {fmtDualTime(i.at)} · {relative(i.at)}
                  </div>
                </Link>
                {i.followUpId && (
                  <div className="flex items-center gap-1 mt-1.5 flex-wrap">
                    {reschedule === i.id ? (
                      <>
                        {QUICK.map((q) => (
                          <button key={q.days} className="btn btn-sm !h-[22px] !px-1.5 !text-[11px]" disabled={busy === i.id} onClick={() => void act(i, { dueAt: plusDays(i.at, q.days) }, `Relance reportée (${q.label}).`)}>
                            {q.label}
                          </button>
                        ))}
                        <button className="btn btn-ghost btn-sm !h-[22px] !px-1.5 !text-[11px]" onClick={() => setReschedule(null)}>✕</button>
                      </>
                    ) : (
                      <>
                        <button className="btn btn-sm !h-[22px] !px-1.5 !text-[11px]" disabled={busy === i.id} onClick={() => void act(i, { status: "done" }, "Relance clôturée.")}>
                          ✓ Faite
                        </button>
                        <button className="btn btn-sm !h-[22px] !px-1.5 !text-[11px]" disabled={busy === i.id} onClick={() => void act(i, { contact: true }, "Relance notée, pense à la reporter.")}>
                          ✉ J&apos;ai relancé
                        </button>
                        <button className="btn btn-sm !h-[22px] !px-1.5 !text-[11px]" style={{ color: "var(--critical)" }} disabled={busy === i.id} onClick={() => void noReply(i)} title="Sans réponse : relance suivante, ou lead froid après la dernière">
                          ✗ Pas de réponse
                        </button>
                        <button className="btn btn-sm !h-[22px] !px-1.5 !text-[11px]" onClick={() => setReschedule(i.id)}>
                          ↻ Reporter
                        </button>
                      </>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
          <div className="px-3.5 py-2 flex justify-between items-center" style={{ background: "var(--surface-2)" }}>
            <Link href="/sales/relances" className="link text-[12px]" onClick={() => setOpen(false)}>
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
