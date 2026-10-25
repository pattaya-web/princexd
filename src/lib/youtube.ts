/**
 * Vidéos YouTube : identifiant, vignette, métadonnées et transcript.
 *
 * Le transcript vient des sous-titres YouTube (manuels, sinon automatiques),
 * sans téléchargement : d'abord l'API « player » avec le client Android
 * (la plus tolérante depuis un serveur), sinon la page de la vidéo. Quand la
 * vidéo n'a aucun sous-titre, l'appelant peut passer par l'audio + whisper.
 */

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const ANDROID_UA = "com.google.android.youtube/20.10.38 (Linux; U; Android 11) gzip";
const INNERTUBE_KEY = "AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8";

export class YoutubeError extends Error {
  status: number;
  constructor(message: string, status = 500) {
    super(message);
    this.status = status;
  }
}

/** `watch?v=`, `youtu.be/`, `shorts/`, `embed/`, `live/` → identifiant 11 caractères. */
export function parseVideoId(raw: string): string | null {
  const s = raw.trim();
  if (/^[\w-]{11}$/.test(s)) return s;
  let u: URL;
  try {
    u = new URL(s.startsWith("http") ? s : `https://${s}`);
  } catch {
    return null;
  }
  const host = u.hostname.replace(/^www\.|^m\./, "");
  if (host === "youtu.be") return idOrNull(u.pathname.slice(1));
  if (!/(^|\.)youtube(-nocookie)?\.com$/.test(host)) return null;
  const v = u.searchParams.get("v");
  if (v) return idOrNull(v);
  const m = u.pathname.match(/^\/(?:shorts|embed|live|v)\/([\w-]{11})/);
  return m ? m[1] : null;
}

function idOrNull(v: string): string | null {
  const id = v.split(/[/?&#]/)[0];
  return /^[\w-]{11}$/.test(id) ? id : null;
}

export function thumbnailUrl(videoId: string): string {
  return `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
}

export function watchUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${videoId}`;
}

export interface YtMeta {
  title: string;
  author: string;
  thumbnail: string;
  durationSec: number;
}

/** Titre et chaîne par oEmbed (public, sans clé) ; la durée vient du player si disponible. */
export async function fetchMeta(videoId: string): Promise<YtMeta> {
  const meta: YtMeta = { title: "", author: "", thumbnail: thumbnailUrl(videoId), durationSec: 0 };
  try {
    const res = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(watchUrl(videoId))}&format=json`, {
      headers: { "User-Agent": UA },
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
    if (res.ok) {
      const j = (await res.json()) as { title?: string; author_name?: string; thumbnail_url?: string };
      meta.title = j.title ?? "";
      meta.author = j.author_name ?? "";
      if (j.thumbnail_url) meta.thumbnail = j.thumbnail_url;
    }
  } catch {
    /* oEmbed indisponible : la vignette par défaut suffit */
  }
  return meta;
}

interface CaptionTrack {
  baseUrl: string;
  languageCode: string;
  kind?: string;
  name?: { simpleText?: string; runs?: { text: string }[] };
}

interface PlayerResponse {
  playabilityStatus?: { status?: string; reason?: string };
  videoDetails?: { title?: string; author?: string; lengthSeconds?: string };
  captions?: { playerCaptionsTracklistRenderer?: { captionTracks?: CaptionTrack[] } };
}

async function playerAndroid(videoId: string): Promise<PlayerResponse | null> {
  try {
    const res = await fetch(`https://www.youtube.com/youtubei/v1/player?key=${INNERTUBE_KEY}&prettyPrint=false`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": ANDROID_UA,
        "X-YouTube-Client-Name": "3",
        "X-YouTube-Client-Version": "20.10.38",
      },
      body: JSON.stringify({
        context: { client: { clientName: "ANDROID", clientVersion: "20.10.38", androidSdkVersion: 30, hl: "en", gl: "US" } },
        videoId,
        contentCheckOk: true,
        racyCheckOk: true,
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) return null;
    return (await res.json()) as PlayerResponse;
  } catch {
    return null;
  }
}

async function tracksFromWatchPage(videoId: string): Promise<CaptionTrack[]> {
  try {
    const res = await fetch(`${watchUrl(videoId)}&hl=en`, {
      headers: { "User-Agent": UA, "Accept-Language": "en-US,en;q=0.9", Cookie: "CONSENT=YES+1; SOCS=CAI" },
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    });
    const html = await res.text();
    const m = html.match(/"captionTracks":(\[.*?\])/);
    return m ? (JSON.parse(m[1]) as CaptionTrack[]) : [];
  } catch {
    return [];
  }
}

/** Sous-titres manuels en anglais d'abord, puis automatiques, puis n'importe quelle langue. */
function pickTrack(tracks: CaptionTrack[]): CaptionTrack | null {
  const manual = tracks.filter((t) => t.kind !== "asr");
  const auto = tracks.filter((t) => t.kind === "asr");
  const en = (list: CaptionTrack[]) => list.find((t) => /^en\b/i.test(t.languageCode));
  return en(manual) ?? en(auto) ?? manual[0] ?? auto[0] ?? null;
}

interface Json3 {
  events?: { tStartMs?: number; dDurationMs?: number; segs?: { utf8?: string }[] }[];
}

/** Texte lisible : phrases regroupées en paragraphes, une pause de 3 s ou ~600 caractères ouvre un paragraphe. */
function json3ToText(json: Json3): string {
  const paras: string[] = [];
  let cur = "";
  let lastEnd = 0;
  for (const ev of json.events ?? []) {
    const line = (ev.segs ?? [])
      .map((s) => s.utf8 ?? "")
      .join("")
      .replace(/\s+/g, " ")
      .trim();
    if (!line) continue;
    const start = ev.tStartMs ?? 0;
    if (cur && (start - lastEnd > 3000 || cur.length > 600)) {
      paras.push(cur.trim());
      cur = "";
    }
    cur += `${line} `;
    lastEnd = start + (ev.dDurationMs ?? 0);
  }
  if (cur.trim()) paras.push(cur.trim());
  return paras.join("\n\n");
}

export interface Captions {
  text: string;
  language: string;
  auto: boolean;
  durationSec: number;
}

/** La durée de la vidéo en secondes, 0 si YouTube ne la donne pas au serveur. Ne lève jamais. */
export async function fetchDuration(videoId: string): Promise<number> {
  const player = await playerAndroid(videoId);
  return Number(player?.videoDetails?.lengthSeconds ?? 0) || 0;
}

/** Les sous-titres de la vidéo, ou null si elle n'en a aucun. Lève une erreur si YouTube bloque. */
export async function fetchCaptions(videoId: string): Promise<Captions | null> {
  let tracks: CaptionTrack[] = [];
  let durationSec = 0;
  const player = await playerAndroid(videoId);
  if (player) {
    tracks = player.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [];
    durationSec = Number(player.videoDetails?.lengthSeconds ?? 0) || 0;
    const st = player.playabilityStatus?.status;
    if (!tracks.length && st && st !== "OK") {
      // LOGIN_REQUIRED / UNPLAYABLE : on tente la page avant d'abandonner.
      tracks = await tracksFromWatchPage(videoId);
      if (!tracks.length) throw new YoutubeError(`YouTube refuse cette vidéo depuis le serveur (${player.playabilityStatus?.reason || st}).`, 502);
    }
  }
  if (!tracks.length) tracks = await tracksFromWatchPage(videoId);
  const track = pickTrack(tracks);
  if (!track) return null;
  const url = `${track.baseUrl.replace(/&fmt=\w+/g, "")}&fmt=json3`;
  const res = await fetch(url, { headers: { "User-Agent": UA }, cache: "no-store", signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new YoutubeError(`Sous-titres injoignables (HTTP ${res.status}).`, 502);
  const text = json3ToText((await res.json()) as Json3);
  if (!text.trim()) return null;
  return { text, language: track.languageCode, auto: track.kind === "asr", durationSec };
}

/** Le prompt par défaut du scénariste (celui du coach, relu). Modifiable dans la page. */
export const DEFAULT_SCRIPT_PROMPT = `Tu es mon scénariste YouTube. Tu m'aides à transformer des vidéos qui marchent sur le marché américain en scripts pour mon marché, sans les traduire : on garde ce qui fait marcher la vidéo (structure, rythme, mécanique du hook), on change le fond pour qu'il soit vrai pour moi et mon audience.

QUI JE SUIS
- Mady, 24 ans, coach e-commerce et IA, marché francophone. Mon offre : Scale X, accompagnement 1:1 pour débutants.
- Ma différence : je fais vraiment de l'e-commerce, je montre mes boutiques et mes chiffres, je ne vends pas de rêve. Je suis cash, drôle, familier. Je parle comme à un pote.
- Mes expressions à garder dans les scripts : « frérot », « en vrai », « le rêve », « officiel ? », « let's go », « honnêtement ». Je tutoie toujours.
- Mon histoire : parti sans argent, business ratés, mon meilleur ami qui a explosé en e-com à côté de moi, puis plus de 1M généré grâce à l'e-com.
- Mes ressources pour le CTA indirect : [à compléter : masterclass gratuite, guide produit, lien en description…]

À QUI JE PARLE
Un débutant francophone, 20 à 60 ans, qui veut un revenu complémentaire, ne sait pas par où commencer, a peur de perdre de l'argent sur les mauvais produits ou les mauvaises pubs, est attiré par l'IA, et a besoin d'être accompagné.

MES TROIS PILIERS
1. La preuve : mes boutiques, mes chiffres, mes élèves.
2. La méthode : trouver un produit, monter une boutique avec l'IA, lancer une pub Meta, lire les données.
3. La peur : comment ne pas perdre d'argent, et les promesses du marché démontées.

CE QUE TU FAIS QUAND JE T'ENVOIE UN TRANSCRIPT
1. Analyse d'abord, en 10 lignes max : le hook (quelle promesse, quelle émotion, en combien de secondes), la structure (les blocs et leur ordre, avec le minutage approximatif), ce qui retient le spectateur (preuve, histoire, tension, relances d'attention), le CTA. Dis-moi pourquoi cette vidéo marche.
2. Puis écris MON script, en français, en points et pas en texte à apprendre par cœur, avec cette structure :
   - 3 options de hook, 15 secondes max chacune, dans ma façon de parler. Je choisis.
   - Le corps en 3 à 5 blocs. Chaque bloc = une idée complète qui tient seule, avec un titre, les points à dire, et entre crochets ce qu'on montre à l'écran [écran : dashboard Shopify / boutique / chiffres] ou en B-roll [B-roll : …].
   - Un moment histoire ou cas élève au milieu, là où l'attention baisse.
   - Un CTA indirect vers une de mes ressources, au quart de la vidéo, cohérent avec le thème de la vidéo, et un CTA direct à la fin (à adapter selon la rétention : on attendra 3 semaines de publication avant de trancher).
   - À la fin : le titre YouTube (3 options) et la liste des B-roll à prévoir pour le monteur.

RÈGLES
- Chaque chiffre annoncé doit avoir sa preuve à l'écran. Si je n'ai pas la preuve, tu mets [À VÉRIFIER] et tu ne l'inventes pas.
- Jamais de promesse de revenu (« gagne 10 000 € en 30 jours »). On montre, on ne promet pas.
- Pas de jargon américain traduit. Si le transcript parle de dropshipping aux US avec des exemples américains, tu remplaces par des exemples qui parlent à un Français ou un Belge.
- Les blagues et les expressions restent. Si le script ressemble à celui d'un coach générique, tu as raté.
- Durée cible : 8 à 12 minutes, soit environ 1 200 à 1 800 mots parlés.
- Si le transcript n'est pas adaptable à mon marché ou à mes piliers, dis-le en une ligne et propose un autre angle sur le même sujet, plutôt que de forcer.

Quand j'envoie un transcript, commence directement par l'analyse, puis le script. Pas d'introduction, pas de résumé de ce que tu vas faire.`;

/** Le message utilisateur envoyé au modèle (ou collé dans Claude) : titre, chaîne, transcript. */
export function transcriptMessage(v: { title: string; author: string; durationSec: number; transcript: string }): string {
  const dur = v.durationSec ? ` · ${Math.floor(v.durationSec / 60)} min ${v.durationSec % 60} s` : "";
  return `TRANSCRIPT DE LA VIDÉO\nTitre : ${v.title || "(sans titre)"}\nChaîne : ${v.author || "?"}${dur}\n\n${v.transcript.trim()}`;
}
