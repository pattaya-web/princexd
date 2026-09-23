"use client";

import { hasRole, sessionHas } from "@/lib/sales/roles";
import { useMemo, useState } from "react";
import { api } from "@/lib/client";
import { label } from "@/lib/format";
import { APPOINTMENT_SOURCES } from "@/lib/sales/constants";
import { Field, InfoNote, Modal, PageHeader, Toggle, useToast } from "@/components/ui";
import { AppointmentsBoard } from "@/components/sales/AppointmentsBoard";
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
  const [importing, setImporting] = useState(false);
  const [running, setRunning] = useState(false);
  const [setterId, setSetterId] = useState("");
  const [closerId, setCloserId] = useState("");
  const [source, setSource] = useState<AppointmentSource>("inbound");
  const [scope, setScope] = useState<"upcoming" | "past">("upcoming");
  const [maxCalls, setMaxCalls] = useState("25");
  const [auto, setAuto] = useState(false);
  const [autoSetter, setAutoSetter] = useState("");

  const setters = useMemo(() => members.filter((m) => hasRole(m, "setter")), [members]);
  const closers = useMemo(() => members.filter((m) => hasRole(m, "closer")), [members]);

  /** Etat de la synchro automatique, lu a l'ouverture de la fenetre. */
  const openImport = async () => {
    setImporting(true);
    try {
      const s = await api<{ enabled: boolean; setterId: string }>("/api/sales/iclosed/sync");
      setAuto(s.enabled);
      setAutoSetter(s.setterId);
    } catch {
      // Reglages illisibles : on laisse les valeurs par defaut.
    }
  };

  const saveAuto = async (enabled: boolean, setter: string) => {
    setAuto(enabled);
    setAutoSetter(setter);
    try {
      await api("/api/settings", {
        method: "PATCH",
        body: JSON.stringify({ salesAutoImport: enabled, salesDefaultSetterId: setter }),
      });
      toast(
        enabled && setter
          ? "Synchronisation automatique activée."
          : enabled
            ? "Choisis le setter par défaut pour activer la synchro."
            : "Synchronisation automatique désactivée.",
      );
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
        title="Rendez-vous"
        actions={
          <>
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

      <AppointmentsBoard
        session={session}
        members={members}
        period={period}
        onPeriodChange={setPeriod}
        onChanged={bump}
        refreshKey={version}
      />

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
            iClosed connaît le booking mais pas le setter qui a amené le prospect. Choisis à qui attribuer ce
            lot — sans attribution, les classements et les commissions seraient faux. Un rendez-vous déjà
            importé est ignoré.
          </InfoNote>

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
                <div className="text-[12.5px] font-semibold">Synchroniser automatiquement</div>
                <div className="dim text-[11.5px] mt-0.5 leading-snug">
                  Les nouveaux rendez-vous à venir arrivent seuls à l&apos;ouverture de l&apos;espace, au plus
                  une fois toutes les 10 minutes.
                </div>
              </div>
              <Toggle checked={auto} onChange={(v) => void saveAuto(v, autoSetter)} />
            </div>

            {auto && (
              <div className="mt-2.5">
                <Field label="Setter attribué aux rendez-vous synchronisés">
                  <select
                    className="select"
                    value={autoSetter}
                    onChange={(e) => void saveAuto(true, e.target.value)}
                  >
                    <option value="">— Choisir (obligatoire) —</option>
                    {setters.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
            )}
          </div>

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
