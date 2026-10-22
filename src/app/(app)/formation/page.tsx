"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/client";
import { ErrorNote, Spinner, useToast } from "@/components/ui";
import { PortalFooter, PortalStepRow, SectionLabel, waHelpLink } from "@/components/formation/portal";
import type { DashboardPayload } from "@/app/api/formation/dashboard/route";

/**
 * Tableau de bord Scale X : la page d'accueil de l'élève.
 *
 * Où il en est dans la formation (reprendre là où il s'est arrêté), ses
 * prochaines étapes à cocher, l'accompagnement (réserver un appel, écrire à
 * Mady), le formulaire d'onboarding et les dernières ressources PDF. Sobre
 * et numéroté, pour qu'un élève sache en trois secondes quoi faire ensuite.
 */
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
          {/* 01 / Formation */}
          <section className="card p-5">
            <div className="flex items-center justify-between gap-3">
              <SectionLabel n="01" title="Formation" />
              <span className="label-xs num">
                {f.done} / {f.total} modules terminés
              </span>
            </div>
            {f.total === 0 ? (
              <p className="dim text-[13.5px] mt-4">Ta formation arrive : aucun module n&apos;est encore publié.</p>
            ) : f.resume ? (
              <>
                <div className="label-xs mt-5">Reprendre où tu en étais</div>
                <h2 className="text-[20px] font-semibold mt-1 leading-tight">{f.resume.title}</h2>
                {f.resume.summary && <p className="muted text-[13.5px] mt-1 leading-relaxed">{f.resume.summary}</p>}
              </>
            ) : (
              <h2 className="text-[20px] font-semibold mt-5 leading-tight">Tous les modules sont terminés. Bravo.</h2>
            )}
            {f.total > 0 && (
              <>
                <div className="flex items-center gap-3 mt-4">
                  <div className="flex-1 h-[6px] rounded-full overflow-hidden" style={{ background: "var(--surface-3)" }}>
                    <div className="h-full rounded-full transition-all" style={{ width: `${f.percent}%`, background: "var(--good)" }} />
                  </div>
                  <span className="text-[12px] num dim">{f.percent}%</span>
                </div>
                <div className="label-xs mt-2">
                  {f.resume ? `Module ${f.resume.index + 1} / ${f.total}` : `${f.total} modules`} · {f.percent}% de la formation
                </div>
                <div className="flex flex-wrap items-center gap-3 mt-4">
                  <Link href={f.resume ? `/formation/cours?m=${f.resume.id}` : "/formation/cours"} className="btn btn-primary btn-sm">
                    {f.resume ? "Reprendre" : "Revoir les modules"}
                  </Link>
                  <Link href="/formation/cours" className="text-[13px] font-medium hover:underline">
                    Tous les modules →
                  </Link>
                </div>
              </>
            )}
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
                Écrire à Mady sur WhatsApp
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
