import type { Student } from "./types";

/**
 * Verrouillage du parcours Scale X (octobre 2026).
 *
 * Chaque onglet du menu est une étape qui se débloque quand la précédente
 * est marquée faite par l'élève. La toute première (Démarrage) ne s'ouvre
 * qu'après validation de Mady : l'élève remplit le formulaire d'onboarding,
 * demande l'accès, Mady confirme qu'elle a bien le formulaire et débloque.
 * Module pur : serveur (API) et navigateur (menu, pages).
 */

export type GateTab = "demarrage" | "produit" | "boutique" | "creatives" | "meta";

export const GATE_TABS: { key: GateTab; href: string; label: string; doneLabel: string }[] = [
  { key: "demarrage", href: "/formation/demarrage", label: "Démarrage", doneLabel: "J'ai tout installé (VS Code, Claude Code, Shopify)" },
  { key: "produit", href: "/formation/produit", label: "Recherche produit", doneLabel: "Mon produit est validé par Mady" },
  { key: "boutique", href: "/formation/boutique", label: "Création de la boutique", doneLabel: "Ma boutique est en ligne" },
  { key: "creatives", href: "/formation/creatives", label: "Créatives", doneLabel: "Mes créatives sont prêtes" },
  { key: "meta", href: "/formation/meta", label: "Campagnes Meta", doneLabel: "Ma première campagne est lancée" },
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

export interface GateState {
  /** L'élève a dit « j'ai rempli le formulaire » (demande d'accès envoyée à Mady). */
  requestedAt: string;
  /** Mady a validé : Démarrage est ouvert. */
  approvedAt: string;
  tabs: GateTabState[];
  /** Prochaine étape à faire (première non faite et débloquée), ou null. */
  next: GateTabState | null;
}

/** L'état du parcours d'un élève. Sans élève (admin), tout est ouvert. */
export function gateState(student: Pick<Student, "accessRequestedAt" | "accessApprovedAt" | "tabsDone"> | undefined, opts: { admin?: boolean } = {}): GateState {
  const done = new Set(student?.tabsDone ?? []);
  const approved = Boolean(student?.accessApprovedAt) || Boolean(opts.admin && !student);
  const tabs: GateTabState[] = [];
  GATE_TABS.forEach((t, i) => {
    const prev = i > 0 ? GATE_TABS[i - 1] : null;
    let unlocked: boolean;
    let blockedBy: GateTabState["blockedBy"] = null;
    if (opts.admin && !student) unlocked = true;
    else if (!prev) {
      unlocked = approved;
      if (!unlocked) blockedBy = { kind: "approval" };
    } else {
      unlocked = approved && done.has(prev.key);
      if (!approved) blockedBy = { kind: "approval" };
      else if (!unlocked) blockedBy = { kind: "tab", key: prev.key, href: prev.href, label: prev.label };
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
