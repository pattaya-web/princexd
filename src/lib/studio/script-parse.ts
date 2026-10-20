/**
 * Lecture du champ « Ce que la personne dit » de l'onglet Création.
 *
 * Deux usages cohabitent :
 *  - le script seul, mot pour mot (« Franchement, depuis que je porte… ») ;
 *  - un prompt complet collé tel quel, comme ceux que l'on écrit pour
 *    Seedance : caméra, gestes, ambiance sonore, et au milieu la réplique
 *    entre guillemets (« She says: "Okay I'm literally obsessed…" »).
 *
 * Dans le second cas, seules les répliques entre guillemets sont dites ; le
 * reste devient la mise en scène et remplace les consignes par défaut
 * (cadrage stable, pas de musique…). Module pur : utilisé côté client pour
 * les compteurs et côté serveur pour le prompt.
 */

export interface ParsedScript {
  /** Ce qui est dit, mot pour mot. */
  spoken: string;
  /** Mise en scène extraite (vide quand le texte est un script simple). */
  directions: string;
  /** Vrai quand une réplique entre guillemets a été trouvée dans un prompt. */
  detected: boolean;
}

/** Verbes qui introduisent la réplique : « She says: », « Elle dit : », « saying ». */
const INTRO = /(?:\b(?:she|he|they|the (?:woman|man|girl|guy|person|creator)|elle|il|la personne)\s+)?\b(?:says?|saying|said|speaks?|tells?|dialogue|dialog|script|lines?|voice[- ]?over|vo|dit|déclare|lance|réplique|texte)\b(?:\s+(?:to|into|at)\s+(?:the\s+)?(?:camera|lens|phone))?\s*[:,]?\s*/i;

/** Une réplique entre guillemets droits, typographiques ou français. */
const QUOTE = /["“«]\s*([^"”»]{12,})\s*["”»]/g;

/** Mots qui trahissent un prompt de mise en scène plutôt qu'un script. */
const DIRECTION_HINT = /\b(handheld|iphone|selfie video|front[- ]camera|camera|lens|9:16|16:9|lip[- ]?sync|ambient|no music|no filter|lighting|framing|reframing|close[- ]up|zoom|pan|tilt|caméra|cadrage|plan serré|ambiance|lumière|gros plan)\b/i;

export function parseCreationScript(raw: string): ParsedScript {
  const text = raw.trim();
  if (!text) return { spoken: "", directions: "", detected: false };

  const all: { start: number; end: number; body: string; introduced: boolean; colon: boolean }[] = [];
  for (const m of text.matchAll(QUOTE)) {
    const start = m.index ?? 0;
    const before = text.slice(Math.max(0, start - 60), start);
    const intro = before.match(new RegExp(`${INTRO.source}$`, "i"));
    all.push({ start, end: start + m[0].length, body: m[1].trim(), introduced: Boolean(intro), colon: Boolean(intro && /:\s*$/.test(intro[0])) });
  }
  /*
   * Un script simple peut citer quelqu'un (« ma pote m'a dit "t'es sérieuse ?" ») :
   * on ne bascule en mode prompt que si le texte hors guillemets parle caméra,
   * ou si la réplique est annoncée avec deux-points (« She says: », « Elle dit : »).
   */
  const outside = all.reduce((acc, q) => acc.replace(text.slice(q.start, q.end), " "), text);
  const looksLikePrompt = all.length > 0 && (DIRECTION_HINT.test(outside) || all.some((q) => q.colon));
  if (!looksLikePrompt) return { spoken: text, directions: "", detected: false };

  // Si des répliques sont annoncées par un verbe, seules celles-là sont dites ;
  // les autres guillemets (« at "this necklace" ») sont des repères de mise en scène.
  const quotes = all.some((q) => q.introduced) ? all.filter((q) => q.introduced) : all;

  const spoken = quotes.map((q) => q.body).join(" ").replace(/\s+/g, " ").trim();
  // La mise en scène : le texte sans les répliques ni leur verbe d'introduction.
  let directions = "";
  let cursor = 0;
  for (const q of quotes) {
    let before = text.slice(cursor, q.start);
    const intro = before.match(new RegExp(`${INTRO.source}$`, "i"));
    if (intro) before = before.slice(0, before.length - intro[0].length);
    directions += `${before}(she says the spoken lines) `;
    cursor = q.end;
  }
  directions += text.slice(cursor);
  directions = directions
    .replace(/\(she says the spoken lines\)\s*[.,;]?\s*(?=\(she says the spoken lines\))/g, "")
    .replace(/\s+/g, " ")
    .replace(/\s+([.,;])/g, "$1")
    .trim();

  return { spoken, directions, detected: true };
}

/** Secondes de parole estimées : environ 15 caractères par seconde. */
export function spokenSeconds(spoken: string): number {
  return Math.ceil(spoken.trim().length / 15);
}
