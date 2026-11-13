"use client";

/**
 * Petits elements partages du cockpit Sales OS : pastilles, avatar, liens de
 * contact, menu de report, appel des actions. Une seule route d'actions
 * (POST /api/sales/ops), un seul format d'erreur.
 */
import { useState, type ReactNode } from "react";
import { api } from "@/lib/client";
import { fmtDate, fmtDualDateTime, fmtTime, isoToParisInput, parisToIso } from "@/lib/format";
import { useToast } from "@/components/ui";
import type { ContactLinks } from "@/lib/sales/ops/views";

export const PRIO_COLOR = ["var(--critical)", "var(--warning)", "var(--accent)", "var(--text-3)"] as const;
export const PRIO_LABEL = ["P0", "P1", "P2", "P3"] as const;
export const PRIO_HINT = ["Urgence : appel imminent, lead chaud, retard critique", "À faire aujourd'hui", "Prochainement", "Nurturing / réactivation"] as const;

export const TONE: Record<string, string> = { good: "var(--good)", warn: "var(--warning)", bad: "var(--critical)", info: "var(--accent)", muted: "var(--text-3)" };

export function opsAction<T = { ok: boolean }>(body: Record<string, unknown>) {
  return api<T>("/api/sales/ops", { method: "POST", body: JSON.stringify(body) });
}

/** Appelle une action, affiche le resultat, recharge. */
export function useOpsAction(onDone: () => void) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const run = async (body: Record<string, unknown>, ok?: string) => {
    setBusy(true);
    try {
      const r = await opsAction<{ ok: boolean; reason?: string }>(body);
      toast(ok ?? r.reason ?? "Enregistré.");
      onDone();
      return true;
    } catch (e) {
      toast((e as Error).message, "err");
      return false;
    } finally {
      setBusy(false);
    }
  };
  return { run, busy };
}

export function PrioBadge({ p }: { p: number }) {
  const c = PRIO_COLOR[p] ?? "var(--text-3)";
  return (
    <span
      className="inline-flex items-center justify-center rounded-md px-1.5 h-[20px] text-[11px] font-bold num shrink-0"
      style={{ color: c, background: `color-mix(in srgb, ${c} 14%, transparent)`, border: `1px solid color-mix(in srgb, ${c} 35%, transparent)` }}
      title={PRIO_HINT[p]}
    >
      {PRIO_LABEL[p] ?? `P${p}`}
    </span>
  );
}

export function Pill({ children, tone = "muted", title }: { children: ReactNode; tone?: string; title?: string }) {
  const c = TONE[tone] ?? tone;
  return (
    <span className="inline-flex items-center rounded-full px-2 h-[20px] text-[11px] font-medium whitespace-nowrap" style={{ color: c, background: `color-mix(in srgb, ${c} 12%, transparent)` }} title={title}>
      {children}
    </span>
  );
}

export function Avatar({ initials, size = 32 }: { initials: string; size?: number }) {
  // Teinte stable par lead, sans dependre d'une photo (Instagram n'en donne pas par API).
  const hue = [...initials].reduce((a, c) => a + c.charCodeAt(0) * 37, 0) % 360;
  return (
    <span
      className="inline-flex items-center justify-center rounded-full font-semibold shrink-0"
      style={{ width: size, height: size, fontSize: size * 0.38, background: `hsl(${hue} 55% 92%)`, color: `hsl(${hue} 45% 32%)` }}
      aria-hidden
    >
      {initials}
    </span>
  );
}

/** « aujourd'hui 14:30 », « demain 09:00 », « 18 nov. 10:00 ». */
export function when(iso: string, today: string) {
  if (!iso) return "—";
  const day = isoToParisInput(iso).slice(0, 10);
  const d = new Date(`${today}T12:00:00Z`);
  const tomorrow = new Date(d.getTime() + 86_400_000).toISOString().slice(0, 10);
  const yesterday = new Date(d.getTime() - 86_400_000).toISOString().slice(0, 10);
  const t = fmtTime(iso);
  if (day === today) return `aujourd'hui ${t}`;
  if (day === tomorrow) return `demain ${t}`;
  if (day === yesterday) return `hier ${t}`;
  return `${fmtDate(iso)} ${t}`;
}

export const dual = fmtDualDateTime;

/**
 * Liens de contact. Ouvrir Instagram ne vaut pas contact : la tache
 * demande ensuite « c'est fait ? ». Pas de lien wa.me (choix de Mady) :
 * le numero se copie.
 */
export function ContactButtons({ contact, onOpened }: { contact: ContactLinks; onOpened?: (channel: string) => void }) {
  const toast = useToast();
  if (!contact.instagram && !contact.phone && !contact.email) return <span className="dim text-[12px]">Aucune coordonnée</span>;
  return (
    <span className="inline-flex flex-wrap gap-1">
      {contact.instagram && (
        <a className="btn btn-sm" href={contact.instagram} target="_blank" rel="noreferrer" onClick={() => onOpened?.("Instagram")} title="Ouvre la conversation Instagram dans un nouvel onglet">
          DM Instagram ↗
        </a>
      )}
      {contact.phone && (
        <button
          type="button"
          className="btn btn-sm"
          onClick={() => {
            void navigator.clipboard?.writeText(contact.phone).then(
              () => toast(`Numéro copié : ${contact.phone}`),
              () => toast(contact.phone),
            );
            onOpened?.("Téléphone / WhatsApp");
          }}
          title="Copie le numéro (WhatsApp, appel)"
        >
          ⧉ {contact.phone}
        </button>
      )}
      {contact.email && (
        <a className="btn btn-sm" href={`mailto:${contact.email}`} onClick={() => onOpened?.("Email")}>
          Email
        </a>
      )}
    </span>
  );
}

/** Raccourcis de report : dans 1 h, ce soir, demain matin, lundi, ou une date. */
export function SnoozeMenu({ onPick, busy }: { onPick: (iso: string) => void; busy?: boolean }) {
  const [custom, setCustom] = useState("");
  const now = new Date();
  const parisDayPlus = (n: number) => isoToParisInput(new Date(now.getTime() + n * 86_400_000)).slice(0, 10);
  const nextMonday = () => {
    const wd = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: "Europe/Paris" }).format(now));
    return parisDayPlus((8 - wd) % 7 || 7);
  };
  const opts = [
    { label: "Dans 1 h", at: new Date(now.getTime() + 3_600_000).toISOString() },
    { label: "Ce soir 18 h", at: parisToIso(`${parisDayPlus(0)}T18:00`) },
    { label: "Demain 9 h", at: parisToIso(`${parisDayPlus(1)}T09:00`) },
    { label: "Lundi 9 h", at: parisToIso(`${nextMonday()}T09:00`) },
  ].filter((o) => Date.parse(o.at) > now.getTime());
  return (
    <div className="flex flex-wrap items-center gap-1">
      {opts.map((o) => (
        <button key={o.label} type="button" className="btn btn-sm" disabled={busy} onClick={() => onPick(o.at)}>
          {o.label}
        </button>
      ))}
      <input type="datetime-local" className="input !h-[28px] !w-auto text-[12px]" value={custom} onChange={(e) => setCustom(e.target.value)} aria-label="Reporter à une date précise" />
      <button type="button" className="btn btn-sm btn-primary" disabled={busy || !custom} onClick={() => onPick(parisToIso(custom))}>
        Reporter
      </button>
    </div>
  );
}

export const money = (n: number, currency = "EUR") => new Intl.NumberFormat("fr-FR", { style: "currency", currency, maximumFractionDigits: 0 }).format(n || 0);

export const SETTING_OPTIONS: { value: string; label: string }[] = [
  { value: "to-contact", label: "À contacter" },
  { value: "contacted", label: "Premier contact fait" },
  { value: "conversation", label: "En conversation" },
  { value: "awaiting-reply", label: "En attente de réponse" },
  { value: "qualified", label: "Qualifié" },
  { value: "proposed", label: "Rendez-vous proposé" },
  { value: "nurturing", label: "Nurturing" },
  { value: "not-qualified", label: "Non qualifié" },
  { value: "lost", label: "Perdu" },
  { value: "dnc", label: "Ne plus contacter" },
];
