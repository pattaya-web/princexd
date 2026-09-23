"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/client";
import { MontageDrive } from "@/components/MontageDrive";
import { CopyButton, InfoNote, PageHeader } from "@/components/ui";
import type { Settings } from "@/lib/types";

export default function MontagePage() {
  const [settings, setSettings] = useState<(Settings & { kieApiKeyMask?: string }) | null>(null);
  const [origin, setOrigin] = useState("");

  useEffect(() => {
    setOrigin(window.location.origin);
    void api<Settings>("/api/settings").then(setSettings).catch(() => setSettings(null));
  }, []);

  const code = settings?.editorAccessCode ?? "";

  return (
    <>
      <PageHeader
        title="Espace monteur"
      />

      <div className="mb-4">
        <InfoNote>
          {code ? (
            <span className="flex flex-wrap items-center gap-2">
              Lien à donner à ton monteur :
              <code className="mono px-1.5 py-0.5 rounded" style={{ background: "var(--surface-3)" }}>
                {origin}/monteur
              </code>
              avec le code
              <code className="mono px-1.5 py-0.5 rounded" style={{ background: "var(--surface-3)" }}>{code}</code>
              <CopyButton text={`${origin}/monteur — code : ${code}`} label="Copier" />
              — il ne verra que ce board, jamais ton CRM ni tes crédits.
            </span>
          ) : (
            <>
              Définis un <strong>code d&apos;accès monteur</strong> dans Réglages pour lui ouvrir la page{" "}
              <code className="mono">/monteur</code>. Tant qu&apos;aucun code n&apos;est défini, personne ne peut y entrer.
            </>
          )}
        </InfoNote>
      </div>

      <MontageDrive role="owner" />
    </>
  );
}
