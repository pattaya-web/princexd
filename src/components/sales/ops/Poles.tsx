"use client";

/**
 * Les poles operationnels du cockpit : des vues filtrees des memes donnees
 * (leads, rendez-vous, relances, ventes). Lignes compactes, lisibles sur
 * telephone, avec l'action principale a droite.
 */
import { useState, type ReactNode } from "react";
import type { AnomalyRow, ApptRow, FollowRow, LeadRow, NoShowRow, PaymentRow, WorkspacePayload } from "@/lib/sales/ops/views";
import { fmtDualDateTime, isoToParisInput, parisToIso } from "@/lib/format";
import { Empty } from "@/components/ui";
import { Avatar, ContactButtons, money, Pill, useOpsAction, when } from "./shared";

function Line({ initials, title, onOpen, chips, meta, right }: { initials: string; title: string; onOpen: () => void; chips?: ReactNode; meta?: ReactNode; right?: ReactNode }) {
  return (
    <li className="card px-3.5 py-2.5 flex flex-wrap sm:flex-nowrap items-start gap-3">
      <button type="button" onClick={onOpen} aria-label={`Ouvrir ${title}`}>
        <Avatar initials={initials} />
      </button>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <button type="button" className="text-[14px] font-semibold hover:underline text-left" onClick={onOpen}>
            {title}
          </button>
          {chips}
        </div>
        {meta && <div className="muted text-[12px] mt-0.5 leading-relaxed">{meta}</div>}
      </div>
      {right && <div className="flex flex-wrap items-center gap-1 sm:justify-end w-full sm:w-auto">{right}</div>}
    </li>
  );
}

const List = ({ children, empty }: { children: ReactNode[]; empty: string }) => (children.length ? <ul className="space-y-2">{children}</ul> : <Empty>{empty}</Empty>);

const nextTxt = (n: { title: string; dueAt: string } | null, today: string) => (n ? `Prochaine action : ${n.title} (${when(n.dueAt, today)})` : "⚠ Aucune prochaine action");

type Props = { data: WorkspacePayload; filter: string; onOpen: (leadId: string) => void; onSheet: (leadId: string) => void; onChanged: () => void };

const match = (q: string, ...fields: string[]) => !q || fields.some((f) => f.toLowerCase().includes(q.toLowerCase()));

/* ------------------------------ Nouveaux leads ----------------------------- */

export function NewLeadsPole({ data, filter, onOpen, onChanged }: Props) {
  const [channel, setChannel] = useState("");
  const { run, busy } = useOpsAction(onChanged);
  const channels = [...new Set(data.poles.newLeads.map((l) => l.source))];
  const rows = data.poles.newLeads.filter((l) => (!channel || l.source === channel) && match(filter, l.name, l.source));
  return (
    <div className="space-y-3">
      {channels.length > 1 && (
        <div className="flex flex-wrap gap-1">
          <button type="button" className={`btn btn-sm ${!channel ? "btn-primary" : ""}`} onClick={() => setChannel("")}>
            Tous
          </button>
          {channels.map((c) => (
            <button key={c} type="button" className={`btn btn-sm ${channel === c ? "btn-primary" : ""}`} onClick={() => setChannel(c)}>
              {c}
            </button>
          ))}
        </div>
      )}
      <List empty="Aucun nouveau lead à traiter.">
        {rows.map((l) => (
          <Line
            key={l.id}
            initials={l.initials}
            title={l.name}
            onOpen={() => onOpen(l.id)}
            chips={
              <>
                <Pill>{l.source}</Pill>
                <Pill tone={l.lastContactAt ? "good" : "warn"}>{l.settingLabel}</Pill>
                {l.heat && <Pill tone="bad">{l.heat}</Pill>}
              </>
            }
            meta={
              <>
                Arrivé {when(l.createdAt, data.today)} · {l.ownerName}
                {l.responseMin !== null ? ` · première réponse en ${l.responseMin < 60 ? `${l.responseMin} min` : `${Math.round(l.responseMin / 60)} h`}` : ` · en attente depuis ${Math.max(0, Math.round((Date.parse(data.now) - Date.parse(l.createdAt)) / 60_000 / 60))} h`}
                <br />
                {nextTxt(l.next, data.today)}
              </>
            }
            right={
              <>
                <ContactButtons contact={l.contact} />
                <button type="button" className="btn btn-sm btn-primary" disabled={busy} onClick={() => void run({ type: "lead", op: "contacted", leadId: l.id }, `${l.name} : contact enregistré.`)}>
                  ✓ Contacté
                </button>
              </>
            }
          />
        ))}
      </List>
    </div>
  );
}

/* ------------------------------- Conversations ----------------------------- */

export function ConversationsPole({ data, filter, onOpen, onChanged }: Props) {
  const { run, busy } = useOpsAction(onChanged);
  const rows = data.poles.conversations.filter((l) => match(filter, l.name, l.source, l.settingLabel));
  return (
    <List empty="Aucune conversation en cours. Les leads contactés apparaissent ici jusqu'à la réservation.">
      {rows.map((l: LeadRow) => (
        <Line
          key={l.id}
          initials={l.initials}
          title={l.name}
          onOpen={() => onOpen(l.id)}
          chips={
            <>
              <Pill tone="info">{l.settingLabel}</Pill>
              <Pill>{l.source}</Pill>
              {l.heat && <Pill tone="bad">{l.heat}</Pill>}
            </>
          }
          meta={
            <>
              Dernier contact {l.lastContactAt ? when(l.lastContactAt, data.today) : "—"} · {l.ownerName}
              <br />
              {nextTxt(l.next, data.today)}
            </>
          }
          right={
            <>
              <ContactButtons contact={l.contact} />
              <select className="select select-xs" defaultValue="" disabled={busy} onChange={(e) => e.target.value && void run({ type: "lead", op: "status", leadId: l.id, settingStatus: e.target.value }, "Statut mis à jour.")} aria-label="Changer le statut">
                <option value="">Statut…</option>
                <option value="conversation">En conversation</option>
                <option value="awaiting-reply">En attente de réponse</option>
                <option value="qualified">Qualifié</option>
                <option value="proposed">Rendez-vous proposé</option>
                <option value="nurturing">Nurturing</option>
                <option value="not-qualified">Non qualifié</option>
                <option value="lost">Perdu</option>
                <option value="dnc">Ne plus contacter</option>
              </select>
            </>
          }
        />
      ))}
    </List>
  );
}

/* -------------------------------- Rendez-vous ------------------------------ */

export function AppointmentsPole({ data, filter, onOpen, onSheet, onChanged }: Props) {
  const { run, busy } = useOpsAction(onChanged);
  const [moving, setMoving] = useState<{ id: string; at: string } | null>(null);
  const rows = data.poles.appointments.filter((a) => match(filter, a.name, a.source, a.confirmLabel));
  return (
    <List empty="Aucun rendez-vous dans les 14 prochains jours.">
      {rows.map((a: ApptRow) => {
        const live = ["booked", "confirmed", "rescheduled"].includes(a.status);
        const past = Date.parse(a.scheduledAt) < Date.parse(data.now);
        return (
          <Line
            key={a.id}
            initials={a.initials}
            title={a.name}
            onOpen={() => onOpen(a.leadId)}
            chips={
              <>
                <Pill tone={a.confirmTone}>{a.confirmLabel}</Pill>
                <Pill>{a.source}</Pill>
              </>
            }
            meta={
              <>
                <strong className="num">{fmtDualDateTime(a.scheduledAt)}</strong> · fuseau du prospect : {a.timezone}
                <br />
                Suivi : {a.ownerName} · Setter : {a.setterName || "—"} · Closer : {a.closerName || "—"}
                {a.lastInteraction && (
                  <>
                    <br />
                    Dernière interaction {when(a.lastInteraction.at, data.today)} : {a.lastInteraction.text}
                  </>
                )}
                <br />
                {nextTxt(a.next, data.today)}
                {moving?.id === a.id && (
                  <span className="flex flex-wrap items-center gap-1 mt-1.5">
                    <input type="datetime-local" className="input !h-[28px] !w-auto text-[12px]" value={moving.at} onChange={(e) => setMoving({ id: a.id, at: e.target.value })} />
                    <span className="dim text-[11px]">heure de Paris</span>
                    <button type="button" className="btn btn-sm btn-primary" disabled={busy || !moving.at} onClick={() => void run({ type: "appointment", appointmentId: a.id, op: "reschedule", at: parisToIso(moving.at) }, "Call reprogrammé : nouvelles confirmations aux bons horaires.").then(() => setMoving(null))}>
                      Valider
                    </button>
                  </span>
                )}
              </>
            }
            right={
              live && !past ? (
                <>
                  <ContactButtons contact={a.contact} />
                  <button type="button" className="btn btn-sm btn-primary" disabled={busy || a.confirmation === "confirmed"} onClick={() => void run({ type: "appointment", appointmentId: a.id, op: "confirm", confirmation: "confirmed" }, "Confirmé par le prospect.")}>
                    ✓ Confirmé
                  </button>
                  <button type="button" className="btn btn-sm" disabled={busy || a.confirmation === "awaiting"} onClick={() => void run({ type: "appointment", appointmentId: a.id, op: "confirm", confirmation: "awaiting" }, "Confirmation envoyée : en attente de sa réponse.")}>
                    Envoyée
                  </button>
                  <button type="button" className="btn btn-sm btn-ghost" onClick={() => setMoving(moving?.id === a.id ? null : { id: a.id, at: isoToParisInput(a.scheduledAt) })}>
                    Reprogrammer
                  </button>
                </>
              ) : live && past ? (
                <>
                  <button type="button" className="btn btn-sm" disabled={busy} onClick={() => void run({ type: "appointment", appointmentId: a.id, op: "no-show" }, "No-show noté : la récupération démarre.")}>
                    Absent (no-show)
                  </button>
                  <button type="button" className="btn btn-sm btn-ghost" onClick={() => onSheet(a.leadId)}>
                    Résultat…
                  </button>
                </>
              ) : null
            }
          />
        );
      })}
    </List>
  );
}

/* --------------------------------- No-shows -------------------------------- */

export function NoShowsPole({ data, filter, onOpen, onChanged }: Props) {
  const { run, busy } = useOpsAction(onChanged);
  const s = data.poles.noShowStats;
  const rows = data.poles.noShows.filter((n) => match(filter, n.name, n.stateLabel));
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2 text-[12.5px]">
        <Pill tone="bad">{s.total} no-shows</Pill>
        <Pill tone="good">{s.recovered} reprogrammés</Pill>
        <Pill tone="info">taux de récupération {s.rate} %</Pill>
        <Pill tone="good">{s.sold} vente{s.sold > 1 ? "s" : ""} après no-show</Pill>
      </div>
      <List empty="Aucun no-show à récupérer.">
        {rows.map((n: NoShowRow) => (
          <Line
            key={n.id}
            initials={n.initials}
            title={n.name}
            onOpen={() => onOpen(n.leadId)}
            chips={
              <>
                <Pill tone={n.state === "rescheduled" ? "good" : n.state === "lost" || n.state === "dnc" ? "muted" : "bad"}>{n.stateLabel}</Pill>
                {n.soldAfter && <Pill tone="good">Vendu ensuite</Pill>}
              </>
            }
            meta={
              <>
                Absent au call du {fmtDualDateTime(n.scheduledAt)} · {n.attempts} tentative(s){n.rescheduledTo ? ` · nouveau call ${fmtDualDateTime(n.rescheduledTo)}` : ""}
                <br />
                {n.state === "rescheduled" || n.state === "lost" || n.state === "dnc" ? "" : nextTxt(n.next, data.today)}
              </>
            }
            right={
              n.state !== "rescheduled" && n.state !== "lost" && n.state !== "dnc" ? (
                <>
                  <ContactButtons contact={n.contact} />
                  <button type="button" className="btn btn-sm btn-ghost" style={{ color: "var(--critical)" }} disabled={busy} onClick={() => window.confirm(`Classer ${n.name} perdu ? Plus aucune relance.`) && void run({ type: "appointment", appointmentId: n.id, op: "noshow-state", state: "lost" }, "Classé perdu.")}>
                    Perdu
                  </button>
                </>
              ) : null
            }
          />
        ))}
      </List>
    </div>
  );
}

/* --------------------------------- Follow-ups ------------------------------ */

export function FollowupsPole({ data, filter, onOpen }: Props) {
  const rows = data.poles.followups.filter((f) => match(filter, f.name, f.objection, f.notes));
  return (
    <List empty="Aucune relance après call en cours.">
      {rows.map((f: FollowRow) => (
        <Line
          key={f.id}
          initials={f.initials}
          title={f.name}
          onOpen={() => onOpen(f.leadId)}
          chips={
            <>
              <Pill tone={f.overdue ? "bad" : "info"}>{when(f.dueAt, data.today)}</Pill>
              {f.objection && <Pill tone="warn">{f.objection}</Pill>}
              {f.heat && <Pill tone="bad">{f.heat}</Pill>}
              {f.step === 2 && <Pill>Dernière relance</Pill>}
            </>
          }
          meta={
            <>
              {f.notes && <>Ce qu'il a dit : « {f.notes} »<br /></>}
              {f.summary && <span className="whitespace-pre-line">Résumé du call : {f.summary.slice(0, 260)}{f.summary.length > 260 ? "…" : ""}<br /></span>}
              {f.lastExchange && f.lastExchange !== f.notes && <>Dernier échange : {f.lastExchange}<br /></>}
              Prix proposé : {f.price ? money(f.price, data.currency) : "—"} · Suivi : {f.ownerName} · Closer : {f.closerName || "—"}
              {f.advice && (
                <>
                  <br />
                  <span style={{ color: "var(--accent)" }}>Conseil : {f.advice}</span>
                </>
              )}
            </>
          }
          right={<ContactButtons contact={f.contact} />}
        />
      ))}
    </List>
  );
}

/* --------------------------------- Paiements ------------------------------- */

export function PaymentsPole({ data, filter, onOpen, onSheet, onChanged }: Props) {
  const { run, busy } = useOpsAction(onChanged);
  const rows = data.poles.payments.filter((p) => match(filter, p.name, p.stateLabel));
  return (
    <div className="space-y-2">
      <p className="dim text-[12px]">Un paiement n'est encaissé que lorsqu'il est enregistré par l'admin ou le closer, après vérification. « Il dit avoir payé » crée une vérification, rien de plus.</p>
      <List empty="Aucun paiement en attente.">
        {rows.map((p: PaymentRow) => (
          <Line
            key={p.saleId}
            initials={p.initials}
            title={p.name}
            onOpen={() => onOpen(p.leadId)}
            chips={<Pill tone={p.tone}>{p.stateLabel}</Pill>}
            meta={
              <>
                {p.offer} · convenu <strong>{money(p.contractValue, data.currency)}</strong> · encaissé {money(p.cashCollected, data.currency)} · reste <strong>{money(p.remaining, data.currency)}</strong>
                <br />
                {p.expectedAt ? `Attendu le ${p.expectedAt.split("-").reverse().join("/")}` : "Sans date attendue"}
                {p.lastReminderAt ? ` · dernière relance ${when(p.lastReminderAt, data.today)}` : ""} · {p.ownerName} · closer {p.closerName || "—"}
                {p.followNote && <><br />Note : {p.followNote}</>}
                <br />
                {nextTxt(p.next, data.today)}
              </>
            }
            right={
              <>
                <ContactButtons contact={p.contact} />
                <select className="select select-xs" value="" disabled={busy} onChange={(e) => e.target.value && void run({ type: "payment", saleId: p.saleId, state: e.target.value, note: window.prompt("Détail (optionnel)") ?? "" }, "Suivi du paiement mis à jour.")} aria-label="Suivi du paiement">
                  <option value="">Suivi…</option>
                  <option value="promised">Paiement promis</option>
                  <option value="link-sent">Lien envoyé</option>
                  <option value="awaiting-verification">Dit avoir payé → vérifier</option>
                  <option value="failed">Paiement échoué</option>
                  <option value="abandoned">Abandonné</option>
                </select>
                {data.me.isAdmin && (
                  <button type="button" className="btn btn-sm btn-primary" onClick={() => onSheet(p.leadId)}>
                    Encaisser…
                  </button>
                )}
              </>
            }
          />
        ))}
      </List>
    </div>
  );
}

/* ------------------------------ Nurturing ---------------------------------- */

export function NurturingPole({ data, filter, onOpen, onChanged }: Props) {
  const { run, busy } = useOpsAction(onChanged);
  const [showOld, setShowOld] = useState(false);
  const rows = data.poles.nurturing.filter((l) => match(filter, l.name, l.nurtureReason, ...l.tags));
  const old = data.poles.reactivation.filter((l) => match(filter, l.name, l.source));
  return (
    <div className="space-y-4">
      <List empty="Aucun prospect en nurturing. Depuis une fiche : « Nurturing » avec une date de reprise.">
        {rows.map((l) => (
          <Line
            key={l.id}
            initials={l.initials}
            title={l.name}
            onOpen={() => onOpen(l.id)}
            chips={
              <>
                <Pill tone={l.nurtureUntil && l.nurtureUntil <= data.today ? "warn" : "info"}>reprise {l.nurtureUntil ? l.nurtureUntil.split("-").reverse().join("/") : "—"}</Pill>
                {l.heat && <Pill tone="bad">{l.heat}</Pill>}
                {l.tags.map((t) => (
                  <Pill key={t}>{t}</Pill>
                ))}
              </>
            }
            meta={
              <>
                {l.nurtureReason || "Sans raison notée"} · {l.source} · {l.ownerName}
              </>
            }
            right={<ContactButtons contact={l.contact} />}
          />
        ))}
      </List>
      {data.poles.reactivation.length > 0 && (
        <div>
          <button type="button" className="btn btn-sm" onClick={() => setShowOld((v) => !v)}>
            {showOld ? "Masquer" : "Voir"} les anciens prospects à réactiver ({data.poles.reactivation.length})
          </button>
          {showOld && (
            <ul className="space-y-2 mt-2">
              {old.map((l) => (
                <Line
                  key={l.id}
                  initials={l.initials}
                  title={l.name}
                  onOpen={() => onOpen(l.id)}
                  chips={<Pill>{l.source}</Pill>}
                  meta={<>Arrivé {when(l.createdAt, data.today)} · stade {l.stage}</>}
                  right={
                    <button type="button" className="btn btn-sm btn-primary" disabled={busy} onClick={() => void run({ type: "lead", op: "reactivate", leadId: l.id }, `${l.name} : tâche de réactivation créée pour aujourd'hui.`)}>
                      Réactiver
                    </button>
                  }
                />
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

/* --------------------------------- Anomalies ------------------------------- */

export function AnomaliesPole({ data, filter, onOpen }: Props) {
  const rows = data.poles.anomalies.filter((a) => match(filter, a.name, a.reason));
  return (
    <div className="space-y-2">
      <p className="dim text-[12px]">Leads actifs mal suivis : sans responsable, sans prochaine action, sans activité, ou call passé sans résultat. Ouvre la fiche et pose la suite (contact, relance planifiée, nurturing, perdu).</p>
      <List empty="Aucune anomalie : chaque lead actif a un responsable et une prochaine action. ✓">
        {rows.map((a: AnomalyRow) => (
          <Line key={a.leadId} initials={a.name.slice(0, 2).toUpperCase()} title={a.name} onOpen={() => onOpen(a.leadId)} chips={<Pill tone="bad">{a.reason}</Pill>} meta={<>Depuis {when(a.since, data.today)} · {a.ownerName}</>} />
        ))}
      </List>
    </div>
  );
}
