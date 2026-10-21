/**
 * Content OS : pilotage quotidien de la production de contenu (YouTube +
 * Instagram), d'après l'accompagnement d'Isma.
 *
 * L'état « réglages » (habitudes, priorités par jour, routine hebdo,
 * ressources, chantiers) vit dans `settings.contentOs` ; les contenus du
 * pipeline dans la collection `contentItems`.
 */
import type { ContentItem, ContentOsState, ContentStatus, CosHabit, CosProject, CosResource, Settings } from "./types";

export const ROADMAP_URL = "https://excalidraw.com/#room=29b976f2da554ecea8a3,6fNk45xeqSgs7jgrzsHY2A";

export const STATUSES: { id: ContentStatus; label: string }[] = [
  { id: "idea", label: "Idées" },
  { id: "script", label: "Script / plan" },
  { id: "ready", label: "Prêt à tourner" },
  { id: "shot", label: "Tourné" },
  { id: "editing", label: "Montage" },
  { id: "review", label: "Validation" },
  { id: "scheduled", label: "Programmé" },
  { id: "published", label: "Publié" },
];

export const PLATFORMS: { id: ContentItem["platform"]; label: string }[] = [
  { id: "youtube", label: "YouTube" },
  { id: "instagram", label: "Instagram" },
];

export const FORMATS: { id: ContentItem["format"]; label: string }[] = [
  { id: "vlog", label: "Vlog" },
  { id: "value", label: "Valeur" },
  { id: "reel", label: "Reel" },
  { id: "testimonial", label: "Témoignage" },
  { id: "challenge", label: "Challenge" },
];

export const FUNNELS: ContentItem["funnel"][] = ["TOFU", "MOFU", "BOFU"];

const habit = (id: string, label: string, order: number): CosHabit => ({ id, label, order });

export const DEFAULT_HABITS: CosHabit[] = [
  habit("film", "Filmer au moins un moment de ma journée avec ma DJI Osmo.", 1),
  habit("work", "Capturer une session de travail ou une démonstration e-commerce / IA.", 2),
  habit("student", "Documenter un moment intéressant avec un élève (avec son autorisation).", 3),
  habit("idea", "Enregistrer une réflexion, une idée ou un conseil spontané.", 4),
  habit("rushes", "Envoyer les rushs exploitables à mon monteur / clipper.", 5),
];

export const DEFAULT_ROUTINE: CosHabit[] = [
  habit("perf", "Analyser les performances des contenus.", 1),
  habit("hooks", "Identifier les hooks et formats gagnants.", 2),
  habit("scripts", "Préparer les prochains scripts.", 3),
  habit("shoot", "Organiser une session de tournage groupée.", 4),
  habit("send", "Envoyer les rushs au monteur.", 5),
  habit("validate", "Valider les montages.", 6),
  habit("schedule", "Programmer les publications.", 7),
  habit("variations", "Préparer les prochaines variations.", 8),
];

const res = (id: string, label: string, url = "", notes = ""): CosResource => ({ id, label, url, notes });

export const DEFAULT_RESOURCES: CosResource[] = [
  res("roadmap", "Roadmap officielle d'Isma", ROADMAP_URL),
  res("viewstats", "Viewstats"),
  res("thumbnails", "Références de miniatures YouTube"),
  res("creators", "Références de créateurs américains"),
  res("prompt", "Prompt Claude pour les scripts YouTube", "/youtube", "Le prompt du scénariste est dans Vidéos YouTube → « Prompt du scénariste »."),
  res("sop", "SOP TOFU / MOFU / BOFU", "/marque", "Résumée dans Ma marque → « SOP et process »."),
  res("editing", "Références de montage Instagram"),
  res("editor", "Instructions pour le monteur / clipper"),
];

const project = (id: string, title: string, status: CosProject["status"], order: number): CosProject => ({ id, title, status, order });

export const DEFAULT_PROJECTS: CosProject[] = [
  project("avatar", "Avatar Express", "done", 1),
  project("nesb", "NESB Scale X", "done", 2),
  project("shoot8", "Tournage des 8 contenus stratégiques", "done", 3),
  project("training", "Visionnage de la formation d'Isma", "done", 4),
  project("edit8", "Montage et publication des 8 contenus stratégiques", "doing", 5),
  project("reactivate", "Réactivation de l'audience existante", "doing", 6),
  project("challenge", "Challenge YouTube e-commerce de 7 jours", "todo", 7),
  project("yt", "Production YouTube récurrente", "todo", 8),
  project("clipping", "Système de clipping Instagram", "todo", 9),
  project("second", "Mise en place éventuelle de la chaîne secondaire", "todo", 10),
];

export const EMPTY_CONTENT_OS: ContentOsState = {
  habits: DEFAULT_HABITS,
  habitLog: {},
  priorities: {},
  routineItems: DEFAULT_ROUTINE,
  routineLog: {},
  resources: DEFAULT_RESOURCES,
  projects: DEFAULT_PROJECTS,
};

/** L'état complet, avec les valeurs par défaut pour ce qui n'a jamais été touché. */
export function contentOsState(settings: Pick<Settings, "contentOs">): ContentOsState {
  const s = settings.contentOs ?? {};
  return {
    habits: s.habits?.length ? s.habits : DEFAULT_HABITS,
    habitLog: s.habitLog ?? {},
    priorities: s.priorities ?? {},
    routineItems: s.routineItems?.length ? s.routineItems : DEFAULT_ROUTINE,
    routineLog: s.routineLog ?? {},
    resources: s.resources?.length ? s.resources : DEFAULT_RESOURCES,
    projects: s.projects?.length ? s.projects : DEFAULT_PROJECTS,
  };
}

/** Date locale AAAA-MM-JJ (côté navigateur : la journée du user, pas celle du serveur). */
export function dayKey(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Lundi de la semaine, AAAA-MM-JJ : la clé de la routine hebdo. */
export function weekKey(d = new Date()): string {
  const x = new Date(d);
  const day = (x.getDay() + 6) % 7;
  x.setDate(x.getDate() - day);
  return dayKey(x);
}

export function emptyItem(): Omit<ContentItem, "id" | "createdAt" | "updatedAt"> {
  return {
    title: "",
    platform: "youtube",
    format: "value",
    funnel: "TOFU",
    hook: "",
    plan: "",
    owner: "",
    dueAt: "",
    rushesUrl: "",
    editUrl: "",
    status: "idea",
    views: 0,
    comments: 0,
    dms: 0,
    leads: 0,
    postNotes: "",
    winner: false,
    winnerNotes: "",
    variations: "",
    order: 0,
  };
}
