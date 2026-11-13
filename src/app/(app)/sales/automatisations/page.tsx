"use client";

/**
 * Automatisations — reglages du Sales OS (admin seulement).
 *
 * Qui est Head of Setting, comment les leads sont repartis, quelles regles
 * creent des taches et a quelle priorite, la cadence des no-shows, la
 * bibliotheque d'objections, les taux de commission du Head. Tout est
 * enregistre cote serveur et applique au prochain passage du moteur
 * (immediat apres l'enregistrement).
 */
import { useEffect, useState } from "react";
import { api } from "@/lib/client";
import { useSalesData } from "@/lib/sales/client";
import { useSales } from "@/components/sales/context";
import { Card, ErrorNote, Field, PageHeader, Spinner, useToast } from "@/components/ui";
import type { CommissionRule, ObjectionDef, SalesOpsSettings } from "@/lib/types";

interface Payload {
  settings: SalesOpsSettings;
  defaults: SalesOpsSettings;
  kinds: { key: keyof SalesOpsSettings["rules"]; label: string; hint: string }[];
  members: { id: string; name: string; status: string; roles: string[]; salesHead: boolean; receivesLeads: boolean }[];
  defaultOwnerId: string;
  rules: CommissionRule[];
  engine: { lastRunAt: string; lastError: string; runs: number; failures: number; openTasks: number; totalTasks: number };
  currency: string;
}

export default function AutomationsPage() {
  const toast = useToast();
  const { version, bump, reloadMembers } = useSales();
  const { data, error, reload } = useSalesData<Payload>(`/api/sales/ops/settings?v=${version}`);
  const [s, setS] = useState<SalesOpsSettings | null>(null);
  const [busy, setBusy] = useState(false);
  const [com, setCom] = useState({ memberId: "", settingPct: "7.5", managerPct: "5", effectiveFrom: new Date().toISOString().slice(0, 10), effectiveTo: "" });

  useEffect(() => {
    if (data) setS(structuredClone(data.settings));
  }, [data]);
  useEffect(() => {
    if (data && !com.memberId) {
      const head = data.members.find((m) => m.salesHead);
      if (head) setCom((c) => ({ ...c, memberId: head.id }));
    }
  }, [data, com.memberId]);

  const put = async (body: Record<string, unknown>, ok: string) => {
    setBusy(true);
    try {
      await api("/api/sales/ops/settings", { method: "PUT", body: JSON.stringify(body) });
      toast(ok);
      bump();
      reloadMembers();
      void reload();
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setBusy(false);
    }
  };

  if (error) return <ErrorNote>{error}</ErrorNote>;
  if (!data || !s) return <Spinner label="Chargement des réglages…" />;
  const active = data.members.filter((m) => m.status !== "inactif");
  const setObj = (i: number, patch: Partial<ObjectionDef>) => setS({ ...s, objections: s.objections.map((o, j) => (j === i ? { ...o, ...patch } : o)) });
  const rulesOf = (memberId: string) => data.rules.filter((r) => r.memberId === memberId);

  return (
    <>
      <PageHeader title="Automatisations" subtitle="Le moteur recalcule la file de tâches toutes les 2 minutes et à chaque ouverture du cockpit. Rien n'est envoyé aux prospects : ce sont des tâches internes." />

      <div className="space-y-4">
        <Card title="Équipe" subtitle="Le Head of Setting voit tout le pipeline coaching et reçoit les nouveaux leads. Il ne touche ni aux encaissements, ni aux commissions, ni à ces réglages.">
          <table className="table w-full text-[13px]">
            <thead>
              <tr>
                <th className="text-left">Membre</th>
                <th className="text-left">Rôles</th>
                <th>Head of Setting</th>
                <th>Reçoit des leads (tour de rôle)</th>
              </tr>
            </thead>
            <tbody>
              {active.map((m) => (
                <tr key={m.id}>
                  <td>{m.name}</td>
                  <td className="muted">{m.roles.join(" + ") || "—"}</td>
                  <td className="text-center">
                    <input type="checkbox" checked={m.salesHead} disabled={busy} onChange={(e) => void put({ member: { id: m.id, salesHead: e.target.checked } }, e.target.checked ? `${m.name} est Head of Setting.` : `${m.name} n'est plus Head of Setting.`)} aria-label={`${m.name} Head of Setting`} />
                  </td>
                  <td className="text-center">
                    <input type="checkbox" checked={m.receivesLeads} disabled={busy} onChange={(e) => void put({ member: { id: m.id, receivesLeads: e.target.checked } }, "Répartition mise à jour.")} aria-label={`${m.name} reçoit des leads`} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="dim text-[12px] mt-2">Un compte Head of Setting se crée dans Équipe (rôle setter, identifiant + mot de passe), puis se coche ici.</p>
        </Card>

        <Card title="Attribution des leads">
          <div className="grid sm:grid-cols-3 gap-3">
            <Field label="Responsable par défaut" hint="Vide = le premier Head of Setting actif.">
              <select className="select" value={s.defaultOwnerId} onChange={(e) => setS({ ...s, defaultOwnerId: e.target.value })}>
                <option value="">Automatique ({active.find((m) => m.id === data.defaultOwnerId)?.name ?? "personne"})</option>
                {active.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Répartition" hint="Tour de rôle : au membre qui suit le moins de leads actifs.">
              <select className="select" value={s.assignment} onChange={(e) => setS({ ...s, assignment: e.target.value as SalesOpsSettings["assignment"] })}>
                <option value="single">Tout au responsable par défaut</option>
                <option value="round-robin">Tour de rôle</option>
              </select>
            </Field>
            <Field label="Mise en route" hint="Les leads arrivés avant cette date ne créent pas de premier contact : ils sont dans Nurturing → anciens prospects.">
              <input type="date" className="input" value={s.startedOn} onChange={(e) => setS({ ...s, startedOn: e.target.value })} />
            </Field>
          </div>
          <label className="flex items-center gap-2 text-[13px] mt-3">
            <input type="checkbox" checked={s.headSeesRealAmounts} onChange={(e) => setS({ ...s, headSeesRealAmounts: e.target.checked })} />
            Le Head of Setting voit les vrais montants des ventes (décoché : comme un setter, le montant que tu lui annonces). Attention : sa commission management (5 % du vrai cash) laisse deviner le CA total.
          </label>
        </Card>

        <Card title="Règles de tâches" subtitle="Désactiver une règle ferme ses tâches ouvertes au prochain passage. La priorité monte d'elle-même quand une tâche arrive à échéance ou prend du retard.">
          <table className="table w-full text-[13px]">
            <thead>
              <tr>
                <th className="text-left">Règle</th>
                <th>Active</th>
                <th>Priorité</th>
              </tr>
            </thead>
            <tbody>
              {data.kinds.map((k) => (
                <tr key={k.key}>
                  <td>
                    <div className="font-medium">{k.label}</div>
                    <div className="dim text-[11.5px]">{k.hint}</div>
                  </td>
                  <td className="text-center">
                    <input type="checkbox" checked={s.rules[k.key]?.enabled !== false} onChange={(e) => setS({ ...s, rules: { ...s.rules, [k.key]: { ...s.rules[k.key], enabled: e.target.checked } } })} aria-label={`Activer ${k.label}`} />
                  </td>
                  <td className="text-center">
                    <select className="select select-xs" value={s.rules[k.key]?.priority ?? 1} onChange={(e) => setS({ ...s, rules: { ...s.rules, [k.key]: { ...s.rules[k.key], priority: Number(e.target.value) as 0 | 1 | 2 | 3 } } })} aria-label={`Priorité ${k.label}`}>
                      <option value={0}>P0 · urgence</option>
                      <option value={1}>P1 · aujourd'hui</option>
                      <option value={2}>P2 · prochainement</option>
                      <option value={3}>P3 · nurturing</option>
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="grid sm:grid-cols-4 gap-3 mt-3">
            <Field label="Relance de conversation après (h)">
              <input type="number" min={1} className="input" value={s.nudgeAfterHours} onChange={(e) => setS({ ...s, nudgeAfterHours: Number(e.target.value) })} />
            </Field>
            <Field label="Cadence no-show (min)" hint="Après l'absence, puis après chaque tentative. Ex. 15, 1440, 4320.">
              <input className="input" value={s.noShowCadenceMin.join(", ")} onChange={(e) => setS({ ...s, noShowCadenceMin: e.target.value.split(/[,;\s]+/).map(Number).filter((n) => Number.isFinite(n) && n >= 0) })} />
            </Field>
            <Field label="Anomalie : sans activité depuis (j)">
              <input type="number" min={1} className="input" value={s.staleDays} onChange={(e) => setS({ ...s, staleDays: Number(e.target.value) })} />
            </Field>
            <Field label="Fenêtre des anomalies (j)">
              <input type="number" min={7} className="input" value={s.anomalyWindowDays} onChange={(e) => setS({ ...s, anomalyWindowDays: Number(e.target.value) })} />
            </Field>
          </div>
        </Card>

        <Card title="Bibliothèque d'objections" subtitle="Proposées quand tu statues un call « en attente » : la relance part au Head of Setting avec le contexte et le conseil.">
          <div className="space-y-2">
            {s.objections.map((o, i) => (
              <div key={i} className="grid sm:grid-cols-[1.2fr_90px_110px_2fr_auto] gap-2 items-center">
                <input className="input !h-[32px]" value={o.label} placeholder="Objection" onChange={(e) => setObj(i, { label: e.target.value, key: o.key || e.target.value })} />
                <input type="number" min={0} className="input !h-[32px]" value={o.followUpDays} title="Relance proposée N jours après le call" onChange={(e) => setObj(i, { followUpDays: Number(e.target.value) })} />
                <label className="flex items-center gap-1 text-[12px]">
                  <input type="checkbox" checked={Boolean(o.askDate)} onChange={(e) => setObj(i, { askDate: e.target.checked })} /> date précise
                </label>
                <input className="input !h-[32px]" value={o.advice} placeholder="Conseil pour la relance" onChange={(e) => setObj(i, { advice: e.target.value })} />
                <button type="button" className="btn btn-sm btn-ghost" onClick={() => setS({ ...s, objections: s.objections.filter((_, j) => j !== i) })} aria-label="Supprimer">
                  ✕
                </button>
              </div>
            ))}
            <button type="button" className="btn btn-sm" onClick={() => setS({ ...s, objections: [...s.objections, { key: "", label: "", followUpDays: 2, advice: "" }] })}>
              + Objection
            </button>
          </div>
        </Card>

        <div className="flex gap-2">
          <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void put({ settings: s }, "Réglages enregistrés : la file est recalculée.")}>
            Enregistrer les réglages
          </button>
          <button type="button" className="btn" disabled={busy} onClick={() => setS(structuredClone({ ...data.defaults, defaultOwnerId: s.defaultOwnerId, startedOn: s.startedOn }))}>
            Valeurs par défaut
          </button>
        </div>

        <Card title="Commissions du Head of Setting" subtitle="Setting : % du cash encaissé sur les rendez-vous qu'il a posés. Management : % de TOUT le cash coaching encaissé (Meta Ads, VSL, réservations directes, tes closings). Chaque changement crée une règle datée : les commissions déjà acquises gardent l'ancien taux.">
          <div className="grid sm:grid-cols-5 gap-3 items-end">
            <Field label="Membre">
              <select className="select" value={com.memberId} onChange={(e) => setCom({ ...com, memberId: e.target.value })}>
                <option value="">Choisir…</option>
                {active.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Setting (%)">
              <input type="number" step="0.1" min={0} className="input" value={com.settingPct} onChange={(e) => setCom({ ...com, settingPct: e.target.value })} />
            </Field>
            <Field label="Management (%)">
              <input type="number" step="0.1" min={0} className="input" value={com.managerPct} onChange={(e) => setCom({ ...com, managerPct: e.target.value })} />
            </Field>
            <Field label="À partir du">
              <input type="date" className="input" value={com.effectiveFrom} onChange={(e) => setCom({ ...com, effectiveFrom: e.target.value })} />
            </Field>
            <Field label="Fin du contrat (optionnel)">
              <input type="date" className="input" value={com.effectiveTo} onChange={(e) => setCom({ ...com, effectiveTo: e.target.value })} />
            </Field>
          </div>
          <button
            type="button"
            className="btn btn-primary mt-3"
            disabled={busy || !com.memberId}
            onClick={() => {
              const name = active.find((m) => m.id === com.memberId)?.name ?? "";
              if (!window.confirm(`Enregistrer pour ${name} : ${com.settingPct} % setting + ${com.managerPct} % management, à partir du ${com.effectiveFrom}${com.effectiveTo ? ` jusqu'au ${com.effectiveTo}` : ""} ?`)) return;
              void put({ commission: { memberId: com.memberId, settingPct: Number(com.settingPct), managerPct: Number(com.managerPct), effectiveFrom: com.effectiveFrom, effectiveTo: com.effectiveTo } }, "Taux enregistrés.");
            }}
          >
            Enregistrer les taux
          </button>
          {com.memberId && rulesOf(com.memberId).length > 0 && (
            <ul className="mt-3 space-y-1 text-[12.5px]">
              {rulesOf(com.memberId).map((r) => (
                <li key={r.id} className="muted">
                  {r.role === "manager" ? "Management" : "Setting"} : {r.pct} % ({r.type === "pct-cash" ? "du cash" : r.type}) · du {r.effectiveFrom || "début"}
                  {r.effectiveTo ? ` au ${r.effectiveTo}` : ""}
                </li>
              ))}
            </ul>
          )}
        </Card>

        <p className="dim text-[12px]">
          Moteur : {data.engine.runs} passage(s) depuis le démarrage du serveur{data.engine.failures ? `, ${data.engine.failures} échec(s)` : ""} · {data.engine.openTasks} tâches ouvertes sur {data.engine.totalTasks}
          {data.engine.lastError ? ` · dernière erreur : ${data.engine.lastError}` : ""}
        </p>
      </div>
    </>
  );
}
