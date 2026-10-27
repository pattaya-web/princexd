"use client";

import { useState } from "react";
import { api } from "@/lib/client";
import { fmtDateTime, relative } from "@/lib/format";
import { Empty, useToast } from "@/components/ui";
import type { IclosedContactRow } from "@/app/api/sales/iclosed/contacts/route";

/**
 * Leads iClosed « opt-in sans rendez-vous », ranges comme dans iClosed :
 * qualifies (ont repondu aux criteres du questionnaire, dont le budget),
 * formulaire commence (nom / telephone laisses, questionnaire pas fini),
 * disqualifies (criteres non remplis). Chaque ligne est une fiche du CRM :
 * on voit qui l'a appelee et ce qu'elle a repondu, on statue en un clic.
 */
export const OPTIN_GROUPS: { status: string; title: string; hint: string; tone: string }[] = [
  { status: "QUALIFIED", title: "Qualifiés · pas de rendez-vous", hint: "Ont rempli le questionnaire avec les bons critères (budget à investir), puis n'ont pas pris le call. Les plus chauds.", tone: "var(--good)" },
  { status: "POTENTIAL", title: "Formulaire commencé", hint: "Ont laissé nom / téléphone / email sur le calendrier sans finir le questionnaire.", tone: "#f97316" },
  { status: "DISQUALIFIED", title: "Disqualifiés · pas de rendez-vous", hint: "Ont répondu au questionnaire sans remplir les critères.", tone: "var(--text-3)" },
];

const CALL_STATUS: Record<string, string> = {
  "no-answer": "Pas de réponse",
  "message-sent": "Message envoyé",
  callback: "À rappeler",
  reached: "Joint",
  "not-interested": "Pas intéressé",
  "wrong-number": "Faux numéro",
  "no-whatsapp": "Pas de WhatsApp",
  cold: "Lead froid",
};

const ACTIONS: { status: string; label: string; title: string }[] = [
  { status: "no-answer", label: "Pas de réponse", title: "Appelé ou écrit, pas de réponse" },
  { status: "message-sent", label: "Message envoyé", title: "Message WhatsApp / Instagram envoyé" },
  { status: "reached", label: "Joint", title: "Joint, en discussion" },
  { status: "not-interested", label: "Pas intéressé", title: "Sort de la liste" },
];

export function IclosedOptInsList({ rows, limit, onChanged, onOpen }: { rows: IclosedContactRow[]; /** Lignes par groupe (accueil) ; tout si absent. */ limit?: number; onChanged: () => void; onOpen: (leadId: string) => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState("");
  const copy = async (v: string) => {
    try {
      await navigator.clipboard.writeText(v);
      toast("Copié.");
    } catch {
      toast("Copie impossible ici.", "err");
    }
  };
  const setStatus = async (r: IclosedContactRow, status: string) => {
    if (!r.leadId) return;
    setBusy(r.leadId);
    try {
      await api(`/api/sales/leads/${r.leadId}`, { method: "PATCH", body: JSON.stringify({ action: "status", status }) });
      toast(`${r.name} : ${CALL_STATUS[status]?.toLowerCase() ?? status}.`);
      onChanged();
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setBusy("");
    }
  };

  if (!rows.length) return <Empty>Personne pour l&apos;instant.</Empty>;
  return (
    <div className="flex flex-col">
      {OPTIN_GROUPS.map((g) => {
        const list = rows.filter((r) => r.status === g.status);
        if (!list.length) return null;
        const shown = limit ? list.slice(0, limit) : list;
        return (
          <section key={g.status}>
            <div className="px-3.5 py-2 flex items-baseline gap-2 flex-wrap" style={{ background: "var(--surface-2)", borderBottom: "1px solid var(--border)", borderTop: "1px solid var(--border)" }}>
              <span className="text-[12.5px] font-semibold" style={{ color: g.tone }}>
                {g.title}
              </span>
              <span className="badge !text-[10.5px] !py-0 num">{list.length}</span>
              <span className="dim text-[11px]">{g.hint}</span>
            </div>
            <ul>
              {shown.map((r, i) => {
                const booked = Boolean(r.appointmentAt);
                return (
                  <li key={r.id} className="px-3.5 py-2.5 flex items-start gap-3 flex-wrap" style={{ borderBottom: i < shown.length - 1 ? "1px solid var(--border)" : "none", opacity: r.callStatus === "not-interested" || r.callStatus === "cold" ? 0.55 : 1 }}>
                    <span className="min-w-0 flex-1 basis-[240px]">
                      <span className="flex items-center gap-2 flex-wrap">
                        <button type="button" className="text-[13px] font-semibold hover:underline text-left" onClick={() => r.leadId && onOpen(r.leadId)} title="Ouvrir la fiche (notes, historique, statut)">
                          {r.name}
                        </button>
                        {r.phone ? (
                          <button type="button" className="link num text-[12.5px]" onClick={() => void copy(r.phone)} title="Copier le numéro">
                            {r.phone}
                          </button>
                        ) : (
                          <span className="dim text-[11.5px]">sans numéro</span>
                        )}
                        {r.country && <span className="dim text-[11px]">{r.country}</span>}
                      </span>
                      <span className="dim text-[11.5px] block">
                        Formulaire {relative(r.createdAt)} · {fmtDateTime(r.createdAt)}
                        {r.email ? ` · ${r.email}` : ""}
                      </span>
                      {/* Qui l'a appele, ce qu'il a repondu. */}
                      {(r.callStatus || r.setterName) && (
                        <span className="text-[12px] block mt-0.5">
                          {r.callStatus ? <span className="font-medium">{CALL_STATUS[r.callStatus] ?? r.callStatus}</span> : <span className="dim">pas encore contacté</span>}
                          {r.lastCallAt ? <span className="dim"> · {relative(r.lastCallAt)}</span> : null}
                          {r.callAttempts > 1 ? <span className="dim"> · {r.callAttempts} essais</span> : null}
                          {r.setterName ? <span className="dim"> · par {r.setterName}</span> : null}
                        </span>
                      )}
                      {r.notes && (
                        <span className="dim text-[11.5px] block truncate max-w-[480px]" title={r.notes}>
                          {r.notes}
                        </span>
                      )}
                    </span>
                    <span className="flex items-center gap-1 flex-wrap shrink-0">
                      {booked ? (
                        <span className="badge badge-good !text-[10.5px] !py-0">RDV pris · {fmtDateTime(r.appointmentAt)}</span>
                      ) : (
                        ACTIONS.map((a) => (
                          <button
                            key={a.status}
                            type="button"
                            className={`btn btn-sm !h-[26px] !text-[11px] ${r.callStatus === a.status ? "btn-primary" : ""}`}
                            disabled={busy === r.leadId || !r.leadId}
                            title={a.title}
                            onClick={() => void setStatus(r, a.status)}
                          >
                            {a.label}
                          </button>
                        ))
                      )}
                      <button type="button" className="btn btn-ghost btn-sm !h-[26px] !text-[11px]" disabled={!r.leadId} onClick={() => r.leadId && onOpen(r.leadId)}>
                        Fiche
                      </button>
                    </span>
                  </li>
                );
              })}
            </ul>
            {limit && list.length > limit && (
              <div className="dim text-[11.5px] px-3.5 py-1.5">… et {list.length - limit} de plus dans Leads → iClosed sans RDV.</div>
            )}
          </section>
        );
      })}
    </div>
  );
}
