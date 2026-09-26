"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/client";
import { forgetSession } from "@/lib/sales/client";
import { Brand } from "@/components/Shell";

/**
 * Connexion de l'equipe.
 *
 * Page volontairement nue et hors du Shell : un setter n'a pas besoin de voir
 * le menu du tool avant d'etre identifie. Le proprietaire, lui, n'a jamais a
 * passer par ici — sans cookie, il est deja chez lui.
 *
 * Identifiant + mot de passe, definis par l'admin dans « Comptes ». Un
 * membre cree avant cette evolution peut encore saisir son ancien code dans
 * le champ identifiant, mot de passe vide.
 */
export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() && !password) return;
    setLoading(true);
    setError("");
    try {
      const res = await api<{ redirect: string; memberName: string }>("/api/sales/session", {
        method: "POST",
        body: JSON.stringify({ username: username.trim(), password }),
      });
      // Le cache de session porte l'ancien role : le vider evite d'atterrir
      // sur un ecran calcule pour la personne precedente.
      forgetSession();
      router.push(res.redirect);
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen flex flex-col px-4" style={{ background: "var(--bg)" }}>
      <div className="h-[60px] flex items-center justify-center sm:justify-start sm:px-4">
        <Brand />
      </div>

      <div className="flex-1 grid place-items-center pb-16">
        <div className="w-full max-w-[380px] rise">
          <form className="card p-7" style={{ borderRadius: "var(--radius-lg)" }} onSubmit={submit}>
            <span className="label-xs block mb-3">Espace équipe</span>
            <h1 className="text-[26px] font-medium leading-[1.1]" style={{ letterSpacing: "-0.03em" }}>
              Bienvenue.
            </h1>
            <p className="muted text-[14px] mt-2 mb-6 leading-relaxed">
              Connecte-toi avec l&apos;identifiant et le mot de passe qui t&apos;ont été transmis.
              Monteur : ton code d&apos;accès dans « Mot de passe » suffit.
            </p>

            <label className="block">
              <span className="label-xs block mb-2">Identifiant</span>
              <input
                className="input !h-[42px] !text-[14px]"
                value={username}
                placeholder="noa.h"
                onChange={(e) => setUsername(e.target.value)}
                autoFocus
                autoCapitalize="none"
                autoComplete="username"
              />
            </label>

            <label className="block mt-3.5">
              <span className="label-xs block mb-2">Mot de passe</span>
              <input
                className="input !h-[42px] !text-[14px]"
                type="password"
                value={password}
                placeholder="••••••••"
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
              />
            </label>

            {error && (
              <p className="text-[12.5px] mt-3 leading-snug" style={{ color: "var(--critical)" }}>
                {error}
              </p>
            )}

            <button
              className="btn btn-primary w-full mt-5 !h-[42px] !text-[14px]"
              type="submit"
              disabled={loading || (!username.trim() && !password)}
            >
              {loading ? <span className="spinner" /> : "Se connecter"}
            </button>
          </form>

          <p className="label-xs text-center mt-6">MPGate · accès réservé</p>
        </div>
      </div>
    </main>
  );
}
