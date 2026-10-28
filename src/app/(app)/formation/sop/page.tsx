"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useToast } from "@/components/ui";
import { PortalFooter } from "@/components/formation/portal";
import { SOP_GROUPS, SOPS, type Sop, type SopPrompt } from "@/lib/formation-sops";

/**
 * SOP (Scale X) : une procédure par tâche, dans l'ordre du parcours. Chaque
 * fiche : quand, combien de temps, les étapes, les messages à coller à
 * Claude, « c'est bon quand », les erreurs à éviter. Tout vient de la
 * méthode de Mady (src/lib/formation-sops.ts).
 */

function PromptBlock({ p }: { p: SopPrompt }) {
  const toast = useToast();
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(p.text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
      toast("Copié. Remplace les [crochets] par tes infos avant d'envoyer.");
    } catch {
      toast("Copie impossible : sélectionne le texte à la main.", "err");
    }
  };
  return (
    <div className="rounded-lg overflow-hidden border" style={{ borderColor: "var(--border)", background: "var(--surface-3)" }}>
      <div className="flex items-center justify-between gap-2 px-3 py-1.5" style={{ borderBottom: "1px solid var(--border)" }}>
        <span className="text-[12px] font-semibold" style={{ color: "var(--accent)" }}>
          💬 {p.title}
        </span>
        <button type="button" onClick={() => void copy()} className={`btn btn-sm !h-[26px] !text-[11.5px] ${copied ? "" : "btn-primary"}`}>
          {copied ? "Copié ✓" : "Copier"}
        </button>
      </div>
      <div className="px-3 py-2.5 text-[13px] leading-relaxed whitespace-pre-wrap break-words">{p.text}</div>
    </div>
  );
}

function SopCard({ sop, open, onToggle }: { sop: Sop & { group: string }; open: boolean; onToggle: () => void }) {
  return (
    <article id={sop.id} className="card overflow-hidden scroll-mt-24">
      <button type="button" onClick={onToggle} className="w-full text-left flex items-start gap-3.5 px-4 sm:px-5 py-4" aria-expanded={open}>
        <span className="shrink-0 w-[40px] h-[40px] rounded-[10px] flex items-center justify-center text-[18px]" style={{ background: "var(--accent-soft)" }} aria-hidden>
          {sop.icon}
        </span>
        <span className="min-w-0 flex-1">
          <span className="label-xs" style={{ letterSpacing: "0.12em" }}>
            SOP {sop.n} · {SOP_GROUPS.find((g) => g.key === sop.group)?.label}
          </span>
          <span className="block text-[17px] font-semibold leading-snug mt-0.5">{sop.title}</span>
          <span className="block muted text-[13px] mt-1">{sop.goal}</span>
          <span className="flex flex-wrap gap-x-3 gap-y-1 mt-2 text-[11.5px] dim">
            <span>⏱ {sop.time}</span>
            <span>📅 {sop.when}</span>
          </span>
        </span>
        <span className="shrink-0 dim text-[13px] mt-1">{open ? "▴" : "▾"}</span>
      </button>

      {open && (
        <div className="px-4 sm:px-5 pb-5 flex flex-col gap-5" style={{ borderTop: "1px solid var(--border)" }}>
          {sop.note && (
            <div className="rounded-md px-3.5 py-2.5 text-[13px] leading-relaxed mt-4" style={{ borderLeft: "3px solid var(--warning)", background: "color-mix(in srgb, var(--warning) 10%, transparent)" }}>
              {sop.note}
            </div>
          )}
          <div className={sop.note ? "" : "mt-4"}>
            <div className="label-xs mb-1.5">Il te faut</div>
            <div className="flex flex-wrap gap-1.5">
              {sop.tools.map((t) => (
                <span key={t} className="badge !text-[11.5px]">
                  {t}
                </span>
              ))}
            </div>
          </div>

          <div>
            <div className="label-xs mb-2">Les étapes, dans l&apos;ordre</div>
            <ol className="flex flex-col gap-2">
              {sop.steps.map((s, i) => (
                <li key={i} className="flex gap-3 text-[13.5px] leading-relaxed">
                  <span className="shrink-0 w-[24px] h-[24px] rounded-full flex items-center justify-center text-[11.5px] font-bold" style={{ background: "var(--accent)", color: "#fff" }}>
                    {i + 1}
                  </span>
                  <span>{s}</span>
                </li>
              ))}
            </ol>
          </div>

          {sop.prompts.length > 0 && (
            <div>
              <div className="label-xs mb-2">À coller à Claude (remplace les [crochets])</div>
              <div className="flex flex-col gap-2.5">
                {sop.prompts.map((p) => (
                  <PromptBlock key={p.title} p={p} />
                ))}
              </div>
            </div>
          )}

          <div className="grid md:grid-cols-2 gap-4">
            <div className="rounded-lg p-3.5" style={{ background: "color-mix(in srgb, var(--good) 8%, transparent)", border: "1px solid color-mix(in srgb, var(--good) 30%, transparent)" }}>
              <div className="label-xs mb-1.5" style={{ color: "var(--good)" }}>
                C&apos;est bon quand
              </div>
              <ul className="flex flex-col gap-1">
                {sop.done.map((d, i) => (
                  <li key={i} className="text-[13px] leading-relaxed flex gap-2">
                    <span style={{ color: "var(--good)" }}>✓</span>
                    <span>{d}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="rounded-lg p-3.5" style={{ background: "color-mix(in srgb, var(--critical) 7%, transparent)", border: "1px solid color-mix(in srgb, var(--critical) 28%, transparent)" }}>
              <div className="label-xs mb-1.5" style={{ color: "var(--critical)" }}>
                Les erreurs qu&apos;on voit
              </div>
              <ul className="flex flex-col gap-1">
                {sop.mistakes.map((m, i) => (
                  <li key={i} className="text-[13px] leading-relaxed flex gap-2">
                    <span style={{ color: "var(--critical)" }}>✕</span>
                    <span>{m}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {sop.links && sop.links.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {sop.links.map((l) =>
                l.href.startsWith("/") ? (
                  <Link key={l.href} href={l.href} className="btn btn-sm">
                    {l.label} →
                  </Link>
                ) : (
                  <a key={l.href} href={l.href} target="_blank" rel="noreferrer" className="btn btn-sm">
                    {l.label} ↗
                  </a>
                ),
              )}
            </div>
          )}
        </div>
      )}
    </article>
  );
}

export default function SopPage() {
  const [query, setQuery] = useState("");
  const [group, setGroup] = useState("");
  const [open, setOpen] = useState<string>(SOPS[0]?.id ?? "");

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return SOPS.filter((s) => (!group || s.group === group) && (!q || `${s.title} ${s.goal} ${s.steps.join(" ")} ${s.tools.join(" ")}`.toLowerCase().includes(q)));
  }, [query, group]);

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="label-xs" style={{ letterSpacing: "0.12em" }}>
            Scale X / SOP
          </div>
          <h1 className="text-[28px] sm:text-[34px] font-semibold leading-tight mt-2" style={{ letterSpacing: "-0.03em" }}>
            Une procédure par tâche.
          </h1>
          <p className="muted text-[14px] mt-1 max-w-[64ch]">
            Claude Code, Shopify, produit, créatives, Meta : pour chaque tâche, les étapes dans l&apos;ordre, les messages à coller à Claude, à quoi tu vois que c&apos;est bon, et les erreurs qu&apos;on voit chez les élèves. Ouvre la fiche, suis-la, coche.
          </p>
        </div>
        <input className="input !h-[34px] w-[220px] max-w-full text-[13px]" placeholder="Rechercher (ex. pixel, logo, .env)…" value={query} onChange={(e) => setQuery(e.target.value)} />
      </header>

      <div className="flex flex-wrap items-center gap-1.5">
        <button type="button" className={`btn btn-sm ${group === "" ? "btn-primary" : "btn-ghost"}`} onClick={() => setGroup("")}>
          Tout ({SOPS.length})
        </button>
        {SOP_GROUPS.map((g) => {
          const n = SOPS.filter((s) => s.group === g.key).length;
          return (
            <button key={g.key} type="button" className={`btn btn-sm ${group === g.key ? "btn-primary" : "btn-ghost"}`} onClick={() => setGroup(group === g.key ? "" : g.key)}>
              {g.label} ({n})
            </button>
          );
        })}
      </div>

      {rows.length === 0 ? (
        <div className="card p-6 text-center muted text-[13.5px]">Aucune fiche ne correspond à « {query} ».</div>
      ) : (
        <div className="flex flex-col gap-3">
          {rows.map((s) => (
            <SopCard key={s.id} sop={s} open={open === s.id} onToggle={() => setOpen(open === s.id ? "" : s.id)} />
          ))}
        </div>
      )}

      <PortalFooter quote="Il n'y a pas de mauvaises IA, il n'y a que de mauvais prompts." author="Mady" />
    </div>
  );
}
