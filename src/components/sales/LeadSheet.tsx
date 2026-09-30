"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/client";
import { fmtDateTime, label, relative } from "@/lib/format";
import { Empty, Field, Modal, Spinner, useToast } from "@/components/ui";
import { StatusBadge } from "./bits";
import type { ActivityLog, Lead } from "@/lib/types";
import type { AppointmentStatus } from "@/lib/types";

interface Payload {
  lead: Lead;
  setterName: string;
  appointments: { id: string; scheduledAt: string; status: AppointmentStatus; closerName: string; iclosedUrl: string }[];
  logs: ActivityLog[];
}

const STATUS: Record<string, string> = {
  "no-answer": "Ne répond pas",
  "message-sent": "Message envoyé",
  callback: "À rappeler",
  reached: "Joint",
  "not-interested": "Pas intéressé",
  "wrong-number": "Faux numéro",
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
              {l.sourceUrl && (
                <>
                  <dt className="dim">Page d&apos;origine</dt>
                  <dd className="truncate" title={l.sourceUrl}>
                    {l.sourceUrl.replace(/^https?:\/\//, "")}
                  </dd>
                </>
              )}
            </dl>

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
