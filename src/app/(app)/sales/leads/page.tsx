"use client";

import { useMemo, useState } from "react";
import { api } from "@/lib/client";
import { relative } from "@/lib/format";
import { useSalesData } from "@/lib/sales/client";
import { hasRole } from "@/lib/sales/roles";
import { Card, Empty, ErrorNote, Field, Modal, PageHeader, Spinner, StatTile, useToast } from "@/components/ui";
import { useSales } from "@/components/sales/context";
import type { CallLeadRow } from "@/app/api/sales/leads/route";
import type { PublicMember } from "@/lib/sales/repo";

const BUCKETS = [
  { key: "new", title: "Nouveaux, à appeler maintenant", tone: "var(--accent)" },
  { key: "retry", title: "À rappeler", tone: "var(--warning)" },
  { key: "talking", title: "Joints, rendez-vous à fixer", tone: "var(--good)" },
] as const;

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

/**
 * Les prospects de la landing page, a appeler dans l'ordre d'arrivee.
 *
 * Un lead vient de laisser son numero : il est chaud maintenant, pas demain.
 * La page ne montre que ce qui reste a faire, avec le numero cliquable et
 * trois boutons, pour que le setter enchaine les appels sans naviguer.
 */
export default function CallLeadsPage() {
  const { session, members, version, bump } = useSales();
  const toast = useToast();
  const [booking, setBooking] = useState<CallLeadRow | null>(null);
  const [syncing, setSyncing] = useState(false);

  const { data, loading, error, reload } = useSalesData<{
    rows: CallLeadRow[];
    counts: { new: number; retry: number; talking: number };
    lastSyncAt: string;
    syncError: string;
  }>(`/api/sales/leads?v=${version}`);

  const act = async (lead: CallLeadRow, action: "attempt" | "reached" | "lost", reason?: string) => {
    try {
      await api(`/api/sales/leads/${lead.id}`, { method: "PATCH", body: JSON.stringify({ action, reason }) });
      toast(action === "attempt" ? "Noté : pas de réponse, à rappeler demain." : action === "reached" ? "Noté : prospect joint." : "Lead classé perdu.");
      void reload();
      bump();
    } catch (e) {
      toast((e as Error).message, "err");
    }
  };

  const sync = async () => {
    setSyncing(true);
    try {
      const r = await api<{ created: number; updated: number }>("/api/sales/systemeio", { method: "POST" });
      toast(r.created ? `${r.created} nouveau${r.created > 1 ? "x" : ""} lead${r.created > 1 ? "s" : ""} récupéré${r.created > 1 ? "s" : ""}.` : "Rien de nouveau côté Systeme.io.");
      void reload();
      bump();
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setSyncing(false);
    }
  };

  const rows = data?.rows ?? [];

  return (
    <>
      <PageHeader
        title="À appeler"
        subtitle="Les prospects qui viennent de laisser leurs coordonnées sur la landing page. Appelle dans les cinq minutes : c'est là que ça décroche."
        actions={
          <button className="btn" onClick={() => void sync()} disabled={syncing} title={data?.lastSyncAt ? `Dernière synchro ${relative(data.lastSyncAt)}` : "Jamais synchronisé"}>
            {syncing ? <span className="spinner" /> : "↻ Vérifier les nouveaux"}
          </button>
        }
      />

      {(error || data?.syncError) && (
        <div className="mb-4">
          <ErrorNote>{error || `Synchro Systeme.io : ${data?.syncError}`}</ErrorNote>
        </div>
      )}

      <div className="grid grid-cols-3 gap-3 mb-4">
        <StatTile label="Nouveaux" value={data?.counts.new ?? 0} accent={data?.counts.new ? "var(--accent)" : undefined} />
        <StatTile label="À rappeler" value={data?.counts.retry ?? 0} accent={data?.counts.retry ? "var(--warning)" : undefined} />
        <StatTile label="Joints" value={data?.counts.talking ?? 0} />
      </div>

      {loading && !data ? (
        <Card>
          <Spinner label="Chargement…" />
        </Card>
      ) : !rows.length ? (
        <Card>
          <Empty>Personne à appeler pour l&apos;instant. Les nouveaux inscrits de la landing page apparaîtront ici tout seuls.</Empty>
        </Card>
      ) : (
        <div className="flex flex-col gap-4">
          {BUCKETS.map((bucket) => {
            const items = rows.filter((r) => r.bucket === bucket.key);
            if (!items.length) return null;
            return (
              <Card key={bucket.key} title={bucket.title} padded={false}>
                <ul>
                  {items.map((l, i) => {
                    const hint = localHint(l.country);
                    return (
                      <li
                        key={l.id}
                        className="px-3.5 py-3 flex items-center gap-3 flex-wrap"
                        style={{ borderBottom: i < items.length - 1 ? "1px solid var(--border)" : "none" }}
                      >
                        <span className="min-w-0 flex-1 basis-[220px]">
                          <span className="block text-[13.5px] font-medium truncate">{l.name}</span>
                          <span className="dim text-[11.5px] flex flex-wrap gap-x-2">
                            <span title={l.optInAt || l.createdAt}>inscrit {relative(l.optInAt || l.createdAt)}</span>
                            {l.country && <span>· {COUNTRY[l.country] ?? l.country}{hint ? ` (il est ${hint} chez lui)` : ""}</span>}
                            {(l.callAttempts ?? 0) > 0 && <span>· {l.callAttempts} appel{l.callAttempts! > 1 ? "s" : ""} sans réponse</span>}
                            {session.isAdmin && l.setterName && <span>· {l.setterName}</span>}
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
                        </span>
                        <span className="flex gap-1.5 shrink-0 ml-auto">
                          <button className="btn btn-sm" onClick={() => setBooking(l)} title="Le prospect a accepté un rendez-vous">
                            ✓ RDV pris
                          </button>
                          {l.bucket !== "talking" && (
                            <button className="btn btn-sm" onClick={() => void act(l, "reached")} title="Joint, mais pas encore de rendez-vous">
                              Joint
                            </button>
                          )}
                          <button className="btn btn-sm btn-ghost" onClick={() => void act(l, "attempt")} title="Pas de réponse : rappel demain">
                            Pas de réponse
                          </button>
                          <button
                            className="btn btn-sm btn-ghost"
                            onClick={() => {
                              const reason = window.prompt("Pourquoi ? (pas intéressé, faux numéro…)") ?? "";
                              void act(l, "lost", reason);
                            }}
                            title="Pas intéressé ou injoignable définitivement"
                          >
                            ✕
                          </button>
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </Card>
            );
          })}
        </div>
      )}

      {booking && (
        <BookModal
          lead={booking}
          isAdmin={session.isAdmin}
          memberId={session.memberId}
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

/* ------------------------------ RDV pris ------------------------------- */

function BookModal({
  lead,
  isAdmin,
  memberId,
  members,
  onClose,
  onDone,
}: {
  lead: CallLeadRow;
  isAdmin: boolean;
  memberId: string;
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
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }, []);
  const [at, setAt] = useState(defaultAt);
  const [closerId, setCloserId] = useState("");
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
          scheduledAt: new Date(at).toISOString(),
          setterId,
          closerId,
          source: "inbound",
          setterNotes: notes,
        }),
      });
      toast("Rendez-vous enregistré.");
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
      title={`Rendez-vous avec ${lead.name}`}
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={busy}>Annuler</button>
          <button className="btn btn-primary" onClick={() => void submit()} disabled={busy || !at}>
            {busy ? <span className="spinner" /> : "Enregistrer le rendez-vous"}
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-3.5">
        <Field label="Date et heure (heure de Paris)">
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
