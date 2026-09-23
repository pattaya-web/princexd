import { NextRequest, NextResponse } from "next/server";
import { readDB, writeDB } from "@/lib/db";
import { askText, KieError, parseJsonLoose } from "@/lib/kie";
import { buildProfilerPrompt, SYSTEM_PROFILER } from "@/lib/prompts";
import type { ContentAnalysis } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Au-delà, le prompt s'alourdit sans rien apprendre de plus. */
const MAX_POSTS = 40;

/**
 * Diagnostic d'un compte : de quoi parle-t-il réellement.
 *
 * Sans `creator`, l'analyse porte sur mon propre compte. Le résultat est
 * conservé — c'est un appel IA, on ne le refait pas à chaque affichage.
 */
export async function POST(req: NextRequest) {
  const { creator, force } = (await req.json().catch(() => ({}))) as {
    creator?: string;
    force?: boolean;
  };

  const db = readDB();
  const handle = creator?.trim().toLowerCase();

  const known = handle
    ? db.creators.find((c) => c.username === handle)?.analysis
    : db.settings.myAnalysis;
  if (known && !force) return NextResponse.json({ analysis: known, cached: true });

  // Les plus engageantes d'abord : c'est là que le style du compte se lit.
  const source = handle
    ? db.creatorPosts
        .filter((p) => p.creator === handle)
        .map((p) => ({ caption: p.caption, likes: p.likes, comments: p.comments }))
    : db.posts
        .filter((p) => p.status === "publie")
        .map((p) => ({ caption: p.caption ?? p.title, likes: p.likes, comments: p.comments }));

  const posts = source
    .filter((p) => p.caption.trim())
    .sort((a, b) => b.likes + b.comments - (a.likes + a.comments))
    .slice(0, MAX_POSTS);

  if (posts.length < 5) {
    return NextResponse.json(
      { error: `Pas assez de publications avec légende pour analyser (${posts.length}).` },
      { status: 400 },
    );
  }

  try {
    const raw = await askText(
      buildProfilerPrompt({ who: handle ? `@${handle}` : "mon compte", posts }),
      SYSTEM_PROFILER,
      4000,
    );
    const parsed = parseJsonLoose<ContentAnalysis>(raw);

    const analysis: ContentAnalysis = {
      resume: String(parsed.resume ?? ""),
      types: Array.isArray(parsed.types) ? parsed.types : [],
      hooks: Array.isArray(parsed.hooks) ? parsed.hooks : [],
      cta: Array.isArray(parsed.cta) ? parsed.cta : [],
      aRetenir: Array.isArray(parsed.aRetenir) ? parsed.aRetenir : [],
      posts: posts.length,
      generatedAt: new Date().toISOString(),
    };

    const fresh = readDB();
    if (handle) {
      const target = fresh.creators.find((c) => c.username === handle);
      if (target) target.analysis = analysis;
    } else {
      fresh.settings.myAnalysis = analysis;
    }
    writeDB(fresh);

    return NextResponse.json({ analysis, cached: false });
  } catch (e) {
    const err = e as KieError;
    return NextResponse.json({ error: err.message }, { status: err.code === 401 ? 401 : 502 });
  }
}
