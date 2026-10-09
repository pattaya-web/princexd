"use client";

import { useState } from "react";
import { useMb } from "@/components/mediabuying/context";
import { ConfirmModal } from "@/components/mediabuying/bits";
import { Card, ErrorNote, Field, InfoNote, Modal, PageHeader, useToast } from "@/components/ui";
import { api } from "@/lib/client";
import { fmtDateTime } from "@/lib/format";
import type { ConnectionCheck } from "@/lib/mediabuying/provider";
import type { PublicConnection } from "@/lib/mediabuying/types";

const EMPTY = { name: "", businessManagerId: "", adAccountId: "", accessToken: "" };

/**
 * Comptes Meta : ajout (test puis connexion), re-test, remplacement du
 * jeton, deconnexion, suppression. Le jeton n'est jamais relu : seule sa
 * fin (« …a1b2 ») est montree.
 */
export default function ConnectionsPage() {
  const mb = useMb();
  const toast = useToast();
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [check, setCheck] = useState<(ConnectionCheck & { provider: "mock" | "meta" }) | null>(null);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [tokenFor, setTokenFor] = useState<PublicConnection | null>(null);
  const [newToken, setNewToken] = useState("");
  const [confirm, setConfirm] = useState<{ title: string; body: string; danger?: boolean; run: () => Promise<void> } | null>(null);
  const [busy, setBusy] = useState("");

  const test = async () => {
    setTesting(true);
    setCheck(null);
    try {
      setCheck(await api("/api/mediabuying/connections/test", { method: "POST", body: JSON.stringify(form), timeoutMs: 60_000 }));
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setTesting(false);
    }
  };

  const connect = async () => {
    setSaving(true);
    try {
      const c = await api<PublicConnection>("/api/mediabuying/connections", { method: "POST", body: JSON.stringify(form), timeoutMs: 60_000 });
      toast(`Compte « ${c.name} » connecté.`);
      setAdding(false);
      setForm(EMPTY);
      setCheck(null);
      await mb.reloadConnections();
      mb.setConnectionId(c.id);
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setSaving(false);
    }
  };

  const retest = async (c: PublicConnection) => {
    setBusy(c.id);
    try {
      const r = await api<ConnectionCheck>(`/api/mediabuying/connections/${c.id}/test`, { method: "POST", timeoutMs: 60_000 });
      toast(r.ok ? `Connexion OK : ${r.account?.name ?? c.name}` : r.error, r.ok ? "ok" : "err");
      await mb.reloadConnections();
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setBusy("");
    }
  };

  return (
    <>
      <PageHeader
        title="Meta connections"
        subtitle="Un compte par Business Manager / compte publicitaire. Le jeton est chiffré côté serveur et jamais renvoyé au navigateur."
        actions={
          <button className="btn btn-primary" onClick={() => setAdding(true)}>
            + Ajouter un compte Meta
          </button>
        }
      />
      {!mb.connections.length && (
        <div className="mb-4">
          <InfoNote>
            Pas encore de compte. Sans Access Token, le compte est <strong>simulé</strong> : campagnes, ads, stats et leads réalistes pour tester tout le cockpit. Quand tu auras le jeton, remplace-le sur ce même compte ou ajoutes-en un vrai.
          </InfoNote>
        </div>
      )}
      <div className="grid md:grid-cols-2 gap-3">
        {mb.connections.map((c) => (
          <Card key={c.id} title={c.name} subtitle={c.accountName || c.adAccountId || "—"}>
            <div className="grid grid-cols-[120px_1fr] gap-x-3 gap-y-1.5 text-[12.5px]">
              <span className="label-xs">Statut</span>
              <span className="flex items-center gap-1.5">
                <span className="inline-block w-2 h-2 rounded-full" style={{ background: c.status === "connected" ? "var(--good)" : c.status === "error" ? "var(--critical)" : "var(--text-3)" }} />
                {c.status === "connected" ? "Connecté" : c.status === "error" ? "Erreur" : "Déconnecté"}
                {c.provider === "mock" && <span className="badge !text-[10px] !py-0">simulé</span>}
              </span>
              <span className="label-xs">Business Manager</span>
              <span className="mono num">{c.businessManagerId || "—"}</span>
              <span className="label-xs">Ad Account</span>
              <span className="mono num">{c.adAccountId || "—"}</span>
              <span className="label-xs">Access Token</span>
              <span className="mono">{c.tokenHint ? `••••••••${c.tokenHint}` : "aucun (mode simulé)"}</span>
              {c.tokenExpiresAt && (
                <>
                  <span className="label-xs">Expire</span>
                  <span className="num" style={{ color: Date.parse(c.tokenExpiresAt) < Date.now() ? "var(--critical)" : Date.parse(c.tokenExpiresAt) - Date.now() < 7 * 86_400_000 ? "var(--warning)" : undefined }}>
                    {fmtDateTime(c.tokenExpiresAt)}
                  </span>
                </>
              )}
              <span className="label-xs">Devise / fuseau</span>
              <span>
                {c.currency} · {c.timezone}
              </span>
              <span className="label-xs">Permissions</span>
              <span className="flex flex-wrap gap-1">
                {c.permissions.map((p) => (
                  <span key={p} className="badge badge-good !text-[10px] !py-0">
                    {p}
                  </span>
                ))}
                {c.missingPermissions.map((p) => (
                  <span key={p} className="badge badge-danger !text-[10px] !py-0" title="Permission manquante">
                    {p} manquante
                  </span>
                ))}
              </span>
              <span className="label-xs">Dernière synchro</span>
              <span className="num">{c.lastSyncAt ? fmtDateTime(c.lastSyncAt) : "jamais"}</span>
            </div>
            {c.lastError && <div className="mt-3"><ErrorNote>{c.lastError}</ErrorNote></div>}
            <div className="flex flex-wrap gap-1.5 mt-4">
              <button className="btn btn-sm" onClick={() => void retest(c)} disabled={busy === c.id}>
                {busy === c.id ? <span className="spinner" /> : "Tester la connexion"}
              </button>
              <button className="btn btn-sm" onClick={() => { setTokenFor(c); setNewToken(""); }}>
                {c.tokenHint ? "Remplacer le jeton" : "Ajouter un Access Token"}
              </button>
              {c.tokenHint && (
                <button
                  className="btn btn-sm"
                  onClick={() =>
                    setConfirm({
                      title: `Déconnecter « ${c.name} » ?`,
                      body: "Le jeton est effacé du serveur. Les phases, notes et le journal restent ; la synchro s'arrête.",
                      danger: true,
                      run: async () => {
                        await api(`/api/mediabuying/connections/${c.id}/disconnect`, { method: "POST" });
                        toast("Compte déconnecté.");
                        await mb.reloadConnections();
                      },
                    })
                  }
                >
                  Déconnecter
                </button>
              )}
              <button
                className="btn btn-sm btn-danger ml-auto"
                onClick={() =>
                  setConfirm({
                    title: `Supprimer « ${c.name} » ?`,
                    body: "Le compte, ses données synchronisées, ses réglages et ses brouillons sont supprimés de l'outil. Rien n'est touché chez Meta.",
                    danger: true,
                    run: async () => {
                      await api(`/api/mediabuying/connections/${c.id}`, { method: "DELETE" });
                      toast("Compte supprimé.");
                      await mb.reloadConnections();
                    },
                  })
                }
              >
                Supprimer
              </button>
            </div>
          </Card>
        ))}
      </div>

      <Modal
        open={adding}
        onClose={() => setAdding(false)}
        title="Ajouter un compte Meta"
        footer={
          <>
            <button className="btn" onClick={() => setAdding(false)}>Annuler</button>
            <button className="btn" onClick={() => void test()} disabled={testing || !form.name.trim()}>
              {testing ? <span className="spinner" /> : "Tester la connexion"}
            </button>
            <button className="btn btn-primary" onClick={() => void connect()} disabled={saving || !check?.ok}>
              {saving ? <span className="spinner" /> : "Connecter"}
            </button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <Field label="Nom interne">
            <input className="input" value={form.name} placeholder="MvdyPrince France" onChange={(e) => setForm({ ...form, name: e.target.value })} autoFocus />
          </Field>
          <div className="grid sm:grid-cols-2 gap-3">
            <Field label="Business Manager ID">
              <input className="input num" value={form.businessManagerId} placeholder="123456789" onChange={(e) => setForm({ ...form, businessManagerId: e.target.value })} />
            </Field>
            <Field label="Ad Account ID">
              <input className="input num" value={form.adAccountId} placeholder="act_123456789" onChange={(e) => setForm({ ...form, adAccountId: e.target.value })} />
            </Field>
          </div>
          <Field label="Access Token" hint="Facultatif pour l'instant : sans jeton, le compte est simulé (données de démonstration). Le jeton n'est jamais affiché ni renvoyé au navigateur.">
            <input className="input mono" type="password" value={form.accessToken} placeholder="EAAB…" onChange={(e) => setForm({ ...form, accessToken: e.target.value })} autoComplete="off" />
          </Field>
          {check && (
            <div className="card-flat px-3 py-2.5 text-[12.5px]">
              {check.ok ? (
                <>
                  <div className="font-semibold" style={{ color: "var(--good)" }}>
                    ✓ Connexion OK {check.provider === "mock" ? "(mode simulé)" : ""}
                  </div>
                  <div className="dim">
                    {check.account?.name} · {check.account?.currency} · {check.account?.timezone}
                  </div>
                  <div className="dim">Permissions : {check.permissions.join(", ") || "—"}</div>
                </>
              ) : (
                <>
                  <div className="font-semibold" style={{ color: "var(--critical)" }}>
                    ✗ {check.error}
                  </div>
                  {check.missingPermissions.length > 0 && <div className="dim">Permissions manquantes : {check.missingPermissions.join(", ")}</div>}
                </>
              )}
            </div>
          )}
        </div>
      </Modal>

      <Modal
        open={tokenFor !== null}
        onClose={() => setTokenFor(null)}
        title={tokenFor ? `Access Token · ${tokenFor.name}` : ""}
        footer={
          <>
            <button className="btn" onClick={() => setTokenFor(null)}>Annuler</button>
            <button
              className="btn btn-primary"
              disabled={!newToken.trim() || saving}
              onClick={async () => {
                if (!tokenFor) return;
                setSaving(true);
                try {
                  await api(`/api/mediabuying/connections/${tokenFor.id}`, { method: "PATCH", body: JSON.stringify({ accessToken: newToken.trim() }) });
                  const r = await api<ConnectionCheck>(`/api/mediabuying/connections/${tokenFor.id}/test`, { method: "POST", timeoutMs: 60_000 });
                  toast(r.ok ? "Jeton enregistré, connexion OK. Lance une synchronisation." : `Jeton enregistré mais : ${r.error}`, r.ok ? "ok" : "err");
                  setTokenFor(null);
                  await mb.reloadConnections();
                } catch (e) {
                  toast((e as Error).message, "err");
                } finally {
                  setSaving(false);
                }
              }}
            >
              Enregistrer
            </button>
          </>
        }
      >
        <Field label="Nouveau jeton" hint="Stocké chiffré (AES-256-GCM). Le compte passe en mode réel dès qu'un jeton est présent.">
          <input className="input mono" type="password" value={newToken} onChange={(e) => setNewToken(e.target.value)} autoComplete="off" autoFocus />
        </Field>
      </Modal>

      <ConfirmModal
        open={confirm !== null}
        title={confirm?.title ?? ""}
        danger={confirm?.danger}
        onClose={() => setConfirm(null)}
        onConfirm={async () => {
          if (!confirm) return;
          try {
            await confirm.run();
          } catch (e) {
            toast((e as Error).message, "err");
          } finally {
            setConfirm(null);
          }
        }}
      >
        {confirm?.body}
      </ConfirmModal>
    </>
  );
}
