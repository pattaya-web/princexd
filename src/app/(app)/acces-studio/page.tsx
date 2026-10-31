"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/client";
import { forgetSession } from "@/lib/sales/client";
import { relative } from "@/lib/format";
import { Card, CopyButton, Empty, ErrorNote, Field, PageHeader, Spinner, useToast } from "@/components/ui";
import type { StudioMemberView } from "@/lib/studio-members";

/**
 * Accès Studio IA : donner le Studio seul à quelqu'un qui n'est ni élève ni
 * équipe. Identifiant + mot de passe, sa propre clé KIE (il recharge ses
 * crédits lui-même), ses créations sauvegardées et visibles par lui seul.
 * Le mot de passe n'est montré qu'une fois, dans le message à envoyer.
 */

const slug = (name: string) =>
  name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ".")
    .replace(/^\.+|\.+$/g, "");

function accessMessage(m: Pick<StudioMemberView, "name" | "username">, password: string) {
  const first = m.name.trim().split(/\s+/)[0] ?? m.name;
  const origin = typeof window !== "undefined" ? window.location.origin : "https://mvdyprince.fr";
  return [
    `Salut ${first}, voici ton accès au Studio IA :`,
    ``,
    `Lien : ${origin}/login`,
    `Identifiant : ${m.username}`,
    `Mot de passe : ${password}`,
    ``,
    `À ta première connexion :`,
    `1. Crée ton compte sur https://kie.ai`,
    `2. Recharge des crédits sur https://kie.ai/billing (20 à 30 € pour démarrer)`,
    `3. Copie ta clé dans « API Key » sur KIE et colle-la en haut du Studio`,
    ``,
    `Images, vidéos, swap vidéo, création : tout tourne sur tes crédits KIE, et tes créations sont sauvegardées dans ton Studio, toi seul les vois.`,
  ].join("\n");
}

export default function StudioAccessPage() {
  const toast = useToast();
  const [members, setMembers] = useState<StudioMemberView[] | null>(null);
  const [error, setError] = useState("");
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState("");
  /** Message prêt à envoyer, juste après une création ou un nouveau mot de passe. */
  const [sent, setSent] = useState<{ id: string; text: string } | null>(null);

  const load = useCallback(async () => {
    try {
      setMembers((await api<{ members: StudioMemberView[] }>("/api/studio-members")).members);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const create = async () => {
    setBusy("create");
    try {
      const r = await api<{ member: StudioMemberView; password: string }>("/api/studio-members", {
        method: "POST",
        body: JSON.stringify({ name, username: username || slug(name), password }),
      });
      setSent({ id: r.member.id, text: accessMessage(r.member, r.password) });
      setName("");
      setUsername("");
      setPassword("");
      toast(`Accès créé pour ${r.member.name}. Copie le message et envoie-le.`);
      await load();
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setBusy("");
    }
  };

  const patch = async (m: StudioMemberView, body: Record<string, unknown>, ok: string) => {
    setBusy(m.id);
    try {
      const r = await api<{ member: StudioMemberView; password?: string }>("/api/studio-members", {
        method: "PATCH",
        body: JSON.stringify({ id: m.id, ...body }),
      });
      if (r.password) setSent({ id: m.id, text: accessMessage(r.member, r.password) });
      toast(ok);
      await load();
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setBusy("");
    }
  };

  const remove = async (m: StudioMemberView) => {
    if (!window.confirm(`Supprimer l'accès de ${m.name} ? Il ne pourra plus se connecter.`)) return;
    setBusy(m.id);
    try {
      await api(`/api/studio-members?id=${encodeURIComponent(m.id)}`, { method: "DELETE" });
      if (sent?.id === m.id) setSent(null);
      toast("Accès supprimé.");
      await load();
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setBusy("");
    }
  };

  const viewAs = async (m: StudioMemberView) => {
    setBusy(m.id);
    try {
      await api("/api/sales/session/view-as", { method: "POST", body: JSON.stringify({ role: "studio", studioMemberId: m.id }) });
      forgetSession();
      window.location.href = "/studio";
    } catch (e) {
      toast((e as Error).message, "err");
      setBusy("");
    }
  };

  return (
    <>
      <PageHeader
        title="Accès Studio IA"
        subtitle="Le Studio seul, pour quelqu'un qui n'est ni élève ni équipe : identifiant + mot de passe, sa propre clé KIE (il recharge ses crédits lui-même), ses créations sauvegardées et visibles par lui seul. Il ne voit rien d'autre du tool."
        actions={
          <a href="/studio" className="btn">
            ← Studio IA
          </a>
        }
      />

      <div className="flex flex-col gap-4">
        <Card title="Nouvel accès">
          <form
            className="grid gap-3 sm:grid-cols-[1.2fr_1fr_1fr_auto] items-end"
            onSubmit={(e) => {
              e.preventDefault();
              void create();
            }}
          >
            <Field label="Nom">
              <input className="input" data-nodraft value={name} onChange={(e) => setName(e.target.value)} placeholder="Alexander" />
            </Field>
            <Field label="Identifiant">
              <input className="input" data-nodraft value={username} onChange={(e) => setUsername(e.target.value)} placeholder={slug(name) || "alexander"} autoComplete="off" />
            </Field>
            <Field label="Mot de passe">
              <input className="input" data-nodraft value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Vide = généré" autoComplete="new-password" />
            </Field>
            <button type="submit" className="btn btn-primary" disabled={busy === "create" || !name.trim()}>
              {busy === "create" ? "Création…" : "Créer l'accès"}
            </button>
          </form>
        </Card>

        {sent && (
          <Card
            title="Message à envoyer"
            subtitle="Le mot de passe n'est affiché qu'ici, une seule fois. Copie-le maintenant."
            actions={
              <>
                <CopyButton text={sent.text} label="Copier le message" />
                <button type="button" className="btn btn-sm btn-ghost" onClick={() => setSent(null)}>
                  Fermer
                </button>
              </>
            }
          >
            <pre className="whitespace-pre-wrap text-[13px] leading-relaxed m-0" style={{ fontFamily: "inherit" }}>
              {sent.text}
            </pre>
          </Card>
        )}

        <Card title="Membres Studio" subtitle={members ? `${members.length} accès` : undefined} padded={false}>
          {error ? (
            <div className="p-4">
              <ErrorNote>{error}</ErrorNote>
            </div>
          ) : !members ? (
            <div className="p-4">
              <Spinner label="Chargement…" />
            </div>
          ) : !members.length ? (
            <Empty>Aucun accès Studio pour l&apos;instant.</Empty>
          ) : (
            <div className="flex flex-col">
              {members.map((m) => (
                <div key={m.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 sm:px-5 py-3.5 border-b last:border-b-0" style={{ borderColor: "var(--border)" }}>
                  <div className="min-w-[180px] flex-1">
                    <div className="font-medium text-[14px] flex items-center gap-2">
                      {m.name}
                      <span className={`badge !text-[10px] ${m.active ? "badge-good" : "badge-warn"}`}>{m.active ? "Actif" : "Coupé"}</span>
                    </div>
                    <div className="dim text-[12px] mt-0.5">
                      <span className="mono">{m.username}</span>
                      {" · "}
                      {m.hasKey ? (
                        <>
                          clé KIE <span className="mono">{m.keyMask}</span>
                        </>
                      ) : (
                        "clé KIE pas encore posée"
                      )}
                      {" · "}
                      {m.creations} création{m.creations > 1 ? "s" : ""}
                      {" · "}
                      {m.lastSeenAt ? `vu ${relative(m.lastSeenAt)}` : "jamais connecté"}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <button type="button" className="btn btn-sm" disabled={busy === m.id} onClick={() => void viewAs(m)} title="Ouvrir son Studio tel qu'il le voit (ses créations, son solde)">
                      Voir son Studio
                    </button>
                    <button type="button" className="btn btn-sm btn-ghost" disabled={busy === m.id} onClick={() => void patch(m, { password: "RESET" }, "Nouveau mot de passe généré.")}>
                      Nouveau mot de passe
                    </button>
                    <button
                      type="button"
                      className="btn btn-sm btn-ghost"
                      disabled={busy === m.id}
                      onClick={() => void patch(m, { active: !m.active }, m.active ? "Accès coupé." : "Accès rouvert.")}
                    >
                      {m.active ? "Couper" : "Rouvrir"}
                    </button>
                    <button type="button" className="btn btn-sm btn-ghost" disabled={busy === m.id} onClick={() => void remove(m)} title="Supprimer l'accès">
                      ✕
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </>
  );
}
