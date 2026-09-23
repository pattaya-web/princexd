import { NextRequest, NextResponse } from "next/server";
import { readDB, writeDB } from "@/lib/db";
import { fetchAudience, fetchPostInsights, InstagramError } from "@/lib/instagram";

export const dynamic = "force-dynamic";

/**
 * Detail d'une publication : ses insights a jour et l'audience du compte.
 *
 * Instagram ne fournit pas de repartition homme/femme par publication : la
 * seule demographie disponible est celle des abonnes du compte. On la met en
 * cache 24 h dans les reglages, elle bouge lentement et chaque appel coute
 * quatre requetes sur un quota de 200 par heure.
 */
const AUDIENCE_TTL_MS = 24 * 60 * 60 * 1000;

export async function GET(req: NextRequest) {
  const postId = req.nextUrl.searchParams.get("postId");
  if (!postId) return NextResponse.json({ error: "postId manquant" }, { status: 400 });

  const db = readDB();
  const post = db.posts.find((p) => p.id === postId);
  if (!post?.igMediaId) {
    return NextResponse.json({ error: "Publication introuvable" }, { status: 404 });
  }

  const cached = db.settings.igAudience ?? null;
  const fresh = cached && Date.now() - new Date(cached.fetchedAt).getTime() < AUDIENCE_TTL_MS;

  try {
    const [insights, audience] = await Promise.all([
      fetchPostInsights(post.igMediaId, post.format.startsWith("reel")),
      fresh ? Promise.resolve(cached) : fetchAudience(),
    ]);

    // Les compteurs de la publication suivent : la liste du dashboard est a jour
    // sans attendre la prochaine synchro complete.
    post.views = insights.views;
    post.likes = insights.likes;
    post.comments = insights.comments;
    post.saves = insights.saves;
    post.shares = insights.shares;
    if (!fresh) db.settings.igAudience = audience;
    writeDB(db);

    return NextResponse.json({ insights, audience });
  } catch (e) {
    const err = e as InstagramError;
    return NextResponse.json({ error: err.message }, { status: err.code === 401 ? 401 : 502 });
  }
}
