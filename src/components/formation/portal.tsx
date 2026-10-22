"use client";

import { Annex } from "@/components/formation/Annex";
import type { StepItem } from "@/lib/formation-steps";

/** Briques partagées des pages Scale X (tableau de bord, étapes, ressources). */

export function SectionLabel({ n, title }: { n: string; title: string }) {
  return (
    <div className="label-xs" style={{ letterSpacing: "0.12em" }}>
      {n} / {title.toUpperCase()}
    </div>
  );
}

export function PortalFooter({ quote, author }: { quote: string; author: string }) {
  return (
    <footer className="mt-6 pt-6 flex flex-col sm:flex-row items-center justify-between gap-3 border-t" style={{ borderColor: "var(--border)" }}>
      <span className="font-semibold text-[15px]" style={{ letterSpacing: "-0.02em" }}>
        Scale X
      </span>
      <div className="text-center">
        <div className="text-[14px] italic" style={{ fontFamily: "Georgia, 'Times New Roman', serif" }}>
          « {quote} »
        </div>
        <div className="dim text-[12px] mt-1">{author}</div>
      </div>
      <span className="dim text-[12px]">Accompagnement e-commerce + IA</span>
    </footer>
  );
}

/** Lien WhatsApp vers le coach, message prérempli. Vide si pas de numéro. */
export function waHelpLink(phone: string, firstName: string): string {
  let d = (phone ?? "").replace(/\D/g, "");
  if (d.startsWith("00")) d = d.slice(2);
  if (d.length === 10 && d.startsWith("0")) d = `33${d.slice(1)}`;
  if (!d) return "";
  return `https://wa.me/${d}?text=${encodeURIComponent(`Salut Mady, c'est ${firstName}. J'ai une question sur mon avancement :`)}`;
}

/** Une étape à cocher. `compact` : sans la consigne détaillée (tableau de bord). */
export function PortalStepRow({ item, busy, onToggle, compact, index }: { item: StepItem; busy?: boolean; onToggle: () => void; compact?: boolean; index?: number }) {
  const external = /^https?:\/\//i.test(item.link);
  return (
    <div className="flex items-start gap-3 py-2.5 border-b last:border-b-0" style={{ borderColor: "var(--border)", opacity: item.done ? 0.62 : 1 }}>
      <button
        type="button"
        onClick={onToggle}
        disabled={busy}
        aria-label={item.done ? "Décocher" : "Marquer comme faite"}
        className="shrink-0 mt-[1px] w-[22px] h-[22px] rounded-full border flex items-center justify-center text-[12px] font-bold transition-colors"
        style={{
          borderColor: item.done ? "var(--good)" : "var(--border-strong)",
          background: item.done ? "var(--good)" : "transparent",
          color: "#fff",
        }}
      >
        {item.done ? "✓" : ""}
      </button>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          {index !== undefined && <span className="label-xs num">{String(index).padStart(2, "0")}</span>}
          <span className="text-[14px] font-medium leading-snug" style={{ textDecoration: item.done ? "line-through" : "none" }}>
            {item.title}
          </span>
          {item.kind === "task" && <span className="badge !text-[10px] !py-0">assignée par Mady</span>}
          {!item.published && <span className="badge badge-warn !text-[10px] !py-0">brouillon</span>}
        </div>
        {!compact && item.detail && (
          <div className="mt-1.5 text-[13.5px]">
            <Annex text={item.detail} />
          </div>
        )}
        {item.link && (
          <div className="mt-1.5">
            <a href={item.link} target={external ? "_blank" : undefined} rel={external ? "noreferrer" : undefined} className="btn btn-sm">
              {external ? "Ouvrir le lien" : "Y aller"}
            </a>
          </div>
        )}
      </div>
    </div>
  );
}
