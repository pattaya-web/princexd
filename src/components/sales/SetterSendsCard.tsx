"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@/lib/client";
import { fmtDate, fmtDateTime, fmtMoney } from "@/lib/format";
import { useSalesData } from "@/lib/sales/client";
import { Card, Empty, useToast } from "@/components/ui";
import { useSales } from "./context";
import type { SetterSendRow } from "@/app/api/sales/setter-sends/route";

/**
 * « À envoyer au setter » (2026-10-30).
 *
 * Chaque closing arrive ici avant d'être visible par le setter : Mady fixe le
 * contrat et l'encaissé qu'elle lui annonce (par défaut les vrais montants),
 * puis Envoyer. Le setter le voit alors dans son espace, sa commission se
 * calcule dessus, et il est prévenu sur Telegram s'il y est relié.
 */
export function SetterSendsCard() {
  const { version, bump } = useSales();
  const toast = useToast();
  const { data, reload } = useSalesData<{ pending: SetterSendRow[]; sent: SetterSendRow[] }>(`/api/sales/setter-sends?v=${version}`);
  const pending = data?.pending ?? [];
  const sent = data?.sent ?? [];
  const [draft, setDraft] = useState<Record<string, { amount: string; cash: string }>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [showSent, setShowSent] = useState(false);

  // Pré-remplissage : ce qui a déjà été saisi au closing, sinon les vrais montants.
  useEffect(() => {
    setDraft((d) => {
      const next = { ...d };
      for (const r of pending) {
        if (next[r.saleId]) continue;
        const amount = r.setterAmount ?? r.contractValue;
        const cash = r.setterCash ?? (r.setterAmount !== null ? (r.cashCollected > 0 ? r.setterAmount : 0) : r.cashCollected);
        next[r.saleId] = { amount: String(amount), cash: String(cash) };
      }
      return next;
    });
  }, [pending]);

  const send = async (r: SetterSendRow) => {
    const d = draft[r.saleId] ?? { amount: String(r.contractValue), cash: String(r.cashCollected) };
    const amount = Number(d.amount);
    const cash = Number(d.cash);
    if (!Number.isFinite(amount) || amount < 0) return toast("Contrat annoncé invalide.", "err");
    if (!Number.isFinite(cash) || cash < 0) return toast("Encaissé annoncé invalide.", "err");
    if (cash > amount + 0.005) return toast("L'encaissé annoncé dépasse le contrat annoncé.", "err");
    setBusy(r.saleId);
    try {
      const res = await api<{ notified: boolean }>("/api/sales/setter-sends", {
        method: "POST",
        body: JSON.stringify({ saleId: r.saleId, setterAmount: amount, setterCash: cash }),
      });
      toast(
        r.setterName
          ? `Closing de ${r.leadName} envoyé à ${r.setterName} : ${fmtMoney(amount, r.currency)} annoncés${res.notified ? " (prévenu sur Telegram)" : ""}.`
          : `Closing de ${r.leadName} classé (aucun setter dessus).`,
      );
      void reload();
      bump();
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setBusy(null);
    }
  };

  const set = (id: string, patch: Partial<{ amount: string; cash: string }>) => setDraft((d) => ({ ...d, [id]: { ...(d[id] ?? { amount: "", cash: "" }), ...patch } }));

  return (
    <Card
      title="Closings à envoyer au setter"
      subtitle={
        pending.length
          ? `${pending.length} closing${pending.length > 1 ? "s" : ""} que ${pending.length > 1 ? "tes setters ne voient" : "ton setter ne voit"} pas encore. Fixe ce que tu annonces, puis Envoyer.`
          : "Un call closé n'apparaît chez le setter que quand tu l'envoies d'ici, au montant que tu lui annonces. Rien en attente."
      }
      padded={false}
      actions={
        sent.length ? (
          <button className="btn btn-sm" onClick={() => setShowSent((v) => !v)}>
            {showSent ? "Masquer les envoyés" : `Envoyés (${sent.length})`}
          </button>
        ) : undefined
      }
    >
      {pending.length === 0 ? (
        <Empty>Aucun closing en attente d&apos;envoi.</Empty>
      ) : (
        <ul className="flex flex-col">
          {pending.map((r) => {
            const d = draft[r.saleId] ?? { amount: String(r.contractValue), cash: String(r.cashCollected) };
            return (
              <li key={r.saleId} className="flex flex-wrap items-center gap-3 px-3.5 py-2.5" style={{ borderBottom: "1px solid var(--border)" }}>
                <div className="flex flex-col min-w-[180px] flex-1">
                  <Link href={`/sales/rendez-vous?open=${r.appointmentId}`} className="text-[13px] font-medium link truncate" title="Ouvrir le call dans le CRM">
                    {r.leadName}
                    {r.igUsername ? <span className="dim font-normal"> · @{r.igUsername}</span> : null}
                  </Link>
                  <span className="dim text-[11.5px]">
                    {fmtDate(r.soldAt)} · setter {r.setterName ? <strong className="font-medium" style={{ color: "var(--text)" }}>{r.setterName}</strong> : <em>aucun</em>}
                    {r.closerName ? ` · closé par ${r.closerName}` : ""}
                    {r.offer ? ` · ${r.offer}` : ""}
                  </span>
                  <span className="dim text-[11.5px]" title="Ce que tu vois, toi : jamais montré au setter">
                    Réel : {fmtMoney(r.contractValue, r.currency)} · {fmtMoney(r.cashCollected, r.currency)} encaissés
                  </span>
                </div>
                <label className="flex flex-col gap-0.5">
                  <span className="label-xs">Contrat annoncé</span>
                  <input className="input input-sm num w-[110px]" type="number" min={0} step={1} value={d.amount} onChange={(e) => set(r.saleId, { amount: e.target.value })} data-nodraft />
                </label>
                <label className="flex flex-col gap-0.5">
                  <span className="label-xs">Encaissé annoncé</span>
                  <input className="input input-sm num w-[110px]" type="number" min={0} step={1} value={d.cash} onChange={(e) => set(r.saleId, { cash: e.target.value })} data-nodraft />
                </label>
                <button
                  className="btn btn-sm btn-primary"
                  disabled={busy === r.saleId}
                  onClick={() => void send(r)}
                  title={r.setterName ? `Rendre ce closing visible à ${r.setterName}${r.setterTelegram ? " et le prévenir sur Telegram" : ""}` : "Aucun setter : classer sans rien envoyer"}
                >
                  {busy === r.saleId ? "Envoi…" : r.setterName ? `Envoyer à ${r.setterName}` : "Classer"}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {showSent && sent.length > 0 && (
        <div style={{ borderTop: "1px solid var(--border)" }}>
          <div className="label-xs px-3.5 pt-2.5 pb-1">Derniers envoyés</div>
          <ul className="flex flex-col">
            {sent.map((r) => (
              <li key={r.saleId} className="flex items-center gap-3 px-3.5 py-1.5 text-[12.5px]" style={{ borderBottom: "1px solid var(--border)" }}>
                <span className="dim num shrink-0 w-[120px]">{fmtDateTime(r.sentAt)}</span>
                <Link href={`/sales/rendez-vous?open=${r.appointmentId}`} className="font-medium link truncate flex-1">
                  {r.leadName}
                </Link>
                <span className="dim shrink-0">{r.setterName || "aucun setter"}</span>
                <span className="num font-semibold shrink-0" title={`Réel : ${fmtMoney(r.contractValue, r.currency)} · ${fmtMoney(r.cashCollected, r.currency)} encaissés`}>
                  {fmtMoney(r.setterAmount ?? r.contractValue, r.currency)}
                  <span className="dim font-normal"> · {fmtMoney(r.setterCash ?? (r.setterAmount !== null ? (r.cashCollected > 0 ? r.setterAmount : 0) : r.cashCollected), r.currency)} enc.</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}
