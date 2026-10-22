import { swipeStage, type EditJob, type Swipe } from "./types";

const STAGE_TITLE: Record<string, string> = { TOFU: "TOFU — Attirer", MOFU: "MOFU — Convaincre", BOFU: "BOFU — Convertir" };

/**
 * Le dossier de montage d'un Reel tourné : titre, brief complet (référence,
 * catégorie, hook, corps, message, CTA, B-roll, textes écran, notes de
 * tournage), durée cible. Le monteur retrouve tout sans chercher dans les DM.
 * Pur : utilisable depuis n'importe quelle page.
 */
export function editJobFromSwipe(s: Swipe): Omit<EditJob, "id" | "createdAt"> {
  const sc = s.script;
  const stage = swipeStage(s);
  const brief = [
    `RÉFÉRENCE : ${s.url}${s.author ? ` (@${s.author})` : ""}`,
    stage ? `CATÉGORIE : ${STAGE_TITLE[stage] ?? stage}` : "",
    sc?.hook ? `HOOK : ${sc.hook}` : "",
    sc?.bullets?.length ? `CORPS :\n${sc.bullets.map((b) => `- ${b}`).join("\n")}` : "",
    sc?.message ? `MESSAGE : ${sc.message}` : "",
    sc?.cta ? `CTA : ${sc.cta}` : "",
    sc?.broll?.length ? `B-ROLL / PREUVES :\n${sc.broll.map((b) => `- ${b}`).join("\n")}` : "",
    sc?.screenText?.length ? `TEXTE ÉCRAN : ${sc.screenText.join(" · ")}` : "",
    s.shootNotes ? `NOTES DE TOURNAGE : ${s.shootNotes}` : "",
    !sc?.hook && s.transcriptInput ? `TRANSCRIPTION DE LA RÉFÉRENCE :\n${s.transcriptInput.slice(0, 1500)}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
  return {
    title: (sc?.hook || s.title || "Reel").slice(0, 90),
    status: "rush-a-deposer",
    style: "rapide",
    brief,
    subtitles: true,
    music: "",
    aspectRatio: "9:16",
    targetDurationSec: sc?.durationSec || 30,
    priority: "P2",
    dueAt: "",
    assignee: s.assignee ?? "",
    postId: "",
    media: [],
    deliveryUrl: "",
    swipeId: s.id,
    comments: [],
    deliveredAt: "",
    postedAt: "",
  } as Omit<EditJob, "id" | "createdAt">;
}
