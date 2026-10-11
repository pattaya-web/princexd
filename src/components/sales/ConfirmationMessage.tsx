"use client";

import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/client";
import { renderTemplate, sortedTemplates, waLink } from "@/lib/sales/templates";
import { useToast } from "@/components/ui";
import type { Appointment, Lead, MessageTemplate } from "@/lib/types";

const WA = "#25d366";

/**
 * Message de confirmation d'un call, a copier-coller (ou a ouvrir dans
 * WhatsApp) depuis la fiche du rendez-vous. Le template « CONFIRMATION »
 * recoit la date, l'heure (dans le fuseau du prospect) et le lien du call.
 * Le lien se copie a part et se corrige ici. « Envoye » passe la
 * confirmation en « en attente de reponse ». Rien n'est envoye par l'outil.
 */
export function ConfirmationMessage({ appt, lead, onChanged }: { appt: Appointment; lead: Lead | null; onChanged: () => void }) {
  const toast = useToast();
  const [templates, setTemplates] = useState<MessageTemplate[]>([]);
  const [selId, setSelId] = useState("");
  const [text, setText] = useState("");
  const [copied, setCopied] = useState<"" | "text" | "link">("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<{ rows: MessageTemplate[] }>("/api/sales/templates")
      .then((r) => setTemplates(r.rows))
      .catch(() => undefined);
  }, []);

  const tz = appt.timezone || "Europe/Paris";
  const ctx = useMemo(() => {
    const d = new Date(appt.scheduledAt);
    const safe = (opts: Intl.DateTimeFormatOptions) => {
      try {
        return new Intl.DateTimeFormat("fr-FR", { ...opts, timeZone: tz }).format(d);
      } catch {
        return new Intl.DateTimeFormat("fr-FR", { ...opts, timeZone: "Europe/Paris" }).format(d);
      }
    };
    return { date: safe({ weekday: "long", day: "numeric", month: "long" }), heure: safe({ hour: "2-digit", minute: "2-digit" }), lien: appt.iclosedUrl };
  }, [appt.scheduledAt, appt.iclosedUrl, tz]);

  const candidates = useMemo(() => {
    const active = sortedTemplates(templates).filter((t) => t.isActive);
    const conf = active.filter((t) => t.category.toUpperCase() === "CONFIRMATION");
    return conf.length ? conf : active;
  }, [templates]);

  // Call dans moins de 36 h : c'est le rappel de confirmation ; sinon le message « call réservé ».
  const soon = new Date(appt.scheduledAt).getTime() - Date.now() < 36 * 3600_000;
  useEffect(() => {
    if (selId || !candidates.length) return;
    const isRappel = (t: MessageTemplate) => /rappel|veille|confirm/i.test(t.name) && !/réservé|reserve/i.test(t.name);
    const first = (soon ? candidates.find(isRappel) : candidates.find((t) => !isRappel(t))) ?? candidates[0];
    setSelId(first.id);
    setText(renderTemplate(first.content, { name: lead?.name }, ctx));
  }, [candidates, selId, lead?.name, ctx, soon]);

  const pick = (id: string) => {
    const t = candidates.find((x) => x.id === id);
    if (!t) return;
    setSelId(id);
    setText(renderTemplate(t.content, { name: lead?.name }, ctx));
  };

  const copy = async (what: "text" | "link", value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(what);
      setTimeout(() => setCopied(""), 1500);
    } catch {
      toast("Copie impossible ici : sélectionne le texte et copie-le à la main.", "err");
    }
  };

  const editLink = async () => {
    const typed = window.prompt("Lien du call (visio Google Meet, iClosed, Zoom…) :", appt.iclosedUrl || "");
    if (typed === null) return;
    try {
      await api(`/api/sales/appointments/${appt.id}`, { method: "PATCH", body: JSON.stringify({ iclosedUrl: typed.trim() }) });
      toast(typed.trim() ? "Lien du call enregistré." : "Lien effacé.");
      onChanged();
    } catch (e) {
      toast((e as Error).message, "err");
    }
  };

  const sent = async () => {
    setBusy(true);
    try {
      await api(`/api/sales/appointments/${appt.id}`, { method: "PATCH", body: JSON.stringify({ confirmation: "awaiting" }) });
      toast("Message envoyé : en attente de sa réponse.");
      onChanged();
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setBusy(false);
    }
  };

  const shortLink = appt.iclosedUrl.replace(/^https?:\/\//, "");

  return (
    <div className="card-flat px-3.5 py-3">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="label-xs">Message de confirmation</span>
        {candidates.length > 1 && (
          <select className="select select-xs !w-auto" value={selId} onChange={(e) => pick(e.target.value)}>
            {candidates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        )}
        <span className="ml-auto flex items-center gap-1.5 text-[12px] min-w-0">
          {appt.iclosedUrl ? (
            <>
              <a href={appt.iclosedUrl} target="_blank" rel="noreferrer" className="link truncate max-w-[220px]" title={appt.iclosedUrl}>
                {shortLink}
              </a>
              <button type="button" className="btn btn-sm !h-[26px] !text-[11px]" onClick={() => void copy("link", appt.iclosedUrl)} title="Copier le lien du call">
                {copied === "link" ? "Copié ✓" : "Copier le lien"}
              </button>
            </>
          ) : (
            <span className="dim">Pas de lien de call</span>
          )}
          <button type="button" className="btn btn-ghost btn-sm !h-[26px] !text-[11px]" onClick={() => void editLink()} title="Saisir ou corriger le lien du call">
            ✎ lien
          </button>
        </span>
      </div>
      <textarea className="textarea w-full !text-[13px] leading-relaxed mt-2" rows={6} value={text} onChange={(e) => setText(e.target.value)} placeholder="Aucun template actif : écris le message ici." />
      <div className="flex items-center gap-1.5 flex-wrap mt-2">
        <button type="button" className="btn btn-sm btn-primary" onClick={() => void copy("text", text)} disabled={!text.trim()}>
          {copied === "text" ? "Copié ✓" : "Copier le message"}
        </button>
        {lead?.phone && (
          <a className="btn btn-sm font-semibold" style={{ background: WA, borderColor: WA, color: "#fff" }} href={waLink(lead.phone, text)} target="_blank" rel="noopener noreferrer" title="Ouvre WhatsApp avec le message prérempli. Rien n'est envoyé.">
            WhatsApp ↗
          </a>
        )}
        <button type="button" className="btn btn-sm" disabled={busy} onClick={() => void sent()} title="Note le message comme envoyé : confirmation « en attente de réponse »">
          ✓ Envoyé → en attente de réponse
        </button>
        <span className="dim text-[11px] ml-auto">{"{{date}}, {{heure}}, {{lien}}, {{prenom}} sont remplacés automatiquement"}</span>
      </div>
    </div>
  );
}
