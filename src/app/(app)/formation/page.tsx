"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/client";
import { ErrorNote, Spinner, useToast } from "@/components/ui";
import { PortalFooter, PortalStepRow, SectionLabel, waHelpLink } from "@/components/formation/portal";
import type { DashboardPayload } from "@/app/api/formation/dashboard/route";
import { youtubeEmbedUrl, youtubeId } from "@/lib/formation";

/**
 * Tableau de bord Scale X : la page d'accueil de l'élève.
 *
 * Où il en est dans la formation (reprendre là où il s'est arrêté), ses
 * prochaines étapes à cocher, l'accompagnement (réserver un appel, écrire à
 * Mady), le formulaire d'onboarding et les dernières ressources PDF. Sobre
 * et numéroté, pour qu'un élève sache en trois secondes quoi faire ensuite.
 */
/** Les temps du parcours élève, dans l'ordre : installer, trouver le produit, créer la boutique, faire les créatives, lancer Meta. */
const PATH = [
  { href: "/formation/demarrage", title: "Installe tout", note: "VS Code, Claude Code, Shopify. Une fois." },
  { href: "/formation/produit", title: "Trouve ton produit", note: "Vidéo BrandSearch, 10 produits à Mady, validation." },
  { href: "/formation/boutique", title: "Crée ta boutique", note: "Vidéo de Mady : le thème + Claude Code. Ton produit dedans." },
  { href: "/formation/creatives", title: "Fais tes créatives", note: "Studio IA : images 3:4, 1:1, 9:16 · vidéos 9:16." },
  { href: "/formation/meta", title: "Lance tes campagnes Meta", note: "Vidéo de Mady : ta première campagne, pas à pas." },
];

export default function ScaleXDashboard() {
  const toast = useToast();
  const [data, setData] = useState<DashboardPayload | null>(null);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState("");

  const load = useCallback(async () => {
    try {
      setData(await api<DashboardPayload>("/api/formation/dashboard"));
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const tick = async (item: { id: string; kind: "step" | "task"; done: boolean }) => {
    if (!data?.student) {
      toast("Tu es admin : les coches sont celles des élèves.");
      return;
    }
    setBusyId(item.id);
    try {
      const r = await api<{ preview: boolean }>("/api/formation/steps/progress", {
        method: "POST",
        body: JSON.stringify(item.kind === "task" ? { taskId: item.id, done: !item.done } : { stepId: item.id, done: !item.done }),
      });
      if (r.preview) toast("Aperçu : la progression de l'élève n'est pas modifiée.");
      else if (!item.done) toast("Étape validée. On avance.");
      await load();
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setBusyId("");
    }
  };

  if (error) return <ErrorNote>{error}</ErrorNote>;
  if (!data) return <Spinner label="Chargement de ton espace…" />;

  const name = data.student?.firstName ?? "Mady";
  const f = data.formation;
  const e = data.education;
  const wa = waHelpLink(data.portal.whatsapp, name);

  return (
    <div className="flex flex-col gap-5">
      <header>
        <div className="label-xs" style={{ letterSpacing: "0.12em" }}>
          {data.today}
        </div>
        <h1 className="text-[28px] sm:text-[34px] font-semibold leading-tight mt-2" style={{ letterSpacing: "-0.03em" }}>
          {data.greeting}, {name}.
        </h1>
        <p className="muted text-[14px] mt-1">Voici où tu en es.</p>
        {data.preview && <div className="badge badge-warn w-fit !text-[11.5px] mt-3">Aperçu : tu vois Scale X comme {data.student?.name}. Rien n&apos;est enregistré.</div>}
        {data.isAdmin && !data.student && (
          <div className="flex flex-wrap gap-2 mt-3">
            <Link href="/formation/parcours" className="btn btn-sm">
              Parcours &amp; étapes
            </Link>
            <Link href="/formation/modules" className="btn btn-sm btn-ghost">
              Modules
            </Link>
            <Link href="/formation/eleves" className="btn btn-sm btn-ghost">
              Accès élèves
            </Link>
          </div>
        )}
      </header>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)] items-start">
        <div className="flex flex-col gap-4">
          {/* 00 / Démarrage */}
          <section className="card p-5" style={{ borderColor: "var(--accent-ring)" }}>
            <div className="flex items-center justify-between gap-3">
              <SectionLabel n="00" title="Démarrage" />
            </div>
            {data.portal.welcomeVideoUrl && (
              <div className="mt-3 rounded-lg overflow-hidden" style={{ background: "#000" }}>
                {youtubeId(data.portal.welcomeVideoUrl) ? (
                  <div style={{ position: "relative", paddingTop: "56.25%" }}>
                    <iframe
                      src={youtubeEmbedUrl(youtubeId(data.portal.welcomeVideoUrl)!)}
                      title="Vidéo d'accompagnement"
                      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                      allowFullScreen
                      style={{ position: "absolute", inset: 0, width: "100%", height: "100%", border: 0 }}
                    />
                  </div>
                ) : (
                  <video src={data.portal.welcomeVideoUrl} controls playsInline preload="metadata" className="w-full max-h-[60vh]" />
                )}
              </div>
            )}
            <h2 className="text-[20px] font-semibold mt-3 leading-tight">Ton parcours, en 4 temps.</h2>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4 mt-3">
              {PATH.map((p, i) => (
                <Link key={p.href} href={p.href} className="card-flat p-3 flex flex-col gap-1 hover:underline">
                  <span className="label-xs num">{String(i + 1).padStart(2, "0")}</span>
                  <span className="text-[14px] font-semibold leading-snug">{p.title}</span>
                  <span className="dim text-[12px] leading-snug">{p.note}</span>
                </Link>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-3 mt-4">
              <Link href="/formation/demarrage" className="btn btn-primary btn-sm">
                Commencer : Démarrage
              </Link>
              <Link href="/formation/demarrage#claude-aide" className="text-[13px] font-medium hover:underline">
                Bloqué ? Demande à Claude →
              </Link>
            </div>
          </section>

          {/* 01 / Education : les guides PDF */}
          <section className="card p-5">
            <div className="flex items-center justify-between gap-3">
              <SectionLabel n="01" title="Education 🎓" />
              <span className="label-xs num">
                {e.done} / {e.total} guides terminés
              </span>
            </div>
            {e.resume ? (
              <>
                <div className="label-xs mt-5">À lire maintenant</div>
                <h2 className="text-[20px] font-semibold mt-1 leading-tight">
                  {String(e.resume.order).padStart(2, "0")} · {e.resume.title}
                </h2>
                {e.resume.summary && <p className="muted text-[13.5px] mt-1 leading-relaxed">{e.resume.summary}</p>}
              </>
            ) : (
              <h2 className="text-[20px] font-semibold mt-5 leading-tight">Tous les guides sont terminés. Bravo.</h2>
            )}
            <div className="flex items-center gap-3 mt-4">
              <div className="flex-1 h-[6px] rounded-full overflow-hidden" style={{ background: "var(--surface-3)" }}>
                <div className="h-full rounded-full transition-all" style={{ width: `${e.percent}%`, background: "var(--good)" }} />
              </div>
              <span className="text-[12px] num dim">{e.percent}%</span>
            </div>
            <div className="flex flex-wrap items-center gap-3 mt-4">
              {e.resume ? (
                <a href={e.resume.file} target="_blank" rel="noreferrer" className="btn btn-primary btn-sm">
                  Ouvrir le PDF
                </a>
              ) : (
                <Link href="/formation/sops" className="btn btn-primary btn-sm">
                  Revoir les guides
                </Link>
              )}
              <Link href="/formation/sops" className="text-[13px] font-medium hover:underline">
                Tous les guides →
              </Link>
              {f.total > 0 && (
                <Link href={f.resume ? `/formation/cours?m=${f.resume.id}` : "/formation/cours"} className="text-[13px] font-medium hover:underline">
                  Vidéos ({f.done} / {f.total}) →
                </Link>
              )}
            </div>
          </section>

          {/* 02 / Prochaines étapes */}
          <section className="card p-5">
            <div className="flex items-center justify-between gap-3">
              <SectionLabel n="02" title="Prochaines étapes" />
              <span className="label-xs num">
                {data.steps.done} / {data.steps.total} faites
              </span>
            </div>
            {data.steps.next.length === 0 ? (
              <p className="dim text-[13.5px] mt-4">
                {data.steps.total ? "Tout est coché. Mady t'assignera la suite après votre prochain call." : "Rien à cocher pour l'instant : ton coach t'assignera tes prochaines étapes après votre prochain call."}
              </p>
            ) : (
              <div className="flex flex-col gap-1 mt-3">
                {data.steps.next.map((s) => (
                  <PortalStepRow key={s.id} item={s} busy={busyId === s.id} onToggle={() => void tick(s)} compact />
                ))}
              </div>
            )}
            <div className="mt-3">
              <Link href="/formation/etapes" className="text-[13px] font-medium hover:underline">
                Toutes mes étapes →
              </Link>
            </div>
          </section>
        </div>

        <div className="flex flex-col gap-4">
          {/* 03 / Accompagnement */}
          <section className="card p-5">
            <SectionLabel n="03" title="Accompagnement" />
            <p className="muted text-[13.5px] mt-3 leading-relaxed">{data.portal.helpText}</p>
            {data.portal.bookingUrl ? (
              <a href={data.portal.bookingUrl} target="_blank" rel="noreferrer" className="btn btn-primary w-full mt-4">
                Réserver un appel
              </a>
            ) : (
              <div className="dim text-[12.5px] mt-4">Lien de réservation à venir.</div>
            )}
            {wa && (
              <a href={wa} target="_blank" rel="noreferrer" className="btn w-full mt-2">
                Urgence : écrire à Mady sur WhatsApp
              </a>
            )}
          </section>

          {/* 04 / Onboarding */}
          <section className="card p-5">
            <SectionLabel n="04" title="Formulaire d'onboarding" />
            <p className="muted text-[13.5px] mt-3 leading-relaxed">5 minutes, à faire une fois : ta situation, ton objectif, pourquoi tu as choisi cet accompagnement. Mady prépare ton suivi avec.</p>
            {data.formUrl ? (
              <a href={data.formUrl} target="_blank" rel="noreferrer" className="btn w-full mt-4">
                Remplir le formulaire
              </a>
            ) : (
              <div className="dim text-[12.5px] mt-4">{data.isAdmin ? "Lien à renseigner dans Élèves → Onboarding." : "Lien à venir."}</div>
            )}
          </section>

          {/* 05 / Ressources */}
          <section className="card p-5">
            <SectionLabel n="05" title="Dernières ressources" />
            {data.resources.latest.length === 0 ? (
              <p className="dim text-[13.5px] mt-3">Aucune ressource pour l&apos;instant.</p>
            ) : (
              <ul className="flex flex-col divide-y mt-2" style={{ borderColor: "var(--border)" }}>
                {data.resources.latest.map((r) => (
                  <li key={r.id} className="py-3 flex items-center justify-between gap-3">
                    <span className="text-[13.5px] font-medium leading-snug min-w-0">{r.title}</span>
                    <a href={r.viewUrl} target="_blank" rel="noreferrer" className="btn btn-sm shrink-0">
                      PDF
                    </a>
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-3">
              <Link href="/formation/sops" className="text-[13px] font-medium hover:underline">
                Toutes les ressources →
              </Link>
            </div>
          </section>
        </div>
      </div>

      <PortalFooter quote={data.portal.quote} author={data.portal.quoteAuthor} />
    </div>
  );
}
