"use client";

import { hasRole, sessionHas } from "@/lib/sales/roles";
import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/client";
import { fmtDateTime, fmtMoney, label } from "@/lib/format";
import { CALL_OUTCOMES, LOST_REASONS, PAYMENT_TYPES } from "@/lib/sales/constants";
import { Field, Modal, Spinner, useToast } from "@/components/ui";
import { IgHandle, StatusBadge } from "./bits";
import type { PublicMember } from "@/lib/sales/repo";
import type {
  ActivityLog,
  Appointment,
  AppointmentStatus,
  FollowUp,
  Lead,
  LostReason,
  PaymentType,
  Sale,
  Session,
  Student,
} from "@/lib/types";

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
  const [contractValue, setContractValue] = useState("");
  const [cashCollected, setCashCollected] = useState("");
  const [paymentType, setPaymentType] = useState<PaymentType>("paid-in-full");
  const [installments, setInstallments] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("");
  const [followUpAt, setFollowUpAt] = useState("");
  const [followUpNotes, setFollowUpNotes] = useState("");
  const [rescheduledAt, setRescheduledAt] = useState("");

  /* Inscription de l'eleve, apres un close. */
  const [enrolling, setEnrolling] = useState(false);
  const [program, setProgram] = useState("");
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
    setPaymentType("paid-in-full");
    setInstallments("");
    setPaymentMethod("");
    setFollowUpAt("");
    setFollowUpNotes("");
    setRescheduledAt("");
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
          nextSessionAt: nextSessionAt ? new Date(nextSessionAt).toISOString() : "",
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
    if (!appt || !outcome) return;

    const payload: Record<string, unknown> = { status: outcome, closerNotes };

    if (outcome === "closed-lost") payload.lostReason = lostReason;

    if (outcome === "closed-won") {
      const contract = Number(contractValue);
      const cash = Number(cashCollected || 0);
      if (!offer.trim()) return toast("Indique l'offre vendue.", "err");
      if (!(contract > 0)) return toast("La valeur de contrat doit être supérieure à 0.", "err");
      if (cash > contract) return toast("Le cash encaissé ne peut pas dépasser le contrat.", "err");
      payload.sale = {
        offer,
        contractValue: contract,
        cashCollected: cash,
        currency: detail?.currency ?? "USD",
        paymentType,
        installments: Number(installments || 0),
        paymentMethod,
        soldAt: new Date().toISOString(),
        notes: "",
      };
    }

    if (outcome === "follow-up" || outcome === "rescheduled") {
      if (followUpAt) {
        payload.followUp = { dueAt: new Date(followUpAt).toISOString(), notes: followUpNotes };
      }
      if (outcome === "rescheduled") {
        if (!rescheduledAt) return toast("Indique la nouvelle date du rendez-vous.", "err");
        payload.rescheduledAt = new Date(rescheduledAt).toISOString();
      }
    }

    setSaving(true);
    try {
      await api(`/api/sales/appointments/${appt.id}/outcome`, {
        method: "POST",
        body: JSON.stringify(payload),
      });
      toast(outcome === "closed-won" ? "Vente enregistrée." : "Résultat enregistré.");
      setOutcome(null);
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
          <button className="btn" onClick={onClose}>
            Fermer
          </button>
        )
      }
    >
      {loading || !detail || !appt ? (
        <Spinner label="Chargement…" />
      ) : outcome ? (
        /* ---------------------- Saisie du resultat --------------------- */
        <div className="flex flex-col gap-3.5">
          <div className="flex items-center gap-2">
            <span className="label-xs">Résultat</span>
            <StatusBadge status={outcome} />
          </div>

          {outcome === "closed-won" && (
            <div className="grid sm:grid-cols-2 gap-3">
              <Field label="Offre vendue" className="sm:col-span-2">
                <input
                  className="input"
                  value={offer}
                  placeholder="Coaching 1:1 e-commerce"
                  onChange={(e) => setOffer(e.target.value)}
                  autoFocus
                />
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
              <Field label="Type de paiement">
                <select
                  className="select"
                  value={paymentType}
                  onChange={(e) => setPaymentType(e.target.value as PaymentType)}
                >
                  {PAYMENT_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {label(t)}
                    </option>
                  ))}
                </select>
              </Field>
              {paymentType === "installments" && (
                <Field label="Nombre d'échéances">
                  <input
                    className="input num"
                    type="number"
                    min={0}
                    value={installments}
                    placeholder="3"
                    onChange={(e) => setInstallments(e.target.value)}
                  />
                </Field>
              )}
              <Field label="Moyen de paiement" className={paymentType === "installments" ? "" : "sm:col-span-2"}>
                <input
                  className="input"
                  value={paymentMethod}
                  placeholder="Stripe, virement, PayPal…"
                  onChange={(e) => setPaymentMethod(e.target.value)}
                />
              </Field>
            </div>
          )}

          {outcome === "closed-lost" && (
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

          {outcome === "rescheduled" && (
            <Field label="Nouvelle date du rendez-vous">
              <input
                className="input"
                type="datetime-local"
                value={rescheduledAt}
                onChange={(e) => setRescheduledAt(e.target.value)}
              />
            </Field>
          )}

          {(outcome === "follow-up" || outcome === "rescheduled") && (
            <div className="grid sm:grid-cols-2 gap-3">
              <Field label="Relance prévue le">
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

          <Field label="Compte-rendu du call">
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
                  className="select !h-[28px] !text-[12.5px] mt-1"
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

          {appt.closerNotes && (
            <div>
              <div className="label-xs mb-1.5">Compte-rendu du closer</div>
              <div className="card-flat px-3.5 py-3 text-[12.5px] leading-relaxed whitespace-pre-wrap">
                {appt.closerNotes}
              </div>
            </div>
          )}

          {/* Vente */}
          {detail.sale && (
            <div>
              <div className="label-xs mb-1.5">Vente</div>
              <div className="card-flat px-3.5 py-3">
                <div className="flex items-baseline justify-between gap-3 flex-wrap">
                  <span className="text-[13px] font-semibold">{detail.sale.offer}</span>
                  <span className="badge badge-good">{label(detail.sale.status)}</span>
                </div>
                <div className="flex flex-wrap gap-x-5 gap-y-1.5 mt-2">
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
                  {detail.sale.refundAmount > 0 && (
                    <span className="text-[12.5px]">
                      <span className="dim">Remboursé </span>
                      <span className="num font-semibold" style={{ color: "var(--critical)" }}>
                        {fmtMoney(detail.sale.refundAmount, detail.sale.currency)}
                      </span>
                    </span>
                  )}
                  <span className="badge !text-[10.5px] !py-0">{label(detail.sale.paymentType)}</span>
                  {detail.sale.installments > 0 && (
                    <span className="dim text-[11.5px] num">{detail.sale.installments} échéances</span>
                  )}
                </div>

                {/*
                  Passage de la vente au coaching.
                  Reserve a l'admin : c'est lui qui decide quand l'onboarding
                  commence reellement, pas le closer qui vient de signer.
                */}
                {session.isAdmin && (
                  <div className="mt-3 pt-3" style={{ borderTop: "1px solid var(--border)" }}>
                    {detail.student ? (
                      <div className="flex items-center justify-between gap-3 flex-wrap">
                        <span className="text-[12.5px]">
                          <span className="dim">Élève inscrit : </span>
                          <strong>{detail.student.program}</strong>
                          <span className="dim"> · {label(detail.student.status)} · </span>
                          <span className="num">{detail.student.progress} %</span>
                        </span>
                        <a href="/eleves" className="btn btn-sm">
                          Suivi élève
                        </a>
                      </div>
                    ) : (
                      <div className="flex items-center justify-between gap-3 flex-wrap">
                        <span className="dim text-[12px]">Pas encore inscrit en coaching.</span>
                        <button className="btn btn-sm btn-primary" onClick={openEnroll}>
                          Inscrire l&apos;élève
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

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
              <div className="label-xs mb-1.5">Enregistrer le résultat du call</div>
              <div className="flex flex-wrap gap-2">
                {CALL_OUTCOMES.map((o) => (
                  <button
                    key={o}
                    className={`btn btn-sm ${o === "closed-won" ? "btn-primary" : ""}`}
                    onClick={() => setOutcome(o)}
                  >
                    {label(o)}
                  </button>
                ))}
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
