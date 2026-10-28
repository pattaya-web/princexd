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
  /* Étape « boutique » : l'élève donne l'adresse de sa boutique, Mady la récupère dans son suivi. */
  const [shopUrl, setShopUrl] = useState("");
  const [shopSaved, setShopSaved] = useState("");

  const load = useCallback(async () => {
    try {
      const g = await api<GatePayload>("/api/formation/gate");
      setGate(g);
      setShopUrl(g.shopUrl);
      setShopSaved(g.shopUrl);
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
      const withShop = tab === "boutique" && done && shopUrl.trim() ? { shopUrl: shopUrl.trim() } : {};
      const r = await api<GatePayload>("/api/formation/gate", { method: "POST", body: JSON.stringify({ action: "done", tab, done, ...withShop }) });
      setGate(r);
      setShopUrl(r.shopUrl);
      setShopSaved(r.shopUrl);
      window.dispatchEvent(new Event(GATE_EVENT));
      if (r.preview) toast("Aperçu : la progression de l'élève n'est pas modifiée.");
      else if (done) toast(next ? `Étape validée. Suivant : ${next.label}.` : "🚀 Campagnes lancées : 100 %. Bravo.");
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setBusy(false);
    }
  };

  const saveShop = async () => {
    setBusy(true);
    try {
      const r = await api<GatePayload>("/api/formation/gate", { method: "POST", body: JSON.stringify({ action: "shop", shopUrl: shopUrl.trim() }) });
      setGate(r);
      setShopUrl(r.shopUrl);
      setShopSaved(r.shopUrl);
      toast(r.preview ? "Aperçu : rien n'est enregistré." : "Adresse enregistrée : Mady l'a dans son suivi.");
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setBusy(false);
    }
  };

  const shopField =
    tab === "boutique" && gate.hasStudent ? (
      <div className="card p-5 flex flex-col gap-2.5" style={{ borderColor: shopSaved ? "var(--good)" : "var(--accent-ring)" }}>
        <div className="text-[14.5px] font-semibold">L&apos;adresse de ta boutique</div>
        <p className="muted text-[13px] leading-relaxed">
          Ton nom de domaine (ex. <strong>tamarque.com</strong>) ou ton adresse <strong>xxx.myshopify.com</strong>. Mady la récupère directement dans son suivi pour regarder ton travail, sans te la redemander.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <input className="input flex-1 min-w-[240px]" value={shopUrl} onChange={(e) => setShopUrl(e.target.value)} placeholder="tamarque.com ou xxx.myshopify.com" inputMode="url" autoCapitalize="off" spellCheck={false} />
          {shopUrl.trim() && shopUrl.trim() !== shopSaved && (
            <button type="button" className="btn btn-sm" onClick={() => void saveShop()} disabled={busy}>
              Enregistrer l&apos;adresse
            </button>
          )}
          {shopSaved && shopUrl.trim() === shopSaved && (
            <a href={shopSaved} target="_blank" rel="noreferrer" className="btn btn-sm btn-ghost">
              Ouvrir ma boutique ↗
            </a>
          )}
        </div>
      </div>
    ) : null;

  return (
    <>
      {gate.preview && me.blockedBy && (
        <div className="badge badge-warn w-fit !text-[11.5px]">
          Aperçu : pour l&apos;élève, cet onglet est verrouillé{me.blockedBy.kind === "tab" ? ` (il doit d'abord terminer « ${me.blockedBy.label} »)` : " (en attente de ta validation du formulaire)"}.
        </div>
      )}
      {children}
      {shopField}
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
              <button type="button" className="btn btn-primary" onClick={() => void mark(true)} disabled={busy || (tab === "boutique" && !shopUrl.trim())} title={tab === "boutique" && !shopUrl.trim() ? "Indique d'abord l'adresse de ta boutique" : undefined}>
                {busy ? "…" : `✓ ${me.doneLabel}`}
              </button>
            </>
          )}
        </div>
      )}
    </>
  );
}
