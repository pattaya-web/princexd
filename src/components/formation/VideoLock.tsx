"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { api } from "@/lib/client";
import type { GatePayload } from "@/app/api/formation/gate/route";

/**
 * Les vidéos du parcours s'ouvrent quand Mady a cliqué « Vu » sur le
 * formulaire d'onboarding de l'élève. Avant : un cadenas à la place du
 * lecteur, avec le chemin vers le formulaire. L'admin voit toujours la vidéo.
 */
export function VideoLock({ children }: { children: ReactNode }) {
  const [gate, setGate] = useState<GatePayload | null>(null);

  useEffect(() => {
    let alive = true;
    const load = () =>
      api<GatePayload>("/api/formation/gate")
        .then((g) => alive && setGate(g))
        .catch(() => alive && setGate(null));
    void load();
    window.addEventListener("formation:gate", load);
    window.addEventListener("focus", load);
    return () => {
      alive = false;
      window.removeEventListener("formation:gate", load);
      window.removeEventListener("focus", load);
    };
  }, []);

  if (!gate) return null;
  const open = gate.isAdmin || !gate.hasStudent || Boolean(gate.approvedAt);
  if (open) return <>{children}</>;

  return (
    <div className="mt-4 rounded-lg flex flex-col items-center justify-center text-center gap-2 px-5 py-10" style={{ background: "var(--surface-2)", border: "1px dashed var(--border-strong)" }}>
      <div className="text-[30px]">🔒</div>
      <div className="text-[15px] font-semibold">Vidéo verrouillée</div>
      <p className="muted text-[13.5px] leading-relaxed max-w-[42ch]">
        {gate.requestedAt ? "Mady vérifie ton formulaire d'onboarding. Dès qu'il est validé, la vidéo s'ouvre." : "Remplis d'abord le formulaire d'onboarding. Mady valide, la vidéo s'ouvre."}
      </p>
      {!gate.requestedAt && (
        <Link href="/formation" className="btn btn-primary btn-sm mt-1">
          Aller au formulaire →
        </Link>
      )}
    </div>
  );
}
