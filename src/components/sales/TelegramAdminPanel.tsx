"use client";

import { useState } from "react";
import { api } from "@/lib/client";
import { fmtDateTime } from "@/lib/format";
import { useSalesData } from "@/lib/sales/client";
import { useToast } from "@/components/ui";

interface Payload {
  configured: boolean;
  botUsername: string;
  me: { linked: boolean; code: string; link: string } | null;
  lastReminderAt?: string;
  lastError?: string;
  members?: { id: string; name: string; role: string; roles: string[]; linked: boolean; linkedAt: string; code: string; link: string }[];
}

/**
 * Réglages → Rappels Telegram : qui est relié, envoyer un test, lancer le
 * rappel tout de suite. Le propriétaire relie son propre compte d'équipe
 * (salesOwnerMemberId) pour recevoir le récap de l'équipe.
 */
export function TelegramAdminPanel({ configured }: { configured: boolean }) {
  const toast = useToast();
  const [busy, setBusy] = useState("");
  const { data, reload } = useSalesData<Payload>(configured ? "/api/sales/telegram?poll=1" : null, { every: 15_000 });
  if (!configured || !data) return null;

  const post = async (action: string, memberId?: string, ok?: string) => {
    setBusy(`${action}:${memberId ?? ""}`);
    try {
      const r = await api<{ sent?: number; skipped?: string }>("/api/sales/telegram", { method: "POST", body: JSON.stringify({ action, memberId }) });
      toast(ok ?? (action === "remind-now" ? `Rappel envoyé à ${r.sent ?? 0} personne${(r.sent ?? 0) > 1 ? "s" : ""}.` : "Fait."));
      void reload(true);
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setBusy("");
    }
  };

  const members = data.members ?? [];
  const linked = members.filter((m) => m.linked).length;

  return (
    <div className="flex flex-col gap-2.5 pt-2" style={{ borderTop: "1px solid var(--border)" }}>
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <span className="text-[12.5px]">
          <span className="font-medium">{linked}</span> <span className="dim">compte{linked > 1 ? "s" : ""} relié{linked > 1 ? "s" : ""} sur {members.length}</span>
          {data.lastReminderAt && <span className="dim"> · dernier rappel {fmtDateTime(data.lastReminderAt)}</span>}
        </span>
        <button className="btn btn-sm" disabled={busy !== "" || linked === 0} onClick={() => void post("remind-now")} title="Envoie le rappel à tous les comptes reliés, maintenant, sans attendre l'heure">
          Envoyer le rappel maintenant
        </button>
      </div>
      {data.me && !data.me.linked && data.me.link && (
        <p className="text-[12.5px] dim">
          Ton propre compte n&apos;est pas relié :{" "}
          <a className="link" href={data.me.link} target="_blank" rel="noopener noreferrer">
            activer le récap équipe sur mon Telegram ↗
          </a>{" "}
          (code <span className="mono">{data.me.code}</span>).
        </p>
      )}
      <ul className="flex flex-col gap-1">
        {members.map((m) => (
          <li key={m.id} className="flex items-center gap-2 flex-wrap text-[12.5px]">
            <span className="font-medium min-w-[120px]">{m.name}</span>
            <span className="dim">{m.roles.length ? m.roles.join(" + ") : m.role}</span>
            {m.linked ? (
              <>
                <span style={{ color: "var(--good)" }}>✅ relié{m.linkedAt ? ` le ${fmtDateTime(m.linkedAt)}` : ""}</span>
                <button className="btn btn-sm btn-ghost !h-[26px] !text-[11.5px]" disabled={busy !== ""} onClick={() => void post("test", m.id, `Test envoyé à ${m.name}.`)}>
                  Test
                </button>
                <button className="btn btn-sm btn-ghost !h-[26px] !text-[11.5px]" disabled={busy !== ""} onClick={() => void post("unlink", m.id, `${m.name} détaché.`)}>
                  Détacher
                </button>
              </>
            ) : (
              <span className="dim">
                pas relié · code <span className="mono">{m.code}</span>
                {m.link && (
                  <>
                    {" "}
                    · <a className="link" href={m.link} target="_blank" rel="noopener noreferrer">lien</a>
                  </>
                )}
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
