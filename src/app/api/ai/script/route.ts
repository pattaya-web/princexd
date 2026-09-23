import { NextRequest, NextResponse } from "next/server";
import { askText, askVision, KieError, parseJsonLoose } from "@/lib/kie";
import { getSettings, readDB, writeDB } from "@/lib/db";
import { buildScriptPrompt, SYSTEM_SCRIPTER } from "@/lib/prompts";
import type { PostScript } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * « Take Script » : démonte une publication existante en plan de tournage.
 *
 * L'API Instagram ne donne ni audio ni transcription, et le modèle texte de KIE
 * n'accepte pas de vidéo. La reconstruction part donc de la légende complète et
 * des chiffres de performance — sauf si l'utilisateur colle une vraie
 * transcription, auquel cas elle fait autorité.
 */
export async function POST(req: NextRequest) {
  const { postId, transcript, force } = (await req.json().catch(() => ({}))) as {
    postId?: string;
    transcript?: string;
    force?: boolean;
  };

  if (!postId) return NextResponse.json({ error: "postId manquant" }, { status: 400 });

  const db = readDB();
  const post = db.posts.find((p) => p.id === postId);
  if (!post) return NextResponse.json({ error: "Publication introuvable" }, { status: 404 });

  // Un script déjà généré est resservi tel quel : inutile de rebrûler des crédits.
  if (post.blueprint && !force && !transcript?.trim()) {
    return NextResponse.json({ blueprint: post.blueprint, cached: true });
  }

  if (!post.caption?.trim() && !transcript?.trim()) {
    return NextResponse.json(
      { error: "Cette publication n'a ni légende ni transcription : rien à démonter." },
      { status: 400 },
    );
  }

  const prompt = buildScriptPrompt({
    caption: post.caption ?? "",
    transcript,
    format: post.format,
    views: post.views,
    likes: post.likes,
    comments: post.comments,
    saves: post.saves,
    shares: post.shares,
    publishedAt: post.publishedAt || post.createdAt,
    brandContext: getSettings().brandContext,
    hasFrame: Boolean(post.thumbnail),
  });

  try {
    // La vignette Instagram est la vraie premiere image du reel : la donner au
    // modele rend le plan 1 observe au lieu de suppose. L'audio, lui, reste
    // hors de portee — KIE n'ingere ni video ni son (verifie).
    const raw = post.thumbnail
      ? await askVision(prompt, SYSTEM_SCRIPTER, [post.thumbnail], 6000)
      : await askText(prompt, SYSTEM_SCRIPTER, 6000);
    const parsed = parseJsonLoose<PostScript>(raw);

    const blueprint: PostScript = {
      ...parsed,
      plans: Array.isArray(parsed.plans) ? parsed.plans : [],
      pourquoiCaMarche: Array.isArray(parsed.pourquoiCaMarche) ? parsed.pourquoiCaMarche : [],
      aRefaire: Array.isArray(parsed.aRefaire) ? parsed.aRefaire : [],
      fromTranscript: Boolean(transcript?.trim()),
      fromFrame: Boolean(post.thumbnail),
      generatedAt: new Date().toISOString(),
    };

    const fresh = readDB();
    const target = fresh.posts.find((p) => p.id === postId);
    if (target) {
      target.blueprint = blueprint;
      writeDB(fresh);
    }

    return NextResponse.json({ blueprint, cached: false });
  } catch (e) {
    const err = e as KieError;
    return NextResponse.json({ error: err.message }, { status: err.code === 401 ? 401 : 502 });
  }
}
