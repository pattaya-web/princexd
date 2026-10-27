import type { DB, Student } from "@/lib/types";

/**
 * Élève ajouté « à la main » par bascule unique, quand Mady me demande de
 * l'ajouter et que je n'ai pas la main sur la base en ligne : la fiche est
 * créée au prochain chargement de la base, une seule fois (la date de la
 * bascule sert de verrou), sans vente ni lead. Accès plateforme ouvert,
 * identifiant seul (pas de mot de passe depuis le 2026-10-22).
 *
 * Renvoie la fiche créée, ou null si un élève du même nom ou du même
 * identifiant existe déjà (pas de doublon).
 */
export function seedFreeStudent(db: DB, now: string, newId: () => string, input: { name: string; username: string; notes: string }): Student | null {
  const fold = (s: string) =>
    s
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .trim();
  const taken = db.students.some((s) => fold(s.name) === fold(input.name) || fold(s.username ?? "") === fold(input.username)) || db.team.some((m) => fold(m.username ?? "") === fold(input.username));
  if (taken) return null;
  const student: Student = {
    id: newId(),
    name: input.name,
    handle: "",
    program: "",
    startedAt: now.slice(0, 10),
    price: 0,
    paid: 0,
    status: "onboarding",
    progress: 0,
    nextSessionAt: "",
    objective: "",
    result: "",
    notes: input.notes,
    createdAt: now,
    username: input.username,
    portalAccess: true,
    currency: "EUR",
  };
  db.students.unshift(student);
  db.activityLogs.unshift({
    id: newId(),
    at: now,
    actorId: db.settings.salesOwnerMemberId ?? "",
    actorName: "Mady",
    action: "student.enrolled",
    entity: "lead",
    entityId: student.id,
    summary: `${student.name} ajouté dans Élèves (accès offert, sans vente)`,
  });
  return student;
}
