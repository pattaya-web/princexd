"use client";

import { hasRole, sessionHas } from "@/lib/sales/roles";
import { useMemo, useState } from "react";
import { api } from "@/lib/client";
import { label, relative } from "@/lib/format";
import { APPOINTMENT_SOURCES } from "@/lib/sales/constants";
import { Field, InfoNote, Modal, PageHeader, Toggle, useToast } from "@/components/ui";
import { AppointmentsBoard } from "@/components/sales/AppointmentsBoard";
import { CrmBoard } from "@/components/sales/CrmBoard";
import { AppointmentModal } from "@/components/sales/AppointmentModal";
import { useSales } from "@/components/sales/context";
import type { AppointmentSource } from "@/lib/types";

/**
 * Tous les rendez-vous, filtrables.
 *
 * Le cloisonnement vient du serveur : un setter arrive ici et n'y trouve que
 * les siens, sans que la page ait a s'en occuper.
 */
export default function AppointmentsPage() {
  const { session, members, period, setPeriod, version, bump } = useSales();
  const toast = useToast();

  const [adding, setAdding] = useState(false);
  /* L'ancien tableau des rendez-vous reste disponible, replie. */
  const [table, setTable] = useState(false);
  const [importing, setImporting] = useState(false);
  const [running, setRunning] = useState(false);
  const [setterId, setSetterId] = useState("");
  const [closerId, setCloserId] = useState("");
  const [source, setSource] = useState<AppointmentSource>("inbound");
  const [scope, setScope] = useState<"upcoming" | "past">("upcoming");
  const [maxCalls, setMaxCalls] = useState("25");
  const [auto, setAuto] = useState(false);
  const [autoSetter, setAutoSetter] = useState("");
  const [autoCloser, setAutoCloser] = useState("");

  const setters = useMemo(() => members.filter((m) => hasRole(m, "setter")), [members]);
  const closers = useMemo(() => members.filter((m) => hasRole(m, "closer")), [members]);

  /** Etat de la synchro automatique, lu a l'ouverture de la fenetre. */
  const [syncInfo, setSyncInfo] = useState<{ hasKey: boolean; lastSyncAt: string } | null>(null);
  const openImport = async () => {
    setImporting(true);
    try {
      const s = await api<{ enabled: boolean; hasKey: boolean; lastSyncAt: string; setterId: string; closerId: string }>("/api/sales/iclosed/sync");
      setAuto(s.enabled);
      setSyncInfo({ hasKey: s.hasKey, lastSyncAt: s.lastSyncAt });
      setAutoSetter(s.setterId);
      setAutoCloser(s.closerId ?? "");
    } catch {
      // Reglages illisibles : on laisse les valeurs par defaut.
    }
  };

  const saveAuto = async (enabled: boolean, setter: string, closer = autoCloser) => {
    setAuto(enabled);
    setAutoSetter(setter);
    setAutoCloser(closer);
    try {
      await api("/api/settings", {
        method: "PATCH",
        body: JSON.stringify({ salesAutoImport: enabled, salesAutoImportOff: !enabled, salesDefaultSetterId: setter, salesDefaultCloserId: closer }),
      });
      toast(enabled ? "Synchronisation automatique active." : "Synchronisation automatique en pause.");
    } catch (e) {
      toast((e as Error).message, "err");
    }
  };

  const runImport = async () => {
    if (!setterId) return toast("Choisis le setter à qui attribuer ces rendez-vous.", "err");
    setRunning(true);
    try {
      const res = await api<{
        examined: number;
        created: number;
        updated: number;
        salesCreated: number;
        salesWithoutAmount: string[];
        unmappedHosts: string[];
      }>(
        "/api/sales/iclosed/import",
        { method: "POST", body: JSON.stringify({ setterId, closerId, source, scope, maxCalls: Number(maxCalls) || 25 }) },
      );
      toast(
        `${res.created} importés, ${res.updated} mis à jour, ${res.salesCreated} vente(s) créée(s).`,
      );
      // Les deux angles morts de l'import meritent leur propre alerte : sans
      // eux l'utilisateur croit que tout est remonte.
      if (res.unmappedHosts.length) {
        toast(
          `Aucun closer CRM associé à : ${res.unmappedHosts.join(", ")}. Fais la correspondance dans Comptes.`,
          "err",
        );
      }
      if (res.salesWithoutAmount.length) {
        toast(
          `${res.salesWithoutAmount.length} vente(s) annoncée(s) par iClosed sans montant — à saisir à la main.`,
          "err",
        );
      }
      setImporting(false);
      bump();
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setRunning(false);
    }
  };

  return (
    <>
      <PageHeader
        title="CRM"
        subtitle="Recherche un lead, ou ouvre une vue : « À traiter » te montre ce qui demande une action maintenant."
        actions={
          <>
            <button className="btn" onClick={() => setTable((v) => !v)} title="Liste détaillée des rendez-vous par période">
              {table ? "Masquer le tableau" : "Vue tableau"}
            </button>
            {session.isAdmin && (
              <button className="btn" onClick={() => void openImport()}>
                Importer iClosed
              </button>
            )}
            {(session.isAdmin || sessionHas(session, "setter")) && (
              <button className="btn btn-primary" onClick={() => setAdding(true)}>
                + Rendez-vous
              </button>
            )}
          </>
        }
      />

      <CrmBoard session={session} members={members} refreshKey={version} onChanged={bump} />

      {table && (
        <div className="mt-6">
          <AppointmentsBoard
            session={session}
            members={members}
            period={period}
            onPeriodChange={setPeriod}
            onChanged={bump}
            refreshKey={version}
          />
        </div>
      )}

      <AppointmentModal
        open={adding}
        onClose={() => setAdding(false)}
        onSaved={bump}
        session={session}
        members={members}
      />

      <Modal
        open={importing}
        onClose={() => setImporting(false)}
        title="Importer depuis iClosed"
        footer={
          <>
            <button className="btn" onClick={() => setImporting(false)}>
              Annuler
            </button>
            <button className="btn btn-primary" onClick={() => void runImport()} disabled={running}>
              {running ? <span className="spinner" /> : "Importer"}
            </button>
          </>
        }
      >
        <div className="flex flex-col gap-3.5">
          <InfoNote>
            Tu n&apos;as normalement rien à faire ici : les rendez-vous iClosed arrivent seuls. Cette fenêtre sert à
            mettre en pause la synchro, à choisir qui reçoit les calls par défaut, et à importer de l&apos;historique.
          </InfoNote>

          {/* Etat, lisible en une ligne : la question « est-ce que ca marche ? » a sa reponse ici. */}
          {syncInfo && (
            <div className="text-[12.5px] flex flex-wrap gap-x-4 gap-y-1">
              <span>
                Clé iClosed :{" "}
                <strong style={{ color: syncInfo.hasKey ? "var(--emerald)" : "var(--critical)" }}>
                  {syncInfo.hasKey ? "présente" : "absente sur ce serveur"}
                </strong>
              </span>
              <span>
                Dernière vérification :{" "}
                <strong>{syncInfo.lastSyncAt ? relative(syncInfo.lastSyncAt) : "jamais"}</strong>
              </span>
            </div>
          )}

          {/*
            Synchro automatique.
            Une fois active, les nouveaux bookings arrivent seuls a l'ouverture
            de l'espace : le closer se connecte et ses calls sont deja la.
          */}
          <div
            className="rounded-lg px-3.5 py-3"
            style={{ background: "var(--surface-2)", border: "1px solid var(--border)" }}
          >
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="min-w-0">
                <div className="text-[12.5px] font-semibold">Synchronisation automatique</div>
                <div className="dim text-[11.5px] mt-0.5 leading-snug">
                  Active par défaut. Les rendez-vous iClosed arrivent seuls : à la seconde si le webhook iClosed est
                  branché, sinon dès qu&apos;une page de calls s&apos;ouvre, au plus toutes les 2 minutes. Éteindre =
                  mettre en pause.
                </div>
              </div>
              <Toggle checked={auto} onChange={(v) => void saveAuto(v, autoSetter)} />
            </div>

            {auto && (
              <div className="mt-2.5 grid sm:grid-cols-2 gap-3">
                <Field label="Setter attribué aux rendez-vous synchronisés">
                  <select
                    className="select"
                    value={autoSetter}
                    onChange={(e) => void saveAuto(true, e.target.value)}
                  >
                    <option value="">— Le premier setter actif —</option>
                    {setters.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Closer qui reçoit ces calls" hint="Ils arrivent sur son dashboard. Tu peux réattribuer chaque call ensuite.">
                  <select
                    className="select"
                    value={autoCloser}
                    onChange={(e) => void saveAuto(true, autoSetter, e.target.value)}
                  >
                    <option value="">— À répartir à la main —</option>
                    {closers.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
            )}
          </div>

          <div className="label-xs mt-1">Import manuel de l&apos;historique (optionnel)</div>
          <div className="grid sm:grid-cols-2 gap-3">
            <Field label="Attribuer au setter">
              <select className="select" value={setterId} onChange={(e) => setSetterId(e.target.value)}>
                <option value="">— Choisir —</option>
                {setters.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Closer">
              <select className="select" value={closerId} onChange={(e) => setCloserId(e.target.value)}>
                <option value="">Non assigné</option>
                {closers.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Source à enregistrer">
              <select
                className="select"
                value={source}
                onChange={(e) => setSource(e.target.value as AppointmentSource)}
              >
                {APPOINTMENT_SOURCES.map((s) => (
                  <option key={s} value={s}>
                    {label(s)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Nombre de rendez-vous à importer">
              <input
                className="input num"
                type="number"
                min={1}
                max={300}
                value={maxCalls}
                onChange={(e) => setMaxCalls(e.target.value)}
              />
            </Field>
            <Field label="Période iClosed">
              <select
                className="select"
                value={scope}
                onChange={(e) => setScope(e.target.value as "upcoming" | "past")}
              >
                <option value="upcoming">Rendez-vous à venir</option>
                <option value="past">Rendez-vous passés</option>
              </select>
            </Field>
          </div>
        </div>
      </Modal>
    </>
  );
}
