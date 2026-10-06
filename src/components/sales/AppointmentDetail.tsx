"use client";

import { hasRole, sessionHas } from "@/lib/sales/roles";
import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/client";
import { useSalesData } from "@/lib/sales/client";
import { fmtDateTime, fmtMoney, label, parisDay, parisToIso } from "@/lib/format";
import { canConfirm, LOST_REASONS } from "@/lib/sales/constants";
import { buildSchedule } from "@/lib/sales/installments";
import { Field, Modal, Spinner, useToast } from "@/components/ui";
import { ConfirmationSelect, IgHandle, StatusBadge } from "./bits";
import type { PublicMember } from "@/lib/sales/repo";
import type {
  ActivityLog,
  Appointment,
  AppointmentStatus,
  FollowUp,
  Lead,
  LostReason,
  PaymentType,
  RecapNextAction,
  EcomObjective,
  Sale,
  Session,
  Student,
} from "@/lib/types";
import { ECOM_OBJECTIVES, ECOM_OBJECTIVE_LABEL } from "@/lib/types";

/** Oui / Non, en deux boutons : une question du recap. */
function YesNo({ label: l, value, onChange }: { label: string; value: boolean | null; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center gap-3 flex-wrap">
      <span className="text-[13px] font-semibold min-w-[90px]">{l}</span>
      <div className="flex gap-1.5">
        <button type="button" className={`btn btn-sm ${value === true ? "btn-primary" : ""}`} onClick={() => onChange(true)}>
          Oui
        </button>
        <button type="button" className={`btn btn-sm ${value === false ? "btn-primary" : ""}`} onClick={() => onChange(false)}>
          Non
        </button>
      </div>
    </div>
  );
}

interface Detail {
  appointment: Appointment;
  lead: Lead | null;
  sale: Sale | null;
  /** Eleve deja inscrit pour cette vente. Null pour un non-admin. */
  student: Student | null;
  followUps: FollowUp[];
  otherAppointments: { id: string; scheduledAt: string; status: AppointmentStatus; setterName: string }[];
  setterName: string;
  closerName: string;
  logs: ActivityLog[];
  currency: string;
}

/**
 * Fiche d'un rendez-vous : ce que le closer ouvre avant de decrocher, et ce
 * dans quoi il enregistre son resultat juste apres.
 *
 * Tout tient dans une seule fenetre — contexte du lead, notes du setter,
 * resultat, vente — parce qu'un closer qui doit naviguer entre trois ecrans
 * finit par ne rien saisir du tout.
 */
export function AppointmentDetail({
  id,
  open,
  onClose,
  onChanged,
  session,
  members,
}: {
  id: string | null;
  open: boolean;
  onClose: () => void;
  onChanged: () => void;
  session: Session;
  members: PublicMember[];
}) {
  const toast = useToast();
  const [detail, setDetail] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  /* Etat du formulaire de resultat. `outcome` a null = fiche en lecture. */
  const [outcome, setOutcome] = useState<AppointmentStatus | null>(null);
  const [closerNotes, setCloserNotes] = useState("");
  const [lostReason, setLostReason] = useState<LostReason>("too-expensive");
  const [offer, setOffer] = useState("");
  /* Catalogue d'offres (Sales Dashboard) : on choisit, le prix se pré-remplit. */
  const { data: catalog } = useSalesData<{ offers: { id: string; name: string; price: number }[] }>("/api/sales/offers");
  const offerList = catalog?.offers ?? [];
  const pickOffer = (name: string) => {
    setOffer(name);
    const o = offerList.find((x) => x.name === name);
    if (o?.price) setContractValue(String(o.price));
  };
  const [contractValue, setContractValue] = useState("");
  const [cashCollected, setCashCollected] = useState("");
  /* « Payé en N fois » : 1 = comptant. Les échéances suivantes se calculent toutes seules. */
  const [installments, setInstallments] = useState("1");
  const [followUpAt, setFollowUpAt] = useState("");
  const [followUpNotes, setFollowUpNotes] = useState("");
  const [rescheduledAt, setRescheduledAt] = useState("");

  /*
   * Recap du call (demande des closers) : closé ?, pitché ?, infos du lead,
   * budget, commentaire, action a venir. Le statut du rendez-vous en decoule,
   * le closer n'a pas a le choisir.
   */
  const [recap, setRecap] = useState(false);
  const [closed, setClosed] = useState<boolean | null>(null);
  const [pitched, setPitched] = useState<boolean | null>(null);
  const [notPitchedReason, setNotPitchedReason] = useState("");
  const [notClosedDetail, setNotClosedDetail] = useState("");
  const [leadInfo, setLeadInfo] = useState("");
  const [ecomObjective, setEcomObjective] = useState<EcomObjective | "">("");
  const [objectiveOther, setObjectiveOther] = useState("");
  const [nextAction, setNextAction] = useState<RecapNextAction>("");
  const derived: AppointmentStatus = closed ? "closed-won" : nextAction === "call" ? "follow-up" : nextAction === "new-appointment" ? "rescheduled" : "closed-lost";
  /** Statut effectivement enregistre : deduit du recap, ou choisi directement (no-show, décalage). */
  const effective: AppointmentStatus | null = outcome ? (recap ? derived : outcome) : null;
  const startRecap = () => {
    setRecap(true);
    setClosed(null);
    setPitched(null);
    setNotPitchedReason("");
    setNotClosedDetail("");
    setLeadInfo(detail?.appointment.recap?.leadInfo ?? "");
    setEcomObjective(detail?.appointment.recap?.objective ?? "");
    setObjectiveOther(detail?.appointment.recap?.objectiveOther ?? "");
    setNextAction("");
    setOutcome("closed-lost");
  };

  /* Inscription de l'eleve, apres un close. */
  const [enrolling, setEnrolling] = useState(false);
  const [program, setProgram] = useState("");
  /* Encaissement complementaire (paiement en plusieurs fois). */
  const [collecting, setCollecting] = useState(false);
  const [colAmount, setColAmount] = useState("");
  const [colAt, setColAt] = useState(parisDay(0));
  const [colMethod, setColMethod] = useState("");
  const [colNote, setColNote] = useState("");
  /** Une échéance encaissée en un clic : le montant prévu, aujourd'hui. */
  const collectInstallment = async (n: number, amount: number) => {
    if (!detail?.sale || !appt) return;
    setSaving(true);
    try {
      const r = await api<{ remaining: number }>(`/api/sales/deals/${detail.sale.id}`, {
        method: "POST",
        body: JSON.stringify({ amount, installmentN: n, note: `Échéance ${n}` }),
      });
      toast(r.remaining > 0 ? `Échéance ${n} encaissée. Reste ${fmtMoney(r.remaining, detail.sale.currency)}.` : `Échéance ${n} encaissée : contrat soldé.`);
      await load(appt.id);
      onChanged();
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setSaving(false);
    }
  };
  /** Déplacer une échéance. */
  const setDue = async (n: number, dueAt: string) => {
    if (!detail?.sale || !appt || !dueAt) return;
    try {
      const schedule = (detail.sale.schedule ?? []).map((it) => (it.n === n ? { ...it, dueAt } : it));
      await api(`/api/sales/deals/${detail.sale.id}`, { method: "PATCH", body: JSON.stringify({ schedule }) });
      await load(appt.id);
      onChanged();
    } catch (e) {
      toast((e as Error).message, "err");
    }
  };

  const collect = async () => {
    if (!detail?.sale || !appt) return;
    setSaving(true);
    try {
      const r = await api<{ remaining: number }>(`/api/sales/deals/${detail.sale.id}`, {
        method: "POST",
        body: JSON.stringify({ amount: Number(colAmount), at: parisToIso(`${colAt}T12:00`), method: colMethod, note: colNote }),
      });
      toast(r.remaining > 0 ? `Encaissement enregistré. Reste ${fmtMoney(r.remaining, detail.sale.currency)}.` : "Encaissement enregistré : contrat soldé.");
      setCollecting(false);
      setColAmount("");
      setColMethod("");
      setColNote("");
      await load(appt.id);
      onChanged();
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setSaving(false);
    }
  };
  const [startedAt, setStartedAt] = useState("");
  const [objective, setObjective] = useState("");
  const [nextSessionAt, setNextSessionAt] = useState("");

  const closers = useMemo(() => members.filter((m) => hasRole(m, "closer") && m.status !== "inactif"), [members]);

  const load = async (appointmentId: string) => {
    setLoading(true);
    try {
      const d = await api<Detail>(`/api/sales/appointments/${appointmentId}`);
      setDetail(d);
      setCloserNotes(d.appointment.closerNotes || "");
    } catch (e) {
      toast((e as Error).message, "err");
      onClose();
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!open || !id) return;
    setOutcome(null);
    setOffer("");
    setContractValue("");
    setCashCollected("");
    setInstallments("1");
    setFollowUpAt("");
    setFollowUpNotes("");
    setRescheduledAt("");
    setRecap(false);
    void load(id);
    // `load` est stable pour un id donne ; l'ajouter aux deps relancerait
    // la requete a chaque frappe dans le formulaire.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, id]);

  const appt = detail?.appointment;
  const canRecord =
    Boolean(appt) &&
    (session.isAdmin || (sessionHas(session, "closer") && appt?.closerId === session.memberId));

  /* ------------------------------ Actions ------------------------------ */

  /** Pseudo Instagram saisi a la main : l'import iClosed n'en invente plus. */
  const editHandle = async () => {
    if (!appt) return;
    const typed = window.prompt("Pseudo Instagram du contact (sans le @). Vide pour effacer.", detail?.lead?.igUsername ?? "");
    if (typed === null) return;
    try {
      await api(`/api/sales/appointments/${appt.id}`, { method: "PATCH", body: JSON.stringify({ igUsername: typed }) });
      toast(typed.trim() ? "Pseudo enregistré." : "Pseudo effacé.");
      await load(appt.id);
      onChanged();
    } catch (e) {
      toast((e as Error).message, "err");
    }
  };

  const assignCloser = async (closerId: string) => {
    if (!appt) return;
    try {
      await api(`/api/sales/appointments/${appt.id}`, {
        method: "PATCH",
        body: JSON.stringify({ closerId }),
      });
      toast(closerId ? "Closer assigné." : "Closer retiré.");
      await load(appt.id);
      onChanged();
    } catch (e) {
      toast((e as Error).message, "err");
    }
  };

  const toggleQualified = async () => {
    if (!appt) return;
    try {
      await api(`/api/sales/appointments/${appt.id}`, {
        method: "PATCH",
        body: JSON.stringify({ qualified: !appt.qualified }),
      });
      await load(appt.id);
      onChanged();
    } catch (e) {
      toast((e as Error).message, "err");
    }
  };

  /**
   * Inscrit l'eleve issu de la vente.
   *
   * Volontairement manuel et reserve a l'admin : une vente signee n'est pas
   * encore un coaching demarre, et creer la fiche automatiquement remplirait
   * le suivi d'eleves qui n'ont pas commence.
   */
  const enroll = async () => {
    if (!detail?.sale) return;
    setSaving(true);
    try {
      const res = await api<{ created: boolean }>("/api/sales/students", {
        method: "POST",
        body: JSON.stringify({
          saleId: detail.sale.id,
          program,
          startedAt,
          objective,
          nextSessionAt: nextSessionAt ? parisToIso(nextSessionAt) : "",
        }),
      });
      toast(res.created ? "Élève inscrit au coaching." : "Cet élève était déjà inscrit.");
      setEnrolling(false);
      if (appt) await load(appt.id);
      onChanged();
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setSaving(false);
    }
  };

  const openEnroll = () => {
    if (!detail?.sale) return;
    // Pre-rempli depuis la vente : l'offre vendue est le programme, la date de
    // vente la date de debut. Rien a retaper dans le cas courant.
    setProgram(detail.sale.offer);
    setStartedAt(detail.sale.soldAt.slice(0, 10));
    setObjective("");
    setNextSessionAt("");
    setEnrolling(true);
  };

  const submitOutcome = async () => {
    if (!appt || !outcome || !effective) return;

    const payload: Record<string, unknown> = { status: effective, closerNotes };

    if (recap) {
      if (closed === null) return toast("Closé : oui ou non ?", "err");
      if (pitched === null) return toast("Pitché : oui ou non ?", "err");
      if (!closed && !nextAction) return toast("Action à venir : rappeler, nouveau rendez-vous, ou rien ?", "err");
      if (!closed && nextAction === "call" && !followUpAt) return toast("Indique quand rappeler.", "err");
      payload.recap = {
        closed,
        notClosedReason: closed ? "" : lostReason,
        notClosedDetail: closed ? "" : notClosedDetail,
        pitched,
        notPitchedReason: pitched ? "" : notPitchedReason,
        leadInfo,
        objective: ecomObjective,
        objectiveOther: ecomObjective === "other" ? objectiveOther : "",
        nextAction: closed ? "" : nextAction,
        nextActionAt: closed ? "" : nextAction === "call" && followUpAt ? parisToIso(followUpAt) : nextAction === "new-appointment" && rescheduledAt ? parisToIso(rescheduledAt) : "",
      };
    }

    if (effective === "closed-lost") payload.lostReason = lostReason;

    if (effective === "closed-won") {
      const contract = Number(contractValue);
      const cash = Number(cashCollected || 0);
      if (!offer.trim()) return toast("Indique l'offre vendue.", "err");
      if (!(contract > 0)) return toast("La valeur de contrat doit être supérieure à 0.", "err");
      if (cash > contract) return toast("Le cash encaissé ne peut pas dépasser le contrat.", "err");
      payload.sale = {
        offer,
        contractValue: contract,
        cashCollected: cash,
        currency: detail?.currency ?? "EUR",
        paymentType: Number(installments) > 1 ? "installments" : "paid-in-full",
        installments: Math.max(1, Number(installments) || 1),
        paymentMethod: "",
        soldAt: new Date().toISOString(),
        notes: "",
      };
    }

    if (effective === "follow-up" || effective === "rescheduled") {
      if (followUpAt) {
        payload.followUp = { dueAt: parisToIso(followUpAt), notes: followUpNotes };
      }
      if (effective === "rescheduled") {
        if (!rescheduledAt) return toast("Indique la nouvelle date du rendez-vous.", "err");
        // Saisie en heure de Paris, quel que soit l'ordinateur.
        payload.rescheduledAt = parisToIso(rescheduledAt);
      }
    }

    setSaving(true);
    try {
      await api(`/api/sales/appointments/${appt.id}/outcome`, {
        method: "POST",
        body: JSON.stringify(payload),
      });
      toast(effective === "closed-won" ? "Vente enregistrée." : recap ? "Récap du call enregistré." : "Résultat enregistré.");
      setOutcome(null);
      setRecap(false);
      await load(appt.id);
      onChanged();
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setSaving(false);
    }
  };

  /* ------------------------------- Rendu ------------------------------- */

  return (
    <>
    <Modal
      open={open}
      onClose={onClose}
      wide
      title={detail?.lead ? `${detail.lead.name}` : "Rendez-vous"}
      footer={
        outcome ? (
          <>
            <button className="btn mr-auto" onClick={() => setOutcome(null)}>
              ← Retour
            </button>
            <button className="btn btn-primary" onClick={() => void submitOutcome()} disabled={saving}>
              {saving ? <span className="spinner" /> : "Enregistrer le résultat"}
            </button>
          </>
        ) : (
          <>
            {session.isAdmin && appt && (
              <button
                className="btn mr-auto"
                style={{ color: "var(--critical)", borderColor: "color-mix(in srgb, var(--critical) 40%, transparent)" }}
                disabled={saving}
                title="Supprimer ce rendez-vous : il disparaît de l'agenda et du dashboard du closer"
                onClick={async () => {
                  const withSale = detail?.sale
                    ? ` Il porte une vente de ${fmtMoney(detail.sale.contractValue, detail.sale.currency)} : elle sera supprimée aussi, et les commissions avec.`
                    : "";
                  if (!window.confirm(`Supprimer le rendez-vous de ${detail?.lead?.name ?? "ce lead"} ?${withSale} Cette action est définitive.`)) return;
                  setSaving(true);
                  try {
                    await api(`/api/sales/appointments/${appt.id}`, { method: "DELETE" });
                    toast("Rendez-vous supprimé.");
                    onChanged();
                    onClose();
                  } catch (e) {
                    toast((e as Error).message, "err");
                  } finally {
                    setSaving(false);
                  }
                }}
              >
                Supprimer
              </button>
            )}
            <button className="btn" onClick={onClose}>
              Fermer
            </button>
          </>
        )
      }
    >
      {loading || !detail || !appt ? (
        <Spinner label="Chargement…" />
      ) : outcome ? (
        /* ---------------------- Saisie du resultat --------------------- */
        <div className="flex flex-col gap-3.5">
          <div className="flex items-center gap-2">
            <span className="label-xs">{recap ? "Récap du call" : "Résultat"}</span>
            {effective && (recap ? (closed !== null && (closed || nextAction)) : true) && <StatusBadge status={effective} />}
          </div>

          {recap && (
            <div className="flex flex-col gap-3">
              <YesNo label="Closé ?" value={closed} onChange={setClosed} />
              {closed === false && (
                <div className="grid sm:grid-cols-2 gap-3">
                  <Field label="Pourquoi pas closé ?">
                    <select className="select" value={lostReason} onChange={(e) => setLostReason(e.target.value as LostReason)}>
                      {LOST_REASONS.map((r) => (
                        <option key={r} value={r}>
                          {label(r)}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Précision">
                    <input className="input" value={notClosedDetail} placeholder="Ce qui a bloqué, avec ses mots" onChange={(e) => setNotClosedDetail(e.target.value)} />
                  </Field>
                </div>
              )}
              <YesNo label="Pitché ?" value={pitched} onChange={setPitched} />
              {pitched === false && (
                <Field label="Pourquoi pas pitché ?">
                  <input className="input" value={notPitchedReason} placeholder="Pas qualifié, pas le décideur, coupé court…" onChange={(e) => setNotPitchedReason(e.target.value)} />
                </Field>
              )}
              <div className="grid sm:grid-cols-2 gap-3">
                <Field label="Informations du lead" className="sm:col-span-2">
                  <textarea className="textarea" value={leadInfo} placeholder="Sa situation, son projet, son niveau, ses objections…" onChange={(e) => setLeadInfo(e.target.value)} />
                </Field>
                <Field label="Objectif e-commerce" hint="Ce qu'il vise, déterminé pendant le call.">
                  <select className="select" value={ecomObjective} onChange={(e) => setEcomObjective(e.target.value as EcomObjective | "")}>
                    <option value="">—</option>
                    {ECOM_OBJECTIVES.map((o) => (
                      <option key={o} value={o}>
                        {ECOM_OBJECTIVE_LABEL[o]}
                      </option>
                    ))}
                  </select>
                </Field>
                {ecomObjective === "other" && (
                  <Field label="Son objectif, avec ses mots">
                    <input className="input" value={objectiveOther} placeholder="ex. vendre sa boutique dans deux ans" onChange={(e) => setObjectiveOther(e.target.value)} />
                  </Field>
                )}
              </div>
              {closed === false && (
                <div>
                  <div className="label-xs mb-1.5">Action à venir</div>
                  <div className="flex flex-wrap gap-2">
                    {([
                      ["call", "Rappeler"],
                      ["new-appointment", "Nouveau rendez-vous"],
                      ["none", "Aucune : perdu"],
                    ] as [RecapNextAction, string][]).map(([k, l]) => (
                      <button key={k} type="button" className={`btn btn-sm ${nextAction === k ? "btn-primary" : ""}`} onClick={() => setNextAction(k)}>
                        {l}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {effective === "closed-won" && (
            <div className="grid sm:grid-cols-2 gap-3">
              <Field label="Offre vendue" className="sm:col-span-2">
                {offerList.length > 0 ? (
                  <div className="flex flex-col gap-1.5">
                    <div className="flex flex-wrap gap-1.5">
                      {offerList.map((o) => (
                        <button
                          key={o.id}
                          type="button"
                          className={`btn btn-sm ${offer === o.name ? "btn-primary" : ""}`}
                          onClick={() => pickOffer(o.name)}
                          title={o.price ? `${o.price} ${detail.currency}` : undefined}
                        >
                          {o.name}{o.price ? ` · ${o.price}` : ""}
                        </button>
                      ))}
                    </div>
                    <input
                      className="input"
                      value={offer}
                      placeholder="Ou une autre offre…"
                      onChange={(e) => setOffer(e.target.value)}
                    />
                  </div>
                ) : (
                  <input
                    className="input"
                    value={offer}
                    placeholder="Coaching 1:1 e-commerce"
                    onChange={(e) => setOffer(e.target.value)}
                    autoFocus
                  />
                )}
              </Field>
              <Field label={`Valeur du contrat (${detail.currency})`}>
                <input
                  className="input num"
                  type="number"
                  min={0}
                  value={contractValue}
                  placeholder="5000"
                  onChange={(e) => setContractValue(e.target.value)}
                />
              </Field>
              <Field label={`Cash encaissé aujourd'hui (${detail.currency})`}>
                <input
                  className="input num"
                  type="number"
                  min={0}
                  value={cashCollected}
                  placeholder="3000"
                  onChange={(e) => setCashCollected(e.target.value)}
                />
              </Field>
              <Field label="Paiement" className="sm:col-span-2">
                <div className="flex flex-col gap-1.5">
                  <div className="flex flex-wrap gap-1.5">
                    {[1, 2, 3, 4].map((k) => (
                      <button
                        key={k}
                        type="button"
                        className={`btn btn-sm ${Number(installments) === k ? "btn-primary" : ""}`}
                        onClick={() => setInstallments(String(k))}
                      >
                        {k === 1 ? "En 1 fois" : `En ${k} fois`}
                      </button>
                    ))}
                  </div>
                  {Number(installments) > 1 && Number(contractValue) > 0 && (() => {
                    const plan = buildSchedule(Number(contractValue), Number(cashCollected || 0), Number(installments), new Date().toISOString());
                    return plan.length ? (
                      <p className="dim text-[12px] num">
                        Prochaines échéances :{" "}
                        {plan.map((it) => `${fmtMoney(it.amount, detail.currency)} le ${it.dueAt.split("-").reverse().join("/")}`).join(" · ")}
                        <span className="block">Un mois d&apos;écart, dates modifiables ensuite. Le jour venu, l&apos;échéance remonte en alerte.</span>
                      </p>
                    ) : null;
                  })()}
                </div>
              </Field>
            </div>
          )}

          {!recap && effective === "closed-lost" && (
            <Field label="Raison">
              <select
                className="select"
                value={lostReason}
                onChange={(e) => setLostReason(e.target.value as LostReason)}
              >
                {LOST_REASONS.map((r) => (
                  <option key={r} value={r}>
                    {label(r)}
                  </option>
                ))}
              </select>
            </Field>
          )}

          {effective === "rescheduled" && (
            <Field label="Nouvelle date du rendez-vous (heure de Paris)">
              <input
                className="input"
                type="datetime-local"
                value={rescheduledAt}
                onChange={(e) => setRescheduledAt(e.target.value)}
              />
            </Field>
          )}

          {(effective === "follow-up" || effective === "rescheduled") && (
            <div className="grid sm:grid-cols-2 gap-3">
              <Field label={effective === "follow-up" ? "Rappeler le (heure de Paris)" : "Relance prévue le"}>
                <input
                  className="input"
                  type="datetime-local"
                  value={followUpAt}
                  onChange={(e) => setFollowUpAt(e.target.value)}
                />
              </Field>
              <Field label="Note de relance">
                <input
                  className="input"
                  value={followUpNotes}
                  placeholder="Doit en parler à son associé"
                  onChange={(e) => setFollowUpNotes(e.target.value)}
                />
              </Field>
            </div>
          )}

          <Field label={recap ? "Commentaire libre" : "Compte-rendu du call"}>
            <textarea
              className="textarea"
              value={closerNotes}
              placeholder="Ce qui s'est dit, les objections, la suite."
              onChange={(e) => setCloserNotes(e.target.value)}
            />
          </Field>
        </div>
      ) : (
        /* -------------------------- Lecture ---------------------------- */
        <div className="flex flex-col gap-4">
          {/* Identite du lead */}
          <div className="card-flat px-3.5 py-3">
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[14px] font-semibold">{detail.lead?.name}</span>
                  <IgHandle username={detail.lead?.igUsername ?? ""} />
                  <button type="button" className="link text-[11.5px]" onClick={() => void editHandle()} title="Saisir ou corriger le pseudo Instagram (le tool n'en invente jamais)">
                    ✎ {detail.lead?.igUsername ? "modifier" : "saisir le pseudo"}
                  </button>
                  {appt.qualified && <span className="badge badge-good !text-[10px] !py-0">Qualifié</span>}
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1.5 text-[12px]">
                  {detail.lead?.email && <span>{detail.lead.email}</span>}
                  {detail.lead?.phone && <span className="num">{detail.lead.phone}</span>}
                  {detail.lead?.country && <span>{detail.lead.country}</span>}
                  <span className="badge !text-[10.5px] !py-0">{label(appt.source)}</span>
                </div>
              </div>
              <StatusBadge status={appt.status} />
            </div>
          </div>

          {/* Creneau et attribution */}
          <div className="grid sm:grid-cols-3 gap-3">
            <div className="card-flat px-3 py-2.5">
              <div className="label-xs">Rendez-vous</div>
              <div className="text-[13px] font-medium num mt-1">{fmtDateTime(appt.scheduledAt)}</div>
              <div className="dim text-[11px] mt-0.5">{appt.timezone}</div>
              {/* Confirmation par le setter : le closer sait si le call tient. */}
              {canConfirm(appt.status) && (
                <div className="mt-2">
                  <div className="label-xs mb-1">Confirmation</div>
                  <ConfirmationSelect
                    id={appt.id}
                    value={appt.confirmation ?? ""}
                    onSaved={() => {
                      void load(appt.id);
                      onChanged();
                    }}
                  />
                </div>
              )}
              {/*
                Le lien de visio, la ou le closer le cherche.
                C'est ce qui lui permet de tenir le call sans compte iClosed :
                le rendez-vous reste heberge sur un seul siege, et le lien
                d'invite lui est simplement transmis ici.
              */}
              {appt.iclosedUrl && (
                <a
                  href={appt.iclosedUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="btn btn-primary btn-sm w-full mt-2"
                >
                  Rejoindre le call ↗
                </a>
              )}
            </div>
            <div className="card-flat px-3 py-2.5">
              <div className="label-xs">Setter</div>
              <div className="text-[13px] font-medium mt-1">{detail.setterName}</div>
            </div>
            <div className="card-flat px-3 py-2.5">
              <div className="label-xs">Closer</div>
              {session.isAdmin ? (
                <select
                  className="select select-sm !text-[12.5px] mt-1"
                  value={appt.closerId}
                  onChange={(e) => void assignCloser(e.target.value)}
                >
                  <option value="">Non assigné</option>
                  {closers.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
              ) : (
                <div className="text-[13px] font-medium mt-1">{detail.closerName || "Non assigné"}</div>
              )}
            </div>
          </div>

          {/* Contexte laisse par le setter : la raison d'etre de la fiche */}
          {appt.setterNotes && (
            <div>
              <div className="label-xs mb-1.5">Contexte du setter</div>
              <div className="card-flat px-3.5 py-3 text-[12.5px] leading-relaxed whitespace-pre-wrap">
                {appt.setterNotes}
              </div>
            </div>
          )}

          {appt.recap && (
            <div>
              <div className="label-xs mb-1.5">Récap du call</div>
              <div className="card-flat px-3.5 py-3 text-[12.5px]">
                <dl className="grid grid-cols-[130px_1fr] gap-y-1.5 gap-x-3">
                  <dt className="dim">Closé</dt>
                  <dd>
                    <strong style={{ color: appt.recap.closed ? "var(--emerald)" : "var(--critical)" }}>{appt.recap.closed ? "Oui" : "Non"}</strong>
                    {!appt.recap.closed && (appt.recap.notClosedReason || appt.recap.notClosedDetail) && (
                      <span className="dim"> · {[appt.recap.notClosedReason ? label(appt.recap.notClosedReason) : "", appt.recap.notClosedDetail].filter(Boolean).join(" — ")}</span>
                    )}
                  </dd>
                  <dt className="dim">Pitché</dt>
                  <dd>
                    <strong>{appt.recap.pitched ? "Oui" : "Non"}</strong>
                    {!appt.recap.pitched && appt.recap.notPitchedReason && <span className="dim"> · {appt.recap.notPitchedReason}</span>}
                  </dd>
                  {appt.recap.leadInfo && (
                    <>
                      <dt className="dim">Infos du lead</dt>
                      <dd className="whitespace-pre-wrap">{appt.recap.leadInfo}</dd>
                    </>
                  )}
                  {appt.recap.objective && (
                    <>
                      <dt className="dim">Objectif</dt>
                      <dd>{appt.recap.objective === "other" && appt.recap.objectiveOther ? appt.recap.objectiveOther : ECOM_OBJECTIVE_LABEL[appt.recap.objective]}</dd>
                    </>
                  )}
                  {appt.recap.budget && (
                    <>
                      <dt className="dim">Budget</dt>
                      <dd>{appt.recap.budget}</dd>
                    </>
                  )}
                  {!appt.recap.closed && appt.recap.nextAction && (
                    <>
                      <dt className="dim">Action à venir</dt>
                      <dd>
                        {appt.recap.nextAction === "call" ? "Rappeler" : appt.recap.nextAction === "new-appointment" ? "Nouveau rendez-vous" : "Aucune, perdu"}
                        {appt.recap.nextActionAt ? ` le ${fmtDateTime(appt.recap.nextActionAt)}` : ""}
                      </dd>
                    </>
                  )}
                </dl>
              </div>
            </div>
          )}

          {appt.closerNotes && (
            <div>
              <div className="label-xs mb-1.5">{appt.recap ? "Commentaire du closer" : "Compte-rendu du closer"}</div>
              <div className="card-flat px-3.5 py-3 text-[12.5px] leading-relaxed whitespace-pre-wrap">
                {appt.closerNotes}
              </div>
            </div>
          )}

          {/* Vente : l'offre, les montants, le plan de paiement. */}
          {detail.sale && (() => {
            const sale = detail.sale;
            const remaining = Math.max(0, Math.round((sale.contractValue - sale.cashCollected) * 100) / 100);
            const canCollect = session.isAdmin || sale.closerId === session.memberId;
            const schedule = sale.schedule ?? [];
            const todayKey = parisDay(0);
            const times = Math.max(sale.installments || 1, schedule.length + (sale.cashCollected > 0 ? 1 : 0), 1);
            return (
              <div>
                <div className="label-xs mb-1.5">Vente</div>
                <div className="card-flat px-3.5 py-3 flex flex-col gap-3">
                  <div className="flex items-baseline justify-between gap-3 flex-wrap">
                    <span className="text-[14px] font-semibold">{sale.offer}</span>
                    <span className={`badge ${sale.status === "active" ? "badge-good" : ""} !text-[10.5px] !py-0`}>{label(sale.status)}</span>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <div className="label-xs">Valeur contrat</div>
                      <div className="num text-[17px] font-semibold">{fmtMoney(sale.contractValue, sale.currency)}</div>
                    </div>
                    <div>
                      <div className="label-xs">Cash encaissé</div>
                      <div className="num text-[17px] font-semibold" style={{ color: "var(--emerald)" }}>{fmtMoney(sale.cashCollected, sale.currency)}</div>
                      {remaining > 0 && <div className="dim text-[11px] num">reste {fmtMoney(remaining, sale.currency)}</div>}
                    </div>
                    <div>
                      <div className="label-xs">Paiement</div>
                      <div className="text-[15px] font-semibold">{times > 1 ? `En ${times} fois` : "En 1 fois"}</div>
                      {sale.refundAmount > 0 && <div className="num text-[11px]" style={{ color: "var(--critical)" }}>remboursé {fmtMoney(sale.refundAmount, sale.currency)}</div>}
                    </div>
                  </div>

                  {schedule.length > 0 && (
                    <ul className="flex flex-col gap-1">
                      {schedule.map((it) => {
                        const state = it.paidAt ? "paid" : it.dueAt < todayKey ? "overdue" : it.dueAt === todayKey ? "today" : "soon";
                        const color = state === "paid" ? "var(--emerald)" : state === "overdue" ? "var(--critical)" : state === "today" ? "var(--warning)" : "var(--text-2)";
                        return (
                          <li key={it.n} className="flex items-center gap-2 flex-wrap text-[12.5px] rounded-[8px] px-2.5 py-1.5" style={{ background: "var(--surface-2)", borderLeft: `3px solid ${color}` }}>
                            <span className="font-semibold">Échéance {it.n}/{times}</span>
                            <span className="num font-semibold">{fmtMoney(it.amount, sale.currency)}</span>
                            {canCollect && !it.paidAt && sale.status !== "cancelled" ? (
                              <input
                                type="date"
                                className="input !h-[26px] !text-[11.5px] !w-auto num"
                                value={it.dueAt}
                                onChange={(e) => void setDue(it.n, e.target.value)}
                                title="Date de l'échéance (modifiable)"
                              />
                            ) : (
                              <span className="num dim">{it.dueAt.split("-").reverse().join("/")}</span>
                            )}
                            <span className="text-[11.5px] font-semibold" style={{ color }}>
                              {state === "paid" ? `✓ payée le ${it.paidAt.slice(0, 10).split("-").reverse().join("/")}` : state === "overdue" ? "⚠ en retard" : state === "today" ? "● aujourd'hui" : "à venir"}
                            </span>
                            {canCollect && !it.paidAt && sale.status !== "cancelled" && (
                              <button className="btn btn-sm btn-primary ml-auto" onClick={() => void collectInstallment(it.n, it.amount)} disabled={saving}>
                                Encaissé ✓
                              </button>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  )}

                  {remaining <= 0 ? (
                    <div className="text-[12.5px] font-semibold" style={{ color: "var(--emerald)" }}>✓ Contrat soldé</div>
                  ) : canCollect && sale.status !== "cancelled" ? (
                    <div>
                      {!collecting ? (
                        <button type="button" className="link text-[12px]" onClick={() => setCollecting(true)}>+ Encaissement d&apos;un autre montant</button>
                      ) : (
                        <div className="grid sm:grid-cols-2 gap-3">
                          <Field label={`Montant reçu (${sale.currency})`} hint={`Maximum ${fmtMoney(remaining, sale.currency)}`}>
                            <input className="input num" type="number" min={0} max={remaining} value={colAmount} onChange={(e) => setColAmount(e.target.value)} autoFocus />
                          </Field>
                          <Field label="Reçu le">
                            <input className="input" type="date" value={colAt} onChange={(e) => setColAt(e.target.value)} />
                          </Field>
                          <Field label="Moyen (optionnel)">
                            <input className="input" placeholder="Virement, Stripe, PayPal…" value={colMethod} onChange={(e) => setColMethod(e.target.value)} />
                          </Field>
                          <Field label="Note (optionnel)">
                            <input className="input" placeholder="Acompte complémentaire" value={colNote} onChange={(e) => setColNote(e.target.value)} />
                          </Field>
                          <div className="sm:col-span-2 flex gap-2 justify-end">
                            <button className="btn" onClick={() => setCollecting(false)} disabled={saving}>Annuler</button>
                            <button className="btn btn-primary" onClick={() => void collect()} disabled={saving || !(Number(colAmount) > 0)}>
                              {saving ? <span className="spinner" /> : "Enregistrer l'encaissement"}
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  ) : null}

                  {(sale.collections ?? []).length > 0 && (
                    <details>
                      <summary className="dim text-[11.5px] cursor-pointer select-none">Historique des encaissements · {(sale.collections ?? []).length}</summary>
                      <ul className="mt-1.5 flex flex-col gap-1">
                        {(sale.collections ?? []).map((c) => (
                          <li key={c.id} className="text-[12px] flex items-baseline gap-2 flex-wrap">
                            <span className="num font-semibold" style={{ color: "var(--emerald)" }}>+ {fmtMoney(c.amount, sale.currency)}</span>
                            <span className="dim num">{fmtDateTime(c.at).slice(0, 8)}</span>
                            {c.method && <span className="dim">· {c.method}</span>}
                            {c.note && <span className="dim">· {c.note}</span>}
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}

                  {/* Passage au coaching : decision de l'admin. */}
                  {session.isAdmin && (
                    <div className="pt-2 flex items-center justify-between gap-3 flex-wrap" style={{ borderTop: "1px solid var(--border)" }}>
                      {detail.student ? (
                        <>
                          <span className="text-[12px]">
                            <span className="dim">Élève inscrit : </span>
                            <strong>{detail.student.program}</strong>
                            <span className="dim"> · {label(detail.student.status)} · </span>
                            <span className="num">{detail.student.progress} %</span>
                          </span>
                          <a href="/eleves" className="btn btn-sm">Suivi élève</a>
                        </>
                      ) : (
                        <>
                          <span className="dim text-[12px]">Pas encore inscrit en coaching.</span>
                          <button className="btn btn-sm" onClick={openEnroll}>Inscrire l&apos;élève</button>
                        </>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })()}

          {/* Relances en cours */}
          {detail.followUps.length > 0 && (
            <div>
              <div className="label-xs mb-1.5">Relances</div>
              <div className="flex flex-col gap-1.5">
                {detail.followUps.map((f) => (
                  <div key={f.id} className="card-flat px-3 py-2 flex items-center justify-between gap-3">
                    <span className="text-[12.5px] num">{fmtDateTime(f.dueAt)}</span>
                    <span className="text-[12px] flex-1 min-w-0 truncate">{f.notes}</span>
                    <span className="badge !text-[10px] !py-0">{label(f.status)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Actions du closer */}
          {canRecord && (
            <div>
              <div className="label-xs mb-1.5">{appt.recap ? "Refaire le récap du call" : "Après le call"}</div>
              <div className="flex flex-wrap gap-2">
                <button className="btn btn-sm btn-primary" onClick={startRecap} title="Closé ? Pitché ? Infos du lead, budget, commentaire, action à venir">
                  ✎ Récap du call
                </button>
                <button className="btn btn-sm" onClick={() => { setRecap(false); setOutcome("no-show"); }} title="Le prospect n'est pas venu">
                  {label("no-show")}
                </button>
                <button className="btn btn-sm" onClick={() => { setRecap(false); setOutcome("rescheduled"); }} title="Décaler ce rendez-vous sans faire de récap">
                  Décaler le rendez-vous
                </button>
              </div>
            </div>
          )}

          {session.isAdmin && (
            <div className="flex flex-wrap gap-2">
              <button className="btn btn-sm" onClick={() => void toggleQualified()}>
                {appt.qualified ? "Retirer « qualifié »" : "Marquer qualifié"}
              </button>
            </div>
          )}

          {/* Historique : la trace qui survit aux mois */}
          <div>
            <div className="label-xs mb-1.5">Historique</div>
            <div className="flex flex-col gap-1">
              {(appt.history ?? []).map((h, i) => (
                <div key={i} className="flex items-baseline gap-2 text-[11.5px]">
                  <span className="dim num shrink-0">{fmtDateTime(h.at)}</span>
                  <span>
                    {h.actorName} → <strong>{label(h.to)}</strong>
                    {h.note ? ` — ${h.note}` : ""}
                  </span>
                </div>
              ))}
              {detail.otherAppointments.map((o) => (
                <div key={o.id} className="flex items-baseline gap-2 text-[11.5px]">
                  <span className="dim num shrink-0">{fmtDateTime(o.scheduledAt)}</span>
                  <span className="dim">
                    Autre rendez-vous du même lead — {label(o.status)} (setter {o.setterName})
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </Modal>

      {/* Inscription au coaching. Soeur et non enfant de la fiche : deux
          modales imbriquees se disputent le verrou de defilement du body. */}
      <Modal
        open={enrolling}
        onClose={() => setEnrolling(false)}
        title={detail?.lead ? `Inscrire ${detail.lead.name}` : "Inscrire l'élève"}
        footer={
          <>
            <button className="btn" onClick={() => setEnrolling(false)}>
              Annuler
            </button>
            <button className="btn btn-primary" onClick={() => void enroll()} disabled={saving}>
              {saving ? <span className="spinner" /> : "Inscrire"}
            </button>
          </>
        }
      >
        {detail?.sale && (
          <div className="flex flex-col gap-3.5">
            {/* Le contrat vient de la vente : il n'est pas ressaisi, donc il ne
                peut pas diverger de ce qui alimente les commissions. */}
            <div className="card-flat px-3.5 py-3 flex flex-wrap gap-x-6 gap-y-1.5">
              <span className="text-[12.5px]">
                <span className="dim">Contrat </span>
                <span className="num font-semibold">
                  {fmtMoney(detail.sale.contractValue, detail.sale.currency)}
                </span>
              </span>
              <span className="text-[12.5px]">
                <span className="dim">Encaissé </span>
                <span className="num font-semibold" style={{ color: "var(--emerald)" }}>
                  {fmtMoney(detail.sale.cashCollected, detail.sale.currency)}
                </span>
              </span>
              <span className="text-[12.5px]">
                <span className="dim">Closé par </span>
                {detail.closerName}
                <span className="dim"> · amené par </span>
                {detail.setterName}
              </span>
            </div>

            <div className="grid sm:grid-cols-2 gap-3.5">
              <Field label="Programme / offre" className="sm:col-span-2">
                <input className="input" value={program} onChange={(e) => setProgram(e.target.value)} />
              </Field>
              <Field label="Début du coaching">
                <input
                  className="input"
                  type="date"
                  value={startedAt}
                  onChange={(e) => setStartedAt(e.target.value)}
                />
              </Field>
              <Field label="Première session">
                <input
                  className="input"
                  type="datetime-local"
                  value={nextSessionAt}
                  onChange={(e) => setNextSessionAt(e.target.value)}
                />
              </Field>
              <Field label="Objectif de l'élève" className="sm:col-span-2">
                <textarea
                  className="textarea"
                  value={objective}
                  placeholder="Passer sa boutique de 3k à 10k / mois en 90 jours"
                  onChange={(e) => setObjective(e.target.value)}
                />
              </Field>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}
