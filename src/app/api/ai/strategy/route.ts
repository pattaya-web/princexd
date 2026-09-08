import { NextResponse } from "next/server";
import { askText, KieError, parseJsonLoose } from "@/lib/kie";
import { getSettings, list } from "@/lib/db";
import { buildStrategyPrompt, SYSTEM_STRATEGE } from "@/lib/prompts";
import { projectGoal, statsByDimension, type DimensionStat } from "@/lib/analytics";
import { fmtPct } from "@/lib/format";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

function table(rows: DimensionStat[]) {
  if (!rows.length) return "(aucune donnée)";
  return rows
    .map(
      (r) =>
        `- ${r.label} : ${r.posts} posts, ${Math.round(r.avgViews)} vues/post en moyenne, ` +
        `engagement ${fmtPct(r.avgEngagementRate * 100)}, saves ${fmtPct(r.avgSaveRate * 100)}, ` +
        `${r.followersPerPost.toFixed(1)} abonnés/post, ${r.callsBooked} calls, score ${r.score}/100`,
    )
    .join("\n");
}

export async function POST() {
  const settings = getSettings();
  const posts = list("posts");
  const followers = list("followers");

  const published = posts.filter((p) => p.status === "publie" && p.views > 0);
  if (published.length < 3) {
    return NextResponse.json(
      {
        error:
          "Pas assez de données : ajoute les stats d'au moins 3 posts publiés dans Contenu avant de demander une reco.",
      },
      { status: 400 },
    );
  }

  const goal = projectGoal(followers, settings.followersGoal, settings.followersStart);

  const prompt = buildStrategyPrompt({
    brandContext: settings.brandContext,
    goal:
      `Passer de ${goal.current} à ${goal.goal} abonnés. Il manque ${goal.remaining} abonnés. ` +
      `Rythme actuel : ${goal.perDay.toFixed(1)} abonnés/jour. ` +
      `L'objectif final est de générer des appels de vente pour mon coaching, pas juste des vues.`,
    formatStats: table(statsByDimension(posts, (p) => p.format)),
    angleStats: table(statsByDimension(posts, (p) => p.angle)),
    hookStats: table(statsByDimension(posts, (p) => (p.hook ? p.hook.slice(0, 40) : "sans hook"))),
    recentPosts: published
      .slice(0, 15)
      .map(
        (p) =>
          `- "${p.title}" (${p.format} / ${p.angle}) : ${p.views} vues, ${p.followersGained} abonnés, ${p.callsBooked} calls`,
      )
      .join("\n"),
  });

  try {
    const raw = await askText(prompt, SYSTEM_STRATEGE, 6000);
    return NextResponse.json({ strategy: parseJsonLoose(raw) });
  } catch (e) {
    const err = e as KieError;
    return NextResponse.json({ error: err.message }, { status: err.code === 401 ? 401 : 502 });
  }
}
