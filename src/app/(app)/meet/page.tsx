"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/client";
import { fmtDate, fmtTime, parisToIso } from "@/lib/format";
import { Card, Empty, ErrorNote, Field, PageHeader, Spinner, useToast } from "@/components/ui";
import type { MeetLink } from "@/lib/types";

const DXB = "Asia/Dubai";
const FR = "Europe/Paris";
const KINDS: { key: MeetLink["kind"]; label: string }[] = [
  { key: "sale", label: "Call de vente" },
  { key: "student", label: "Call élève" },
  { key: "other", label: "Autre" },
];

interface Payload {
  clientSet: boolean;
  connected: boolean;
  email: string;
  rows: MeetLink[];
}

/** L'heure locale « YYYY-MM-DDTHH:mm » d'un instant dans un fuseau, pour un <input type="datetime-local">. */
function localInput(iso: string, tz: string): string {
  const d = new Date(iso);
  const p = new Intl.DateTimeFormat("fr-FR", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(d);
  const g = (t: string) => p.find((x) => x.type === t)?.value ?? "00";
  return `${g("year")}-${g("month")}-${g("day")}T${g("hour")}:${g("minute")}`;
}

/** Le message prêt à envoyer au prospect, dans son fuseau. */
function invitation(l: Pick<MeetLink, "guestName" | "startAt" | "timeZone" | "meetUrl" | "kind" | "instant">): string {
  const hello = l.guestName ? `Salut ${l.guestName.split(" ")[0]}, ` : "Salut, ";
  if (l.instant) return `${hello}voici le lien pour notre ${l.kind === "student" ? "call" : "appel"}, je t'attends dedans :\n${l.meetUrl}`;
  const tz = l.timeZone;
  const tzLabel = tz === FR ? "heure de Paris" : "heure de Dubaï";
  const day = new Intl.DateTimeFormat("fr-FR", { timeZone: tz, weekday: "long", day: "numeric", month: "long" }).format(new Date(l.startAt));
  const hour = new Intl.DateTimeFormat("fr-FR", { timeZone: tz, hour: "2-digit", minute: "2-digit" }).format(new Date(l.startAt));
  return `${hello}voici le lien pour notre ${l.kind === "student" ? "call" : "appel"} ${day} à ${hour} (${tzLabel}) :\n${l.meetUrl}\nÀ tout à l'heure !`;
}

/**
 * Générateur de liens Google Meet : un call de vente ou un call élève, à
 * l'heure de Dubaï (par défaut) ou de France, posé dans l'agenda Google de
 * Mady avec sa visio Meet. L'invité reçoit l'invitation s'il a un email ;
 * sinon on copie le message et le lien.
 */
export default function MeetPage() {
  const toast = useToast();
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState("");
  const load = () =>
    api<Payload>("/api/google/meet")
      .then((d) => {
        setData(d);
        setError("");
      })
      .catch((e: Error) => setError(e.message));
  useEffect(() => {
    void load();
    // Retour du consentement Google (/api/google/callback) : ?connected=… ou ?error=…
    const params = new URLSearchParams(window.location.search);
    const err = params.get("error");
    const ok = params.get("connected");
    if (err) toast(err, "err");
    if (ok) toast(`Google Agenda connecté${ok !== "1" ? ` : ${ok}` : ""}.`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [kind, setKind] = useState<MeetLink["kind"]>("sale");
  const [tz, setTz] = useState(DXB);
  const [guestName, setGuestName] = useState("");
  const [guestEmail, setGuestEmail] = useState("");
  const [when, setWhen] = useState(() => {
    const d = new Date(Date.now() + 3600_000);
    d.setMinutes(0, 0, 0);
    return localInput(d.toISOString(), DXB);
  });
  const [duration, setDuration] = useState(30);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [last, setLast] = useState<MeetLink | null>(null);

  // Changer de fuseau garde la meme heure affichee (c'est l'heure du client qui compte).
  const startIso = useMemo(() => (when ? parisToIso(when, tz) : ""), [when, tz]);
  const otherTz = tz === DXB ? FR : DXB;

  const copy = async (v: string, msg = "Copié.") => {
    try {
      await navigator.clipboard.writeText(v);
      toast(msg);
    } catch {
      toast("Copie impossible ici : sélectionne le texte et copie-le à la main.", "err");
    }
  };

  const [instantBusy, setInstantBusy] = useState(false);

  const create = async (instant = false) => {
    if (!instant && !startIso) return toast("Choisis la date et l'heure.", "err");
    /*
     * Reunion instantanee : l'onglet Meet est ouvert tout de suite (dans le
     * clic, sinon le navigateur bloque la fenetre) puis pointe sur le lien
     * des qu'il existe ; le lien est aussi copie pour l'envoyer au prospect.
     */
    const tab = instant ? window.open("", "_blank") : null;
    if (instant) setInstantBusy(true);
    else setBusy(true);
    try {
      const body = instant
        ? { kind, guestName, guestEmail, instant: true, timeZone: tz, durationMin: duration, note }
        : { kind, guestName, guestEmail, startAt: startIso, timeZone: tz, durationMin: duration, note };
      const r = await api<{ link: MeetLink }>("/api/google/meet", { method: "POST", body: JSON.stringify(body), timeoutMs: 60_000 });
      setLast(r.link);
      if (tab) {
        tab.location.href = r.link.meetUrl;
        try {
          await navigator.clipboard.writeText(r.link.meetUrl);
          toast("Réunion lancée, lien copié : envoie-le au prospect.");
        } catch {
          toast("Réunion lancée. Copie le lien ci-contre pour le prospect.");
        }
      } else {
        toast(guestEmail ? "Lien Meet créé, invitation envoyée." : "Lien Meet créé.");
      }
      setGuestName("");
      setGuestEmail("");
      setNote("");
      void load();
    } catch (e) {
      tab?.close();
      toast((e as Error).message, "err");
    } finally {
      setBusy(false);
      setInstantBusy(false);
    }
  };

  const remove = async (l: MeetLink) => {
    if (!window.confirm(`Annuler le call « ${l.title} » ? L'événement est supprimé de ton agenda et l'invité prévenu.`)) return;
    try {
      await api("/api/google/meet", { method: "DELETE", body: JSON.stringify({ id: l.id }) });
      toast("Call annulé.");
      if (last?.id === l.id) setLast(null);
      void load();
    } catch (e) {
      toast((e as Error).message, "err");
    }
  };

  const Chip = ({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) => (
    <button type="button" className={`btn btn-sm ${active ? "btn-primary" : ""}`} onClick={onClick}>
      {children}
    </button>
  );

  return (
    <div>
      <PageHeader
        title="Lien Meet"
        subtitle="Un call de vente ou un call élève à l'heure de Dubaï ou de France : le lien Meet est généré, le rendez-vous est posé dans ton Google Agenda, l'invité reçoit l'invitation. Pour un call tout de suite, « Réunion instantanée »."
        actions={
          <button className="btn btn-primary" onClick={() => void create(true)} disabled={instantBusy || busy || !data?.connected} title="Démarre un Meet maintenant : l'onglet s'ouvre et le lien est copié">
            {instantBusy ? <span className="spinner" /> : "⚡ Réunion instantanée"}
          </button>
        }
      />
      {error && <ErrorNote>{error}</ErrorNote>}

      {data && !data.connected && (
        <Card className="mb-4" title="Connecter mon Google Agenda">
          <div className="flex flex-col gap-3">
            <p className="text-[13.5px] leading-relaxed">
              {data.clientSet ? "Le client OAuth est en place. Connecte ton compte Google pour que les liens Meet se posent dans ton agenda." : "Il manque l'identifiant et le secret client Google."}{" "}
              {!data.clientSet && (
                <Link href="/reglages" className="link">
                  Les coller dans Réglages → Google Agenda.
                </Link>
              )}
            </p>
            {data.clientSet && (
              <a className="btn btn-primary w-fit" href="/api/google/auth">
                Connecter mon Google Agenda
              </a>
            )}
          </div>
        </Card>
      )}

      <div className="grid lg:grid-cols-[1.1fr_1fr] gap-4 items-start">
        <Card title="Nouveau lien Meet" subtitle={data?.email ? `Posé dans l'agenda de ${data.email}` : undefined}>
          <div className="flex flex-col gap-3">
            <Field label="C'est pour">
              <div className="flex flex-wrap gap-1.5">
                {KINDS.map((k) => (
                  <Chip key={k.key} active={kind === k.key} onClick={() => setKind(k.key)}>
                    {k.label}
                  </Chip>
                ))}
              </div>
            </Field>
            <Field label="Fuseau horaire du client" hint="L'heure ci-dessous est dans ce fuseau. L'invitation et l'agenda l'affichent comme ça.">
              <div className="flex flex-wrap gap-1.5">
                <Chip active={tz === DXB} onClick={() => setTz(DXB)}>
                  Dubaï
                </Chip>
                <Chip active={tz === FR} onClick={() => setTz(FR)}>
                  France
                </Chip>
              </div>
            </Field>
            <div className="grid sm:grid-cols-[1fr_140px] gap-3">
              <Field label={`Date et heure (${tz === DXB ? "Dubaï" : "France"})`} hint={startIso ? `= ${fmtDate(startIso, otherTz)} ${fmtTime(startIso, otherTz)} ${otherTz === FR ? "en France" : "à Dubaï"}` : undefined}>
                <input className="input" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
              </Field>
              <Field label="Durée">
                <select className="select" value={duration} onChange={(e) => setDuration(Number(e.target.value))}>
                  {[15, 30, 45, 60, 90].map((m) => (
                    <option key={m} value={m}>
                      {m} min
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <div className="grid sm:grid-cols-2 gap-3">
              <Field label="Prénom / nom de l'invité">
                <input className="input" value={guestName} onChange={(e) => setGuestName(e.target.value)} placeholder="Optionnel" />
              </Field>
              <Field label="Email de l'invité" hint="S'il est renseigné, Google lui envoie l'invitation.">
                <input className="input" type="email" value={guestEmail} onChange={(e) => setGuestEmail(e.target.value)} placeholder="Optionnel" />
              </Field>
            </div>
            <Field label="Note (dans l'événement)">
              <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optionnel" />
            </Field>
            <div className="flex justify-end items-center gap-2 flex-wrap">
              <button className="btn" onClick={() => void create(true)} disabled={instantBusy || busy || !data?.connected} title="Démarre maintenant, avec l'invité et la durée ci-dessus si tu les as remplis">
                {instantBusy ? <span className="spinner" /> : "⚡ Maintenant"}
              </button>
              <button className="btn btn-primary" onClick={() => void create()} disabled={busy || instantBusy || !data?.connected}>
                {busy ? <span className="spinner" /> : "Générer le lien Meet"}
              </button>
            </div>
          </div>
        </Card>

        <div className="flex flex-col gap-4">
          {last && (
            <Card title={last.instant ? "Réunion en cours" : "Lien prêt"} subtitle={last.guestEmail ? `Invitation envoyée à ${last.guestEmail}` : last.instant ? "Le Meet est ouvert dans un autre onglet. Envoie le lien au prospect." : "Copie le message et envoie-le."}>
              <div className="flex flex-col gap-2.5">
                <div className="flex items-center gap-2 flex-wrap">
                  <a href={last.meetUrl} target="_blank" rel="noreferrer" className="link mono text-[13px] break-all">
                    {last.meetUrl}
                  </a>
                  <button className="btn btn-sm btn-primary" onClick={() => void copy(last.meetUrl, "Lien Meet copié.")}>
                    Copier le lien
                  </button>
                  {last.instant && (
                    <a className="btn btn-sm" href={last.meetUrl} target="_blank" rel="noreferrer">
                      Rejoindre ↗
                    </a>
                  )}
                </div>
                <pre className="text-[13px] leading-relaxed whitespace-pre-wrap rounded-[8px] px-3 py-2.5" style={{ fontFamily: "inherit", background: "var(--surface-2)", border: "1px solid var(--border)" }}>
                  {invitation(last)}
                </pre>
                <div className="flex items-center gap-2 flex-wrap">
                  <button className="btn btn-sm" onClick={() => void copy(invitation(last), "Message copié.")}>
                    Copier le message
                  </button>
                  {last.eventUrl && (
                    <a className="btn btn-sm btn-ghost" href={last.eventUrl} target="_blank" rel="noreferrer">
                      Voir dans Google Agenda ↗
                    </a>
                  )}
                </div>
              </div>
            </Card>
          )}

          <Card title="Liens générés" padded={false}>
            {!data ? (
              <div className="p-4">
                <Spinner label="Chargement…" />
              </div>
            ) : data.rows.length === 0 ? (
              <Empty>Aucun lien pour l&apos;instant.</Empty>
            ) : (
              <ul>
                {data.rows.map((l, i) => (
                  <li key={l.id} className="px-3.5 py-2.5 flex items-center gap-3 flex-wrap" style={{ borderBottom: i < data.rows.length - 1 ? "1px solid var(--border)" : "none", opacity: Date.parse(l.startAt) < Date.now() - 3600_000 ? 0.6 : 1 }}>
                    <span className="min-w-0 flex-1 basis-[200px]">
                      <span className="block text-[13px] font-medium truncate">{l.title}</span>
                      <span className="dim text-[11.5px] block">
                        {l.instant ? "⚡ Instantanée · " : ""}
                        {fmtDate(l.startAt, l.timeZone)} {fmtTime(l.startAt, l.timeZone)} ({l.timeZone === FR ? "France" : "Dubaï"}) · {l.durationMin} min
                        {l.guestEmail ? ` · ${l.guestEmail}` : ""}
                      </span>
                    </span>
                    <span className="flex items-center gap-1 shrink-0">
                      <button className="btn btn-sm !h-[26px]" onClick={() => void copy(l.meetUrl, "Lien Meet copié.")}>
                        Lien
                      </button>
                      <button className="btn btn-sm btn-ghost !h-[26px]" onClick={() => void copy(invitation(l), "Message copié.")}>
                        Message
                      </button>
                      <button className="btn btn-sm btn-ghost !h-[26px]" style={{ color: "var(--critical)" }} onClick={() => void remove(l)} title="Annuler le call">
                        ✕
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
