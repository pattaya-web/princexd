"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/client";
import { forgetSession } from "@/lib/sales/client";
import { Card, CopyButton, Empty, ErrorNote, Field, Modal, PageHeader, Spinner, Toggle, useToast } from "@/components/ui";
import type { StudentAccessRow } from "@/lib/formation";
import type { StudentAccessPayload } from "@/app/api/formation/access/route";

/**
 * Acces des eleves a la plateforme (admin).
 *
 * Un eleve du CRM n'entre sur /formation qu'avec un identifiant et un mot de
 * passe poses ici. Le mot de passe est hache cote serveur et jamais relu :
 * tu le transmets toi-meme a l'eleve. L'interrupteur « Accès » coupe ou
 * rouvre l'entree sans effacer ses identifiants ni sa progression.
 */

const fmtDate = (iso: string) =>
  iso ? new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "short", year: "numeric", timeZone: "Europe/Paris" }).format(new Date(iso)) : "—";

export default function StudentAccessPage() {
  const toast = useToast();
  const [data, setData] = useState<StudentAccessPayload | null>(null);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<StudentAccessRow | null>(null);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState("");
  const [lastCreds, setLastCreds] = useState<{ name: string; username: string; password: string } | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await api<StudentAccessPayload>("/api/formation/access"));
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const openEdit = (s: StudentAccessRow) => {
    setEditing(s);
    setUsername(s.username || s.suggestedUsername);
    setPassword("");
  };

  const save = async () => {
    if (!editing) return;
    setSaving(true);
    try {
      const body: Record<string, unknown> = { username: username.trim() };
      if (password) body.password = password;
      await api(`/api/formation/access/${editing.id}`, { method: "PATCH", body: JSON.stringify(body) });
      if (password) setLastCreds({ name: editing.name, username: username.trim().toLowerCase(), password });
      toast(password ? "Identifiants enregistrés. Transmets-les à l'élève." : "Identifiant enregistré.");
      setEditing(null);
      await load();
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setSaving(false);
    }
  };

  const toggleAccess = async (s: StudentAccessRow) => {
    setBusyId(s.id);
    try {
      await api(`/api/formation/access/${s.id}`, { method: "PATCH", body: JSON.stringify({ portalAccess: !s.portalAccess }) });
      toast(s.portalAccess ? `Accès de ${s.name} coupé.` : `Accès de ${s.name} ouvert.`);
      await load();
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setBusyId("");
    }
  };

  /** Ouvre la plateforme dans la peau de cet eleve (jeton d'apercu, rien n'est ecrit). */
  const viewAs = async (s: StudentAccessRow) => {
    setBusyId(s.id);
    try {
      await api("/api/sales/session/view-as", { method: "POST", body: JSON.stringify({ role: "student", studentId: s.id }) });
      forgetSession();
      window.location.href = "/formation";
    } catch (e) {
      toast((e as Error).message, "err");
      setBusyId("");
    }
  };

  const students = data?.students ?? [];
  const withAccess = students.filter((s) => s.portalAccess).length;

  return (
    <div>
      <PageHeader
        title="Accès élèves"
        subtitle="Qui peut entrer sur la plateforme de formation. Crée les identifiants de chaque élève ici, puis transmets-les lui."
        actions={
          <Link href="/eleves" className="btn btn-sm btn-ghost">
            Fiches élèves
          </Link>
        }
      />

      {error && <ErrorNote>{error}</ErrorNote>}
      {!data && !error && <Spinner label="Chargement…" />}

      {lastCreds && (
        <div className="card p-4 mb-4 flex flex-wrap items-center gap-3" style={{ borderColor: "var(--accent)" }}>
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-semibold">Identifiants de {lastCreds.name}</div>
            <div className="dim text-[12px]">Affichés une seule fois : le mot de passe n&apos;est pas conservé en clair.</div>
            <div className="mono text-[13px] mt-1.5">
              Identifiant : {lastCreds.username} · Mot de passe : {lastCreds.password}
            </div>
          </div>
          <CopyButton
            text={`Ta plateforme de formation : ${typeof window !== "undefined" ? window.location.origin : ""}/login\nIdentifiant : ${lastCreds.username}\nMot de passe : ${lastCreds.password}`}
            label="Copier le message"
          />
          <button className="btn btn-ghost btn-sm" onClick={() => setLastCreds(null)}>
            Fermer
          </button>
        </div>
      )}

      {data && !students.length && (
        <Empty action={<Link href="/eleves" className="btn btn-primary btn-sm">Ajouter un élève</Link>}>
          Aucun élève dans le CRM. Crée d&apos;abord sa fiche, puis reviens ici lui donner un accès.
        </Empty>
      )}

      {data && students.length > 0 && (
        <Card
          title="Élèves"
          subtitle={`${withAccess} accès ouvert${withAccess > 1 ? "s" : ""} sur ${students.length} élève${students.length > 1 ? "s" : ""} · ${data.publishedModules} module${data.publishedModules > 1 ? "s" : ""} publié${data.publishedModules > 1 ? "s" : ""}`}
          padded={false}
        >
          <div className="overflow-x-auto">
            <table className="table w-full text-[13px]">
              <thead>
                <tr>
                  <th className="text-left">Élève</th>
                  <th className="text-left">Contrat</th>
                  <th className="text-left">Identifiant</th>
                  <th className="text-left">Accès</th>
                  <th className="text-left">Avancement</th>
                  <th className="text-left">Dernière visite</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {students.map((s) => (
                  <tr key={s.id} className="row-hover" style={{ opacity: busyId === s.id ? 0.6 : 1 }}>
                    <td>
                      <div className="font-medium">{s.name}</div>
                      <div className="dim text-[12px]">{s.email || s.handle || "—"}</div>
                    </td>
                    <td>
                      {s.contractSigned ? (
                        <span className="badge badge-good !text-[10.5px] !py-0">Signé{s.contractAt ? ` le ${fmtDate(s.contractAt)}` : ""}</span>
                      ) : (
                        <span className="badge badge-warn !text-[10.5px] !py-0">Pas signé</span>
                      )}
                    </td>
                    <td>
                      {s.username ? (
                        <span className="mono">{s.username}</span>
                      ) : (
                        <span className="dim">—</span>
                      )}
                      <div className="dim text-[11.5px]">{s.hasPassword ? "mot de passe défini" : "pas de mot de passe"}</div>
                    </td>
                    <td>
                      <Toggle
                        checked={s.portalAccess}
                        onChange={() => void toggleAccess(s)}
                        label={s.portalAccess ? "Ouvert" : "Fermé"}
                      />
                    </td>
                    <td className="num">
                      {s.completed} / {data.publishedModules}
                    </td>
                    <td className="dim">{fmtDate(s.portalLastSeenAt)}</td>
                    <td className="text-right whitespace-nowrap">
                      <button className="btn btn-sm" onClick={() => openEdit(s)}>
                        {s.hasPassword ? "Identifiants" : "Créer l'accès"}
                      </button>
                      <button className="btn btn-sm btn-ghost ml-1" onClick={() => void viewAs(s)} title="Ouvrir la plateforme comme cet élève">
                        Voir comme
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <Modal
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={editing ? `Accès de ${editing.name}` : ""}
        footer={
          <>
            <button className="btn btn-sm btn-ghost" onClick={() => setEditing(null)} disabled={saving}>
              Annuler
            </button>
            <button
              className="btn btn-sm btn-primary"
              onClick={() => void save()}
              disabled={saving || !username.trim() || (!editing?.hasPassword && password.length < 6) || (password.length > 0 && password.length < 6)}
            >
              {saving ? "Enregistrement…" : "Enregistrer"}
            </button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <Field label="Identifiant" hint="Ce que l'élève tape sur la page de connexion. Minuscules, sans espace.">
            <input className="input" value={username} onChange={(e) => setUsername(e.target.value)} autoFocus />
          </Field>
          <Field
            label={editing?.hasPassword ? "Nouveau mot de passe" : "Mot de passe"}
            hint={editing?.hasPassword ? "Laisse vide pour garder l'actuel. 6 caractères minimum." : "6 caractères minimum. Tu le transmets toi-même à l'élève."}
          >
            <input className="input" type="text" autoComplete="off" value={password} onChange={(e) => setPassword(e.target.value)} placeholder={editing?.hasPassword ? "••••••" : ""} />
          </Field>
          {!editing?.hasPassword && (
            <div className="dim text-[12px] leading-snug">L&apos;accès s&apos;ouvre dès que le mot de passe est enregistré. Tu pourras le couper depuis la liste.</div>
          )}
        </div>
      </Modal>
    </div>
  );
}
