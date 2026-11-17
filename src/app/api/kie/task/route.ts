import { NextRequest, NextResponse } from "next/server";
import { getTask, isRateLimited, KieError } from "@/lib/kie";
import { readDB, withKieKey, writeDB } from "@/lib/db";
import { keyForOwner, ownGenerations, scopeError, studioScope } from "@/lib/studio-tenant";
import { relaunchAllDue, relaunchNow, relaunchPending, scheduleRelaunch } from "@/lib/studio/relaunch";
import { applyWideCrop } from "@/lib/studio/wide";
import { warmThumb } from "@/lib/thumbs";

export const dynamic = "force-dynamic";

/**
 * Rafraîchit une ou plusieurs générations en cours.
 * Sans paramètre, reprend toutes les tâches encore ouvertes — c'est ce que
 * le Studio appelle en boucle tant qu'il reste quelque chose à attendre.
 */
export async function GET(req: NextRequest) {
  const one = req.nextUrl.searchParams.get("taskId");
  /*
   * `list=1` : le client suivait des rendus et veut la liste meme si plus
   * rien n'est en attente. Sur le VPS, KIE previent le serveur par rappel
   * (/api/kie/callback) : la generation passe en « success » entre deux
   * sondages, et sans ce parametre la reponse repartait sans generations.
   * Le dock ne rediffusait rien, la case restait sur le chrono jusqu'a F5.
   */
  const wantList = req.nextUrl.searchParams.get("list") === "1";
  // Chacun ne sonde et ne voit que ses generations (eleve : les siennes, avec sa cle).
  let scope;
  try {
    scope = studioScope(req);
  } catch (e) {
    const { error, status } = scopeError(e);
    return NextResponse.json({ error }, { status });
  }
  const db = readDB();
  const mine = ownGenerations(db, scope.ownerId);
  const updated: string[] = [];
  let changed = false;

  // Refus de cadence KIE : les relances programmées dont l'heure est venue repartent ici.
  const relaunched = await relaunchAllDue(db, mine);
  if (relaunched.length) {
    changed = true;
    for (const g of relaunched) updated.push(g.taskId);
  }

  // Une génération en attente de relance n'a pas encore de tâche à sonder.
  const pending = mine.filter(
    (g) => (one ? g.taskId === one : g.state !== "success" && g.state !== "fail" && !relaunchPending(g)),
  );
  if (!pending.length) {
    if (changed) writeDB(db);
    const remaining = mine.filter((g) => g.state !== "success" && g.state !== "fail").length;
    return NextResponse.json(
      wantList || changed
        ? { updated, remaining, generations: mine.slice(0, 60) }
        : { updated, remaining },
    );
  }
  // Les taches sont interrogees en parallele : en serie, douze appels de
  // 300 ms depassaient l'intervalle de sondage et empilaient les requetes.
  const batch = pending.slice(0, 12);
  const results = await Promise.allSettled(
    batch.map((gen) => {
      const key = keyForOwner(db, gen.ownerId);
      return key ? withKieKey(key, () => getTask(gen.taskId)) : getTask(gen.taskId);
    }),
  );
  for (const [i, gen] of batch.entries()) {
    const r = results[i];
    if (r.status === "rejected") {
      // Une tâche qui échoue à répondre ne doit pas bloquer les autres.
      const msg = (r.reason as KieError)?.message ?? String(r.reason);
      // Cadence de sondage refusée : rien à noter, le tour suivant repassera.
      if (isRateLimited(msg, (r.reason as KieError)?.code)) continue;
      if (gen.failMsg !== msg) {
        gen.failMsg = msg;
        changed = true;
      }
      continue;
    }
    const rec = r.value;
    const same =
      gen.state === rec.state &&
      gen.progress === rec.progress &&
      gen.failMsg === rec.failMsg &&
      gen.creditsConsumed === rec.creditsConsumed &&
      JSON.stringify(gen.resultUrls ?? []) === JSON.stringify(rec.resultUrls);
    // Rien n'a bouge chez KIE : on ne reecrit pas plusieurs Mo pour rien.
    if (same) continue;
    changed = true;
    gen.state = rec.state;
    gen.resultUrls = rec.resultUrls;
    // Format 32:9 demandé : recadrage avant d'exposer le résultat.
    await applyWideCrop(gen);
    for (const u of gen.resultUrls ?? []) warmThumb(u);
    gen.creditsConsumed = rec.creditsConsumed;
    gen.failMsg = rec.failMsg;
    gen.progress = rec.progress;
    /*
     * On mesure nous-memes, et on ignore le `costTime` de KIE.
     *
     * Il est publie sans unite documentee : une tache de 600 s reelles
     * renvoyait 600, qu'on divisait par 1000 en le croyant en
     * millisecondes — d'ou les « genere en 0 min 01 » affiches sur des
     * generations de dix minutes. Notre propre mesure n'a pas d'ambiguite.
     */
    if (!gen.costTimeSec && (rec.state === "success" || rec.state === "fail")) {
      gen.costTimeSec = Math.max(
        1,
        Math.round((Date.now() - new Date(gen.createdAt).getTime()) / 1000),
      );
    }
    gen.updatedAt = new Date().toISOString();
    // Échec passager (cadence) : la même tâche sera reposée un peu plus tard.
    if (rec.state === "fail") scheduleRelaunch(gen, rec.failMsg);
    updated.push(gen.taskId);
  }
  if (changed) writeDB(db);

  const remaining = mine.filter((g) => g.state !== "success" && g.state !== "fail").length;
  return NextResponse.json({ updated, remaining, generations: mine.slice(0, 60) });
}

/**
 * Relance à la main une génération en échec (bouton « Relancer » de la
 * tuile) : même modèle, mêmes entrées, nouvelle tâche KIE tout de suite.
 */
export async function POST(req: NextRequest) {
  let scope;
  try {
    scope = studioScope(req);
  } catch (e) {
    const { error, status } = scopeError(e);
    return NextResponse.json({ error }, { status });
  }
  const { id } = (await req.json().catch(() => ({}))) as { id?: string };
  const db = readDB();
  const gen = ownGenerations(db, scope.ownerId).find((g) => g.id === id);
  if (!gen) return NextResponse.json({ error: "Génération introuvable." }, { status: 404 });
  if (gen.state !== "fail") return NextResponse.json({ error: "Cette génération n'est pas en échec." }, { status: 409 });
  gen.relaunches = 0;
  await relaunchNow(db, gen);
  writeDB(db);
  // 422 et non 502 : derrière Cloudflare, un 502 est remplacé par sa page HTML et le message se perd.
  if (gen.state === "fail") return NextResponse.json({ error: gen.failMsg || "KIE a refusé la relance." }, { status: 422 });
  return NextResponse.json(gen);
}
