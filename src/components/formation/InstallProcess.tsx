"use client";

import { useEffect, useMemo, useState } from "react";
import { useToast } from "@/components/ui";
import { Annex } from "./Annex";
import type { GuideNote, GuideSection, GuideStep } from "@/lib/formation-guide";

type Os = "windows" | "mac";

const NOTE_COLORS: Record<GuideNote["kind"], string> = {
  info: "var(--accent)",
  ok: "var(--good)",
  warn: "var(--warning)",
  danger: "var(--critical)",
};

function Note({ note }: { note: GuideNote }) {
  const c = NOTE_COLORS[note.kind];
  return (
    <div className="rounded-md px-3.5 py-2.5 text-[13.5px] leading-relaxed" style={{ borderLeft: `3px solid ${c}`, background: `color-mix(in srgb, ${c} 10%, transparent)` }}>
      <div className="font-semibold" style={{ color: c }}>
        {note.title}
      </div>
      <div className="mt-0.5">{note.text}</div>
    </div>
  );
}

function Cmd({ text }: { text: string }) {
  const toast = useToast();
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
      toast("Copié. Colle-le à Claude dans VS Code.");
    } catch {
      toast("Copie impossible : sélectionne le texte à la main.", "err");
    }
  };
  return (
    <div className="rounded-lg overflow-hidden border" style={{ borderColor: "var(--border)", background: "var(--surface-3)" }}>
      <div className="flex items-center justify-between gap-2 px-3 py-1.5" style={{ borderBottom: "1px solid var(--border)" }}>
        <span className="label-xs" style={{ color: "var(--accent)" }}>
          💬 À coller à Claude
        </span>
        <button type="button" onClick={() => void copy()} className={`btn btn-sm !h-[26px] !text-[11.5px] ${copied ? "" : "btn-primary"}`}>
          {copied ? "Copié ✓" : "Copier"}
        </button>
      </div>
      <div className="px-3 py-2.5 text-[13.5px] leading-relaxed whitespace-pre-wrap break-words">{text}</div>
    </div>
  );
}

/** Une étape : une carte, un gros bouton rond qui se coche avec un petit rebond. */
function StepCard({ step, index, done, onToggle, isNext }: { step: GuideStep; index: number; done: boolean; onToggle: () => void; isNext: boolean }) {
  return (
    <div
      className={`sx-step rounded-lg p-4 flex gap-3.5 transition-all ${done ? "sx-step-done" : ""} ${isNext ? "sx-step-next" : ""}`}
      style={{ background: isNext ? "var(--accent-soft)" : "var(--surface-2)", border: `1px solid ${isNext ? "var(--accent-ring)" : "var(--border)"}` }}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-label={done ? "Décocher" : "Marquer comme faite"}
        title={done ? "Fait. Clique pour décocher." : "Clique quand c'est fait."}
        className={`sx-check shrink-0 w-[34px] h-[34px] rounded-full flex items-center justify-center text-[13.5px] font-bold ${done ? "sx-check-done" : ""}`}
        style={{ background: done ? "var(--good)" : "var(--accent)", color: "#fff", boxShadow: done ? "0 0 0 6px color-mix(in srgb, var(--good) 18%, transparent)" : "0 6px 16px -8px var(--accent)" }}
      >
        {done ? "✓" : index}
      </button>
      <div className="min-w-0 flex-1 flex flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-[15px] font-semibold leading-snug" style={{ opacity: done ? 0.6 : 1, textDecoration: done ? "line-through" : "none" }}>
            {step.title}
          </span>
          {!done && isNext && (
            <button type="button" onClick={onToggle} className="btn btn-sm btn-primary !h-[26px] !text-[11.5px]">
              C&apos;est fait ✓
            </button>
          )}
        </div>
        {!done && (
          <>
            <Annex text={step.text} className="!text-[13.5px]" />
            {step.cmds?.map((c) => (
              <Cmd key={c} text={c} />
            ))}
            {step.link && (
              <a href={step.link.href} target="_blank" rel="noreferrer" className="btn btn-sm w-fit">
                {step.link.label} ↗
              </a>
            )}
            {step.note && <Note note={step.note} />}
          </>
        )}
      </div>
    </div>
  );
}

/**
 * Le process d'installation, en rangées dépliables : une rangée par
 * section (01 → 09), une seule ouverte à la fois. Dans une rangée, les
 * étapes sont des cartes ; la prochaine à faire est mise en avant, les
 * faites se replient en une ligne barrée. Quand une rangée est complète,
 * elle se ferme avec un ✓ et la suivante s'ouvre toute seule. Une barre de
 * progression en haut dit où on en est, sans un mot de trop.
 */
export function InstallProcess({ sections, os, setOs, done, onToggle }: { sections: GuideSection[]; os: Os; setOs: (v: Os) => void; done: Set<string>; onToggle: (key: string, done: boolean) => void }) {
  const toast = useToast();
  const keyOf = (s: GuideSection, i: number) => `${s.id}:${s.os ? os : ""}:${i}`;
  const stepsOf = (s: GuideSection) => (s.os ? s.os[os] : (s.steps ?? []));

  const rows = useMemo(
    () =>
      sections.map((s) => {
        const steps = stepsOf(s);
        const doneCount = steps.filter((_, i) => done.has(keyOf(s, i))).length;
        return { s, steps, doneCount, complete: steps.length > 0 && doneCount === steps.length };
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sections, os, done],
  );
  const total = rows.reduce((n, r) => n + r.steps.length, 0);
  const doneTotal = rows.reduce((n, r) => n + r.doneCount, 0);
  const pct = total ? Math.round((doneTotal / total) * 100) : 0;
  const firstOpen = rows.find((r) => r.steps.length > 0 && !r.complete)?.s.id ?? rows.find((r) => r.steps.length === 0)?.s.id ?? null;

  const [open, setOpen] = useState<string | null>(null);
  const [celebrated, setCelebrated] = useState(false);
  useEffect(() => {
    if (open === null && firstOpen) setOpen(firstOpen);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firstOpen]);
  useEffect(() => {
    if (total > 0 && doneTotal === total && !celebrated) {
      setCelebrated(true);
      toast("🎉 Tout est installé. Direction la recherche produit.");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doneTotal, total]);

  const toggle = (s: GuideSection, i: number, steps: GuideStep[]) => {
    const key = keyOf(s, i);
    const willBeDone = !done.has(key);
    onToggle(key, willBeDone);
    // Dernière étape de la rangée : on la ferme, la suivante s'ouvre.
    if (willBeDone) {
      const remaining = steps.filter((_, j) => j !== i && !done.has(keyOf(s, j))).length;
      if (remaining === 0) {
        const idx = rows.findIndex((r) => r.s.id === s.id);
        const next = rows.slice(idx + 1).find((r) => !r.complete);
        setTimeout(() => setOpen(next?.s.id ?? null), 450);
      }
    }
  };

  return (
    <section className="flex flex-col gap-3">
      {/* Où j'en suis */}
      <div className="card p-4 flex items-center gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-3">
            <span className="text-[14px] font-semibold">{pct === 100 ? "🎉 Installation terminée" : pct === 0 ? "On installe tes outils" : "Installation en cours"}</span>
            <span className="label-xs num">
              {doneTotal} / {total}
            </span>
          </div>
          <div className="sx-progress mt-2">
            <span style={{ width: `${pct}%` }} />
          </div>
        </div>
        <div className="flex gap-1 p-1 rounded-full shrink-0" style={{ background: "var(--surface-3)" }}>
          {(["windows", "mac"] as const).map((k) => (
            <button key={k} type="button" onClick={() => setOs(k)} className="px-3 py-1 rounded-full text-[12.5px] font-medium transition-all" style={os === k ? { background: "var(--accent)", color: "#fff" } : { color: "var(--text-2)" }}>
              {k === "windows" ? "Windows" : "Mac"}
            </button>
          ))}
        </div>
      </div>

      {/* Les rangées */}
      <div className="flex flex-col gap-2">
        {rows.map(({ s, steps, doneCount, complete }, ri) => {
          const isOpen = open === s.id;
          const nextIdx = steps.findIndex((_, i) => !done.has(keyOf(s, i)));
          return (
            <div key={s.id} id={s.id} className={`card overflow-hidden scroll-mt-4 transition-all ${isOpen ? "sx-row-open" : ""}`} style={{ borderColor: isOpen ? "var(--accent-ring)" : complete ? "color-mix(in srgb, var(--good) 45%, transparent)" : "var(--border)" }}>
              <button type="button" onClick={() => setOpen(isOpen ? null : s.id)} className="w-full text-left px-4 py-3.5 flex items-center gap-3.5" aria-expanded={isOpen}>
                <span
                  className={`sx-check shrink-0 w-[34px] h-[34px] rounded-full flex items-center justify-center text-[13px] font-bold ${complete ? "sx-check-done" : ""}`}
                  style={{ background: complete ? "var(--good)" : isOpen ? "var(--accent)" : "var(--surface-3)", color: complete || isOpen ? "#fff" : "var(--text-2)" }}
                >
                  {complete ? "✓" : ri + 1}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[15.5px] font-semibold leading-snug" style={{ opacity: complete && !isOpen ? 0.7 : 1 }}>
                    {s.title}
                  </span>
                  {steps.length > 0 && !isOpen && (
                    <span className="dim text-[12px]">{complete ? "Fait" : doneCount ? `${doneCount} / ${steps.length} étapes` : `${steps.length} étape${steps.length > 1 ? "s" : ""}`}</span>
                  )}
                </span>
                <span className="sx-chevron shrink-0 dim text-[14px]" style={{ transform: isOpen ? "rotate(180deg)" : "none" }}>
                  ▾
                </span>
              </button>

              <div className="sx-fold" data-open={isOpen}>
                <div className="min-h-0">
                  <div className="px-4 pb-4 flex flex-col gap-3">
                    {s.intro && <p className="muted text-[13.5px] leading-relaxed">{s.intro}</p>}
                    {s.notes?.map((n) => (
                      <Note key={n.title} note={n} />
                    ))}
                    {s.defs && (
                      <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
                        {s.defs.map((d) => (
                          <div key={d.term}>
                            <dt className="text-[13.5px] font-semibold">{d.term}</dt>
                            <dd className="muted text-[13px] leading-relaxed mt-0.5">{d.text}</dd>
                          </div>
                        ))}
                      </dl>
                    )}
                    {steps.map((st, i) => (
                      <StepCard key={`${s.id}-${os}-${i}`} step={st} index={i + 1} done={done.has(keyOf(s, i))} isNext={i === nextIdx} onToggle={() => toggle(s, i, steps)} />
                    ))}
                    {s.fixes && (
                      <details className="rounded-md" style={{ border: "1px solid var(--border)" }}>
                        <summary className="cursor-pointer list-none px-3.5 py-2 text-[13px] font-medium select-none">🛠 Ça ne marche pas ?</summary>
                        <ul className="flex flex-col gap-1.5 text-[13px] px-3.5 pb-3">
                          {s.fixes.map((f) => (
                            <li key={f.problem}>
                              <span className="font-semibold" style={{ color: "var(--warning)" }}>
                                {f.problem} :
                              </span>{" "}
                              {f.fix}
                            </li>
                          ))}
                        </ul>
                      </details>
                    )}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
