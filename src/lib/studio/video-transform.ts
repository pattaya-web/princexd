import { PROVIDERS } from "./config";
import { quote } from "./costs";
import { compressVideo, ensureLocal, firstFrame, makeReferenceSheet, nearestAspect, probe, publishToKie } from "./media";
import { getProvider, type PollResult } from "./providers";
import { noProviderReason, providerRejects, selectBestProvider } from "./select-provider";
import type { ProviderId, ProviderInput, StudioJob } from "./types";

/**
 * Orchestration vidéo : prépare les sources, choisit le provider, lance la
 * tâche, puis la suit. Ne touche pas à la base : c'est `jobs.ts` qui persiste
 * ce que ces fonctions renvoient.
 */

export class TransformError extends Error {}

function callbackUrl(): string | undefined {
  const base = process.env.PUBLIC_BASE_URL?.trim();
  return base && !base.includes("localhost") ? `${base}/api/kie/callback` : undefined;
}

export interface StartOutcome {
  provider: StudioJob["provider"];
  sourceDurationSec: number;
  remoteSourceUrl: string;
  remoteReferenceUrl: string;
  providerJobId: string;
  providerInput: Record<string, unknown>;
  creditsEstimated: number;
}

/**
 * Étape « uploading » puis « generating_video ».
 *
 * `onProgress` permet à l'appelant d'enregistrer les URL publiques dès
 * qu'elles existent : si le serveur redémarre entre l'upload et la création
 * de la tâche, on ne renvoie pas 100 Mo une seconde fois.
 */
export async function startTransformation(
  job: StudioJob,
  onProgress: (patch: Partial<StudioJob>) => Promise<void>,
): Promise<StartOutcome> {
  const src = await ensureLocal(job.sourceVideo);
  const ref = await ensureLocal(job.referenceImage);
  const info = await probe(src.path);
  const durationSec = info.durationSec || job.sourceDurationSec || 0;

  const hasProduct = (job.productImages ?? []).length > 0;
  const sel = { transform: job.transform, durationSec, sourceBytes: info.bytes, hasProduct };
  const provider = job.requestedProvider === "auto" ? selectBestProvider(sel) : job.requestedProvider;
  // (les jobs « photo qui parle » ne passent jamais ici : leur moteur n'est pas un provider video)
  const refusal = job.requestedProvider === "auto" ? noProviderReason(sel) : providerRejects(provider, sel);
  if (refusal) throw new TransformError(refusal);

  await onProgress({ provider, sourceDurationSec: durationSec, sourceVideo: src.url, referenceImage: ref.url });

  let remoteSourceUrl = job.remoteSourceUrl;
  let remoteReferenceUrl = job.remoteReferenceUrl;
  if (!remoteSourceUrl) {
    let uploadPath = src.path;
    const limit = PROVIDERS[provider];
    const tooManyPixels = Boolean(limit.maxSourcePixels && info.width * info.height > limit.maxSourcePixels);
    if (limit.compressSource && (info.bytes > limit.maxSourceBytes || tooManyPixels)) {
      const small = await compressVideo(src.path, limit.maxSourceBytes, durationSec, {
        maxPixels: limit.maxSourcePixels,
        width: info.width,
        height: info.height,
      });
      if (small.bytes > limit.maxSourceBytes) {
        throw new TransformError(`${limit.label} accepte ${Math.round(limit.maxSourceBytes / 1e6)} Mo maximum et la vidéo reste trop lourde même compressée : raccourcis-la.`);
      }
      uploadPath = small.path;
    }
    remoteSourceUrl = await publishToKie(uploadPath, job.sourceVideoName);
    await onProgress({ remoteSourceUrl });
  }
  /*
   * Vues du personnage : la premiere est la reference principale. Avec 2 ou 3
   * photos, les modeles multi-images les recoivent toutes ; les autres
   * recoivent une planche assemblee (face + dos + tenue cote a cote).
   */
  const views = (job.referenceImages?.length ? job.referenceImages : [job.referenceImage]).slice(0, 3);
  let remoteReferenceUrls = job.remoteReferenceUrls ?? [];
  if (remoteReferenceUrls.length !== views.length) {
    remoteReferenceUrls = [];
    for (const [k, u] of views.entries()) {
      const local = k === 0 ? ref : await ensureLocal(u);
      remoteReferenceUrls.push(await publishToKie(local.path, k === 0 ? job.referenceImageName : `vue-${k + 1}`));
    }
    await onProgress({ remoteReferenceUrls });
  }
  const multi = Boolean(PROVIDERS[provider].multiRef);
  if (!remoteReferenceUrl) {
    if (views.length > 1 && !multi) {
      const paths = [ref.path];
      for (const u of views.slice(1)) paths.push((await ensureLocal(u)).path);
      const sheet = await makeReferenceSheet(paths);
      await onProgress({ referenceSheet: sheet.url });
      remoteReferenceUrl = await publishToKie(sheet.path, "planche-personnage.jpg");
    } else {
      remoteReferenceUrl = remoteReferenceUrls[0];
    }
    await onProgress({ remoteReferenceUrl });
  }

  // Photos du produit : publiees une fois, reutilisees aux relances.
  let remoteProductUrls = job.remoteProductUrls ?? [];
  if (hasProduct && PROVIDERS[provider].supportsProduct && remoteProductUrls.length !== job.productImages.length) {
    remoteProductUrls = [];
    for (const [k, u] of job.productImages.entries()) {
      const local = await ensureLocal(u);
      remoteProductUrls.push(await publishToKie(local.path, `produit-${k + 1}`));
    }
    await onProgress({ remoteProductUrls });
  }

  // Nouveau lieu fourni : publie, et il remplace l'image fixe du decor d'origine.
  let remoteSceneImageUrl = job.remoteSceneImageUrl ?? "";
  if (job.sceneImage && !remoteSceneImageUrl) {
    const scene = await ensureLocal(job.sceneImage);
    remoteSceneImageUrl = await publishToKie(scene.path, "nouveau-decor");
    await onProgress({ remoteSceneImageUrl });
  }

  // Image fixe de la video : les modeles qui regenerent la scene tiennent mieux le decor en la voyant.
  let remoteSceneUrl = job.remoteSceneUrl ?? "";
  if (PROVIDERS[provider].wantsSceneFrame && !remoteSceneUrl && !remoteSceneImageUrl) {
    const frame = await firstFrame(src.path, Math.min(0.4, Math.max(0, durationSec / 2)));
    remoteSceneUrl = await publishToKie(frame.path, "scene");
    await onProgress({ remoteSceneUrl });
  }

  const input: ProviderInput = {
    sourceVideoUrl: remoteSourceUrl,
    referenceImageUrl: remoteReferenceUrl,
    referenceImageUrls: multi ? remoteReferenceUrls : [remoteReferenceUrl],
    userPrompt: job.userPrompt,
    prompt: job.prompt,
    negativePrompt: job.negativePrompt,
    resolution: job.resolution,
    aspectRatio: job.aspectRatio === "original" ? nearestAspect(info.width, info.height) : job.aspectRatio,
    durationSec,
    keepAudio: job.voiceMode !== "none",
    ...(remoteProductUrls.length ? { product: { urls: remoteProductUrls, description: job.productDescription } } : {}),
    ...(remoteSceneUrl ? { sceneFrameUrl: remoteSceneUrl } : {}),
    ...(remoteSceneImageUrl ? { sceneImageUrl: remoteSceneImageUrl } : {}),
  };

  const estimate = quote({
    provider,
    transform: job.transform,
    durationSec,
    resolution: job.resolution,
    variants: 1,
    hasProduct,
  });

  const started = await getProvider(provider).generateVideoTransformation(input, callbackUrl());
  return {
    provider,
    sourceDurationSec: durationSec,
    remoteSourceUrl,
    remoteReferenceUrl,
    providerJobId: started.providerJobId,
    providerInput: started.payload,
    creditsEstimated: estimate.creditsPerVideo,
  };
}

export function pollTransformation(job: StudioJob): Promise<PollResult> {
  return getProvider(job.provider as ProviderId).poll(job.providerJobId);
}

/**
 * Traduit les refus des fournisseurs en phrases lisibles.
 * Toujours préfixé du nom du provider : « La génération Wan a échoué ».
 */
export function readableProviderError(provider: StudioJob["provider"], raw: string): string {
  const cfg = (PROVIDERS as Record<string, (typeof PROVIDERS)[keyof typeof PROVIDERS] | undefined>)[provider];
  const label = cfg?.label ?? (provider === "infinitalk" ? "InfiniteTalk" : provider);
  const m = (raw || "").toLowerCase();
  let why = raw?.trim() ?? "";
  if (m.includes("file type") || m.includes("not supported")) {
    why = "format de fichier refusé (vidéo en MP4/MOV, image en JPG/PNG).";
  } else if (m.includes("duration")) {
    why = cfg ? `durée de vidéo hors limites (${cfg.minDurationSec}–${cfg.maxDurationSec} s).` : "durée hors limites.";
  } else if (m.includes("size") || m.includes("large")) {
    why = "fichier trop lourd.";
  } else if (m.includes("insufficient") || m.includes("credit")) {
    why = "crédits KIE insuffisants.";
  } else if (m.includes("nsfw") || m.includes("sensitive") || m.includes("policy")) {
    why = "contenu refusé par le filtre du modèle.";
  } else if (m.includes("timeout") || m.includes("timed out")) {
    why = "le fournisseur n'a pas répondu à temps.";
  }
  const detail = raw?.trim() && why !== raw.trim() ? ` (détail : ${raw.trim().slice(0, 160)})` : "";
  return why ? `La génération ${label} a échoué : ${why}${detail}` : `La génération ${label} a échoué.`;
}
