"use client";

import { CopyButton } from "@/components/ui";
import { SWIPE_CONFIDENCE_MIN, SWIPE_PROD_LABEL, swipeProdStatus, swipeStage, type Swipe, type SwipeAnalysis, type SwipeProdStatus, type SwipeStage } from "@/lib/types";

/* Briques partagées du Swipe file : étapes du funnel, états d'une fiche, panneaux d'analyse. */

export const STAGE_COLOR: Record<SwipeStage, string> = { TOFU: "#006DBC", MOFU: "#a855f7", BOFU: "#16a34a" };
export const STAGE_TITLE: Record<SwipeStage, string> = { TOFU: "TOFU — Attirer", MOFU: "MOFU — Convaincre", BOFU: "BOFU — Convertir" };
export const STAGE_HINT: Record<SwipeStage, string> = {
  TOFU: "Toucher une audience nouvelle : hook large, zéro jargon, une émotion, pas de vente.",
  MOFU: "Rassurer, éduquer, lever une objection : démonstration, étude de cas, preuve d'expertise.",
  BOFU: "Provoquer une action : preuve réelle, raison d'agir, un seul CTA (DM, appel).",
};

export const FORMAT_LABEL: Record<string, string> = {
  tier_list: "Tier list",
  choix_binaire: "Choix binaire",
  hot_take: "Hot take",
  reaction: "Réaction",
  anecdote_parcours: "Anecdote de parcours",
  chiffre_choc: "Chiffre choc",
  lifestyle_punchline: "Lifestyle + punchline",
  tuto_ecran: "Tuto écran",
  reponse_commentaire: "Réponse à un commentaire",
  decryptage: "Décryptage",
  erreur_correction: "Erreur + correction",
  a_ta_place: "À ta place",
  coulisses: "Coulisses",
  resultat_eleve: "Résultat élève",
  objection: "Objection",
  pour_qui: "Pour qui / pas pour qui",
  comment_ca_se_passe: "Comment ça se passe",
  garantie: "Garantie",
  urgence: "Urgence",
};

/** Le classement est-il à vérifier (auto peu sûr ou absent, pas corrigé à la main) ? */
export const needsCheck = (s: Swipe) => Boolean(s.analysis) && !s.etapeManuelle && (!s.analysis?.etape || (s.analysis?.confiance ?? 0) < SWIPE_CONFIDENCE_MIN);

export const hasTranscript = (s: Swipe) => Boolean(s.transcriptInput?.trim());

/** L'état d'une fiche, en un mot, pour la carte et les filtres. */
export type SwipeState = "needs-transcript" | "to-analyze" | "check" | "analyzed" | "script-ready" | "to-shoot" | "shot" | "edited" | "validation" | "scheduled" | "published";

export function swipeState(s: Swipe): SwipeState {
  const prod = swipeProdStatus(s);
  if (prod === "publie") return "published";
  if (prod === "programme") return "scheduled";
  if (prod === "validation") return "validation";
  if (prod === "monte") return "edited";
  if (prod === "tourne") return "shot";
  if (prod === "a-tourner") return "to-shoot";
  if (prod === "scripte" || s.script?.hook) return "script-ready";
  if (!hasTranscript(s)) return "needs-transcript";
  if (!s.analysis) return "to-analyze";
  if (needsCheck(s)) return "check";
  return "analyzed";
}

export const STATE_LABEL: Record<SwipeState, string> = {
  "needs-transcript": "Transcription nécessaire",
  "to-analyze": "À analyser",
  check: "Classification à vérifier",
  analyzed: "Analysé",
  "script-ready": "Script prêt",
  "to-shoot": "Prêt à tourner",
  shot: "Tourné",
  edited: "Monté",
  validation: "Validation",
  scheduled: "Programmé",
  published: "Publié",
};

const STATE_TONE: Record<SwipeState, string> = {
  "needs-transcript": "var(--warning)",
  "to-analyze": "var(--text-2)",
  check: "#6b7280",
  analyzed: "var(--text-2)",
  "script-ready": "var(--accent)",
  "to-shoot": "var(--accent)",
  shot: "#7c3aed",
  edited: "#7c3aed",
  validation: "#7c3aed",
  scheduled: "#0e7490",
  published: "var(--good)",
};

export function StateBadge({ s, working }: { s: Swipe; working?: string }) {
  if (working) {
    return (
      <span className="badge !text-[10.5px] !py-0 inline-flex items-center gap-1" style={{ color: "var(--accent)" }}>
        <span className="spinner" style={{ width: 10, height: 10 }} /> {working}
      </span>
    );
  }
  const st = swipeState(s);
  const color = STATE_TONE[st];
  return (
    <span className="badge !text-[10.5px] !py-0" style={{ color, borderColor: `color-mix(in srgb, ${color} 40%, transparent)`, background: `color-mix(in srgb, ${color} 10%, transparent)` }}>
      {STATE_LABEL[st]}
    </span>
  );
}

export function StageBadge({ s, small }: { s: Swipe; small?: boolean }) {
  const stage = swipeStage(s);
  if (!stage) return null;
  const check = needsCheck(s);
  const color = check ? "#6b7280" : STAGE_COLOR[stage];
  const size = small ? "!text-[10px] !py-0" : "!text-[11px]";
  return (
    <span
      className={`badge ${size} font-semibold`}
      style={{ background: `color-mix(in srgb, ${color} 16%, transparent)`, color, borderColor: `color-mix(in srgb, ${color} 40%, transparent)` }}
      title={check ? `Classé ${stage} par l'IA avec ${s.analysis?.confiance ?? 0} % de confiance : à vérifier` : s.etapeManuelle ? `${stage}, corrigé à la main` : `${stage} · ${s.analysis?.confiance ?? 0} % de confiance`}
    >
      {stage}
      {check ? " · à vérifier" : s.etapeManuelle ? " ✎" : ""}
    </span>
  );
}

export function ProdBadge({ s }: { s: Swipe }) {
  const prod = swipeProdStatus(s);
  if (prod === "source") return null;
  return <span className="badge badge-accent !text-[10px] !py-0">{SWIPE_PROD_LABEL[prod as SwipeProdStatus]}</span>;
}

export function Block({ title, text, mono }: { title: string; text: string; mono?: boolean }) {
  if (!text?.trim()) return null;
  return (
    <div>
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <span className="label-xs">{title}</span>
        <CopyButton text={text} />
      </div>
      <p className={`prose-sm p-3.5 rounded-[8px] whitespace-pre-line leading-[1.8] ${mono ? "mono !text-[12px]" : "text-[13.5px]"}`} style={{ background: "var(--surface-2)", border: "1px solid var(--border)" }}>
        {text}
      </p>
    </div>
  );
}

/** L'analyse : classement (avec justification), mécanique du Reel, pourquoi ça marche. */
export function MechanicsPanel({ s, a, onStage }: { s: Swipe; a: SwipeAnalysis; onStage: (stage: SwipeStage | "") => void }) {
  const stage = swipeStage(s);
  const check = needsCheck(s);
  return (
    <div className="flex flex-col gap-4">
      <div className="card-flat p-3.5" style={{ borderColor: stage && !check ? `color-mix(in srgb, ${STAGE_COLOR[stage]} 45%, transparent)` : undefined }}>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="label-xs">Classification</span>
          <StageBadge s={s} />
          {a.format && <span className="badge !text-[10.5px] !py-0">{FORMAT_LABEL[a.format] ?? a.format}</span>}
          <span className="dim text-[12px]">IA : {a.etape ?? "indécise"} à {a.confiance ?? 0} %</span>
          <select className="select select-sm !w-auto ml-auto" value={s.etapeManuelle ?? ""} onChange={(e) => onStage(e.target.value as SwipeStage | "")} title="Corriger la catégorie : la correction prime sur l'IA">
            <option value="">{a.etape ? `Auto (${a.etape})` : "Choisir la catégorie…"}</option>
            {(["TOFU", "MOFU", "BOFU"] as SwipeStage[]).map((st) => (
              <option key={st} value={st}>
                {STAGE_TITLE[st]}
              </option>
            ))}
          </select>
        </div>
        {check && <p className="text-[12.5px] mt-2" style={{ color: "var(--warning)" }}>Classification à vérifier : l&apos;IA n&apos;est pas sûre. Lis la justification et choisis la catégorie à la main.</p>}
        {a.justification && <p className="text-[13px] leading-relaxed mt-2">{a.justification}</p>}
        {stage && <p className="dim text-[12px] mt-1.5">{STAGE_HINT[stage]}</p>}
      </div>

      <div className="grid sm:grid-cols-2 gap-3">
        <div className="card-flat p-3">
          <div className="label-xs mb-1.5">Hook{a.hookType ? ` (${a.hookType})` : ""}</div>
          <p className="text-[13px] leading-relaxed font-medium">{a.hook}</p>
        </div>
        <div className="card-flat p-3">
          <div className="label-xs mb-1.5">Émotion ou objection</div>
          <p className="text-[13px] leading-relaxed">{a.emotion || a.promise || "—"}</p>
        </div>
        <div className="card-flat p-3">
          <div className="label-xs mb-1.5">Structure narrative</div>
          <p className="text-[13px] leading-relaxed">{a.structure || "—"}</p>
        </div>
        <div className="card-flat p-3">
          <div className="label-xs mb-1.5">CTA</div>
          <p className="text-[13px] leading-relaxed">{a.cta || "aucun"}</p>
        </div>
      </div>
      <Block title="Promesse" text={a.promise} />
      <Block title="Corps de l'argumentation" text={a.body} />
      <Block title="Preuve ou démonstration" text={a.proof} />

      {a.whyItWorks?.length > 0 && (
        <div>
          <span className="label-xs block mb-2">Pourquoi ça marche</span>
          <ul className="flex flex-col gap-1.5">
            {a.whyItWorks.map((w, i) => (
              <li key={i} className="flex gap-2.5 text-[13px] leading-relaxed">
                <span className="dim num shrink-0">{String(i + 1).padStart(2, "0")}</span>
                <span className="muted">{w}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {a.onScreenText?.length > 0 && (
        <div>
          <span className="label-xs block mb-2">Textes incrustés</span>
          <div className="flex flex-wrap gap-1.5">
            {a.onScreenText.map((t, i) => (
              <span key={i} className="badge">
                {t}
              </span>
            ))}
          </div>
        </div>
      )}

      {a.altHooks?.length > 0 && (
        <div>
          <span className="label-xs block mb-2">Hooks alternatifs à tester</span>
          <ul className="flex flex-col gap-1.5">
            {a.altHooks.map((h, i) => (
              <li key={i} className="flex items-center justify-between gap-3 px-3 py-2 rounded-[8px] text-[13px]" style={{ background: "var(--surface-2)", border: "1px solid var(--border)" }}>
                <span>{h}</span>
                <CopyButton text={h} />
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export function ShotsPanel({ a }: { a: SwipeAnalysis }) {
  return (
    <div className="flex flex-col gap-5">
      {a.timeline?.length > 0 && (
        <div>
          <span className="label-xs block mb-2">Découpage seconde par seconde</span>
          <div className="scroll-x">
            <table className="table">
              <thead>
                <tr>
                  <th style={{ width: 74 }}>Temps</th>
                  <th>Ce qui est dit</th>
                  <th>Plan filmé</th>
                </tr>
              </thead>
              <tbody>
                {a.timeline.map((t, i) => (
                  <tr key={i}>
                    <td className="num dim">{t.t}</td>
                    <td>{t.beat}</td>
                    <td className="muted">{t.shot}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {a.shotList?.length > 0 && (
        <div>
          <span className="label-xs block mb-2">Les plans à mettre en avant</span>
          <div className="grid sm:grid-cols-2 gap-3">
            {a.shotList.map((sh, i) => (
              <div key={i} className="card-flat p-3">
                <div className="flex items-baseline gap-2 mb-1.5">
                  <span className="dim num text-[11px]">{String(i + 1).padStart(2, "0")}</span>
                  <span className="text-[13px] font-semibold">{sh.plan}</span>
                </div>
                <p className="text-[12.5px] leading-relaxed muted">{sh.description}</p>
                <p className="text-[12px] leading-relaxed mt-2 pt-2" style={{ borderTop: "1px solid var(--border)", color: "var(--accent)" }}>
                  {sh.pourquoi}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}
      {!a.timeline?.length && !a.shotList?.length && <p className="dim text-[13px]">Pas de découpage pour ce Reel.</p>}
    </div>
  );
}
