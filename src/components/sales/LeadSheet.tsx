"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/client";
import { fmtDateTime, isoToParisInput, label, parisToIso, relative } from "@/lib/format";
import { Empty, Field, Modal, Spinner, useToast } from "@/components/ui";
import { StatusBadge } from "./bits";
import { AttributionBlock } from "./AttributionBlock";
import { useSales } from "./context";
import type { ActivityLog, Lead } from "@/lib/types";
import type { AppointmentStatus } from "@/lib/types";

interface Payload {
  lead: Lead;
  setterName: string;
  appointments: { id: string; scheduledAt: string; status: AppointmentStatus; closerName: string; iclosedUrl: string }[];
  /** Vente en cours du lead, s'il y en a une. */
  sale: { id: string; offer: string; contractValue: number; cashCollected: number; currency: string; soldAt: string; closerName: string } | null;
  logs: ActivityLog[];
}

const STATUS: Record<string, string> = {
  "no-answer": "Ne répond pas",
  "message-sent": "Message envoyé",
  callback: "À rappeler",
  reached: "Joint",
  "not-interested": "Pas intéressé",
  "wrong-number": "Faux numéro",
  "no-whatsapp": "Pas de WhatsApp",
  cold: "Lead froid · sans réponse",
};

/**
 * Fiche d'un contact de la landing page.
 *
 * Tout ce qu'il faut avant de decrocher, et la place pour ecrire apres : les
 * coordonnees, d'ou il vient, ce qui a ete fait (statuts, rappels, rendez-
 * vous), et une note libre que le setter ou le closer garde sur lui. La
 * note est sauvegardee telle quelle, c'est la sienne.
 */
export function LeadSheet({ id, onClose, onChanged }: { id: string | null; onClose: () => void; onChanged: () => void }) {
  const toast = useToast();
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(false);
  const [note, setNote] = useState("");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!id) {
      setData(null);
      return;
    }
    let alive = true;
    setLoading(true);
    api<Payload>(`/api/sales/leads/${id}`)
      .then((d) => {
        if (!alive) return;
        setData(d);
        setNote(d.lead.notes ?? "");
        setDirty(false);
      })
      .catch((e: Error) => toast(e.message, "err"))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  /** Pseudo Instagram saisi a la main : le tool n'en invente jamais. */
  const editHandle = async () => {
    if (!id || !data) return;
    const current = data.lead.igUsername ?? "";
    const typed = window.prompt("Pseudo Instagram du contact (sans le @). Vide pour effacer.", current);
    if (typed === null) return;
    try {
      const r = await api<{ lead: Payload["lead"] }>(`/api/sales/leads/${id}`, { method: "PATCH", body: JSON.stringify({ action: "contact", igUsername: typed }) });
      setData({ ...data, lead: r.lead });
      toast(r.lead.igUsername ? `Pseudo enregistré : @${r.lead.igUsername}` : "Pseudo effacé.");
      onChanged();
    } catch (e) {
      toast((e as Error).message, "err");
    }
  };

  const save = async () => {
    if (!id) return;
    setSaving(true);
    try {
      await api(`/api/sales/leads/${id}`, { method: "PATCH", body: JSON.stringify({ action: "note", note }) });
      toast("Note enregistrée.");
      setDirty(false);
      onChanged();
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setSaving(false);
    }
  };

  const l = data?.lead;

  return (
    <Modal
      open={id !== null}
      onClose={() => {
        if (dirty && !window.confirm("Ta note n'est pas enregistrée. Fermer quand même ?")) return;
        onClose();
      }}
      wide
      title={l ? l.name : "Fiche contact"}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Fermer
          </button>
          <button className="btn btn-primary" onClick={() => void save()} disabled={saving || !dirty}>
            {saving ? <span className="spinner" /> : "Enregistrer la note"}
          </button>
        </>
      }
    >
      {loading && !data ? (
        <Spinner label="Chargement de la fiche…" />
      ) : !l ? null : (
        <div className="grid lg:grid-cols-5 gap-5">
          {/* ------------------------- Identite ------------------------- */}
          <div className="lg:col-span-2 flex flex-col gap-3">
            <div className="flex flex-wrap gap-2">
              {l.phone ? (
                <a className="btn btn-primary" href={`tel:${l.phone}`}>
                  ☏ {l.phone}
                </a>
              ) : (
                <span className="badge badge-warn">Pas de numéro</span>
              )}
              {l.email && (
                <a className="btn" href={`mailto:${l.email}`} title={l.email}>
                  ✉ {l.email}
                </a>
              )}
            </div>
            <dl className="text-[12.5px] grid grid-cols-[110px_1fr] gap-y-1.5 gap-x-3">
              <dt className="dim">Statut</dt>
              <dd>
                {l.callStatus ? STATUS[l.callStatus] : "Non statué"}
                {l.callStatus === "callback" && l.callbackAt ? ` · le ${fmtDateTime(l.callbackAt)}` : ""}
                {l.callStatus === "no-answer" && (l.callAttempts ?? 0) > 1 ? ` (${l.callAttempts} essais)` : ""}
              </dd>
              <dt className="dim">Dernier appel</dt>
              <dd>{l.lastCallAt ? `${fmtDateTime(l.lastCallAt)} (${relative(l.lastCallAt)})` : "jamais"}</dd>
              <dt className="dim">Inscrit</dt>
              <dd>{l.optInAt ? `${fmtDateTime(l.optInAt)} (${relative(l.optInAt)})` : fmtDateTime(l.createdAt)}</dd>
              {l.country && (
                <>
                  <dt className="dim">Pays</dt>
                  <dd>{l.country}</dd>
                </>
              )}
              <dt className="dim">Setter</dt>
              <dd>{data?.setterName || <span style={{ color: "var(--warning)" }}>à attribuer</span>}</dd>
              <dt className="dim">Instagram</dt>
              <dd className="flex items-center gap-2">
                {l.igUsername ? `@${l.igUsername.replace(/^@+/, "")}` : <span className="dim">non renseigné</span>}
                <button type="button" className="link text-[11.5px]" onClick={() => void editHandle()} title="Saisir ou corriger le pseudo Instagram">
                  ✎ {l.igUsername ? "modifier" : "saisir"}
                </button>
              </dd>
              {l.sourceUrl && (
                <>
                  <dt className="dim">Page d&apos;origine</dt>
                  <dd className="truncate" title={l.sourceUrl}>
                    {l.sourceUrl.replace(/^https?:\/\//, "")}
                  </dd>
                </>
              )}
            </dl>

            {/* D'ou vient ce lead : first touch, jamais ecrase par un DM ulterieur. */}
            <AttributionBlock
              lead={l}
              isAdmin
              onChanged={(lead) => {
                setData((d) => (d ? { ...d, lead } : d));
                onChanged();
              }}
            />

            {/* Rendez-vous de ce contact, passes et a venir. */}
            <div>
              <div className="label-xs mb-1.5">Rendez-vous</div>
              {!data?.appointments.length ? (
                <div className="dim text-[12px]">Aucun rendez-vous posé.</div>
              ) : (
                <ul className="flex flex-col gap-1">
                  {data.appointments.map((a) => (
                    <li key={a.id} className="flex items-center gap-2 text-[12.5px] flex-wrap">
                      <span className="num">{fmtDateTime(a.scheduledAt)}</span>
                      <StatusBadge status={a.status} />
                      {a.closerName && <span className="dim">avec {a.closerName}</span>}
                      {a.iclosedUrl && (
                        <a href={a.iclosedUrl} target="_blank" rel="noreferrer" className="link">
                          visio ↗
                        </a>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          {/* --------------------------- Notes --------------------------- */}
          <div className="lg:col-span-3 flex flex-col gap-3">
            {/* Pitche, en attente, close, no-show, perdu : sans derouler la prise de rendez-vous. */}
            {id && data && (
              <QuickOutcome
                id={id}
                data={data}
                onDone={() => {
                  onChanged();
                  api<Payload>(`/api/sales/leads/${id}`)
                    .then((d) => setData(d))
                    .catch(() => undefined);
                }}
              />
            )}
            <Field label="Notes" hint="Ce qu'il cherche, son budget, son objection, « RDV en physique le 15 octobre »… Visible par toi et l'admin.">
              <textarea
                className="textarea w-full"
                rows={8}
                value={note}
                placeholder="Écris ici tout ce qu'il faut savoir sur ce contact."
                onChange={(e) => {
                  setNote(e.target.value);
                  setDirty(true);
                }}
              />
            </Field>

            <div>
              <div className="label-xs mb-1.5">Historique</div>
              {!data?.logs.length ? (
                <Empty>Rien pour l&apos;instant : les statuts posés apparaîtront ici.</Empty>
              ) : (
                <ul className="flex flex-col">
                  {data.logs.map((g, i) => (
                    <li
                      key={g.id}
                      className="py-1.5 flex items-baseline gap-3 text-[12.5px]"
                      style={{ borderTop: i ? "1px solid var(--border)" : "none" }}
                    >
                      <span className="dim num text-[11px] shrink-0 w-[92px]">{fmtDateTime(g.at)}</span>
                      <span className="min-w-0">{g.summary || label(g.action)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}

/* --------------------------- Issue en un clic --------------------------- */

type QuickStatus = "completed" | "follow-up" | "closed-won" | "no-show" | "closed-lost";

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

/**
 * Poser l'issue d'un lead depuis sa fiche, sans derouler la prise de
 * rendez-vous : pitche, en attente, close (avec le montant), paiement en
 * attente, no-show, perdu. Le serveur s'appuie sur le dernier rendez-vous ou
 * en cree un a l'instant : la vente et les commissions restent justes.
 */
function QuickOutcome({ id, data, onDone }: { id: string; data: Payload; onDone: () => void }) {
  const toast = useToast();
  const { session, members } = useSales();
  const [mode, setMode] = useState<"" | "closed-won" | "follow-up" | "closed-lost">("");
  const [busy, setBusy] = useState(false);
  const [offers, setOffers] = useState<{ name: string; price: number }[]>([]);
  const [currency, setCurrency] = useState("EUR");
  const [offer, setOffer] = useState("");
  const [contract, setContract] = useState("");
  const [cash, setCash] = useState("");
  const [installments, setInstallments] = useState("0");
  const [closerId, setCloserId] = useState(data.lead.closerId ?? "");
  const [reason, setReason] = useState("need-to-think");
  const [followUpAt, setFollowUpAt] = useState(isoToParisInput(new Date(Date.now() + 2 * 86_400_000)));
  const [note, setNote] = useState("");
  const closers = members.filter((m) => m.roles.includes("closer") && m.status !== "inactif");
  const last = data.appointments[0];

  const openSale = async (pendingPayment: boolean) => {
    setMode("closed-won");
    setCash(pendingPayment ? "0" : "");
    setInstallments(pendingPayment ? "1" : "0");
    if (!offers.length) {
      try {
        const r = await api<{ offers: { name: string; price: number }[]; currency: string }>("/api/sales/offers");
        setOffers(r.offers);
        setCurrency(r.currency || "EUR");
        if (r.offers[0]) {
          setOffer(r.offers[0].name);
          if (r.offers[0].price > 0) {
            setContract(String(r.offers[0].price));
            if (!pendingPayment) setCash(String(r.offers[0].price));
          }
        }
      } catch {
        // pas de catalogue : saisie libre
      }
    }
  };

  const send = async (status: QuickStatus, extra: Record<string, unknown> = {}) => {
    setBusy(true);
    try {
      const r = await api<{ created: boolean; sale: { contractValue: number; currency: string } | null }>(`/api/sales/leads/${id}/outcome`, {
        method: "POST",
        body: JSON.stringify({ status, closerId, note, ...extra }),
      });
      const msg: Record<QuickStatus, string> = {
        completed: "Pitché : call noté comme fait.",
        "follow-up": "En attente : relance programmée.",
        "closed-won": r.sale ? `Closé ✓ ${r.sale.contractValue} ${r.sale.currency}.` : "Closé ✓",
        "no-show": "No-show noté.",
        "closed-lost": "Perdu noté.",
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

  const n = (v: string) => Number(String(v).replace(",", ".")) || 0;

  return (
    <div className="card-flat p-3.5">
      <div className="flex items-center gap-2 flex-wrap mb-2.5">
        <span className="label-xs">Issue du call · en un clic</span>
        <span className="ml-auto text-[12px] flex items-center gap-2">
          {data.sale ? (
            <span className="badge badge-good !text-[11px]">
              Closé · {data.sale.contractValue} {data.sale.currency}
              {data.sale.cashCollected < data.sale.contractValue ? ` (${data.sale.cashCollected} encaissés)` : ""}
            </span>
          ) : last ? (
            <>
              <span className="dim">Dernier call :</span>
              <StatusBadge status={last.status} />
            </>
          ) : (
            <span className="dim">Aucun call enregistré</span>
          )}
        </span>
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <button className="btn btn-sm !h-[32px]" disabled={busy} onClick={() => void send("completed")} title="Call fait, offre présentée, pas encore de décision">
          Pitché
        </button>
        <button className="btn btn-sm !h-[32px]" disabled={busy} onClick={() => setMode(mode === "follow-up" ? "" : "follow-up")} title="En réflexion ou R2 à caler : une relance est programmée">
          ⏳ En attente
        </button>
        <button className="btn btn-sm btn-primary !h-[32px]" disabled={busy} onClick={() => void openSale(false)}>
          ✓ Closé
        </button>
        <button className="btn btn-sm !h-[32px]" disabled={busy} onClick={() => void openSale(true)} title="Vente conclue, argent pas encore reçu">
          Paiement en attente
        </button>
        <button className="btn btn-sm !h-[32px]" disabled={busy} onClick={() => void send("no-show")}>
          No-show
        </button>
        <button className="btn btn-sm !h-[32px]" disabled={busy} onClick={() => setMode(mode === "closed-lost" ? "" : "closed-lost")} style={{ color: "var(--critical)" }}>
          Perdu
        </button>
      </div>

      {mode === "closed-won" && (
        <div className="mt-3 grid sm:grid-cols-2 gap-2.5">
          <Field label="Offre">
            <input className="input !h-[34px]" list="quick-offers" value={offer} onChange={(e) => setOffer(e.target.value)} placeholder="Coaching…" />
            <datalist id="quick-offers">
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
                if (installments === "0") setCash(e.target.value);
              }}
              placeholder="2000"
            />
          </Field>
          <Field label={`Encaissé aujourd'hui (${currency})`}>
            <input className="input !h-[34px] num" inputMode="decimal" value={cash} onChange={(e) => setCash(e.target.value)} placeholder="0" />
          </Field>
          <Field label="Reste à payer en">
            <select className="select !h-[34px]" value={installments} onChange={(e) => setInstallments(e.target.value)}>
              <option value="0">Rien : tout encaissé</option>
              {[1, 2, 3, 4, 6, 12].map((k) => (
                <option key={k} value={String(k)}>
                  {k} fois
                </option>
              ))}
            </select>
          </Field>
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
          <Field label="Note (optionnel)">
            <input className="input !h-[34px]" value={note} onChange={(e) => setNote(e.target.value)} placeholder="R2 fait, part sur le coaching…" />
          </Field>
          <div className="sm:col-span-2 flex items-center gap-2">
            <button
              className="btn btn-primary"
              disabled={busy || n(contract) <= 0 || n(cash) > n(contract)}
              onClick={() => void send("closed-won", { sale: { offer, contractValue: n(contract), cashCollected: n(cash), installments: Number(installments) } })}
            >
              {busy ? <span className="spinner" /> : n(cash) < n(contract) ? "Enregistrer la vente (reste dû suivi)" : "Enregistrer la vente"}
            </button>
            <button className="btn btn-ghost" onClick={() => setMode("")} disabled={busy}>
              Annuler
            </button>
          </div>
        </div>
      )}

      {mode === "follow-up" && (
        <div className="mt-3 flex items-end gap-2 flex-wrap">
          <Field label="Relancer le">
            <input type="datetime-local" className="input !h-[34px] !w-auto" value={followUpAt} onChange={(e) => setFollowUpAt(e.target.value)} />
          </Field>
          <Field label="Note (optionnel)" className="flex-1 min-w-[200px]">
            <input className="input !h-[34px]" value={note} onChange={(e) => setNote(e.target.value)} placeholder="R2 à caler jeudi…" />
          </Field>
          <button className="btn btn-primary !h-[34px]" disabled={busy || !followUpAt} onClick={() => void send("follow-up", { followUpAt: parisToIso(followUpAt) })}>
            Programmer
          </button>
        </div>
      )}

      {mode === "closed-lost" && (
        <div className="mt-3 flex items-end gap-2 flex-wrap">
          <Field label="Raison">
            <select className="select !h-[34px]" value={reason} onChange={(e) => setReason(e.target.value)}>
              {LOST.map((r) => (
                <option key={r.key} value={r.key}>
                  {r.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Note (optionnel)" className="flex-1 min-w-[200px]">
            <input className="input !h-[34px]" value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
          <button className="btn !h-[34px]" style={{ borderColor: "var(--critical)", color: "var(--critical)" }} disabled={busy} onClick={() => void send("closed-lost", { lostReason: reason })}>
            Marquer perdu
          </button>
        </div>
      )}
    </div>
  );
}
