"use client";

import { useState } from "react";
import Link from "next/link";
import { api } from "@/lib/client";
import { fmtDate, fmtInt, fmtMoney, label } from "@/lib/format";
import { periodQuery, useSalesData } from "@/lib/sales/client";
import { describeRule } from "@/lib/sales/commissions";
import { Card, Empty, ErrorNote, Field, Modal, PageHeader, Spinner, StatTile, useToast } from "@/components/ui";
import { PeriodPicker } from "@/components/sales/bits";
import { useSales } from "@/components/sales/context";
import type { LedgerRow } from "@/lib/sales/commissions";
import type { CommissionAdjustment, CommissionPayment } from "@/lib/types";

interface LedgerPayload {
  rows: LedgerRow[];
  payments: (CommissionPayment & { memberName: string })[];
  /** Bonus / malus poses par le proprietaire (les siens pour un membre). */
  adjustments: (CommissionAdjustment & { memberName: string })[];
  /** Conversations perdues (laissees dormir) et reprises aux autres, par membre, sur la periode. */
  takeovers: Record<string, { lost: number; taken: number }>;
  currency: string;
  isAdmin: boolean;
}

/**
 * Grand livre des commissions.
 *
 * Le solde du n'est jamais un champ que l'on remet a zero : c'est toujours
 * « tout ce qui a ete gagne moins tout ce qui a ete verse ». Marquer un
 * paiement ajoute donc une ligne d'historique, ce qui permet de retracer six
 * mois plus tard qui a recu quoi et quand.
 */
export default function CommissionsPage() {
  const { period, setPeriod, version, bump } = useSales();
  const toast = useToast();

  const [paying, setPaying] = useState<LedgerRow | null>(null);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("");
  const [notes, setNotes] = useState("");
  const [allowOverpay, setAllowOverpay] = useState(false);
  const [bonus, setBonus] = useState(false);
  const [saving, setSaving] = useState(false);
  const [detail, setDetail] = useState<LedgerRow | null>(null);

  /* --- Bonus / malus (admin) --- */
  const [adjMember, setAdjMember] = useState("");
  const [adjKind, setAdjKind] = useState<"bonus" | "malus">("bonus");
  const [adjMode, setAdjMode] = useState<"amount" | "pct">("amount");
  const [adjValue, setAdjValue] = useState("");
  const [adjReason, setAdjReason] = useState("");
  const [adjAt, setAdjAt] = useState(() => new Date().toISOString().slice(0, 10));
  const [adjSaving, setAdjSaving] = useState(false);

  const { data, loading, error, reload } = useSalesData<LedgerPayload>(
    `/api/sales/commissions?${periodQuery(period.period, period.from, period.to, { v: String(version) })}`,
  );

  const currency = data?.currency ?? "EUR";
  const rows = data?.rows ?? [];
  const totalDue = rows.reduce((a, r) => a + r.due, 0);
  const totalEarned = rows.reduce((a, r) => a + r.earnedInPeriod, 0);
  const totalPaid = rows.reduce((a, r) => a + r.paidTotal, 0);

  const openPay = (row: LedgerRow) => {
    setPaying(row);
    // Pre-rempli avec le solde : le cas courant est de solder d'un coup.
    setAmount(row.due > 0 ? String(row.due) : "");
    setMethod("");
    setNotes("");
    setAllowOverpay(false);
    setBonus(false);
  };

  const pay = async () => {
    if (!paying) return;
    const value = Number(amount);
    if (!(value > 0)) return toast("Indique un montant supérieur à 0.", "err");

    setSaving(true);
    try {
      await api("/api/sales/commissions/pay", {
        method: "POST",
        body: JSON.stringify({
          memberId: paying.memberId,
          amount: value,
          currency,
          method,
          notes,
          allowOverpay,
          kind: bonus ? "bonus" : "commission",
          paidAt: new Date().toISOString(),
        }),
      });
      toast(`${fmtMoney(value, currency)} versés à ${paying.name}.`);
      setPaying(null);
      void reload();
      bump();
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setSaving(false);
    }
  };

  const addAdjustment = async () => {
    const [memberId, role] = adjMember.split(":");
    if (!memberId) return toast("Choisis le membre.", "err");
    const value = Number(adjValue);
    if (!(value > 0)) return toast("Indique une valeur supérieure à 0.", "err");
    if (!adjReason.trim()) return toast("Donne le motif : c'est ce que le membre lira.", "err");
    setAdjSaving(true);
    try {
      await api("/api/sales/commissions/adjust", {
        method: "POST",
        body: JSON.stringify({ memberId, role, kind: adjKind, mode: adjMode, value, reason: adjReason.trim(), at: `${adjAt}T12:00:00.000Z` }),
      });
      toast(adjKind === "bonus" ? "Bonus enregistré, le membre est prévenu." : "Malus enregistré, le membre est prévenu.");
      setAdjValue("");
      setAdjReason("");
      void reload();
      bump();
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setAdjSaving(false);
    }
  };

  const removeAdjustment = async (a: CommissionAdjustment & { memberName: string }) => {
    if (!window.confirm(`Retirer ce ${a.kind} pour ${a.memberName} ?`)) return;
    try {
      await api("/api/sales/commissions/adjust", { method: "DELETE", body: JSON.stringify({ id: a.id }) });
      toast("Ajustement retiré.");
      void reload();
      bump();
    } catch (e) {
      toast((e as Error).message, "err");
    }
  };

  const adjLabel = (a: CommissionAdjustment) => (a.mode === "pct" ? `${a.kind === "malus" ? "−" : "+"}${a.value} % du mois` : `${a.kind === "malus" ? "−" : "+"}${fmtMoney(a.value, a.currency)}`);

  return (
    <>
      <PageHeader title="Commissions" actions={<PeriodPicker value={period} onChange={setPeriod} />} />

      {error && (
        <div className="mb-4">
          <ErrorNote>{error}</ErrorNote>
        </div>
      )}

      <div className="grid grid-cols-3 gap-3 mb-4">
        <StatTile label="Gagné sur la période" value={fmtMoney(totalEarned, currency)} />
        <StatTile label="Déjà versé (cumul)" value={fmtMoney(totalPaid, currency)} />
        <StatTile
          label="Reste dû"
          value={fmtMoney(totalDue, currency)}
          accent={totalDue > 0 ? "var(--warning)" : "var(--good)"}
        />
      </div>

      {loading && !data ? (
        <Card>
          <Spinner label="Calcul des commissions…" />
        </Card>
      ) : !rows.length ? (
        <Card>
          <Empty
            action={
              <Link href="/sales/equipe" className="btn btn-primary">
                Configurer l&apos;équipe
              </Link>
            }
          >
            Aucun setter ni closer configuré. Crée les comptes et leurs règles de commission pour voir apparaître
            le grand livre.
          </Empty>
        </Card>
      ) : (
        <Card padded={false} className="mb-4">
          <div className="scroll-x">
            <table className="table">
              <thead>
                <tr>
                  <th>Membre</th>
                  <th>Rôle</th>
                  <th>Règle</th>
                  <th className="text-right">Rdv</th>
                  <th className="text-right">Shows</th>
                  <th className="text-right">Ventes</th>
                  <th className="text-right">CA</th>
                  <th className="text-right">Cash</th>
                  <th className="text-right">Gagné (période)</th>
                  <th className="text-right">Versé (cumul)</th>
                  <th className="text-right">Reste dû</th>
                  {data?.isAdmin && <th />}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={`${r.memberId}-${r.role}`} className="cursor-pointer" onClick={() => setDetail(r)}>
                    <td>
                      <Link
                        href={`/sales/membre/${r.memberId}`}
                        className="link text-[12.5px]"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {r.name}
                      </Link>
                    </td>
                    <td>
                      <span className="badge !text-[10.5px] !py-0">{label(r.role)}</span>
                    </td>
                    <td className="text-[11.5px] dim max-w-[190px] truncate">
                      {describeRule(r.rule, currency)}
                    </td>
                    <td className="text-right num">{fmtInt(r.appointments)}</td>
                    <td className="text-right num">{fmtInt(r.shows)}</td>
                    <td className="text-right num">{fmtInt(r.sales)}</td>
                    <td className="text-right num">{fmtMoney(r.revenue, currency)}</td>
                    <td className="text-right num" style={{ color: "var(--emerald)" }}>
                      {fmtMoney(r.cashCollected, currency)}
                    </td>
                    <td className="text-right num font-semibold">{fmtMoney(r.earnedInPeriod, currency)}</td>
                    <td className="text-right num">{fmtMoney(r.paidTotal, currency)}</td>
                    <td
                      className="text-right num font-semibold"
                      style={{ color: r.due > 0 ? "var(--warning)" : "var(--text-3)" }}
                    >
                      {fmtMoney(r.due, currency)}
                    </td>
                    {data?.isAdmin && (
                      <td onClick={(e) => e.stopPropagation()}>
                        <button className="btn btn-sm btn-primary" onClick={() => openPay(r)} disabled={r.due <= 0}>
                          Marquer payé
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Bonus / malus : le proprietaire juge le setting, le membre voit le motif. */}
      {data && (data.isAdmin || data.adjustments.length > 0) && (
        <Card
          title="Bonus / malus"
          subtitle={
            data.isAdmin
              ? "Un setting propre (prospects vraiment qualifiés, notes claires) mérite un bonus ; un setting bâclé ou des conversations laissées dormir, un malus. Le membre est prévenu sur Telegram et voit le motif ici."
              : "Posés par Mady selon la qualité du setting. Ils entrent dans ton gagné et ton reste dû."
          }
          padded={false}
          className="mb-4"
        >
          {data.isAdmin && (
            <div className="px-4 pt-4 pb-3 flex flex-wrap items-end gap-2.5" style={{ borderBottom: "1px solid var(--border)" }}>
              <Field label="Membre">
                <select className="select select-sm" value={adjMember} onChange={(e) => setAdjMember(e.target.value)}>
                  <option value="">Choisir…</option>
                  {rows.map((r) => (
                    <option key={`${r.memberId}:${r.role}`} value={`${r.memberId}:${r.role}`}>
                      {r.name} · {label(r.role)}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Type">
                <select className="select select-sm" value={adjKind} onChange={(e) => setAdjKind(e.target.value as "bonus" | "malus")}>
                  <option value="bonus">Bonus</option>
                  <option value="malus">Malus</option>
                </select>
              </Field>
              <Field label="Calcul">
                <select className="select select-sm" value={adjMode} onChange={(e) => setAdjMode(e.target.value as "amount" | "pct")}>
                  <option value="amount">Montant ({currency})</option>
                  <option value="pct">% du gagné du mois</option>
                </select>
              </Field>
              <Field label={adjMode === "pct" ? "%" : currency}>
                <input className="input num !w-[90px]" type="number" min={0} value={adjValue} onChange={(e) => setAdjValue(e.target.value)} />
              </Field>
              <Field label="Date">
                <input className="input !w-[150px]" type="date" value={adjAt} onChange={(e) => setAdjAt(e.target.value)} />
              </Field>
              <Field label="Motif (lu par le membre)">
                <input className="input !w-[280px]" value={adjReason} placeholder="Ex. 4 prospects très bien qualifiés cette semaine" onChange={(e) => setAdjReason(e.target.value)} />
              </Field>
              <button className="btn btn-primary" disabled={adjSaving} onClick={() => void addAdjustment()}>
                {adjSaving ? <span className="spinner" /> : adjKind === "bonus" ? "Donner le bonus" : "Poser le malus"}
              </button>
            </div>
          )}
          {data.isAdmin && Object.keys(data.takeovers).length > 0 && (
            <div className="px-4 py-2.5 flex flex-wrap gap-x-5 gap-y-1 text-[12px] dim" style={{ borderBottom: "1px solid var(--border)" }} title="Règle de l'heure : conversations reprises par un autre setter sur la période">
              <span className="font-medium" style={{ color: "var(--text)" }}>Règle de l&apos;heure sur la période :</span>
              {rows
                .filter((r) => r.role === "setter" && data.takeovers[r.memberId])
                .map((r) => (
                  <span key={r.memberId}>
                    {r.name} · <span style={{ color: data.takeovers[r.memberId].lost ? "var(--warning)" : undefined }}>{data.takeovers[r.memberId].lost} perdue{data.takeovers[r.memberId].lost > 1 ? "s" : ""}</span> · {data.takeovers[r.memberId].taken} reprise{data.takeovers[r.memberId].taken > 1 ? "s" : ""}
                  </span>
                ))}
            </div>
          )}
          {data.adjustments.length === 0 ? (
            <div className="px-4 py-4">
              <Empty>Aucun bonus ni malus pour le moment.</Empty>
            </div>
          ) : (
            <div className="scroll-x">
              <table className="table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Membre</th>
                    <th>Type</th>
                    <th className="text-right">Valeur</th>
                    <th>Motif</th>
                    {data.isAdmin && <th />}
                  </tr>
                </thead>
                <tbody>
                  {data.adjustments.map((a) => (
                    <tr key={a.id}>
                      <td className="num">{fmtDate(a.at)}</td>
                      <td className="text-[12.5px]">
                        {a.memberName} <span className="dim">· {label(a.role)}</span>
                      </td>
                      <td>
                        <span className="badge !text-[10.5px] !py-0" style={{ color: a.kind === "malus" ? "var(--danger, #ef4444)" : "var(--good)" }}>
                          {a.kind === "malus" ? "Malus" : "Bonus"}
                        </span>
                      </td>
                      <td className="text-right num font-semibold" style={{ color: a.kind === "malus" ? "var(--danger, #ef4444)" : "var(--good)" }}>
                        {adjLabel(a)}
                      </td>
                      <td className="text-[12px] max-w-[320px] truncate" title={a.reason}>{a.reason}</td>
                      {data.isAdmin && (
                        <td className="text-right">
                          <button className="btn btn-sm btn-ghost" onClick={() => void removeAdjustment(a)} title="Retirer">
                            ✕
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {/* Historique des versements : jamais efface, jamais ecrase. */}
      {data && data.payments.length > 0 && (
        <Card title="Historique des versements" padded={false}>
          <div className="scroll-x">
            <table className="table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Membre</th>
                  <th className="text-right">Montant</th>
                  <th>Moyen</th>
                  <th>Note</th>
                </tr>
              </thead>
              <tbody>
                {data.payments.map((p) => (
                  <tr key={p.id}>
                    <td className="num">{fmtDate(p.paidAt)}</td>
                    <td className="text-[12.5px]">{p.memberName}</td>
                    <td className="text-right num font-semibold">{fmtMoney(p.amount, p.currency)}</td>
                    <td className="text-[12.5px]">{p.method || <span className="dim">—</span>}</td>
                    <td className="text-[12px] max-w-[240px] truncate">
                      {p.kind === "bonus" && <span className="badge !text-[10px] !py-0 mr-1.5">Prime</span>}
                      {p.notes || <span className="dim">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Detail des lignes : d'ou vient exactement le montant gagne. */}
      <Modal
        open={detail !== null}
        onClose={() => setDetail(null)}
        wide
        title={detail ? `Détail — ${detail.name}` : ""}
      >
        {!detail?.entries.length ? (
          <Empty>Aucune commission générée sur cette période.</Empty>
        ) : (
          <div className="scroll-x">
            <table className="table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Origine</th>
                  <th>Calcul</th>
                  <th className="text-right">Montant</th>
                </tr>
              </thead>
              <tbody>
                {detail.entries.map((e, i) => (
                  <tr key={`${e.sourceId}-${i}`}>
                    <td className="num">{fmtDate(e.at)}</td>
                    <td>
                      <span className="badge !text-[10.5px] !py-0">
                        {e.kind === "sale" ? "Vente" : e.kind === "show" ? "Call honoré" : e.kind === "fixed" ? "Fixe" : e.kind === "adjustment" ? (e.amount < 0 ? "Malus" : "Bonus") : "Rendez-vous"}
                      </span>
                    </td>
                    <td className="text-[12px]">{e.detail}</td>
                    <td className="text-right num font-semibold" style={{ color: e.amount < 0 ? "var(--danger, #ef4444)" : undefined }}>{fmtMoney(e.amount, e.currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Modal>

      {/* Versement */}
      <Modal
        open={paying !== null}
        onClose={() => setPaying(null)}
        title={paying ? `Verser une commission — ${paying.name}` : ""}
        footer={
          <>
            <button className="btn" onClick={() => setPaying(null)}>
              Annuler
            </button>
            <button className="btn btn-primary" onClick={() => void pay()} disabled={saving}>
              {saving ? <span className="spinner" /> : "Enregistrer le versement"}
            </button>
          </>
        }
      >
        {paying && (
          <div className="flex flex-col gap-3.5">
            <div className="card-flat px-3.5 py-3 flex flex-wrap gap-x-6 gap-y-1.5">
              <span className="text-[12.5px]">
                <span className="dim">Gagné au total </span>
                <span className="num font-semibold">{fmtMoney(paying.earnedTotal, currency)}</span>
              </span>
              <span className="text-[12.5px]">
                <span className="dim">Déjà versé </span>
                <span className="num font-semibold">{fmtMoney(paying.paidTotal, currency)}</span>
              </span>
              <span className="text-[12.5px]">
                <span className="dim">Reste dû </span>
                <span className="num font-semibold" style={{ color: "var(--warning)" }}>
                  {fmtMoney(paying.due, currency)}
                </span>
              </span>
            </div>

            <Field label={`Montant versé (${currency})`}>
              <input
                className="input num"
                type="number"
                min={0}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                autoFocus
              />
            </Field>
            <Field label="Moyen de paiement">
              <input
                className="input"
                value={method}
                placeholder="Virement, Wise, PayPal…"
                onChange={(e) => setMethod(e.target.value)}
              />
            </Field>
            <Field label="Note">
              <input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} />
            </Field>

            <label className="flex items-center gap-2 text-[12.5px]">
              <input
                type="checkbox"
                checked={bonus}
                onChange={(e) => setBonus(e.target.checked)}
              />
              Prime hors commissions (onboarding, geste) : tracée, mais ne solde aucune commission
            </label>
            {!bonus && (
              <label className="flex items-center gap-2 text-[12.5px]">
                <input
                  type="checkbox"
                  checked={allowOverpay}
                  onChange={(e) => setAllowOverpay(e.target.checked)}
                />
                Autoriser une avance au-delà du solde dû
              </label>
            )}
          </div>
        )}
      </Modal>
    </>
  );
}
