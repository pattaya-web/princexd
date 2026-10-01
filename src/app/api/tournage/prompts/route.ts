import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";
import { askVision, KieError, parseJsonLoose, uploadToKie } from "@/lib/kie";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const MEDIA_DIR = path.join(process.cwd(), "data", "media");

const SYSTEM = `Tu es directeur artistique pour des marques e-commerce qui vendent des produits AliExpress rebrandés.
On te donne la photo d'un produit. Tu réponds UNIQUEMENT en JSON, sans commentaire, avec ces clés :
{
  "product": "nom court du produit en français, 2 à 6 mots, tel qu'on le dirait à voix haute",
  "brandPrompt": "prompt en français pour un assistant IA : créer une marque e-commerce de ce produit qui fait +50 000 € par mois (nom, positionnement, cible, offre, angle, page produit, 3 hooks de pub vidéo, plan Meta Ads 30 jours avec budget). Le produit est décrit précisément à partir de la photo.",
  "imagePrompt": "prompt EN ANGLAIS pour un générateur d'images (Higgsfield) : photo produit ultra réaliste de CE produit précis (matière, couleur, forme, détails visibles), vertical 9:16, esthétique marque premium, lumière studio douce, fond propre avec une touche lifestyle, Sony A7IV 50mm, 8k, no text, no watermark. 60 à 90 mots.",
  "videoPrompt": "prompt EN ANGLAIS pour Kling Motion 3.0 à partir de cette image : mouvement cinématique court (rotation lente, lumière qui balaie, léger push-in caméra, profondeur de champ), fidèle au produit, vertical 9:16, 5 seconds, photorealistic, no text. 40 à 70 mots."
}`;

/**
 * Prompts du kit tournage generes a partir de la photo du produit.
 *
 * La photo est chez nous (/api/media/…) ; les modeles ne lisent que des
 * adresses publiques, on la depose donc chez KIE le temps de l'analyse.
 */
export async function POST(req: NextRequest) {
  const { url } = (await req.json().catch(() => ({}))) as { url?: string };
  const file = (url ?? "").startsWith("/api/media/") ? url!.slice("/api/media/".length).split("?")[0] : "";
  if (!/^[A-Za-z0-9]+\.[A-Za-z0-9]+$/.test(file)) {
    return NextResponse.json({ error: "Récupère ou colle d'abord la photo du produit." }, { status: 400 });
  }
  try {
    const buf = await fs.readFile(path.join(MEDIA_DIR, file));
    const ext = path.extname(file).toLowerCase();
    const type = ext === ".png" ? "image/png" : ext === ".webp" ? "image/webp" : "image/jpeg";
    const publicUrl = await uploadToKie(new File([new Uint8Array(buf)], file, { type }), "princexd/tournage");
    const raw = await askVision("Analyse cette photo de produit et renvoie le JSON demandé.", SYSTEM, [publicUrl], 2000);
    const out = parseJsonLoose<{ product?: string; brandPrompt?: string; imagePrompt?: string; videoPrompt?: string }>(raw);
    if (!out.imagePrompt || !out.videoPrompt) throw new KieError("Le modèle n'a pas renvoyé les prompts attendus.");
    return NextResponse.json({
      product: (out.product ?? "").trim(),
      brandPrompt: (out.brandPrompt ?? "").trim(),
      imagePrompt: out.imagePrompt.trim(),
      videoPrompt: out.videoPrompt.trim(),
    });
  } catch (e) {
    const err = e as KieError;
    return NextResponse.json({ error: err.message || "Analyse impossible." }, { status: err.code && err.code >= 400 ? err.code : 502 });
  }
}
