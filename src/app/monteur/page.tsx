"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/client";
import { MontageBoard } from "@/components/MontageBoard";
import { Card, ErrorNote, Field, InfoNote, ToastHost } from "@/components/ui";
import { ThemeToggle } from "@/components/Shell";

/**
 * Espace du monteur. Cloisonné par le middleware : une fois le code saisi,
 * le cookie de rôle ferme l'accès à tout le reste du tool.
 */
export default function MonteurPage() {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void api<{ role: string }>("/api/auth/editor")
      .then((r) => setAuthed(r.role === "editor"))
      .catch(() => setAuthed(false));
  }, []);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await api("/api/auth/editor", { method: "POST", body: JSON.stringify({ code }) });
      window.location.reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const logout = async () => {
    await api("/api/auth/editor", { method: "DELETE" });
    window.location.reload();
  };

  return (
    <ToastHost>
      <div className="min-h-screen">
        <header
          className="h-[52px] flex items-center justify-between px-4 sticky top-0 z-20"
          style={{
            background: "color-mix(in srgb, var(--bg) 90%, transparent)",
            backdropFilter: "blur(10px)",
            borderBottom: "1px solid var(--border)",
          }}
        >
          <div className="flex items-center gap-2">
            <span
              className="w-[22px] h-[22px] rounded-[6px] grid place-items-center text-[12px] font-bold"
              style={{ background: "var(--accent)", color: "var(--accent-on)" }}
            >
              ✂
            </span>
            <span className="font-semibold text-[13.5px]">Espace montage</span>
          </div>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            {authed && (
              <button className="btn btn-sm btn-ghost" onClick={() => void logout()}>
                Quitter
              </button>
            )}
          </div>
        </header>

        <main className="p-4 sm:p-6 max-w-[1500px]">
          {authed === null ? null : authed ? (
            <>
              <div className="mb-4">
                <InfoNote>
                  Chaque carte contient le brief, les rushs et le format attendu. Quand ton montage est prêt, dépose
                  la vidéo dans <strong>Vidéos montées</strong> puis fais glisser la carte en <strong>Livré</strong>.
                </InfoNote>
              </div>
              <MontageBoard role="editor" />
            </>
          ) : (
            <div className="max-w-sm mx-auto mt-[8vh]">
              <Card title="Accès monteur">
                <div className="flex flex-col gap-3.5">
                  <Field label="Code d'accès">
                    <input
                      className="input mono"
                      type="password"
                      value={code}
                      autoFocus
                      onChange={(e) => setCode(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") void submit();
                      }}
                    />
                  </Field>
                  {error && <ErrorNote>{error}</ErrorNote>}
                  <button className="btn btn-primary" onClick={() => void submit()} disabled={busy || !code.trim()}>
                    {busy ? <span className="spinner" /> : "Entrer"}
                  </button>
                </div>
              </Card>
            </div>
          )}
        </main>
      </div>
    </ToastHost>
  );
}
