"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { api } from "@/lib/client";
import { parisToIso } from "@/lib/format";
import { SOURCE_CHANNEL_LABEL } from "@/lib/sales/attribution";
import { CHANNEL_LABEL, renderTemplate, sortedTemplates, waLink } from "@/lib/sales/templates";
import { Modal, useToast } from "@/components/ui";
import type { MessageTemplate, SourceChannel } from "@/lib/types";

export interface MessagesLead {
  id: string;
  name: string;
  phone?: string;
  sourceChannel?: SourceChannel;
  funnelLabel?: string;
}

const WA = "#25d366";

/**
 * « Messages » d'un lead : les templates favoris en tete, un clic met le
 * texte dans la zone (modifiable sans toucher au template), puis Copier,
 * Ouvrir WhatsApp, ou Marquer comme envoye — qui seul ecrit dans la timeline
 * et propose la prochaine relance. Rien n'est envoye par l'outil.
 */
export function MessagesModal({
  lead,
  templates,
  initialTemplateId,
  title,
  isAdmin,
  onClose,
  onSent,
  onTemplatesChanged,
}: {
  lead: MessagesLead;
  templates: MessageTemplate[];
  initialTemplateId?: string;
  title?: string;
  isAdmin: boolean;
  onClose: () => void;
  onSent: () => void;
  onTemplatesChanged: () => void;
}) {
  const toast = useToast();
  const list = useMemo(() => sortedTemplates(templates).filter((t) => t.isActive), [templates]);
  // Sans template impose, le premier favori est deja ouvert : un clic de moins.
  const [selectedId, setSelectedId] = useState(() => initialTemplateId ?? (list.find((t) => t.isFavorite) ?? list[0])?.id ?? "");
  const selected = list.find((t) => t.id === selectedId) ?? null;
  const [text, setText] = useState(() => (selected ? renderTemplate(selected.content, lead) : ""));
  const [copied, setCopied] = useState(false);
  const [step, setStep] = useState<"compose" | "next">("compose");
  const [customAt, setCustomAt] = useState("");
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");

  const q = query.trim().toLowerCase();
  const matches = (t: MessageTemplate) => !q || t.name.toLowerCase().includes(q) || t.category.toLowerCase().includes(q) || t.content.toLowerCase().includes(q);
  const favorites = list.filter((t) => t.isFavorite && matches(t));
  const others = list.filter((t) => !t.isFavorite && matches(t));
  const categories = [...new Set(others.map((t) => t.category))];

  const pick = (t: MessageTemplate) => {
    setSelectedId(t.id);
    setText(renderTemplate(t.content, lead));
    setCopied(false);
    setStep("compose");
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast("Copie impossible ici : sélectionne le texte et copie-le à la main.", "err");
    }
  };

  const openWhatsApp = () => {
    if (!lead.phone) {
      toast("Pas de numéro sur ce lead.", "err");
      return;
    }
    window.open(waLink(lead.phone, text), "_blank", "noopener");
  };

  const saveAsNew = async () => {
    const name = window.prompt("Nom du nouveau template :", selected ? `${selected.name} (variante)` : "");
    if (!name?.trim()) return;
    try {
      await api("/api/sales/templates", {
        method: "POST",
        body: JSON.stringify({ name: name.trim(), content: text, category: selected?.category ?? "AUTRE", channel: selected?.channel ?? "whatsapp" }),
      });
      toast("Nouveau template enregistré.");
      onTemplatesChanged();
    } catch (e) {
      toast((e as Error).message, "err");
    }
  };

  const markSent = async (next: string) => {
    setBusy(true);
    try {
      await api(`/api/sales/leads/${lead.id}`, {
        method: "PATCH",
        body: JSON.stringify({ action: "message", templateId: selected?.id, templateName: selected?.name, channel: selected?.channel ?? "whatsapp", next }),
      });
      toast(next === "none" ? `${lead.name} : message noté comme envoyé.` : `${lead.name} : message envoyé, relance programmée.`);
      onSent();
      onClose();
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setBusy(false);
    }
  };

  const TemplateButton = ({ t }: { t: MessageTemplate }) => (
    <button
      type="button"
      onClick={() => pick(t)}
      className="w-full text-left px-2.5 py-1.5 rounded-md text-[12.5px] leading-snug transition-colors"
      style={{ background: t.id === selectedId ? "var(--accent-soft)" : "transparent", color: t.id === selectedId ? "var(--accent)" : "var(--text)", fontWeight: t.id === selectedId ? 600 : 500 }}
      title={t.content.slice(0, 160)}
    >
      {t.isFavorite ? "⭐ " : ""}
      {t.name}
    </button>
  );

  return (
    <Modal
      open
      onClose={onClose}
      title={title ? `${title} · ${lead.name}` : `Messages · ${lead.name}`}
      wide
      footer={
        <>
          <span className="dim text-[11.5px] mr-auto">
            {lead.phone ? <span className="num">{lead.phone}</span> : "Pas de numéro"}
            {lead.sourceChannel ? ` · ${SOURCE_CHANNEL_LABEL[lead.sourceChannel]}` : ""}
            {lead.funnelLabel ? ` · ${lead.funnelLabel}` : ""}
          </span>
          {isAdmin && (
            <Link href="/sales/messages" className="btn btn-ghost btn-sm" onClick={onClose}>
              Gérer les templates
            </Link>
          )}
          <button className="btn" onClick={onClose} disabled={busy}>
            Fermer
          </button>
        </>
      }
    >
      <div className="grid sm:grid-cols-[230px_1fr] gap-4">
        {/* Templates : favoris en tete, puis par categorie. */}
        <div className="flex flex-col gap-2 min-w-0">
          <input className="input !h-[32px] !text-[12.5px]" placeholder="Chercher un template…" value={query} onChange={(e) => setQuery(e.target.value)} />
          {!list.length && <p className="dim text-[12px]">Aucun template actif. {isAdmin ? "Crée-les dans Sales → Messages." : ""}</p>}
          {favorites.length > 0 && (
            <div>
              <div className="label-xs mb-1">Favoris</div>
              <div className="flex flex-col gap-0.5">
                {favorites.map((t) => (
                  <TemplateButton key={t.id} t={t} />
                ))}
              </div>
            </div>
          )}
          {categories.map((c) => (
            <div key={c}>
              <div className="label-xs mb-1">{c}</div>
              <div className="flex flex-col gap-0.5">
                {others
                  .filter((t) => t.category === c)
                  .map((t) => (
                    <TemplateButton key={t.id} t={t} />
                  ))}
              </div>
            </div>
          ))}
        </div>

        {/* Le texte, modifiable sans toucher au template. */}
        <div className="flex flex-col gap-2.5 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[13px] font-semibold">{selected ? selected.name : "Message libre"}</span>
            {selected && <span className="badge !text-[10px] !py-0">{selected.category}</span>}
            {selected && <span className="dim text-[11.5px]">{CHANNEL_LABEL[selected.channel]}</span>}
          </div>
          <textarea
            className="textarea w-full !text-[13.5px] leading-relaxed"
            rows={11}
            value={text}
            placeholder="Choisis un template à gauche, ou écris ton message ici."
            onChange={(e) => {
              setText(e.target.value);
              setCopied(false);
            }}
          />
          <p className="dim text-[11.5px] -mt-1">Modifie le texte ici si besoin : le template original ne change pas.</p>

          {step === "compose" ? (
            <div className="flex items-center gap-1.5 flex-wrap">
              <button className="btn btn-primary" onClick={() => void copy()} disabled={!text.trim()} style={copied ? { background: "var(--good)", borderColor: "var(--good)" } : undefined}>
                {copied ? "Copié ✓" : "Copier"}
              </button>
              <button className="btn font-semibold" style={{ background: WA, borderColor: WA, color: "#fff" }} onClick={openWhatsApp} disabled={!lead.phone} title={lead.phone ? "Ouvre WhatsApp avec le message prérempli, rien n'est envoyé" : "Pas de numéro"}>
                Ouvrir WhatsApp
              </button>
              <button className="btn" onClick={() => setStep("next")} disabled={busy} title="Écrit « message envoyé » dans l'historique du lead">
                ✓ Marquer comme envoyé
              </button>
              <button className="btn btn-ghost btn-sm ml-auto" onClick={() => void saveAsNew()} disabled={!text.trim()} title="Garder cette version comme nouveau template">
                Sauvegarder comme nouveau template
              </button>
            </div>
          ) : (
            <div className="card-flat p-3">
              <div className="text-[12.5px] font-semibold mb-2">Prochaine relance ?</div>
              <div className="flex items-center gap-1.5 flex-wrap">
                <button className="btn btn-sm btn-primary" disabled={busy} onClick={() => void markSent("tomorrow")}>
                  Demain
                </button>
                <button className="btn btn-sm" disabled={busy} onClick={() => void markSent("3d")}>
                  Dans 3 jours
                </button>
                <span className="inline-flex items-center gap-1">
                  <input type="datetime-local" className="input !h-[30px] !text-[12px] !w-auto" value={customAt} onChange={(e) => setCustomAt(e.target.value)} />
                  <button className="btn btn-sm" disabled={busy || !customAt} onClick={() => void markSent(parisToIso(customAt))}>
                    OK
                  </button>
                </span>
                <button className="btn btn-sm btn-ghost" disabled={busy} onClick={() => void markSent("none")}>
                  Aucune
                </button>
                <button className="btn btn-sm btn-ghost ml-auto" disabled={busy} onClick={() => setStep("compose")}>
                  ← Retour
                </button>
              </div>
              <p className="dim text-[11.5px] mt-2">Le lead passe « message envoyé » et revient dans la liste à la date choisie.</p>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}
