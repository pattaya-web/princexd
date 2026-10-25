"use client";

import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/client";
import { fmtDateTime, fmtMoney, isoToParisInput, parisToIso } from "@/lib/format";
import { addDays, addMonths, buildSchedule, DEFAULT_EXPECTED_DAYS, PAYMENT_STATE_LABEL, PAYMENT_STATE_TONE, parisToday, type PaymentView } from "@/lib/sales/installments";
import { Field, useToast } from "@/components/ui";
import { StatusBadge } from "./bits";
import { useSales } from "./context";
import type { AppointmentStatus, Sale } from "@/lib/types";

/* ------------------------------- Couleurs -------------------------------- */

export const TONE_COLOR = {
  good: "var(--good)",
  warn: "var(--warning)",
  bad: "var(--critical)",
  info: "var(--accent)",
  muted: "var(--text-3)",
  accent: "var(--accent)",
} as const;

const fmtDay = (day: string) => day.slice(0, 10).split("-").reverse().slice(0, 2).join("/");

/* --------------------------------- Types --------------------------------- */

export type SaleWithPayment = Sale & { closerName: string; payment: PaymentView };

export interface OutcomeLead {
  id: string;
  name: string;
  closerId?: string;
  phone?: string;
  callStatus?: string;
}

export interface OutcomeAppointment {
  id: string;
  scheduledAt: string;
  status: AppointmentStatus;
  closerName: string;
}

type CallStatus = "completed" | "follow-up" | "closed-won" | "no-show" | "closed-lost" | "rescheduled";
type Mode = "" | "closed-won" | "follow-up" | "closed-lost" | "rescheduled" | "collect" | "unpaid" | "specify" | "callback" | "fix";

const LOST: { key: string; label: string }[] = [
  { key: "too-expensive", label: "Trop cher" },
  { key: "no-money", label: "Pas le budget" },
  { key: "need-to-think", label: "Veut réfléchir" },
  { key: "need-partner-approval", label: "Doit en parler" },
  { key: "not-qualified", label: "Pas qualifié" },
  { key: "not-interested", label: "Pas intéressé" },
  { key: "timing", label: "Pas le moment" },
  { key: "competitor", label: "Parti ailleurs" },
  { key: "other", label: "Autre" },
];

const n = (v: string) => Number(String(v).replace(",", ".").replace(/\s/g, "")) || 0;

/**
 * Statuer un lead, quelle que soit sa situation, depuis un seul bloc.
 *
 * Le call : show (pitché), en attente (relance), reprogrammé, no-show,
 * perdu, closé — avec, pour une vente, le montant, ce qui est encaissé
 * aujourd'hui, en combien de fois, et quand le paiement est attendu si rien
 * n'est entré (« contrat envoyé »).
 *
 * L'argent, ensuite : chaque échéance se marque encaissée en un clic, un
 * paiement d'un autre montant s'enregistre, une vente iClosed se précise
 * (une fois / plusieurs fois / contrat envoyé), et « il n'a pas payé »
 * annule la vente : le chiffre d'affaires redescend, le call repasse en
 * perdu. Rien n'est jamais dit « en retard » avant la date.
 */
export function OutcomePanel({
  lead,
  appointments,
  sale,
  cancelledSale,
  canOutcome,
  onDone,
  compact = false,
}: {
  lead: OutcomeLead;
  appointments: OutcomeAppointment[];
  sale: SaleWithPayment | null;
  cancelledSale?: { contractValue: number; currency: string; updatedAt: string } | null;
  canOutcome: boolean;
  onDone: () => void;
  compact?: boolean;
}) {
  const toast = useToast();
  const { session, members, currency: defaultCurrency } = useSales();
  const [mode, setMode] = useState<Mode>("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");

  /* Vente */
  const [offers, setOffers] = useState<{ name: string; price: number }[]>([]);
  const [offer, setOffer] = useState("");
  const [contract, setContract] = useState("");
  const [cash, setCash] = useState("");
  const [times, setTimes] = useState("1");
  const [expectedAt, setExpectedAt] = useState(addDays(parisToday(), DEFAULT_EXPECTED_DAYS));
  const [closerId, setCloserId] = useState(lead.closerId ?? "");
  /* Perdu / en attente / reprogrammé / rappel */
  const [reason, setReason] = useState("need-to-think");
  const [followUpAt, setFollowUpAt] = useState(isoToParisInput(new Date(Date.now() + 2 * 86_400_000)));
  const [rescheduledAt, setRescheduledAt] = useState(isoToParisInput(new Date(Date.now() + 86_400_000)));
  const [callbackAt, setCallbackAt] = useState(isoToParisInput(new Date(Date.now() + 86_400_000)));
  /* Encaissement libre */
  const [colAmount, setColAmount] = useState("");
  const [colAt, setColAt] = useState(parisToday());
  /* Préciser (vente iClosed ou reste dû sans échéance) */
  const [specTimes, setSpecTimes] = useState("2");
  const [specFirst, setSpecFirst] = useState("");
  const [specExpected, setSpecExpected] = useState(addDays(parisToday(), DEFAULT_EXPECTED_DAYS));
  /* Corriger la vente : contrat, total encaissé, nombre de fois, prochaine échéance. */
  const [fixContract, setFixContract] = useState("");
  const [fixCash, setFixCash] = useState("");
  const [fixTimes, setFixTimes] = useState("1");
  const [fixNextAt, setFixNextAt] = useState("");

  const closers = members.filter((m) => m.roles.includes("closer") && m.status !== "inactif");
  const last = appointments[0];
  const currency = sale?.currency || defaultCurrency || "EUR";
  const today = parisToday();
  const canPay = Boolean(sale) && (session.isAdmin || sale?.closerId === session.memberId);

  useEffect(() => {
    setCloserId(lead.closerId ?? "");
  }, [lead.id, lead.closerId]);

  /** Ouvre le formulaire de vente, avec le catalogue si on l'a. */
  const openSale = async (pendingPayment: boolean) => {
    setMode("closed-won");
    setTimes("1");
    let list = offers;
    if (!list.length) {
      try {
        const r = await api<{ offers: { name: string; price: number }[]; currency: string }>("/api/sales/offers");
        list = r.offers;
        setOffers(list);
      } catch {
        // pas de catalogue : saisie libre
      }
    }
    const first = list[0];
    if (first && !offer) setOffer(first.name);
    const price = first?.price && first.price > 0 ? String(first.price) : contract;
    setContract(price);
    setCash(pendingPayment ? "0" : price);
  };

  const send = async (status: CallStatus, extra: Record<string, unknown> = {}) => {
    setBusy(true);
    try {
      const r = await api<{ created: boolean; sale: { contractValue: number; currency: string } | null }>(`/api/sales/leads/${lead.id}/outcome`, {
        method: "POST",
        body: JSON.stringify({ status, closerId, note, ...extra }),
      });
      const msg: Record<CallStatus, string> = {
        completed: "Show noté : call fait, pas encore de décision.",
        "follow-up": "En attente : relance programmée.",
        "closed-won": r.sale ? `Closé ✓ ${fmtMoney(r.sale.contractValue, r.sale.currency)}.` : "Closé ✓",
        "no-show": "No-show noté.",
        "closed-lost": "Perdu noté.",
        rescheduled: "Call reprogrammé.",
      };
      toast(msg[status]);
      setMode("");
      setNote("");
      onDone();
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setBusy(false);
    }
  };

  /** Statut d'appel (lead sans call) : pas intéressé, ne répond pas, à rappeler. */
  const leadStatus = async (status: string, ok: string, extra: Record<string, unknown> = {}) => {
    setBusy(true);
    try {
      await api(`/api/sales/leads/${lead.id}`, { method: "PATCH", body: JSON.stringify({ action: "status", status, note, ...extra }) });
      toast(ok);
      setMode("");
      setNote("");
      onDone();
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setBusy(false);
    }
  };

  const saleCall = async (method: "POST" | "PATCH", body: Record<string, unknown>, ok: string) => {
    if (!sale) return;
    setBusy(true);
    try {
      await api(`/api/sales/deals/${sale.id}`, { method, body: JSON.stringify(body) });
      toast(ok);
      setMode("");
      setNote("");
      onDone();
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setBusy(false);
    }
  };

  /* Aperçu du plan, pendant la saisie de la vente. */
  const preview = useMemo(() => {
    const c = n(contract);
    const paid = Math.min(n(cash), c);
    const t = Math.max(1, Number(times) || 1);
    if (c <= 0) return "";
    const plan = buildSchedule(c, paid, t, new Date().toISOString(), paid > 0 ? "" : expectedAt);
    const parts: string[] = [];
    if (paid > 0) parts.push(paid >= c ? `${fmtMoney(c, currency)} encaissés aujourd'hui, soldé` : `${fmtMoney(paid, currency)} aujourd'hui`);
    else parts.push("rien encaissé aujourd'hui (contrat envoyé)");
    for (const it of plan) parts.push(`${fmtMoney(it.amount, currency)} le ${fmtDay(it.dueAt)}`);
    return parts.join(" · ");
  }, [contract, cash, times, expectedAt, currency]);

  const pay = sale?.payment ?? null;
  const schedule = (sale?.schedule ?? []).slice().sort((a, b) => a.dueAt.localeCompare(b.dueAt));

  /* Ouvre la correction avec les valeurs actuelles : on ne retape que ce qui est faux. */
  const openFix = () => {
    if (!pay) return;
    setFixContract(String(pay.contractValue));
    setFixCash(String(pay.cashCollected));
    setFixTimes(String(Math.max(1, pay.times)));
    setFixNextAt(schedule.find((it) => !it.paidAt)?.dueAt ?? addMonths(today, 1));
    setMode("fix");
  };

  /*
   * Le plan corrigé : ce qui est déjà encaissé compte pour la première
   * échéance, le reste est réparti à parts égales à partir de la date
   * choisie, un mois d'écart. Envoyé tel quel au serveur (plan explicite).
   */
  const fixPlan = useMemo(() => {
    const c = n(fixContract);
    const paid = Math.min(n(fixCash), c);
    const remaining = Math.round((c - paid) * 100) / 100;
    const paidNow = paid > 0 ? 1 : 0;
    const future = Math.max(remaining > 0 ? 1 : 0, (Math.max(1, Number(fixTimes) || 1)) - paidNow);
    if (c <= 0 || remaining <= 0 || !/^\d{4}-\d{2}-\d{2}$/.test(fixNextAt)) return [] as { n: number; dueAt: string; amount: number; paidAt: string }[];
    const base = Math.floor((remaining / future) * 100) / 100;
    return Array.from({ length: future }, (_, i) => ({
      n: paidNow + i + 1,
      dueAt: addMonths(fixNextAt, i),
      amount: i === future - 1 ? Math.round((remaining - base * (future - 1)) * 100) / 100 : base,
      paidAt: "",
    }));
  }, [fixContract, fixCash, fixTimes, fixNextAt]);

  const sendFix = () => {
    const c = n(fixContract);
    const paid = Math.min(n(fixCash), c);
    const times = Math.max(1, Number(fixTimes) || 1);
    void saleCall(
      "PATCH",
      {
        contractValue: c,
        cashCollected: paid,
        installments: Math.max(times, fixPlan.length + (paid > 0 ? 1 : 0)),
        paymentType: paid >= c ? "paid-in-full" : times > 1 ? "installments" : "other",
        paymentExpectedAt: paid <= 0 ? fixNextAt : "",
        schedule: fixPlan,
      },
      "Vente corrigée.",
    );
  };
  const stateColor = pay ? TONE_COLOR[PAYMENT_STATE_TONE[pay.state]] : undefined;

  const btn = `btn btn-sm ${compact ? "!h-[30px]" : "!h-[32px]"}`;

  return (
    <div className="card-flat p-3.5 flex flex-col gap-3">
      {/* ------------------------------ En-tête ------------------------------ */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="label-xs">Statuer · en un clic</span>
        <span className="ml-auto text-[12px] flex items-center gap-2 flex-wrap justify-end">
          {sale && pay ? (
            <span className="badge !text-[11px]" style={{ color: stateColor, borderColor: `color-mix(in srgb, ${stateColor} 40%, transparent)` }}>
              Closé {fmtMoney(pay.contractValue, currency)} · {PAYMENT_STATE_LABEL[pay.state]}
            </span>
          ) : cancelledSale ? (
            <span className="badge badge-danger !text-[11px]">Vente {fmtMoney(cancelledSale.contractValue, cancelledSale.currency)} annulée · non payée</span>
          ) : last ? (
            <>
              <span className="dim">Dernier call {fmtDateTime(last.scheduledAt)} :</span>
              <StatusBadge status={last.status} />
            </>
          ) : (
            <span className="dim">Aucun call enregistré</span>
          )}
        </span>
      </div>

      {/* ------------------------------ Le call ------------------------------ */}
      {canOutcome ? (
        <div className="flex items-center gap-1.5 flex-wrap">
          <button className={btn} disabled={busy} onClick={() => void send("completed")} title="Le prospect est venu, l'offre a été présentée, pas encore de décision">
            Show · pitché
          </button>
          <button className={btn} disabled={busy} onClick={() => setMode(mode === "follow-up" ? "" : "follow-up")} title="En réflexion ou R2 à caler : une relance est programmée">
            ⏳ En attente
          </button>
          <button className={btn} disabled={busy} onClick={() => setMode(mode === "rescheduled" ? "" : "rescheduled")} title="Le call est décalé à une autre date">
            ↻ Reprogrammer
          </button>
          <button className={btn} disabled={busy} onClick={() => void send("no-show")} title="Le prospect n'est pas venu">
            No-show
          </button>
          <button className={btn} disabled={busy} onClick={() => setMode(mode === "closed-lost" ? "" : "closed-lost")} style={{ color: "var(--critical)" }}>
            Perdu
          </button>
          <span className="flex-1" />
          {!sale && (
            <>
              <button className={`${btn} btn-primary`} disabled={busy} onClick={() => void openSale(false)} title="Vente conclue : montant, encaissé aujourd'hui, en combien de fois">
                ✓ Closé
              </button>
              <button className={btn} disabled={busy} onClick={() => void openSale(true)} title="Vente conclue, contrat envoyé, rien encaissé pour l'instant">
                Contrat envoyé
              </button>
            </>
          )}
          {!last && (
            <>
              <button className={btn} disabled={busy} onClick={() => void leadStatus("no-answer", `${lead.name} : ne répond pas.`)} title="Appelé, pas de réponse">
                Ne répond pas
              </button>
              <button className={btn} disabled={busy} onClick={() => setMode(mode === "callback" ? "" : "callback")} title="Le prospect demande à être rappelé">
                À rappeler
              </button>
            </>
          )}
        </div>
      ) : (
        <div className="dim text-[12px]">Seul un closer (ou l&apos;admin) pose l&apos;issue d&apos;un call.</div>
      )}

      {mode === "closed-won" && (
        <div className="grid sm:grid-cols-2 gap-2.5 pt-1" style={{ borderTop: "1px solid var(--border)" }}>
          <Field label="Offre">
            <input className="input !h-[34px]" list="outcome-offers" value={offer} onChange={(e) => setOffer(e.target.value)} placeholder="Coaching…" />
            <datalist id="outcome-offers">
              {offers.map((o) => (
                <option key={o.name} value={o.name} />
              ))}
            </datalist>
          </Field>
          <Field label={`Montant du contrat (${currency})`}>
            <input
              className="input !h-[34px] num"
              inputMode="decimal"
              value={contract}
              onChange={(e) => {
                setContract(e.target.value);
                if (n(cash) > 0 && Number(times) === 1) setCash(e.target.value);
              }}
              placeholder="2500"
            />
          </Field>
          <Field label={`Encaissé aujourd'hui (${currency})`}>
            <div className="flex items-center gap-1.5">
              <input className="input !h-[34px] num flex-1" inputMode="decimal" value={cash} onChange={(e) => setCash(e.target.value)} placeholder="0" />
              <button type="button" className="btn btn-sm !h-[34px]" onClick={() => setCash(String(n(contract)))} title="Tout encaissé aujourd'hui">
                Tout
              </button>
              <button type="button" className="btn btn-sm !h-[34px]" onClick={() => setCash(n(contract) && Number(times) > 1 ? String(Math.round((n(contract) / Number(times)) * 100) / 100) : "0")} title="La première échéance d'un paiement en plusieurs fois">
                1/{times}
              </button>
              <button type="button" className="btn btn-sm !h-[34px]" onClick={() => setCash("0")} title="Contrat envoyé, rien reçu pour l'instant">
                Rien
              </button>
            </div>
          </Field>
          <Field label="Payé en">
            <select className="select !h-[34px]" value={times} onChange={(e) => setTimes(e.target.value)}>
              {[1, 2, 3, 4, 6, 12].map((k) => (
                <option key={k} value={String(k)}>
                  {k === 1 ? "1 fois (one shot)" : `${k} fois`}
                </option>
              ))}
            </select>
          </Field>
          {n(cash) <= 0 && (
            <Field label="1er paiement attendu le" hint="Passée sans paiement, la vente remonte en « paiement non reçu ».">
              <input type="date" className="input !h-[34px] !w-auto num" value={expectedAt} min={today} onChange={(e) => setExpectedAt(e.target.value)} />
            </Field>
          )}
          {session.isAdmin && closers.length > 0 && (
            <Field label="Closer">
              <select className="select !h-[34px]" value={closerId} onChange={(e) => setCloserId(e.target.value)}>
                <option value="">—</option>
                {closers.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </Field>
          )}
          <Field label="Note (optionnel)" className="sm:col-span-2">
            <input className="input !h-[34px]" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Contrat envoyé par mail, paie à la réception…" />
          </Field>
          {preview && (
            <div className="sm:col-span-2 text-[12.5px] rounded-[8px] px-3 py-2" style={{ background: "var(--surface-2)" }}>
              <span className="dim">Plan : </span>
              {preview}
            </div>
          )}
          <div className="sm:col-span-2 flex items-center gap-2">
            <button
              className="btn btn-primary"
              disabled={busy || n(contract) <= 0 || n(cash) > n(contract)}
              onClick={() => void send("closed-won", { sale: { offer, contractValue: n(contract), cashCollected: Math.min(n(cash), n(contract)), installments: Number(times), paymentExpectedAt: n(cash) <= 0 ? expectedAt : "" } })}
            >
              {busy ? <span className="spinner" /> : n(cash) <= 0 ? "Enregistrer la vente · paiement attendu" : n(cash) < n(contract) ? "Enregistrer la vente · reste dû suivi" : "Enregistrer la vente"}
            </button>
            <button className="btn btn-ghost" onClick={() => setMode("")} disabled={busy}>
              Annuler
            </button>
          </div>
        </div>
      )}

      {mode === "follow-up" && (
        <div className="flex items-end gap-2 flex-wrap pt-1" style={{ borderTop: "1px solid var(--border)" }}>
          <Field label="Relancer le">
            <input type="datetime-local" className="input !h-[34px] !w-auto" value={followUpAt} onChange={(e) => setFollowUpAt(e.target.value)} />
          </Field>
          <div className="flex gap-1 pb-[2px]">
            {[1, 2, 3, 7].map((d) => (
              <button key={d} type="button" className="btn btn-sm !h-[34px]" onClick={() => setFollowUpAt(isoToParisInput(new Date(Date.now() + d * 86_400_000)).slice(0, 10) + "T10:00")}>
                J+{d}
              </button>
            ))}
          </div>
          <Field label="Note (optionnel)" className="flex-1 min-w-[180px]">
            <input className="input !h-[34px]" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Doit en parler à sa femme, R2 jeudi…" />
          </Field>
          <button className="btn btn-primary !h-[34px]" disabled={busy || !followUpAt} onClick={() => void send("follow-up", { followUpAt: parisToIso(followUpAt) })}>
            Programmer
          </button>
        </div>
      )}

      {mode === "rescheduled" && (
        <div className="flex items-end gap-2 flex-wrap pt-1" style={{ borderTop: "1px solid var(--border)" }}>
          <Field label="Nouvelle date du call">
            <input type="datetime-local" className="input !h-[34px] !w-auto" value={rescheduledAt} onChange={(e) => setRescheduledAt(e.target.value)} />
          </Field>
          <Field label="Note (optionnel)" className="flex-1 min-w-[180px]">
            <input className="input !h-[34px]" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Empêchement, redécalé à sa demande…" />
          </Field>
          <button className="btn btn-primary !h-[34px]" disabled={busy || !rescheduledAt} onClick={() => void send("rescheduled", { rescheduledAt: parisToIso(rescheduledAt) })}>
            Reprogrammer
          </button>
        </div>
      )}

      {mode === "closed-lost" && (
        <div className="flex items-end gap-2 flex-wrap pt-1" style={{ borderTop: "1px solid var(--border)" }}>
          <Field label="Raison">
            <select className="select !h-[34px]" value={reason} onChange={(e) => setReason(e.target.value)}>
              {LOST.map((r) => (
                <option key={r.key} value={r.key}>
                  {r.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Note (optionnel)" className="flex-1 min-w-[180px]">
            <input className="input !h-[34px]" value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
          {last ? (
            <button className="btn !h-[34px]" style={{ borderColor: "var(--critical)", color: "var(--critical)" }} disabled={busy} onClick={() => void send("closed-lost", { lostReason: reason })}>
              Marquer perdu
            </button>
          ) : (
            <button className="btn !h-[34px]" style={{ borderColor: "var(--critical)", color: "var(--critical)" }} disabled={busy} onClick={() => void leadStatus("not-interested", `${lead.name} : pas intéressé, sort de la liste.`)} title="Pas de call : le lead sort simplement de la liste">
              Pas intéressé
            </button>
          )}
        </div>
      )}

      {mode === "callback" && (
        <div className="flex items-end gap-2 flex-wrap pt-1" style={{ borderTop: "1px solid var(--border)" }}>
          <Field label="Rappeler le">
            <input type="datetime-local" className="input !h-[34px] !w-auto" value={callbackAt} onChange={(e) => setCallbackAt(e.target.value)} />
          </Field>
          <Field label="Note (optionnel)" className="flex-1 min-w-[180px]">
            <input className="input !h-[34px]" value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
          <button className="btn btn-primary !h-[34px]" disabled={busy || !callbackAt} onClick={() => void leadStatus("callback", `Rappel noté pour ${lead.name}.`, { callbackAt: parisToIso(callbackAt) })}>
            Noter le rappel
          </button>
        </div>
      )}

      {/* ----------------------------- L'argent ----------------------------- */}
      {sale && pay && (
        <div className="flex flex-col gap-2 pt-2" style={{ borderTop: "1px solid var(--border)" }}>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="label-xs">Paiement</span>
            <span className="text-[12.5px] font-semibold" style={{ color: stateColor }}>
              {PAYMENT_STATE_LABEL[pay.state]}
            </span>
            <span className="dim text-[12px]">· {pay.summary}</span>
          </div>
          <div className="grid grid-cols-3 gap-2 text-[12px]">
            <div>
              <div className="label-xs !text-[9.5px]">Contrat</div>
              <div className="num text-[14px] font-semibold">{fmtMoney(pay.contractValue, currency)}</div>
            </div>
            <div>
              <div className="label-xs !text-[9.5px]">Encaissé</div>
              <div className="num text-[14px] font-semibold" style={{ color: pay.cashCollected > 0 ? "var(--good)" : undefined }}>
                {fmtMoney(pay.cashCollected, currency)}
              </div>
            </div>
            <div>
              <div className="label-xs !text-[9.5px]">Reste</div>
              <div className="num text-[14px] font-semibold" style={{ color: pay.remaining > 0 ? (pay.state === "overdue" ? "var(--critical)" : "var(--text)") : "var(--good)" }}>
                {pay.remaining > 0 ? fmtMoney(pay.remaining, currency) : "soldé ✓"}
              </div>
            </div>
          </div>

          {canPay && mode !== "fix" && (
            <div>
              <button className="btn btn-sm btn-ghost !h-[26px] !px-2" disabled={busy} onClick={openFix} title="Le contrat, l'encaissé ou l'échéancier est faux : corrige-le ici">
                ✎ Corriger la vente
              </button>
            </div>
          )}

          {mode === "fix" && (
            <div className="rounded-[8px] px-3 py-2.5 flex flex-col gap-2" style={{ background: "var(--surface-2)", border: "1px solid var(--border)" }}>
              <div className="text-[12.5px] font-semibold">Corriger la vente</div>
              <div className="flex items-end gap-2 flex-wrap">
                <Field label={`Contrat (${currency})`}>
                  <input className="input !h-[34px] !w-[120px] num" inputMode="decimal" value={fixContract} onChange={(e) => setFixContract(e.target.value)} autoFocus />
                </Field>
                <Field label={`Déjà encaissé (${currency})`}>
                  <input className="input !h-[34px] !w-[120px] num" inputMode="decimal" value={fixCash} onChange={(e) => setFixCash(e.target.value)} />
                </Field>
                <Field label="Payé en">
                  <select className="select !h-[34px]" value={fixTimes} onChange={(e) => setFixTimes(e.target.value)}>
                    {[1, 2, 3, 4, 6, 12].map((k) => (
                      <option key={k} value={String(k)}>
                        {k} fois
                      </option>
                    ))}
                  </select>
                </Field>
                {n(fixContract) - Math.min(n(fixCash), n(fixContract)) > 0 && (
                  <Field label={n(fixCash) > 0 ? "Prochaine échéance le" : "1er paiement attendu le"}>
                    <input type="date" className="input !h-[34px] !w-auto num" value={fixNextAt} onChange={(e) => setFixNextAt(e.target.value)} />
                  </Field>
                )}
              </div>
              <div className="dim text-[12px]">
                {n(fixContract) <= 0
                  ? "Indique la valeur du contrat."
                  : n(fixCash) > n(fixContract)
                    ? "L'encaissé dépasse le contrat."
                    : fixPlan.length === 0
                      ? `${fmtMoney(n(fixContract), currency)} de contrat, soldé.`
                      : `${fmtMoney(Math.min(n(fixCash), n(fixContract)), currency)} encaissés · ${fixPlan.map((it) => `${fmtMoney(it.amount, currency)} le ${fmtDay(it.dueAt)}`).join(" · ")}`}
              </div>
              <div className="flex items-center gap-2">
                <button className="btn btn-primary !h-[34px]" disabled={busy || n(fixContract) <= 0 || n(fixCash) > n(fixContract) || (n(fixContract) > n(fixCash) && !/^\d{4}-\d{2}-\d{2}$/.test(fixNextAt))} onClick={sendFix}>
                  Enregistrer la correction
                </button>
                <button className="btn btn-ghost !h-[34px]" onClick={() => setMode("")}>
                  Annuler
                </button>
              </div>
            </div>
          )}

          {pay.state === "unspecified" && canPay && (
            <div className="rounded-[8px] px-3 py-2.5 flex flex-col gap-2" style={{ background: "color-mix(in srgb, var(--warning) 10%, transparent)", border: "1px solid color-mix(in srgb, var(--warning) 35%, transparent)" }}>
              <div className="text-[12.5px] font-semibold">Vente remontée par iClosed : comment paie-t-il ?</div>
              <div className="flex items-center gap-1.5 flex-wrap">
                <button className="btn btn-sm btn-primary" disabled={busy} onClick={() => void saleCall("PATCH", { cashCollected: pay.contractValue, installments: 1, paymentType: "paid-in-full" }, "Payé en une fois : contrat soldé.")}>
                  Tout payé · 1 fois
                </button>
                {[2, 3].map((k) => (
                  <button key={k} className="btn btn-sm" disabled={busy} onClick={() => void saleCall("PATCH", { cashCollected: Math.round((pay.contractValue / k) * 100) / 100, installments: k, paymentType: "installments" }, `Payé en ${k} fois : 1re échéance encaissée, les suivantes suivies.`)}>
                    En {k} fois · 1re reçue
                  </button>
                ))}
                <button className="btn btn-sm" disabled={busy} onClick={() => setMode(mode === "specify" ? "" : "specify")}>
                  Autre…
                </button>
              </div>
              {mode === "specify" && (
                <div className="flex items-end gap-2 flex-wrap">
                  <Field label="Payé en">
                    <select className="select !h-[34px]" value={specTimes} onChange={(e) => setSpecTimes(e.target.value)}>
                      {[1, 2, 3, 4, 6, 12].map((k) => (
                        <option key={k} value={String(k)}>
                          {k} fois
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label={`Déjà encaissé (${currency})`}>
                    <input className="input !h-[34px] !w-[120px] num" inputMode="decimal" value={specFirst} onChange={(e) => setSpecFirst(e.target.value)} placeholder="0" />
                  </Field>
                  {n(specFirst) <= 0 && (
                    <Field label="1er paiement attendu le">
                      <input type="date" className="input !h-[34px] !w-auto num" value={specExpected} onChange={(e) => setSpecExpected(e.target.value)} />
                    </Field>
                  )}
                  <button
                    className="btn btn-primary !h-[34px]"
                    disabled={busy || n(specFirst) > pay.contractValue}
                    onClick={() => void saleCall("PATCH", { cashCollected: n(specFirst), installments: Number(specTimes), paymentType: n(specFirst) >= pay.contractValue ? "paid-in-full" : Number(specTimes) > 1 ? "installments" : "other", paymentExpectedAt: n(specFirst) <= 0 ? specExpected : "" }, "Paiement précisé.")}
                  >
                    Enregistrer
                  </button>
                </div>
              )}
            </div>
          )}

          {schedule.length > 0 && pay.state !== "unspecified" && (
            <ul className="flex flex-col gap-1">
              {schedule.map((it) => {
                const state = it.paidAt ? "paid" : it.dueAt < today ? "overdue" : it.dueAt === today ? "today" : "soon";
                const color = state === "paid" ? "var(--good)" : state === "overdue" ? "var(--critical)" : state === "today" ? "var(--warning)" : "var(--text-3)";
                return (
                  <li key={it.n} className="flex items-center gap-2 flex-wrap text-[12.5px] rounded-[8px] px-2.5 py-1.5" style={{ background: "var(--surface-2)", borderLeft: `3px solid ${color}` }}>
                    <span className="font-semibold">
                      {it.n === 1 && pay.cashCollected <= 0 ? "1er paiement" : `Échéance ${it.n}/${pay.times}`}
                    </span>
                    <span className="num font-semibold">{fmtMoney(it.amount, currency)}</span>
                    <span className="num dim">le {fmtDay(it.dueAt)}</span>
                    <span className="text-[11.5px] font-semibold" style={{ color }}>
                      {state === "paid" ? `✓ encaissée le ${fmtDay(it.paidAt)}` : state === "overdue" ? "⚠ en retard" : state === "today" ? "● aujourd'hui" : "à venir · à jour"}
                    </span>
                    {canPay && !it.paidAt && (
                      <button className="btn btn-sm btn-primary ml-auto !h-[26px]" disabled={busy} onClick={() => void saleCall("POST", { amount: it.amount, installmentN: it.n }, `${fmtMoney(it.amount, currency)} encaissés ✓`)}>
                        Encaissé ✓
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}

          {pay.remaining > 0 && canPay && pay.state !== "unspecified" && (
            <div className="flex items-center gap-1.5 flex-wrap">
              <button className="btn btn-sm" disabled={busy} onClick={() => setMode(mode === "collect" ? "" : "collect")}>
                + Paiement reçu (autre montant)
              </button>
              {pay.state === "open" && (
                <>
                  <span className="dim text-[12px]">Planifier le reste :</span>
                  {[1, 2, 3].map((k) => (
                    <button key={k} className="btn btn-sm" disabled={busy} onClick={() => void saleCall("PATCH", { installments: pay.paidCount + k, paymentType: "installments" }, `Reste planifié en ${k} fois.`)}>
                      en {k} fois
                    </button>
                  ))}
                </>
              )}
              {pay.cashCollected <= 0 && (
                <button className="btn btn-sm ml-auto" style={{ color: "var(--critical)", borderColor: "color-mix(in srgb, var(--critical) 50%, transparent)" }} disabled={busy} onClick={() => setMode(mode === "unpaid" ? "" : "unpaid")} title="Le client ne paie pas : la vente est annulée, le chiffre d'affaires redescend, le call repasse en perdu">
                  Il n&apos;a pas payé → annuler la vente
                </button>
              )}
            </div>
          )}

          {mode === "collect" && (
            <div className="flex items-end gap-2 flex-wrap">
              <Field label={`Montant reçu (${currency})`} hint={`Maximum ${fmtMoney(pay.remaining, currency)}`}>
                <input className="input !h-[34px] !w-[140px] num" inputMode="decimal" value={colAmount} onChange={(e) => setColAmount(e.target.value)} autoFocus />
              </Field>
              <Field label="Reçu le">
                <input type="date" className="input !h-[34px] !w-auto num" value={colAt} onChange={(e) => setColAt(e.target.value)} />
              </Field>
              <button className="btn btn-primary !h-[34px]" disabled={busy || n(colAmount) <= 0 || n(colAmount) > pay.remaining + 0.005} onClick={() => void saleCall("POST", { amount: n(colAmount), at: `${colAt}T12:00:00.000Z` }, `${fmtMoney(n(colAmount), currency)} encaissés ✓`)}>
                Enregistrer
              </button>
              <button className="btn btn-ghost !h-[34px]" onClick={() => setMode("")}>
                Annuler
              </button>
            </div>
          )}

          {mode === "unpaid" && (
            <div className="rounded-[8px] px-3 py-2.5 flex flex-col gap-2" style={{ background: "color-mix(in srgb, var(--critical) 8%, transparent)", border: "1px solid color-mix(in srgb, var(--critical) 35%, transparent)" }}>
              <div className="text-[12.5px]">
                La vente de <strong className="num">{fmtMoney(pay.contractValue, currency)}</strong> sera annulée : elle sort du chiffre d&apos;affaires et des commissions, le call repasse en « perdu · pas le budget ». Elle reste dans l&apos;historique.
              </div>
              <div className="flex items-end gap-2 flex-wrap">
                <Field label="Pourquoi (optionnel)" className="flex-1 min-w-[180px]">
                  <input className="input !h-[34px]" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Plus de nouvelles depuis le contrat…" />
                </Field>
                <button className="btn !h-[34px]" style={{ background: "var(--critical)", color: "#fff", borderColor: "var(--critical)" }} disabled={busy} onClick={() => void saleCall("PATCH", { action: "unpaid", note }, "Vente annulée : le client n'a pas payé.")}>
                  Confirmer l&apos;annulation
                </button>
                <button className="btn btn-ghost !h-[34px]" onClick={() => setMode("")}>
                  Garder la vente
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
