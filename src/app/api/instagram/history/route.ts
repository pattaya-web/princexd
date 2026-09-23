import { NextRequest, NextResponse } from "next/server";
import { readDB } from "@/lib/db";
import { buildHistory, fetchFollowerRange, fetchUnfollows, InstagramError } from "@/lib/instagram";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const DAY_MS = 86_400_000;

/**
 * Historique abonnés gagnés / perdus sur une plage libre.
 *
 * `?days=30` pour les raccourcis, ou `?since=2026-08-01&until=2026-08-31`
 * pour une sélection au calendrier. Lecture seule : contrairement à la synchro,
 * cette route n'écrit rien — elle sert juste à explorer une période.
 */
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const todayISO = new Date().toISOString().slice(0, 10);

  // Bornes voulues, exprimées en dates affichées.
  let fromISO = q.get("since") ?? "";
  let toISO = q.get("until") ?? "";

  if (!fromISO || !toISO) {
    const days = Math.min(Math.max(Number(q.get("days")) || 30, 2), 90);
    const end = new Date(Date.now() - DAY_MS); // la journée en cours est incomplète
    toISO = end.toISOString().slice(0, 10);
    fromISO = new Date(end.getTime() - (days - 1) * DAY_MS).toISOString().slice(0, 10);
  }

  if (fromISO > toISO) [fromISO, toISO] = [toISO, fromISO];
  if (toISO > todayISO) toISO = todayISO;

  const fromMs = new Date(`${fromISO}T00:00:00Z`).getTime();
  const toMs = new Date(`${toISO}T00:00:00Z`).getTime();
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs)) {
    return NextResponse.json({ error: "Plage de dates invalide." }, { status: 400 });
  }

  // Meta date ses valeurs par la FIN de fenêtre et les bornes sont exclusives
  // d'un côté : plutôt que de deviner l'arrondi, on demande large et on filtre.
  const since = Math.floor((fromMs - 2 * DAY_MS) / 1000);
  const until = Math.min(Math.floor((toMs + 2 * DAY_MS) / 1000), Math.floor(Date.now() / 1000));

  try {
    const { gains, reach } = await fetchFollowerRange(since, until);
    const db = readDB();

    // Un appel Meta par journee : on complete seulement ce qui manque au cache,
    // et on plafonne pour ne pas vider le quota sur une plage trop large.
    const cache = { ...(db.settings.igUnfollows ?? {}) };
    const wanted = Object.keys(gains)
      .filter((d) => d >= fromISO && d <= toISO && cache[d] === undefined)
      .sort()
      .slice(-45);
    if (wanted.length) Object.assign(cache, await fetchUnfollows(wanted));

    const all = buildHistory(gains, reach, db.followers, cache);
    const history = all.filter((d) => d.date >= fromISO && d.date <= toISO);
    // follower_count n'est conservé qu'environ 30 jours : au-delà, Meta renvoie
    // la portée mais plus aucun gain. On le dit plutôt que d'afficher un plat.
    const gainsMissing = history.length > 0 && history.every((d) => d.gained === 0);
    return NextResponse.json({ history, gainsMissing });
  } catch (e) {
    const err = e as InstagramError;
    return NextResponse.json({ error: err.message }, { status: err.code === 401 ? 401 : 502 });
  }
}
