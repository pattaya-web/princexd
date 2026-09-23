"use client";

import { useState } from "react";
import { api } from "@/lib/client";
import { useSalesData } from "@/lib/sales/client";
import { Card, Empty, ErrorNote, Spinner, useToast } from "@/components/ui";

interface Host {
  id: number;
  name: string;
  email: string;
  calls: number;
  memberId: string;
  memberName: string;
}

interface HostsPayload {
  hosts: Host[];
  examined: number;
  singleHost: boolean;
  closers: { id: string; name: string; iclosedUserId: number | null }[];
}

/**
 * Correspondance entre les utilisateurs iClosed et les closers du CRM.
 *
 * C'est ce qui permet a un call importe de savoir qui le prend : iClosed
 * identifie l'hote du call, cette table dit lequel de mes closers c'est. Le
 * closer retrouve alors le rendez-vous dans son espace, avec le lien de visio
 * envoye au prospect. La correspondance est explicite et jamais deduite du
 * nom : une homonymie fausserait directement les commissions.
 */
export function IclosedMapping() {
  const toast = useToast();
  const [saving, setSaving] = useState("");
  // Chargement a la demande : la route consomme du quota iClosed, inutile de
  // la declencher a chaque ouverture de la page des comptes.
  const [enabled, setEnabled] = useState(false);

  const { data, loading, error, reload } = useSalesData<HostsPayload>(
    enabled ? "/api/sales/iclosed/hosts" : null,
  );

  const assign = async (hostId: number, memberId: string) => {
    setSaving(String(hostId));
    try {
      if (memberId) {
        await api("/api/sales/members", {
          method: "PATCH",
          body: JSON.stringify({ id: memberId, iclosedUserId: hostId }),
        });
      } else {
        // Retrait : on cherche le membre qui portait cet identifiant.
        const current = data?.hosts.find((h) => h.id === hostId)?.memberId;
        if (current) {
          await api("/api/sales/members", {
            method: "PATCH",
            body: JSON.stringify({ id: current, iclosedUserId: null }),
          });
        }
      }
      toast("Closer associé. Ses prochains calls iClosed lui seront assignés.");
      void reload();
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setSaving("");
    }
  };

  return (
    <Card
      title="iClosed — qui prend les calls"
      subtitle="Chaque call importé est assigné au closer associé, qui voit le lien de visio dans son espace."
      actions={
        <button
          className="btn btn-sm"
          onClick={() => (enabled ? void reload() : setEnabled(true))}
          disabled={loading}
        >
          {loading ? <span className="spinner" /> : enabled ? "Actualiser" : "Interroger iClosed"}
        </button>
      }
    >
      {!enabled ? (
        <Empty
          action={
            <button className="btn btn-primary" onClick={() => setEnabled(true)}>
              Interroger iClosed
            </button>
          }
        >
          Lis les calls récents pour choisir quel closer les prend.
        </Empty>
      ) : error ? (
        <ErrorNote>{error}</ErrorNote>
      ) : loading && !data ? (
        <Spinner label="Lecture des calls iClosed…" />
      ) : !data ? null : !data.hosts.length ? (
        <Empty>Aucun utilisateur iClosed trouvé sur les calls récents.</Empty>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="scroll-x">
            <table className="table">
              <thead>
                <tr>
                  <th>Compte iClosed</th>
                  <th className="text-right">Calls</th>
                  <th style={{ width: 220 }}>Closer qui les prend</th>
                </tr>
              </thead>
              <tbody>
                {data.hosts.map((h) => (
                  <tr key={h.id}>
                    <td>
                      <div className="text-[13px] font-medium">{h.name}</div>
                      <div className="dim text-[11.5px]">{h.email}</div>
                    </td>
                    <td className="text-right num">{h.calls}</td>
                    <td>
                      <select
                        className="select !h-[30px] !text-[12.5px]"
                        value={h.memberId}
                        disabled={saving === String(h.id)}
                        onChange={(e) => void assign(h.id, e.target.value)}
                      >
                        <option value="">— Personne —</option>
                        {data.closers.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/*
            Diagnostic en une phrase : tant qu'iClosed n'a qu'un compte, tous
            les calls vont au meme closer. Suffisant pour une petite equipe ;
            au-dela, il faut un siege iClosed par closer.
          */}
          {data.singleHost && (
            <p className="dim text-[12px] leading-relaxed">
              Un seul compte iClosed héberge tous les calls : ils iront tous au closer choisi ci-dessus. Pour
              répartir entre plusieurs closers, chacun doit avoir son propre siège iClosed.
            </p>
          )}
        </div>
      )}
    </Card>
  );
}
