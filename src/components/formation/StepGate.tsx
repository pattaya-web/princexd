"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { api } from "@/lib/client";
import { Spinner, useToast } from "@/components/ui";
import type { GateTab } from "@/lib/formation-gate";
import type { GatePayload } from "@/app/api/formation/gate/route";

/** Les pages du parcours préviennent le menu quand une étape change d'état. */
export const GATE_EVENT = "formation:gate";

/**
 * Verrou d'une page du parcours Scale X.
 *
 * Verrouillée : l'élève voit seulement ce qu'il lui manque (l'étape d'avant
 * à finir, ou la validation de Mady après le formulaire d'onboarding).
 * Ouverte : la page, puis en bas un seul bouton « j'ai terminé », qui
 * débloque l'onglet suivant. L'admin voit tout, toujours.
 */
export function StepGate({ tab, children }: { tab: GateTab; children: ReactNode }) {
  const toast = useToast();
  const [gate, setGate] = useState<GatePayload | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setGate(await api<GatePayload>("/api/formation/gate"));
    } catch {
      /* hors formation : pas de verrou */
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (!gate) return <Spinner label="Chargement…" />;
  const me = gate.tabs.find((t) => t.key === tab)!;
  const idx = gate.tabs.findIndex((t) => t.key === tab);
  const next = gate.tabs[idx + 1] ?? null;
  const locked = !me.unlocked && !gate.isAdmin;

  if (locked) {
    const b = me.blockedBy;
    return (
      <div className="card p-6 sm:p-8 text-center flex flex-col items-center gap-3 max-w-[560px] mx-auto mt-6">
        <div className="text-[34px]">🔒</div>
        <h1 className="text-[22px] font-semibold leading-tight" style={{ letterSpacing: "-0.02em" }}>
          {me.label}
        </h1>
        {b?.kind === "approval" ? (
          <>
            <p className="muted text-[14px] leading-relaxed">Cette étape s&apos;ouvre quand Mady a validé ton formulaire d&apos;onboarding.</p>
            <Link href="/formation" className="btn btn-primary btn-sm mt-1">
              Remplir le formulaire →
            </Link>
          </>
        ) : b?.kind === "tab" ? (
          <>
            <p className="muted text-[14px] leading-relaxed">Termine d&apos;abord l&apos;étape « {b.label} ».</p>
            <Link href={b.href} className="btn btn-primary btn-sm mt-1">
              Aller à {b.label} →
            </Link>
          </>
        ) : null}
      </div>
    );
  }

  const mark = async (done: boolean) => {
    setBusy(true);
    try {
      const r = await api<GatePayload>("/api/formation/gate", { method: "POST", body: JSON.stringify({ action: "done", tab, done }) });
      setGate(r);
      window.dispatchEvent(new Event(GATE_EVENT));
      if (r.preview) toast("Aperçu : la progression de l'élève n'est pas modifiée.");
      else if (done) toast(next ? `Étape validée. Suivant : ${next.label}.` : "🚀 Campagnes lancées : 100 %. Bravo.");
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {gate.preview && me.blockedBy && (
        <div className="badge badge-warn w-fit !text-[11.5px]">
          Aperçu : pour l&apos;élève, cet onglet est verrouillé{me.blockedBy.kind === "tab" ? ` (il doit d'abord terminer « ${me.blockedBy.label} »)` : " (en attente de ta validation du formulaire)"}.
        </div>
      )}
      {children}
      {gate.hasStudent && (
        <div className="card p-5 flex flex-wrap items-center justify-between gap-3" style={{ borderColor: me.done ? "var(--good)" : "var(--accent-ring)" }}>
          {me.done ? (
            <>
              <div className="text-[14.5px] font-semibold" style={{ color: "var(--good)" }}>
                {next ? "✓ Étape terminée" : "🚀 Campagnes lancées · 100 %"}
              </div>
              <div className="flex items-center gap-2">
                {next && (
                  <Link href={next.href} className="btn btn-primary btn-sm">
                    Suivant : {next.label} →
                  </Link>
                )}
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => void mark(false)} disabled={busy}>
                  Rouvrir
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="text-[14.5px] font-semibold">Quand c&apos;est fait, valide l&apos;étape.</div>
              <button type="button" className="btn btn-primary" onClick={() => void mark(true)} disabled={busy}>
                {busy ? "…" : `✓ ${me.doneLabel}`}
              </button>
            </>
          )}
        </div>
      )}
    </>
  );
}
