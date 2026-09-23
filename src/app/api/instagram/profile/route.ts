import { NextRequest, NextResponse } from "next/server";
import { readDB, writeDB } from "@/lib/db";
import { InstagramError } from "@/lib/instagram";
import { runLightSync } from "@/lib/instagram-sync";

export const dynamic = "force-dynamic";

/**
 * Profil Instagram pour l'en-tête du dashboard.
 *
 * Le dashboard appelle cette route à chaque ouverture, mais on ne redemande à
 * Meta que si le cache a plus de 10 minutes : le quota est de 200 appels par
 * heure et une synchro complète en consomme déjà une cinquantaine. `?force=1`
 * court-circuite le cache pour le bouton « Actualiser ».
 */
const TTL_MS = 10 * 60 * 1000;

/**
 * Rafraichissement en tache de fond.
 *
 * La synchro Meta prend ~4,5 s : l'attendre bloquait l'affichage du profil
 * toutes les 10 minutes. On sert donc le cache immediatement et on rattrape
 * derriere. Le verrou evite qu'une rafale d'onglets declenche N synchros.
 */
let refreshing: Promise<void> | null = null;
/*
 * Derniere erreur de la synchro de fond. Avaler l'erreur laissait le
 * dashboard afficher un profil vieux de deux semaines et des miniatures
 * expirees, sans jamais dire que Meta refusait l'acces.
 */
let lastError: string | null = null;
/* Pas de nouvel essai avant ce delai : un token bloque ne se debloque pas
 * en six secondes, et chaque tentative consomme du quota pour rien. */
let retryAfter = 0;
const RETRY_MS = 5 * 60 * 1000;

function refreshInBackground() {
  if (refreshing || Date.now() < retryAfter) return;
  refreshing = (async () => {
    try {
      const db = readDB();
      await runLightSync(db);
      writeDB(db);
      lastError = null;
    } catch (e) {
      lastError = (e as InstagramError).message;
      retryAfter = Date.now() + RETRY_MS;
    } finally {
      refreshing = null;
    }
  })();
}

export async function GET(req: NextRequest) {
  const force = req.nextUrl.searchParams.get("force") === "1";
  const cached = readDB().settings.igProfile;

  const fresh =
    cached && Date.now() - new Date(cached.fetchedAt).getTime() < TTL_MS;

  if (cached && !force) {
    // Cache perime : on le renvoie quand meme et on relance derriere.
    if (!fresh) refreshInBackground();
    return NextResponse.json({
      profile: cached,
      cached: true,
      stale: !fresh,
      ...(lastError ? { error: lastError } : {}),
    });
  }

  try {
    const db = readDB();
    const { snapshot } = await runLightSync(db);
    writeDB(db);
    return NextResponse.json({ profile: snapshot, cached: false });
  } catch (e) {
    const err = e as InstagramError;
    // Token expiré ou Meta indisponible : on préfère afficher le dernier
    // profil connu plutôt qu'un dashboard vide, en signalant le problème.
    if (cached) {
      return NextResponse.json({ profile: cached, cached: true, error: err.message });
    }
    return NextResponse.json({ error: err.message }, { status: err.code === 401 ? 401 : 502 });
  }
}
