"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/client";
import { ErrorNote, Spinner, useToast } from "@/components/ui";
import { GATE_EVENT } from "@/components/formation/StepGate";
import type { DashboardPayload } from "@/app/api/formation/dashboard/route";
import type { GatePayload } from "@/app/api/formation/gate/route";
import { youtubeEmbedUrl, youtubeId } from "@/lib/formation";

/**
 * Accueil Scale X : la vidéo de bienvenue de Mady, puis la première étape,
 * le formulaire d'onboarding. L'élève le remplit, dit qu'il l'a fait, et
 * Mady débloque Démarrage. Rien d'autre : le reste est dans les onglets,
 * qui s'ouvrent un à un.
 */
export default function ScaleXDashboard() {
  const toast = useToast();
  const [data, setData] = useState<DashboardPayload | null>(null);
  const [gate, setGate] = useState<GatePayload | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [d, g] = await Promise.all([api<DashboardPayload>("/api/formation/dashboard"), api<GatePayload>("/api/formation/gate")]);
      setData(d);
      setGate(g);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const request = async () => {
    setBusy(true);
    try {
      const r = await api<GatePayload>("/api/formation/gate", { method: "POST", body: JSON.stringify({ action: "request" }) });
      setGate(r);
      window.dispatchEvent(new Event(GATE_EVENT));
      toast(r.preview ? "Aperçu : rien n'est enregistré." : "C'est noté. Mady valide et débloque Démarrage.");
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setBusy(false);
    }
  };

  if (error) return <ErrorNote>{error}</ErrorNote>;
  if (!data || !gate) return <Spinner label="Chargement…" />;

  const name = data.student?.firstName ?? "Mady";
  const video = data.portal.welcomeVideoUrl;
  const vid = video ? youtubeId(video) : null;
  const approved = Boolean(gate.approvedAt);
  const requested = Boolean(gate.requestedAt);

  return (
    <div className="flex flex-col gap-5 max-w-[920px]">
      <header>
        <h1 className="text-[28px] sm:text-[34px] font-semibold leading-tight" style={{ letterSpacing: "-0.03em" }}>
          Bienvenue, {name}.
        </h1>
        {data.preview && <div className="badge badge-warn w-fit !text-[11.5px] mt-3">Aperçu : tu vois Scale X comme {data.student?.name}. Rien n&apos;est enregistré.</div>}
        {data.isAdmin && !data.student && (
          <div className="flex flex-wrap gap-2 mt-3">
            <Link href="/formation/eleves" className="btn btn-sm">
              Accès élèves
            </Link>
            <Link href="/formation/parcours" className="btn btn-sm btn-ghost">
              Parcours &amp; étapes
            </Link>
            <Link href="/formation/modules" className="btn btn-sm btn-ghost">
              Modules
            </Link>
          </div>
        )}
      </header>

      {/* La vidéo de bienvenue, en grand. */}
      {video ? (
        <div className="rounded-lg overflow-hidden" style={{ background: "#000" }}>
          {vid ? (
            <div style={{ position: "relative", paddingTop: "56.25%" }}>
              <iframe
                src={youtubeEmbedUrl(vid)}
                title="Bienvenue dans Scale X"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                allowFullScreen
                style={{ position: "absolute", inset: 0, width: "100%", height: "100%", border: 0 }}
              />
            </div>
          ) : (
            <video src={video} controls playsInline preload="metadata" className="w-full max-h-[70vh]" />
          )}
        </div>
      ) : (
        data.isAdmin && <div className="dim text-[12.5px]">Vidéo de bienvenue à renseigner dans Démarrage → Modifier.</div>
      )}

      {/* Étape 1 : le formulaire d'onboarding, obligatoire. */}
      <section className="card p-5" style={{ borderColor: approved ? "var(--good)" : "var(--accent-ring)" }}>
        <div className="label-xs" style={{ letterSpacing: "0.12em" }}>
          ÉTAPE 1 / FORMULAIRE D&apos;ONBOARDING
        </div>
        <p className="text-[14.5px] mt-2 leading-relaxed">5 minutes, une fois. Obligatoire avant de commencer.</p>
        <div className="flex flex-wrap items-center gap-2 mt-4">
          {data.formUrl ? (
            <a href={data.formUrl} target="_blank" rel="noreferrer" className={`btn ${approved || requested ? "" : "btn-primary"}`}>
              Remplir le formulaire ↗
            </a>
          ) : (
            <span className="dim text-[12.5px]">{data.isAdmin ? "Lien du formulaire à renseigner dans Élèves → Onboarding." : "Lien à venir."}</span>
          )}
          {gate.hasStudent && !approved && !requested && (
            <button type="button" className="btn" onClick={() => void request()} disabled={busy || !data.formUrl}>
              {busy ? "…" : "✓ Je l'ai rempli"}
            </button>
          )}
        </div>
        {(approved || requested) && (
          <div className="flex flex-wrap items-center justify-between gap-3 mt-4 pt-4" style={{ borderTop: "1px solid var(--border)" }}>
            <span className="text-[13.5px] font-semibold" style={{ color: approved ? "var(--good)" : "var(--text-2)" }}>
              {approved ? "✓ Mady a bien reçu ton formulaire" : "✓ Formulaire envoyé, Mady est prévenue"}
            </span>
            <Link href={gate.next?.href ?? "/formation/demarrage"} className="btn btn-primary btn-sm">
              {gate.next ? `Continuer : ${gate.next.label} →` : "Démarrage →"}
            </Link>
          </div>
        )}
      </section>
    </div>
  );
}
