import type { Student } from "./types";

/**
 * Parcours Scale X (octobre 2026).
 *
 * Les onglets s'ouvrent en chaîne : Démarrage est ouvert d'emblée, puis
 * chaque onglet s'ouvre quand l'élève a validé le précédent (bouton en bas
 * de page) : Démarrage → Recherche produit → Création de la boutique →
 * Créatives → Campagnes Meta. Le formulaire d'onboarding (accueil) ne
 * verrouille rien : quand l'élève dit l'avoir rempli, Mady reçoit une
 * notification et la marque « vu ». Studio IA, Mes étapes et Ressources
 * restent ouverts. Module pur : serveur et navigateur.
 */

/**
 * Vrai : les onglets du parcours s'ouvrent l'un après l'autre.
 * Faux depuis le 2026-10-27 : tout est ouvert pour tous les élèves, le bouton
 * « j'ai terminé » ne sert plus qu'à suivre l'avancement.
 */
export const LOCK_CHAIN = false;

export type GateTab = "demarrage" | "produit" | "boutique" | "creatives" | "meta";

export const GATE_TABS: { key: GateTab; href: string; label: string; doneLabel: string }[] = [
  { key: "demarrage", href: "/formation/demarrage", label: "Démarrage", doneLabel: "J'ai tout installé (VS Code, Claude Code, Shopify)" },
  { key: "produit", href: "/formation/produit", label: "Recherche produit", doneLabel: "Mon produit est validé par Mady" },
  { key: "boutique", href: "/formation/boutique", label: "Création de la boutique", doneLabel: "Ma boutique est en ligne" },
  { key: "creatives", href: "/formation/creatives", label: "Créatives", doneLabel: "Mes créatives sont prêtes" },
  { key: "meta", href: "/formation/meta", label: "Campagnes Meta", doneLabel: "Mes campagnes sont lancées 🚀" },
];

export const isGateTab = (v: unknown): v is GateTab => GATE_TABS.some((t) => t.key === v);

export interface GateTabState {
  key: GateTab;
  href: string;
  label: string;
  doneLabel: string;
  unlocked: boolean;
  done: boolean;
  /** Ce qu'il manque quand c'est verrouillé : l'étape à finir avant, ou la validation de Mady. */
  blockedBy: { kind: "approval" } | { kind: "tab"; key: GateTab; href: string; label: string } | null;
}

/** Avancement de l'élève, 0 → 100 % quand « Mes campagnes sont lancées » est coché. */
export function gateProgress(tabs: Pick<GateTabState, "done">[]): number {
  return tabs.length ? Math.round((tabs.filter((t) => t.done).length / tabs.length) * 100) : 0;
}

export interface GateState {
  /** L'élève a dit « j'ai rempli le formulaire » (demande d'accès envoyée à Mady). */
  requestedAt: string;
  /** Mady a validé : Démarrage est ouvert. */
  approvedAt: string;
  tabs: GateTabState[];
  /** Prochaine étape à faire (première non faite et débloquée), ou null. */
  next: GateTabState | null;
}

/**
 * L'état du parcours d'un élève. Sans élève (admin), tout est ouvert.
 * `preview` (admin en « Voir comme ») : tout est ouvert aussi, mais
 * `blockedBy` reste renseigné pour dire ce que l'élève, lui, voit verrouillé.
 */
export function gateState(student: Pick<Student, "accessRequestedAt" | "accessApprovedAt" | "tabsDone"> | undefined, opts: { admin?: boolean; preview?: boolean } = {}): GateState {
  const done = new Set(student?.tabsDone ?? []);
  const tabs: GateTabState[] = [];
  GATE_TABS.forEach((t, i) => {
    const prev = i > 0 ? GATE_TABS[i - 1] : null;
    let unlocked: boolean;
    let blockedBy: GateTabState["blockedBy"] = null;
    if (!LOCK_CHAIN || (opts.admin && !student) || !prev) unlocked = true;
    else {
      unlocked = done.has(prev.key);
      if (!unlocked) blockedBy = { kind: "tab", key: prev.key, href: prev.href, label: prev.label };
      if (!unlocked && opts.preview) unlocked = true;
    }
    tabs.push({ key: t.key, href: t.href, label: t.label, doneLabel: t.doneLabel, unlocked, done: done.has(t.key), blockedBy });
  });
  return {
    requestedAt: student?.accessRequestedAt ?? "",
    approvedAt: student?.accessApprovedAt ?? "",
    tabs,
    next: tabs.find((t) => t.unlocked && !t.done) ?? null,
  };
}
