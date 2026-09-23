/**
 * Fenetres temporelles partagees par tous les ecrans du module.
 *
 * Centralise ici pour que le dashboard admin, la page setters et le grand
 * livre des commissions repondent exactement la meme chose a "ce mois-ci".
 * Deux ecrans qui calculent leur periode chacun de leur cote finissent
 * toujours par afficher des chiffres differents.
 */

export type PeriodKey =
  | "today"
  | "yesterday"
  | "7d"
  | "30d"
  | "month"
  | "upcoming"
  | "all"
  | "custom";

export interface Range {
  /** Borne basse incluse, ISO. */
  from: string;
  /** Borne haute incluse, ISO. */
  to: string;
  key: PeriodKey;
  label: string;
}

export const PERIODS: { key: PeriodKey; label: string }[] = [
  { key: "today", label: "Aujourd'hui" },
  { key: "yesterday", label: "Hier" },
  { key: "7d", label: "7 jours" },
  { key: "30d", label: "30 jours" },
  { key: "month", label: "Ce mois" },
  { key: "upcoming", label: "À venir" },
  { key: "all", label: "Tout" },
];

/**
 * Borne haute lointaine.
 *
 * Les fenetres glissantes (« 7 jours », « ce mois ») s'arretent volontairement
 * a aujourd'hui : compter des rendez-vous futurs dans un taux de presence le
 * ferait chuter sans raison. Mais « Tout » et « À venir » doivent, elles,
 * depasser le present — sinon un rendez-vous pose pour la semaine prochaine
 * n'apparait dans aucun ecran, ce qui est le comble pour un outil de setter.
 */
const FAR_FUTURE = new Date("2100-01-01T00:00:00.000Z").toISOString();

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
const endOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);

/**
 * Resout une periode en bornes ISO.
 *
 * Les bornes sont calculees dans le fuseau local du serveur : le tool est
 * mono-utilisateur cote hebergement, et un decoupage UTC decalerait
 * "aujourd'hui" de deux heures en France.
 */
export function resolveRange(key: PeriodKey, from = "", to = "", now = new Date()): Range {
  const label = PERIODS.find((p) => p.key === key)?.label ?? "Personnalisé";

  switch (key) {
    case "today":
      return { from: startOfDay(now).toISOString(), to: endOfDay(now).toISOString(), key, label };
    case "yesterday": {
      const y = new Date(now);
      y.setDate(y.getDate() - 1);
      return { from: startOfDay(y).toISOString(), to: endOfDay(y).toISOString(), key, label };
    }
    case "7d": {
      const s = new Date(now);
      s.setDate(s.getDate() - 6);
      return { from: startOfDay(s).toISOString(), to: endOfDay(now).toISOString(), key, label };
    }
    case "30d": {
      const s = new Date(now);
      s.setDate(s.getDate() - 29);
      return { from: startOfDay(s).toISOString(), to: endOfDay(now).toISOString(), key, label };
    }
    case "month": {
      const s = new Date(now.getFullYear(), now.getMonth(), 1);
      return { from: startOfDay(s).toISOString(), to: endOfDay(now).toISOString(), key, label };
    }
    case "upcoming":
      // De maintenant a l'infini : ce qui reste a honorer.
      return { from: new Date(now).toISOString(), to: FAR_FUTURE, key, label };
    case "custom": {
      // Une borne vide vaut "pas de limite" : on peut donc demander
      // "depuis le 1er janvier" sans renseigner de fin.
      const f = from ? startOfDay(new Date(from)) : new Date(0);
      const t = to ? endOfDay(new Date(to)) : endOfDay(now);
      const valid = !Number.isNaN(f.getTime()) && !Number.isNaN(t.getTime());
      if (!valid) return resolveRange("30d", "", "", now);
      return { from: f.toISOString(), to: t.toISOString(), key, label: "Personnalisé" };
    }
    default:
      return { from: new Date(0).toISOString(), to: FAR_FUTURE, key: "all", label: "Tout" };
  }
}

/** Vrai si l'horodatage tombe dans la fenetre. Une date vide est hors periode. */
export function inRange(iso: string | undefined, range: Range): boolean {
  if (!iso) return false;
  return iso >= range.from && iso <= range.to;
}

/** Bornes lues depuis une query string, avec repli sur 30 jours. */
export function rangeFromParams(params: URLSearchParams): Range {
  const key = (params.get("period") ?? "30d") as PeriodKey;
  const known: PeriodKey[] = ["today", "yesterday", "7d", "30d", "month", "upcoming", "all", "custom"];
  if (!known.includes(key)) return resolveRange("30d");
  return resolveRange(key, params.get("from") ?? "", params.get("to") ?? "");
}
