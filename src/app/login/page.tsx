"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { forgetSession } from "@/lib/sales/client";
import { Brand } from "@/components/Shell";

/**
 * Connexion.
 *
 * Page volontairement nue et hors du Shell : personne n'a besoin de voir le
 * menu du tool avant d'etre identifie.
 *
 * Un seul champ au depart : l'identifiant. Les eleves de Scale X entrent
 * avec lui seul, et un champ « mot de passe » les faisait bloquer (« c'est
 * quoi le mot de passe ? »). Le champ n'apparait que si le serveur le
 * reclame (`needPassword`) : admin, equipe commerciale, monteur avec compte,
 * ancienne fiche eleve qui en a un.
 */
export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [needPassword, setNeedPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim()) return;
    setLoading(true);
    setError("");
    try {
      let res: Response;
      try {
        res = await fetch("/api/sales/session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username: username.trim(), password: needPassword ? password : "" }),
        });
      } catch {
        throw new Error("Connexion au serveur impossible. Vérifie ta connexion et réessaie.");
      }
      const data = (await res.json().catch(() => ({}))) as { redirect?: string; error?: string; needPassword?: boolean };
      if (!res.ok) {
        if (data.needPassword && !needPassword) {
          // Pas une erreur pour l'utilisateur : on ouvre juste le second champ.
          setNeedPassword(true);
          setLoading(false);
          return;
        }
        throw new Error(data.error || "Connexion refusée.");
      }
      // Le cache de session porte l'ancien role : le vider evite d'atterrir
      // sur un ecran calcule pour la personne precedente.
      forgetSession();
      router.push(data.redirect || "/");
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
      setLoading(false);
    }
  };

  const disabled = loading || !username.trim() || (needPassword && !password);

  return (
    <main className="min-h-screen flex flex-col px-4" style={{ background: "var(--bg)" }}>
      <div className="h-[60px] flex items-center justify-center sm:justify-start sm:px-4">
        <Brand />
      </div>

      <div className="flex-1 grid place-items-center pb-16">
        <div className="w-full max-w-[380px] rise">
          <form className="card p-7" style={{ borderRadius: "var(--radius-lg)" }} onSubmit={submit}>
            <span className="label-xs block mb-3">Connexion</span>
            <h1 className="text-[26px] font-medium leading-[1.1]" style={{ letterSpacing: "-0.03em" }}>
              Bienvenue.
            </h1>
            <p className="muted text-[14px] mt-2 mb-6 leading-relaxed">
              {needPassword ? "Ce compte a un mot de passe : saisis-le pour continuer." : "Entre l'identifiant qui t'a été transmis. Élève : ton identifiant suffit, pas de mot de passe."}
            </p>

            <label className="block">
              <span className="label-xs block mb-2">Identifiant</span>
              <input
                className="input !h-[42px] !text-[14px]"
                value={username}
                placeholder="prenom.nom"
                onChange={(e) => {
                  setUsername(e.target.value);
                  if (needPassword) {
                    setNeedPassword(false);
                    setPassword("");
                  }
                }}
                autoFocus
                autoCapitalize="none"
                autoComplete="username"
              />
            </label>

            {needPassword && (
              <label className="block mt-3.5">
                <span className="label-xs block mb-2">Mot de passe</span>
                <input
                  className="input !h-[42px] !text-[14px]"
                  type="password"
                  value={password}
                  placeholder="••••••••"
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                  autoFocus
                />
              </label>
            )}

            {error && (
              <p className="text-[12.5px] mt-3 leading-snug" style={{ color: "var(--critical)" }}>
                {error}
              </p>
            )}

            <button className="btn btn-primary w-full mt-5 !h-[42px] !text-[14px]" type="submit" disabled={disabled}>
              {loading ? <span className="spinner" /> : needPassword ? "Se connecter" : "Continuer"}
            </button>
          </form>

          <p className="label-xs text-center mt-6">MPGate · accès réservé</p>
        </div>
      </div>
    </main>
  );
}
