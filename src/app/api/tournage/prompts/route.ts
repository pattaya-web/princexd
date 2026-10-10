import { NextRequest, NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";
import { newId } from "@/lib/db";
import { askVision, parseJsonLoose, uploadToKie } from "@/lib/kie";

export const dynamic = "force-dynamic";

const MEDIA_DIR = path.join(process.cwd(), "data", "media");

const SYSTEM = `Tu es directeur artistique pour des marques e-commerce qui vendent des produits AliExpress rebrandés.
On te donne la photo d'un produit. Tu réponds UNIQUEMENT en JSON, sans commentaire, avec ces clés :
{
  "product": "nom court du produit en français, 2 à 6 mots, tel qu'on le dirait à voix haute",
  "brandPrompt": "prompt en français pour un assistant IA : créer une marque e-commerce de ce produit qui fait +50 000 € par mois (nom, positionnement, cible, offre, angle, page produit, 3 hooks de pub vidéo, plan Meta Ads 30 jours avec budget). Le produit est décrit précisément à partir de la photo.",
  "imagePrompt": "prompt EN ANGLAIS pour un générateur d'images (Higgsfield) : photo produit ultra réaliste de CE produit précis (matière, couleur, forme, détails visibles), vertical 9:16, esthétique marque premium, lumière studio douce, fond propre avec une touche lifestyle, Sony A7IV 50mm, 8k, no text, no watermark. 60 à 90 mots.",
  "videoPrompt": "prompt EN ANGLAIS pour Kling Motion 3.0 à partir de cette image : mouvement cinématique court (rotation lente, lumière qui balaie, léger push-in caméra, profondeur de champ), fidèle au produit, vertical 9:16, 5 seconds, photorealistic, no text. 40 à 70 mots."
}`;

type Out = { product?: string; brandPrompt?: string; imagePrompt?: string; videoPrompt?: string };

interface Job {
  status: "running" | "done" | "error";
  startedAt: number;
  attempt: number;
  result?: { product: string; brandPrompt: string; imagePrompt: string; videoPrompt: string };
  error?: string;
}

/*
 * Taches en memoire : l'app tourne en un seul processus, et une tache ne vit
 * que quelques minutes. Pas besoin de la base pour ca.
 */
const jobs = new Map<string, Job>();
const JOB_TTL = 15 * 60_000;
/** Un seul modele vision chez KIE (gemini-3-pro), 55 a 130 s avec une image. */
const ATTEMPT_TIMEOUT = 150_000;
const ATTEMPTS = 2;

function sweep() {
  const now = Date.now();
  for (const [id, job] of jobs) if (now - job.startedAt > JOB_TTL) jobs.delete(id);
}

async function run(id: string, file: string) {
  const job = jobs.get(id)!;
  try {
    const buf = await fs.readFile(path.join(MEDIA_DIR, file));
    const ext = path.extname(file).toLowerCase();
    const type = ext === ".png" ? "image/png" : ext === ".webp" ? "image/webp" : "image/jpeg";
    const publicUrl = await uploadToKie(new File([new Uint8Array(buf)], file, { type }), "princexd/tournage");

    let lastError = "";
    for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
      job.attempt = attempt;
      try {
        const raw = await askVision("Analyse cette photo de produit et renvoie le JSON demandé.", SYSTEM, [publicUrl], 1500, { timeoutMs: ATTEMPT_TIMEOUT });
        const out = parseJsonLoose<Out>(raw);
        if (out.imagePrompt && out.videoPrompt) {
          job.result = {
            product: (out.product ?? "").trim(),
            brandPrompt: (out.brandPrompt ?? "").trim(),
            imagePrompt: out.imagePrompt.trim(),
            videoPrompt: out.videoPrompt.trim(),
          };
          job.status = "done";
          return;
        }
        lastError = "réponse incomplète du modèle";
      } catch (e) {
        lastError = (e as Error).message.slice(0, 160);
      }
    }
    throw new Error(lastError || "Analyse impossible.");
  } catch (e) {
    job.status = "error";
    job.error = (e as Error).message || "Analyse impossible.";
  }
}

/**
 * Prompts du kit tournage generes a partir de la photo du produit.
 *
 * Le modele met couramment plus d'une minute : derriere Cloudflare, une
 * requete qui attend la reponse serait coupee a 100 s. On lance donc le
 * travail en tache de fond (POST -> jobId) et la page vient lire l'etat (GET).
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
    await fs.access(path.join(MEDIA_DIR, file));
  } catch {
    return NextResponse.json({ error: "La photo n'est plus sur le serveur : colle-la à nouveau." }, { status: 404 });
  }
  sweep();
  const id = newId();
  jobs.set(id, { status: "running", startedAt: Date.now(), attempt: 0 });
  void run(id, file);
  return NextResponse.json({ jobId: id }, { status: 202 });
}

export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("job") ?? "";
  const job = jobs.get(id);
  if (!job) {
    // Redemarrage du serveur entre-temps : la page relance simplement.
    return NextResponse.json({ error: "Tâche introuvable : relance l'analyse." }, { status: 404 });
  }
  if (job.status === "error") return NextResponse.json({ status: "error", error: job.error }, { status: 502 });
  return NextResponse.json({
    status: job.status,
    attempt: job.attempt,
    elapsed: Math.round((Date.now() - job.startedAt) / 1000),
    ...(job.result ? { result: job.result } : {}),
  });
}
