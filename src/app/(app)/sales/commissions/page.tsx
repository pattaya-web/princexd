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
import type { CommissionPayment } from "@/lib/types";

interface LedgerPayload {
  rows: LedgerRow[];
  payments: (CommissionPayment & { memberName: string })[];
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
  const [saving, setSaving] = useState(false);
  const [detail, setDetail] = useState<LedgerRow | null>(null);

  const { data, loading, error, reload } = useSalesData<LedgerPayload>(
    `/api/sales/commissions?${periodQuery(period.period, period.from, period.to, { v: String(version) })}`,
  );

  const currency = data?.currency ?? "USD";
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
                        {e.kind === "sale" ? "Vente" : e.kind === "show" ? "Call honoré" : "Rendez-vous"}
                      </span>
                    </td>
                    <td className="text-[12px]">{e.detail}</td>
                    <td className="text-right num font-semibold">{fmtMoney(e.amount, e.currency)}</td>
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
                checked={allowOverpay}
                onChange={(e) => setAllowOverpay(e.target.checked)}
              />
              Autoriser une avance au-delà du solde dû
            </label>
          </div>
        )}
      </Modal>
    </>
  );
}
