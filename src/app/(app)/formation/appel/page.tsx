"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/client";
import { ErrorNote, Spinner } from "@/components/ui";
import { PortalFooter, waHelpLink } from "@/components/formation/portal";
import type { DashboardPayload } from "@/app/api/formation/dashboard/route";

/** Réserver un appel (Scale X) : le lien de réservation de Mady, et WhatsApp pour les urgences (après Claude Code). */
export default function ReserverAppelPage() {
  const [data, setData] = useState<DashboardPayload | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api<DashboardPayload>("/api/formation/dashboard")
      .then(setData)
      .catch((e) => setError((e as Error).message));
  }, []);

  if (error) return <ErrorNote>{error}</ErrorNote>;
  if (!data) return <Spinner label="Chargement…" />;

  const wa = waHelpLink(data.portal.whatsapp, data.student?.firstName ?? "");

  return (
    <div className="flex flex-col gap-5 max-w-[640px]">
      <header>
        <h1 className="text-[28px] sm:text-[34px] font-semibold leading-tight" style={{ letterSpacing: "-0.03em" }}>
          Réserver un appel
        </h1>
        <p className="muted text-[14px] mt-1">{data.portal.helpText}</p>
      </header>
      <div className="card p-5 flex flex-col gap-3">
        {data.portal.bookingUrl ? (
          <a href={data.portal.bookingUrl} target="_blank" rel="noreferrer" className="btn btn-primary w-full">
            Choisir un créneau
          </a>
        ) : (
          <div className="dim text-[13.5px]">{data.isAdmin ? "Renseigne le lien de réservation dans Formation → Parcours & étapes." : "Le lien de réservation arrive bientôt. En attendant, demande à Claude Code, puis à Mady si c'est urgent."}</div>
        )}
        {wa && (
          <a href={wa} target="_blank" rel="noreferrer" className="btn w-full">
            Urgence ? WhatsApp (après avoir essayé avec Claude)
          </a>
        )}
        <p className="dim text-[12.5px] leading-relaxed">Avant le call, prépare tes chiffres ou ta question précise : on avance plus vite.</p>
      </div>
      <PortalFooter quote={data.portal.quote} author={data.portal.quoteAuthor} />
    </div>
  );
}
