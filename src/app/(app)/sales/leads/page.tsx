"use client";

import { useMemo, useState, type CSSProperties } from "react";
import { api } from "@/lib/client";
import { fmtDateTime, isoToParisInput, parisDay, parisToIso, parisWeekday, relative } from "@/lib/format";
import { useSalesData } from "@/lib/sales/client";
import { hasRole } from "@/lib/sales/roles";
import { Card, Empty, ErrorNote, Field, Modal, PageHeader, Spinner, useToast } from "@/components/ui";
import { useSales } from "@/components/sales/context";
import { LeadSheet } from "@/components/sales/LeadSheet";
import Link from "next/link";
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


/** Couleur d'une ligne selon son etat. */
const TONE: Record<CallBucket, string> = {
  new: COLOR.new,
  retry: COLOR.yellow,
  due: COLOR.blue,
  later: COLOR.blue,
  talking: COLOR.violet,
  booked: COLOR.green,
  lost: COLOR.red,
};

/**
 * Filtres : un etat, ou tout. Servent aussi de legende. Pas de « rendez-vous
 * pose » ici : un lead froid qui prend rendez-vous quitte cette liste pour
 * Rendez-vous et l'Agenda, c'est un call de closing, plus un lead a appeler.
 */
type FilterKey = "all" | "new" | "retry" | "callback" | "talking" | "lost";
const FILTERS: { key: FilterKey; label: string; color?: string; buckets: CallBucket[] }[] = [
  { key: "all", label: "Tous", buckets: ["due", "new", "retry", "later", "talking", "lost"] },
  { key: "new", label: "Non statués", color: COLOR.new, buckets: ["new"] },
  { key: "retry", label: "Ne répond pas, à relancer", color: COLOR.yellow, buckets: ["retry"] },
  { key: "callback", label: "À rappeler plus tard", color: COLOR.blue, buckets: ["due", "later"] },
  { key: "talking", label: "Joints, RDV à fixer", color: COLOR.violet, buckets: ["talking"] },
  { key: "lost", label: "Pas intéressés", color: COLOR.red, buckets: ["lost"] },
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
  const [filter, setFilter] = useState<FilterKey>("all");
  // Vrai quand le prochain statut pose doit d'abord annuler le rendez-vous du lead.
  const [cancelPending, setCancelPending] = useState(false);
  // Fiche contact ouverte (notes, historique, rendez-vous).
  const [sheetId, setSheetId] = useState<string | null>(null);

  const setters = useMemo(() => members.filter((m) => hasRole(m, "setter") && m.status !== "inactif"), [members]);

  const { data, loading, error, reload } = useSalesData<{
    rows: CallLeadRow[];
    counts: Record<CallBucket, number> & { notInterested: number; hidden: number };
    // (lost = pas intéressés des 30 derniers jours, notInterested = tous)
    lastSyncAt: string;
    syncError: string;
    defaultCloserId: string;
    ownerMemberId: string;
  }>(`/api/sales/leads?v=${version}`);


  const setStatus = async (lead: CallLeadRow, status: LeadCallStatus, callbackAt?: string, note?: string, cancelAppointment = false) => {
    setBusy(lead.id);
    try {
      await api(`/api/sales/leads/${lead.id}`, {
        method: "PATCH",
        body: JSON.stringify({ action: "status", status, callbackAt, note, cancelAppointment }),
      });
      toast(
        cancelAppointment
          ? `Rendez-vous annulé, ${lead.name} repasse en « ${STATUS_LABEL[status].toLowerCase()} ».`
          : status === "callback" && callbackAt
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

  return (
    <>
      <PageHeader
        title="À appeler — leads froids de la landing page"
        subtitle={
          data?.lastSyncAt
            ? `Inscrits Systeme.io synchronisés ${relative(data.lastSyncAt)}. Appelle dans les cinq minutes qui suivent l'inscription : c'est là que ça décroche. Un rendez-vous posé part dans Rendez-vous et l'Agenda.`
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

      {/* Filtres, qui font aussi legende : un clic n'affiche qu'un etat. */}
      <div className="flex flex-wrap items-center gap-1.5 mb-3">
        {FILTERS.map((f) => {
          const n = f.buckets.reduce((acc, k) => acc + (c?.[k] ?? 0), 0);
          const active = filter === f.key;
          return (
            <button
              key={f.key}
              type="button"
              onClick={() => setFilter(f.key)}
              className="flex items-center gap-1.5 h-[30px] px-3 rounded-full text-[12.5px] font-medium transition-colors"
              style={{
                background: active ? (f.color ? `color-mix(in srgb, ${f.color} 28%, var(--surface))` : "var(--surface)") : "var(--surface-2)",
                border: `1px solid ${active ? (f.color ?? "var(--text-2)") : "var(--border)"}`,
                color: active ? "var(--text)" : "var(--text-2)",
              }}
              title={f.key === "all" ? "Tous les contacts" : `N'afficher que : ${f.label.toLowerCase()}`}
            >
              {f.color && <Dot color={f.color} />}
              {f.label}
              <span className="num opacity-70">{n}</span>
            </button>
          );
        })}
        {/* Les rendez-vous poses ne sont plus ici : on dit ou ils sont. */}
        {(c?.booked ?? 0) > 0 && (
          <Link
            href="/sales/rendez-vous"
            className="flex items-center gap-1.5 h-[30px] px-3 rounded-full text-[12.5px] font-medium ml-auto"
            style={{ border: `1px solid ${COLOR.green}`, color: COLOR.green }}
            title="Les leads qui ont pris rendez-vous sont dans Rendez-vous et l'Agenda"
          >
            <Dot color={COLOR.green} />
            {c!.booked} rendez-vous posé{c!.booked > 1 ? "s" : ""} → Rendez-vous
          </Link>
        )}
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
        <Card padded={false}>
          <div className="scroll-x">
            <table className="table">
              <thead>
                <tr>
                  <th>Contact</th>
                  <th style={{ width: 230 }}>Statut</th>
                  <th>Détail</th>
                  <th>Inscrit</th>
                  <th>Téléphone</th>
                  {session.isAdmin && <th>Setter</th>}
                  <th className="text-right" style={{ width: 120 }} />
                </tr>
              </thead>
              <tbody>
                {rows
                  .filter((r) => FILTERS.find((f) => f.key === filter)?.buckets.includes(r.bucket))
                  .map((l) => {
                    const tone = TONE[l.bucket];
                    const hint = localHint(l.country);
                    const booked = l.bucket === "booked";
                    const lost = l.bucket === "lost";
                    // Toute la ligne prend la couleur de l'etat, comme une ligne surlignee dans un tableur.
                    const rowStyle: CSSProperties = { background: `color-mix(in srgb, ${tone} ${lost ? 14 : 20}%, var(--surface))` };
                    const selectValue = booked ? "booked" : (l.callStatus ?? "");
                    const onPick = (v: string) => {
                      if (v === "booked") return setBooking(l);
                      /*
                       * Rendez-vous pris puis annule : changer le statut annule
                       * le rendez-vous a venir (le closer ne le voit plus) et
                       * le lead reprend sa place dans la liste.
                       */
                      let cancel = false;
                      if (booked) {
                        if (v === "") return;
                        const when = l.appointmentAt ? ` du ${fmtDateTime(l.appointmentAt)}` : "";
                        if (!window.confirm(`${l.name} a un rendez-vous${when}. Changer son statut annule ce rendez-vous. Continuer ?`)) return;
                        cancel = true;
                      }
                      if (v === "callback") {
                        setCancelPending(cancel);
                        return setCallbackFor(l);
                      }
                      if (v === "not-interested") {
                        const reason = window.prompt("Pas intéressé : pourquoi ? (optionnel)") ?? null;
                        if (reason === null) return;
                        return void setStatus(l, "not-interested", undefined, reason, cancel);
                      }
                      if (v === "") return void reopen(l);
                      void setStatus(l, v as LeadCallStatus, undefined, undefined, cancel);
                    };
                    return (
                      <tr key={l.id} style={rowStyle}>
                        <td style={{ borderLeft: `4px solid ${tone}` }}>
                          <button
                            type="button"
                            onClick={() => setSheetId(l.id)}
                            className="flex items-center gap-2 text-[13px] font-medium text-left hover:underline"
                            title="Ouvrir la fiche : notes, historique, rendez-vous"
                          >
                            <Dot color={tone} />
                            <span className="truncate max-w-[220px]">{l.name}</span>
                          </button>
                          {(l.country || !l.setterId) && (
                            <div className="dim text-[11px] mt-0.5">
                              {l.country ? `${COUNTRY[l.country] ?? l.country}${hint ? ` · il est ${hint} chez lui` : ""}` : ""}
                              {!l.setterId && <span style={{ color: "var(--warning)" }}>{l.country ? " · " : ""}sans setter</span>}
                            </div>
                          )}
                          {/* Note libre : « RDV en physique le 15 octobre », un prenom, une objection… */}
                          <button
                            type="button"
                            onClick={() => setSheetId(l.id)}
                            className="text-[11px] mt-0.5 text-left max-w-[260px] truncate block"
                            style={{ color: l.notes ? "var(--text)" : "var(--text-3)" }}
                            title={l.notes || "Ajouter une note"}
                          >
                            ✎ {l.notes ? l.notes.split("\n").join(" · ") : "note"}
                          </button>
                        </td>
                        <td>
                          <select
                            className="select select-sm !text-[12px]"
                            value={selectValue}
                            disabled={busy === l.id}
                            onChange={(e) => onPick(e.target.value)}
                            style={{ backgroundColor: `color-mix(in srgb, ${tone} 30%, var(--surface))`, borderColor: tone, fontWeight: 600 }}
                            title={booked ? "Rendez-vous posé. Choisir un autre statut annule le rendez-vous." : "Changer le statut"}
                          >
                            {booked ? <option value="booked">Rendez-vous posé</option> : <option value="">Non statué</option>}
                            <option value="no-answer">Ne répond pas</option>
                            <option value="message-sent">Message envoyé</option>
                            <option value="callback">À rappeler plus tard…</option>
                            <option value="reached">Joint, RDV à fixer</option>
                            {!booked && <option value="booked">Rendez-vous posé…</option>}
                            <option value="not-interested">Pas intéressé</option>
                          </select>
                        </td>
                        <td className="text-[12px]">
                          {booked && l.appointmentAt ? (
                            <span style={{ color: COLOR.green, fontWeight: 600 }}>
                              Call le {fmtDateTime(l.appointmentAt)}{l.closerName ? ` avec ${l.closerName}` : ", closer à attribuer"}
                            </span>
                          ) : l.callStatus === "callback" && l.callbackAt ? (
                            <span style={{ color: COLOR.blue, fontWeight: 600 }}>
                              {l.bucket === "due" ? "Rappel dû depuis le " : "Rappeler le "}{fmtDateTime(l.callbackAt)}
                            </span>
                          ) : l.callStatus ? (
                            <span className="dim">
                              {STATUS_LABEL[l.callStatus]}
                              {l.callStatus === "no-answer" && (l.callAttempts ?? 0) > 1 ? ` (${l.callAttempts} essais)` : ""}
                              {l.lastCallAt ? `, ${relative(l.lastCallAt)}` : ""}
                            </span>
                          ) : (
                            <span className="dim">Jamais appelé</span>
                          )}
                        </td>
                        <td className="num text-[12px]" title={l.optInAt || l.createdAt}>{relative(l.optInAt || l.createdAt)}</td>
                        <td>
                          <div className="flex items-center gap-1.5 flex-wrap">
                            {l.phone ? (
                              <a className="btn btn-sm btn-primary !h-[26px]" href={`tel:${l.phone}`} title="Appeler">
                                ☏ {l.phone}
                              </a>
                            ) : (
                              <span className="badge badge-warn !text-[10.5px]">Pas de numéro</span>
                            )}
                            {l.email && (
                              <a className="btn btn-sm btn-ghost !h-[26px] !text-[11.5px]" href={`mailto:${l.email}`} title={l.email}>
                                ✉
                              </a>
                            )}
                          </div>
                        </td>
                        {session.isAdmin && (
                          <td>
                            <select
                              className="select select-xs !text-[11.5px] !w-auto"
                              value={l.setterId ?? ""}
                              title="Setter chargé de ce lead"
                              onChange={(e) => void assign(l, e.target.value)}
                            >
                              <option value="">Setter…</option>
                              {setters.map((m) => (
                                <option key={m.id} value={m.id}>{m.name}</option>
                              ))}
                            </select>
                          </td>
                        )}
                        <td className="text-right">
                          {!booked && !lost && (
                            <button className="btn btn-sm !h-[26px]" onClick={() => setBooking(l)} disabled={busy === l.id} title="Le prospect a accepté un rendez-vous">
                              ✓ RDV
                            </button>
                          )}
                          {lost && (
                            <button className="btn btn-sm !h-[26px]" onClick={() => void reopen(l)} disabled={busy === l.id} title="Il revient : le remettre dans la liste">
                              ↺ Remettre
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <LeadSheet
        id={sheetId}
        onClose={() => setSheetId(null)}
        onChanged={() => {
          void reload();
        }}
      />

      {callbackFor && (
        <CallbackModal
          lead={callbackFor}
          onClose={() => {
            setCallbackFor(null);
            setCancelPending(false);
          }}
          onPick={async (at, note) => {
            const l = callbackFor;
            const cancel = cancelPending;
            setCallbackFor(null);
            setCancelPending(false);
            await setStatus(l, "callback", at, note, cancel);
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
          defaultCloserId={
            hasRole(session, "closer") && session.memberId
              ? session.memberId
              : session.isAdmin && data?.ownerMemberId
                ? data.ownerMemberId
                : (data?.defaultCloserId ?? "")
          }
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
