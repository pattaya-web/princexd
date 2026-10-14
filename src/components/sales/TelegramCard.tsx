"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/client";
import { useSalesData } from "@/lib/sales/client";
import { Card, useToast } from "@/components/ui";

interface TelegramMe {
  configured: boolean;
  botUsername: string;
  takeoverMin: number;
  me: { linked: boolean; linkedAt: string; code: string; botUsername: string; link: string } | null;
}

/**
 * Accueil du membre : relier son Telegram au bot des rappels.
 *
 * Un clic ouvre la conversation avec le bot, le code part tout seul
 * (« /start CODE ») ; sans l'app, le code se copie et s'envoie a la main.
 * Tant que le compte n'est pas relie, on relit l'etat toutes les 8 s : le
 * membre voit « Activés » sans recharger.
 */
export function TelegramCard() {
  const toast = useToast();
  const [waiting, setWaiting] = useState(false);
  const [busy, setBusy] = useState(false);
  const { data, reload } = useSalesData<TelegramMe>(`/api/sales/telegram${waiting ? "?poll=1" : ""}`, { every: waiting ? 8_000 : 0 });

  useEffect(() => {
    if (data?.me?.linked && waiting) {
      setWaiting(false);
      toast("Rappels Telegram activés.");
    }
  }, [data?.me?.linked, waiting, toast]);

  if (!data || !data.configured || !data.me) return null;
  const me = data.me;

  const act = async (action: "test" | "unlink") => {
    setBusy(true);
    try {
      await api("/api/sales/telegram", { method: "POST", body: JSON.stringify({ action }) });
      toast(action === "test" ? "Message de test envoyé sur Telegram." : "Rappels Telegram désactivés.");
      void reload(true);
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card
      title="Mes rappels Telegram"
      subtitle={
        me.linked
          ? "Un rappel toutes les heures pendant tes horaires, un avertissement quand une conversation dort, un message si un lead t'est repris."
          : `Active-les : rappel chaque heure, avertissement avant qu'une conversation puisse t'être reprise (${data.takeoverMin || 60} min sans action).`
      }
    >
      {me.linked ? (
        <div className="flex items-center gap-2 flex-wrap text-[13px]">
          <span className="inline-flex items-center gap-1.5 font-medium" style={{ color: "var(--good)" }}>
            ✅ Activés
          </span>
          <button className="btn btn-sm" disabled={busy} onClick={() => void act("test")}>
            M&apos;envoyer un test
          </button>
          <button className="btn btn-sm btn-ghost" disabled={busy} onClick={() => void act("unlink")}>
            Désactiver
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-2.5">
          <div className="flex items-center gap-2 flex-wrap">
            {me.link ? (
              <a className="btn btn-sm btn-primary" href={me.link} target="_blank" rel="noopener noreferrer" onClick={() => setWaiting(true)}>
                Activer mes rappels Telegram ↗
              </a>
            ) : (
              <span className="dim text-[12.5px]">Le bot n&apos;a pas encore de nom : demande à l&apos;admin de réenregistrer le jeton.</span>
            )}
            {waiting && <span className="dim text-[12px]">En attente de ton message au bot…</span>}
          </div>
          <div className="dim text-[12px] leading-relaxed">
            Le bouton ouvre Telegram sur <span className="mono">@{me.botUsername || "le bot"}</span> et envoie ton code. Si rien ne se passe, écris-lui
            simplement ce code : <span className="mono font-semibold" style={{ color: "var(--text)" }}>{me.code}</span>
          </div>
        </div>
      )}
    </Card>
  );
}
