import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";
import { insert, newId } from "@/lib/db";
import { getOpenAiKey, OpenAiError } from "@/lib/openai";
import type { Generation } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const MEDIA_DIR = path.join(process.cwd(), "data", "media");

/** Modèles d'image OpenAI acceptés, du meilleur au plus économique. */
const MODELS = new Set(["gpt-image-2", "gpt-image-1.5", "gpt-image-1", "gpt-image-1-mini"]);
/**
 * Formats acceptes. gpt-image-2 prend n'importe quelle dimension, les modeles
 * anterieurs seulement les trois carres/portrait/paysage historiques : la
 * liste couvre les deux cas, l'interface restreint deja selon le modele.
 */
const SIZES = new Set([
  "auto",
  "1024x1024",
  "1024x1536",
  "1536x1024",
  "864x1536",
  "1152x1536",
  "1024x1280",
  "1536x1152",
  "1536x864",
]);

/**
 * Édition d'image via OpenAI.
 *
 * Contrairement à KIE, qui va CHERCHER les images sur internet et impose donc
 * un serveur exposé, cette API accepte les fichiers en multipart : le swap
 * fonctionne sans tunnel.
 *
 * KIE expose bien gpt-image-2-image-to-image, mais il ignore les images
 * fournies et retombe en texte-vers-image (vérifié : le rendu n'avait aucun
 * rapport avec les sources). D'où le passage direct par OpenAI.
 */
export async function POST(req: NextRequest) {
  const key = getOpenAiKey();
  if (!key) {
    return NextResponse.json(
      { error: "Aucune clé OpenAI configurée (Réglages, ou OPENAI_API_KEY dans .env.local)." },
      { status: 401 },
    );
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Requête illisible." }, { status: 400 });
  }

  const prompt = String(form.get("prompt") ?? "").trim();
  if (!prompt) return NextResponse.json({ error: "Consigne manquante." }, { status: 400 });

  const model = String(form.get("model") ?? "gpt-image-2");
  if (!MODELS.has(model)) return NextResponse.json({ error: `Modèle inconnu : ${model}` }, { status: 400 });

  const size = String(form.get("size") ?? "1024x1536");
  if (!SIZES.has(size)) return NextResponse.json({ error: `Format inconnu : ${size}` }, { status: 400 });

  const images = form.getAll("image").filter((f): f is File => f instanceof File);
  if (!images.length) return NextResponse.json({ error: "Aucune image reçue." }, { status: 400 });

  const upstream = new FormData();
  upstream.append("model", model);
  upstream.append("prompt", prompt);
  upstream.append("size", size);
  // L'ordre est significatif : la scène d'abord, la référence de visage ensuite.
  for (const img of images) upstream.append("image[]", img, img.name);

  try {
    const res = await fetch("https://api.openai.com/v1/images/edits", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}` },
      body: upstream,
      cache: "no-store",
    });

    const text = await res.text();
    let json: {
      data?: { b64_json?: string }[];
      usage?: { total_tokens?: number };
      error?: { message?: string };
    };
    try {
      json = JSON.parse(text) as typeof json;
    } catch {
      throw new OpenAiError(`Réponse OpenAI illisible (HTTP ${res.status}).`, res.status);
    }

    if (!res.ok || json.error) {
      throw new OpenAiError(json.error?.message ?? `Erreur OpenAI (HTTP ${res.status}).`, res.status);
    }

    const b64 = json.data?.[0]?.b64_json;
    if (!b64) throw new OpenAiError("OpenAI n'a renvoyé aucune image.", 502);

    await fs.mkdir(MEDIA_DIR, { recursive: true });
    const stored = `${newId()}.png`;
    await fs.writeFile(path.join(MEDIA_DIR, stored), Buffer.from(b64, "base64"));

    // La tâche est déjà terminée : on l'enregistre directement en succès pour
    // qu'elle apparaisse dans la galerie sans passer par le polling KIE.
    const row = insert("generations", {
      taskId: `openai-${stored}`,
      model,
      kind: "image",
      prompt,
      input: { model, size, images: images.length },
      state: "success",
      resultUrls: [`/api/media/${stored}`],
      creditsConsumed: 0,
      failMsg: "",
      progress: 100,
      costTimeSec: 0,
      updatedAt: new Date().toISOString(),
    }) as unknown as Generation;

    return NextResponse.json({
      generation: row,
      tokens: json.usage?.total_tokens ?? 0,
    });
  } catch (e) {
    const err = e as OpenAiError;
    return NextResponse.json({ error: err.message }, { status: err.code === 401 ? 401 : 502 });
  }
}
