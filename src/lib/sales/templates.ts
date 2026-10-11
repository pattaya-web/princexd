import type { DB, MessageTemplate, TemplateChannel } from "@/lib/types";

/**
 * Templates de messages : les textes que le setter copie ou ouvre dans
 * WhatsApp depuis la liste des leads. Les exemples ci-dessous sont poses une
 * fois, puis tout se gere dans Sales → Messages (creer, modifier, dupliquer,
 * ordonner, favoris, actif, template par defaut d'une action).
 *
 * Contexte des textes : le prospect a DEJA acces a la masterclass quand on
 * l'appelle (opt-in = acces immediat). On ne parle donc jamais de « demande
 * d'acces » ; on l'appelle « apres son passage sur la masterclass ».
 */

export const DEFAULT_TEMPLATE_CATEGORIES = ["LEAD ADS", "RELANCE", "APRÈS CALL", "R2", "CONTRAT", "PAIEMENT", "NO-SHOW", "CLOSING", "FOLLOW-UP", "AUTRE"];

export const TEMPLATE_CHANNELS: { key: TemplateChannel; label: string }[] = [
  { key: "whatsapp", label: "WhatsApp" },
  { key: "sms", label: "SMS" },
  { key: "instagram", label: "Instagram DM" },
  { key: "email", label: "Email" },
  { key: "other", label: "Autre" },
];

export const CHANNEL_LABEL: Record<TemplateChannel, string> = Object.fromEntries(TEMPLATE_CHANNELS.map((c) => [c.key, c.label])) as Record<TemplateChannel, string>;

/** Actions de la liste des leads qui ouvrent un template par defaut. */
export const TEMPLATE_ACTIONS: { key: string; label: string }[] = [{ key: "no-answer", label: "Appel sans réponse" }];

export const asChannel = (v: unknown): TemplateChannel => (TEMPLATE_CHANNELS.some((c) => c.key === v) ? (v as TemplateChannel) : "whatsapp");
export const asActions = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && TEMPLATE_ACTIONS.some((a) => a.key === x)) : []);

/** Les categories en vigueur : celles des reglages, plus celles que des templates utilisent deja. */
export function templateCategories(db: DB): string[] {
  const list = db.settings.messageTemplateCategories?.length ? [...db.settings.messageTemplateCategories] : [...DEFAULT_TEMPLATE_CATEGORIES];
  for (const t of db.messageTemplates ?? []) if (t.category && !list.includes(t.category)) list.push(t.category);
  return list;
}

/** Les templates dans l'ordre d'affichage. */
export const sortedTemplates = (list: MessageTemplate[]) => [...list].sort((a, b) => a.sortOrder - b.sortOrder || a.createdAt.localeCompare(b.createdAt));

/** Le template qui s'ouvre tout seul pour une action (favori actif en repli). */
export function defaultTemplateFor(list: MessageTemplate[], action: string): MessageTemplate | undefined {
  const active = sortedTemplates(list).filter((t) => t.isActive);
  return active.find((t) => t.defaultFor?.includes(action)) ?? active.find((t) => t.isFavorite) ?? active[0];
}

/** « {{prenom}} » / « {{nom}} » dans un texte : remplaces par ceux du lead (les exemples n'en ont pas). */
export function renderTemplate(content: string, lead: { name?: string }, ctx: { date?: string; heure?: string; lien?: string } = {}): string {
  const name = (lead.name ?? "").trim();
  const first = name.split(/\s+/)[0] ?? "";
  return content
    .replace(/\{\{\s*pr[eé]nom\s*\}\}|\{pr[eé]nom\}/gi, first)
    .replace(/\{\{\s*nom\s*\}\}|\{nom\}/gi, name)
    .replace(/\{\{\s*date\s*\}\}|\{date\}/gi, ctx.date ?? "")
    .replace(/\{\{\s*heure\s*\}\}|\{heure\}/gi, ctx.heure ?? "")
    .replace(/\{\{\s*lien\s*\}\}|\{lien\}/gi, ctx.lien ?? "");
}

/** Numero au format international sans « + » (wa.me) : 06… devient 336…, +33 6… devient 336… */
export function waNumber(phone: string): string {
  let d = (phone ?? "").replace(/\D/g, "");
  if (d.startsWith("00")) d = d.slice(2);
  if (d.length === 10 && d.startsWith("0")) d = `33${d.slice(1)}`;
  return d;
}

/** Lien WhatsApp avec le message prerempli. Rien n'est envoye : c'est l'utilisateur qui appuie. */
export function waLink(phone: string, text: string): string {
  const n = waNumber(phone);
  const q = text ? `?text=${encodeURIComponent(text)}` : "";
  return n ? `https://wa.me/${n}${q}` : `https://wa.me/${q}`;
}
