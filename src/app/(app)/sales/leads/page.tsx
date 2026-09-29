"use client";

import { useMemo, useState } from "react";
import { api } from "@/lib/client";
import { fmtDateTime, isoToParisInput, parisDay, parisToIso, parisWeekday, relative } from "@/lib/format";
import { useSalesData } from "@/lib/sales/client";
import { hasRole } from "@/lib/sales/roles";
import { Card, Empty, ErrorNote, Field, Modal, PageHeader, Spinner, StatTile, useToast } from "@/components/ui";
import { useSales } from "@/components/sales/context";
import type { CallBucket, CallLeadRow } from "@/app/api/sales/leads/route";
import type { PublicMember } from "@/lib/sales/repo";
import type { LeadCallStatus } from "@/lib/types";

/**
 * Code couleur, le meme partout sur la page : bord de ligne, pastille,
 * compteurs et legende. Un setter doit lire l'etat d'un contact sans lire
 * le texte.
 */
const COLOR = {
  new: "#94a3b8", //   gris : jamais appelé
  yellow: "#eab308", // jaune : ne répond pas, à relancer
  blue: "#3b82f6", //   bleu : veut être rappelé plus tard
  violet: "#a855f7", // violet : joint, rendez-vous à fixer
  green: "#22c55e", //  vert : rendez-vous posé
  red: "#ef4444", //    rouge : pas intéressé, pas d'argent
} as const;

const LEGEND: { color: string; label: string }[] = [
  { color: COLOR.new, label: "Nouveau, jamais appelé" },
  { color: COLOR.yellow, label: "Ne répond pas, à relancer" },
  { color: COLOR.blue, label: "Veut être rappelé plus tard" },
  { color: COLOR.violet, label: "Joint, rendez-vous à fixer" },
  { color: COLOR.green, label: "Rendez-vous posé" },
  { color: COLOR.red, label: "Pas intéressé, pas d'argent" },
];

/** Groupes, dans l'ordre de traitement : ce qu'il faut faire maintenant en haut. */
const BUCKETS: { key: CallBucket; title: string; hint: string; tone: string }[] = [
  { key: "due", title: "Rappels à passer maintenant", hint: "Ils ont demandé à être rappelés, l'heure est passée.", tone: COLOR.blue },
  { key: "new", title: "Nouveaux, jamais appelés", hint: "Le plus récent en premier : il vient de s'inscrire, il est chaud.", tone: COLOR.new },
  { key: "retry", title: "À relancer", hint: "Pas de réponse ou message laissé. Le plus ancien essai en premier.", tone: COLOR.yellow },
  { key: "later", title: "Rappels prévus", hint: "Ils ont donné un créneau, ne pas appeler avant.", tone: COLOR.blue },
  { key: "talking", title: "Joints, rendez-vous à fixer", hint: "Tu les as eus au téléphone : il manque la date du call.", tone: COLOR.violet },
  { key: "booked", title: "Rendez-vous posés", hint: "Call de vente enregistré, le closer prend le relais.", tone: COLOR.green },
  { key: "lost", title: "Pas intéressés", hint: "Trente derniers jours. Un bouton les remet dans la liste s'ils reviennent.", tone: COLOR.red },
];

function Dot({ color }: { color: string }) {
  return <span className="inline-block w-[10px] h-[10px] rounded-full shrink-0" style={{ background: color, boxShadow: `0 0 0 2px color-mix(in srgb, ${color} 25%, transparent)` }} />;
}

const STATUS_LABEL: Record<LeadCallStatus, string> = {
  "no-answer": "Ne répond pas",
  "message-sent": "Message envoyé",
  callback: "Demande à être rappelé",
  reached: "Appelé, joint",
  "not-interested": "Pas intéressé",
};

const COUNTRY: Record<string, string> = { FR: "France", BE: "Belgique", CH: "Suisse", CA: "Canada", AE: "Émirats", MA: "Maroc", DZ: "Algérie", TN: "Tunisie", LU: "Luxembourg" };

/** Heure locale du prospect approximee par son pays : appeler un Canadien a 9 h de Paris, c'est 3 h chez lui. */
function localHint(country?: string): string {
  const tz: Record<string, string> = { CA: "America/Toronto", AE: "Asia/Dubai", MA: "Africa/Casablanca", DZ: "Africa/Algiers", TN: "Africa/Tunis", CH: "Europe/Zurich", BE: "Europe/Brussels", LU: "Europe/Luxembourg", FR: "Europe/Paris" };
  const zone = country ? tz[country] : "";
  if (!zone || zone === "Europe/Paris") return "";
  try {
    return new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: zone }).format(new Date());
  } catch {
    return "";
  }
}

/** Valeur d'un <input type="datetime-local"> pour un instant, en heure de Paris. */
const localInputValue = (d: Date): string => isoToParisInput(d);

/**
 * Les prospects de la landing page (Systeme.io), a appeler dans l'ordre.
 *
 * La liste se resynchronise a chaque ouverture (au plus toutes les trois
 * minutes), ne montre que ce qui reste a faire, dans l'ordre ou il faut le
 * faire, et chaque ligne se statue en un clic : ne repond pas, message
 * envoye, a rappeler a telle heure, joint, pas interesse, rendez-vous pris.
 */
export default function CallLeadsPage() {
  const { session, members, version, bump } = useSales();
  const toast = useToast();
  const [booking, setBooking] = useState<CallLeadRow | null>(null);
  const [callbackFor, setCallbackFor] = useState<CallLeadRow | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [busy, setBusy] = useState("");

  const setters = useMemo(() => members.filter((m) => hasRole(m, "setter") && m.status !== "inactif"), [members]);

  const { data, loading, error, reload } = useSalesData<{
    rows: CallLeadRow[];
    counts: Record<CallBucket, number> & { notInterested: number; hidden: number };
    // (lost = pas intéressés des 30 derniers jours, notInterested = tous)
    lastSyncAt: string;
    syncError: string;
    defaultCloserId: string;
  }>(`/api/sales/leads?v=${version}`);

  const setStatus = async (lead: CallLeadRow, status: LeadCallStatus, callbackAt?: string, note?: string) => {
    setBusy(lead.id);
    try {
      await api(`/api/sales/leads/${lead.id}`, {
        method: "PATCH",
        body: JSON.stringify({ action: "status", status, callbackAt, note }),
      });
      toast(
        status === "callback" && callbackAt
          ? `Rappel noté pour le ${fmtDateTime(callbackAt)}.`
          : status === "not-interested"
            ? `${lead.name} sort de la liste.`
            : `Noté : ${STATUS_LABEL[status].toLowerCase()}.`,
      );
      void reload();
      bump();
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setBusy("");
    }
  };

  const assign = async (lead: CallLeadRow, setterId: string) => {
    try {
      await api(`/api/sales/leads/${lead.id}`, { method: "PATCH", body: JSON.stringify({ action: "assign", setterId }) });
      toast("Lead réattribué.");
      void reload();
    } catch (e) {
      toast((e as Error).message, "err");
    }
  };

  const reopen = async (lead: CallLeadRow) => {
    setBusy(lead.id);
    try {
      await api(`/api/sales/leads/${lead.id}`, { method: "PATCH", body: JSON.stringify({ action: "reopen" }) });
      toast(`${lead.name} est de retour dans la liste.`);
      void reload();
      bump();
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setBusy("");
    }
  };

  const assignAll = async (setterId: string) => {
    try {
      const r = await api<{ moved: number; setter: string }>("/api/sales/leads", { method: "PATCH", body: JSON.stringify({ setterId }) });
      toast(r.moved ? `${r.moved} lead${r.moved > 1 ? "s" : ""} attribué${r.moved > 1 ? "s" : ""} à ${r.setter}.` : `Tout était déjà chez ${r.setter}.`);
      void reload();
      bump();
    } catch (e) {
      toast((e as Error).message, "err");
    }
  };

  const sync = async () => {
    setSyncing(true);
    try {
      const r = await api<{ examined: number; created: number; known: number; inBase: { toCall: number } }>("/api/sales/systemeio", { method: "POST" });
      toast(
        r.created
          ? `${r.created} nouveau${r.created > 1 ? "x" : ""} lead${r.created > 1 ? "s" : ""} récupéré${r.created > 1 ? "s" : ""}.`
          : `${r.examined} contact${r.examined > 1 ? "s" : ""} lu${r.examined > 1 ? "s" : ""} chez Systeme.io, ${r.known} déjà en base. ${r.inBase.toCall} à appeler au total.`,
      );
      void reload();
      bump();
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setSyncing(false);
    }
  };

  const rows = data?.rows ?? [];
  const c = data?.counts;
  const todo = (c?.due ?? 0) + (c?.new ?? 0) + (c?.retry ?? 0);

  return (
    <>
      <PageHeader
        title="À appeler"
        subtitle={
          data?.lastSyncAt
            ? `Contacts Systeme.io synchronisés ${relative(data.lastSyncAt)}. Appelle dans les cinq minutes qui suivent l'inscription : c'est là que ça décroche.`
            : "Les prospects qui viennent de laisser leurs coordonnées sur la landing page."
        }
        actions={
          <>
            {session.isAdmin && setters.length > 0 && rows.some((r) => r.bucket !== "booked") && (
              <select
                className="select !w-auto !h-[30px] !text-[12.5px]"
                value=""
                title="Donner tous les leads encore à appeler à un setter"
                onChange={(e) => {
                  const id = e.target.value;
                  if (!id) return;
                  const name = setters.find((m) => m.id === id)?.name ?? "";
                  if (window.confirm(`Attribuer tous les leads à appeler à ${name} ?`)) void assignAll(id);
                }}
              >
                <option value="">Tout attribuer à…</option>
                {setters.map((m) => (
                  <option key={m.id} value={m.id}>{m.name}</option>
                ))}
              </select>
            )}
            <button className="btn" onClick={() => void sync()} disabled={syncing} title="Relire Systeme.io tout de suite">
              {syncing ? <span className="spinner" /> : "↻ Vérifier les nouveaux"}
            </button>
          </>
        }
      />

      {(error || data?.syncError) && (
        <div className="mb-4">
          <ErrorNote>{error || `Synchro Systeme.io : ${data?.syncError}`}</ErrorNote>
        </div>
      )}

      {/* Legende : la couleur d'un contact dit son etat, sans lire le texte. */}
      <div
        className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-3.5 py-2.5 rounded-[10px] mb-3 text-[12px]"
        style={{ background: "var(--surface-2)", border: "1px solid var(--border)" }}
      >
        <span className="label-xs mr-1">Code couleur</span>
        {LEGEND.map((l) => (
          <span key={l.label} className="flex items-center gap-1.5">
            <Dot color={l.color} />
            {l.label}
          </span>
        ))}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-4">
        <StatTile label="À appeler" value={todo} accent={todo ? "var(--accent)" : undefined} hint={c?.due ? `${c.due} rappel${c.due > 1 ? "s" : ""} en retard` : "nouveaux + à relancer + rappels dus"} />
        <StatTile label="Nouveaux" value={c?.new ?? 0} accent={c?.new ? COLOR.new : undefined} />
        <StatTile label="À relancer" value={c?.retry ?? 0} accent={c?.retry ? COLOR.yellow : undefined} />
        <StatTile label="Rappels prévus" value={(c?.later ?? 0) + (c?.due ?? 0)} accent={c?.later || c?.due ? COLOR.blue : undefined} />
        <StatTile label="Rendez-vous posés" value={c?.booked ?? 0} accent={c?.booked ? COLOR.green : undefined} hint={c?.talking ? `+ ${c.talking} joint${c.talking > 1 ? "s" : ""} à fixer` : undefined} />
        <StatTile label="Pas intéressés" value={c?.lost ?? 0} accent={c?.lost ? COLOR.red : undefined} hint={c?.notInterested && c.notInterested > (c.lost ?? 0) ? `${c.notInterested} au total` : undefined} />
      </div>

      {loading && !data ? (
        <Card>
          <Spinner label="Chargement…" />
        </Card>
      ) : !rows.length ? (
        <Card>
          <Empty>
            {c?.hidden ? (
              <>
                {c.hidden} lead{c.hidden > 1 ? "s" : ""} à appeler existe{c.hidden > 1 ? "nt" : ""}, mais {c.hidden > 1 ? "ils sont attribués" : "il est attribué"} à un autre setter.
                <br />
                L&apos;admin peut te les donner : « À appeler », menu « Tout attribuer à… », ou setter par setter sur chaque ligne.
              </>
            ) : (
              <>Personne à appeler pour l&apos;instant. Les nouveaux inscrits de la landing page apparaîtront ici tout seuls.</>
            )}
          </Empty>
        </Card>
      ) : (
        <div className="flex flex-col gap-4">
          {BUCKETS.map((bucket) => {
            const items = rows.filter((r) => r.bucket === bucket.key);
            if (!items.length) return null;
            return (
              <Card
                key={bucket.key}
                title={
                  <span className="flex items-center gap-2">
                    <Dot color={bucket.tone} />
                    {bucket.title} · {items.length}
                  </span>
                }
                subtitle={bucket.hint}
                padded={false}
              >
                <ul>
                  {items.map((l, i) => {
                    const hint = localHint(l.country);
                    const booked = bucket.key === "booked";
                    const lost = bucket.key === "lost";
                    return (
                      <li
                        key={l.id}
                        className="px-3.5 py-3 flex items-center gap-3 flex-wrap"
                        style={{
                          borderBottom: i < items.length - 1 ? "1px solid var(--border)" : "none",
                          borderLeft: `4px solid ${bucket.tone}`,
                          background: `linear-gradient(90deg, color-mix(in srgb, ${bucket.tone} 9%, transparent), transparent 220px)`,
                          opacity: lost ? 0.8 : 1,
                        }}
                      >
                        <span className="min-w-0 flex-1 basis-[240px]">
                          <span className="flex items-center gap-2 text-[13.5px] font-medium">
                            <Dot color={bucket.tone} />
                            <span className="truncate">{l.name}</span>
                          </span>
                          <span className="dim text-[11.5px] flex flex-wrap gap-x-2">
                            <span title={l.optInAt || l.createdAt}>inscrit {relative(l.optInAt || l.createdAt)}</span>
                            {l.country && <span>· {COUNTRY[l.country] ?? l.country}{hint ? ` (il est ${hint} chez lui)` : ""}</span>}
                            {l.callStatus && !booked && (
                              <span>
                                · {STATUS_LABEL[l.callStatus]}
                                {l.callStatus === "callback" && l.callbackAt ? ` le ${fmtDateTime(l.callbackAt)}` : ""}
                                {l.callStatus === "no-answer" && (l.callAttempts ?? 0) > 1 ? ` (${l.callAttempts} essais)` : ""}
                                {l.lastCallAt ? `, ${relative(l.lastCallAt)}` : ""}
                              </span>
                            )}
                            {booked && l.appointmentAt && (
                              <span style={{ color: "var(--emerald)" }}>
                                · call le {fmtDateTime(l.appointmentAt)}{l.closerName ? ` avec ${l.closerName}` : ", closer à attribuer"}
                              </span>
                            )}
                            {!l.setterId && <span style={{ color: "var(--warning)" }}>· sans setter, premier qui appelle le prend</span>}
                          </span>
                        </span>

                        <span className="flex items-center gap-2 flex-wrap">
                          {l.phone ? (
                            <a className="btn btn-sm btn-primary" href={`tel:${l.phone}`} title="Appeler">
                              ☏ {l.phone}
                            </a>
                          ) : (
                            <span className="badge badge-warn !text-[10.5px]">Pas de numéro</span>
                          )}
                          {l.email && (
                            <a className="btn btn-sm btn-ghost !text-[12px]" href={`mailto:${l.email}`} title={l.email}>
                              ✉ {l.email.length > 26 ? `${l.email.slice(0, 24)}…` : l.email}
                            </a>
                          )}
                          {session.isAdmin && setters.length > 0 && (
                            <select
                              className="select !h-[26px] !text-[11.5px] !w-auto"
                              value={l.setterId ?? ""}
                              title="Setter chargé de ce lead"
                              onChange={(e) => void assign(l, e.target.value)}
                            >
                              <option value="">Setter…</option>
                              {setters.map((m) => (
                                <option key={m.id} value={m.id}>{m.name}</option>
                              ))}
                            </select>
                          )}
                        </span>

                        {lost && (
                          <span className="flex gap-1.5 shrink-0 ml-auto">
                            <button className="btn btn-sm" onClick={() => void reopen(l)} disabled={busy === l.id} title="Il revient : le remettre dans les leads à relancer">
                              ↺ Remettre à appeler
                            </button>
                          </span>
                        )}
                        {!booked && !lost && (
                          <span className="flex gap-1.5 shrink-0 ml-auto flex-wrap">
                            <button className="btn btn-sm" onClick={() => setBooking(l)} disabled={busy === l.id} title="Le prospect a accepté un rendez-vous">
                              ✓ Call pris
                            </button>
                            {l.callStatus !== "reached" && (
                              <button className="btn btn-sm" onClick={() => void setStatus(l, "reached")} disabled={busy === l.id} title="Appelé et joint, rendez-vous à fixer">
                                Joint
                              </button>
                            )}
                            <button className="btn btn-sm" onClick={() => setCallbackFor(l)} disabled={busy === l.id} title="Il demande à être rappelé : choisir la date et l'heure">
                              ⏰ À rappeler
                            </button>
                            <button className="btn btn-sm btn-ghost" onClick={() => void setStatus(l, "no-answer")} disabled={busy === l.id} title="Pas de réponse">
                              Ne répond pas
                            </button>
                            <button className="btn btn-sm btn-ghost" onClick={() => void setStatus(l, "message-sent")} disabled={busy === l.id} title="Message laissé (SMS, WhatsApp, vocal)">
                              Message envoyé
                            </button>
                            <button
                              className="btn btn-sm btn-ghost"
                              disabled={busy === l.id}
                              onClick={() => {
                                const reason = window.prompt("Pas intéressé : pourquoi ? (optionnel)") ?? null;
                                if (reason === null) return;
                                void setStatus(l, "not-interested", undefined, reason);
                              }}
                              title="Pas intéressé : sort de la liste"
                            >
                              ✕ Pas intéressé
                            </button>
                          </span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </Card>
            );
          })}
        </div>
      )}

      {callbackFor && (
        <CallbackModal
          lead={callbackFor}
          onClose={() => setCallbackFor(null)}
          onPick={async (at, note) => {
            const l = callbackFor;
            setCallbackFor(null);
            await setStatus(l, "callback", at, note);
          }}
        />
      )}

      {booking && (
        <BookModal
          lead={booking}
          isAdmin={session.isAdmin}
          memberId={session.memberId}
          // Le setter qui est aussi closer se propose lui-meme ; sinon le
          // closer par defaut des reglages. Le call arrive sur le bon dash.
          defaultCloserId={hasRole(session, "closer") && session.memberId ? session.memberId : (data?.defaultCloserId ?? "")}
          members={members}
          onClose={() => setBooking(null)}
          onDone={() => {
            setBooking(null);
            void reload();
            bump();
          }}
        />
      )}
    </>
  );
}

/* ------------------------------ À rappeler ------------------------------ */

function CallbackModal({
  lead,
  onClose,
  onPick,
}: {
  lead: CallLeadRow;
  onClose: () => void;
  onPick: (atIso: string, note: string) => Promise<void>;
}) {
  const defaultAt = useMemo(() => {
    const d = new Date(Date.now() + 2 * 3600_000);
    d.setMinutes(0, 0, 0);
    return localInputValue(d);
  }, []);
  const [at, setAt] = useState(defaultAt);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  // Raccourcis : les cas qui reviennent a chaque appel, en heure de Paris.
  const quick = (label: string, value: () => string) => (
    <button type="button" className="btn btn-sm" onClick={() => setAt(value())}>
      {label}
    </button>
  );
  // Prochain lundi a Paris (dans 7 jours si on est lundi).
  const nextMonday = () => parisDay(((8 - parisWeekday()) % 7) || 7);

  return (
    <Modal
      open
      onClose={onClose}
      title={`Rappeler ${lead.name}`}
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={busy}>Annuler</button>
          <button
            className="btn btn-primary"
            disabled={busy || !at}
            onClick={async () => {
              setBusy(true);
              try {
                await onPick(parisToIso(at), note);
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? <span className="spinner" /> : "Noter le rappel"}
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-3.5">
        <div className="flex gap-1.5 flex-wrap">
          {quick("Dans 1 h", () => isoToParisInput(new Date(Date.now() + 3600_000)).slice(0, 14) + "00")}
          {quick("Ce soir 18 h", () => `${parisDay(0)}T18:00`)}
          {quick("Demain 10 h", () => `${parisDay(1)}T10:00`)}
          {quick("Demain 14 h", () => `${parisDay(1)}T14:00`)}
          {quick("Lundi 10 h", () => `${nextMonday()}T10:00`)}
        </div>
        <Field label="Date et heure du rappel (heure de Paris)">
          <input className="input" type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} />
        </Field>
        <Field label="Note" hint="Ce qu'il a dit, pour reprendre la conversation au bon endroit.">
          <textarea className="input w-full" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        <p className="dim text-[12px]">Il remontera en haut de la liste, dans « Rappels à passer maintenant », dès que l&apos;heure sera passée.</p>
      </div>
    </Modal>
  );
}

/* ------------------------------ RDV pris ------------------------------- */

function BookModal({
  lead,
  isAdmin,
  memberId,
  defaultCloserId,
  members,
  onClose,
  onDone,
}: {
  lead: CallLeadRow;
  isAdmin: boolean;
  memberId: string;
  defaultCloserId: string;
  members: PublicMember[];
  onClose: () => void;
  onDone: () => void;
}) {
  const toast = useToast();
  const closers = useMemo(() => members.filter((m) => hasRole(m, "closer")), [members]);
  const setters = useMemo(() => members.filter((m) => hasRole(m, "setter")), [members]);
  const defaultAt = useMemo(() => {
    const d = new Date(Date.now() + 24 * 3600_000);
    d.setMinutes(0, 0, 0);
    return localInputValue(d);
  }, []);
  const [at, setAt] = useState(defaultAt);
  const [closerId, setCloserId] = useState(closers.some((m) => m.id === defaultCloserId) ? defaultCloserId : "");
  const [setterId, setSetterId] = useState(lead.setterId || memberId);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    try {
      await api("/api/sales/appointments", {
        method: "POST",
        body: JSON.stringify({
          leadId: lead.id,
          igUsername: lead.igUsername ?? "",
          name: lead.name,
          email: lead.email ?? "",
          phone: lead.phone ?? "",
          country: lead.country ?? "",
          timezone: lead.timezone || "Europe/Paris",
          scheduledAt: parisToIso(at),
          setterId,
          closerId,
          source: "inbound",
          setterNotes: notes,
        }),
      });
      toast("Call de vente enregistré.");
      onDone();
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={`Call de vente avec ${lead.name}`}
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={busy}>Annuler</button>
          <button className="btn btn-primary" onClick={() => void submit()} disabled={busy || !at}>
            {busy ? <span className="spinner" /> : "Enregistrer le call"}
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-3.5">
        <Field label="Date et heure du call (heure de Paris)">
          <input className="input" type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} />
        </Field>
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="Closer">
            <select className="select" value={closerId} onChange={(e) => setCloserId(e.target.value)}>
              <option value="">À attribuer plus tard</option>
              {closers.map((m) => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </select>
          </Field>
          {isAdmin && (
            <Field label="Setter">
              <select className="select" value={setterId} onChange={(e) => setSetterId(e.target.value)}>
                {setters.map((m) => (
                  <option key={m.id} value={m.id}>{m.name}</option>
                ))}
              </select>
            </Field>
          )}
        </div>
        <Field label="Notes pour le closer" hint="Ce qu'il cherche, son objection, son budget…">
          <textarea className="input w-full" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}
