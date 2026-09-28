import { NextRequest, NextResponse } from "next/server";
import { getSettings, readDB, saveSettings, writeDB } from "@/lib/db";
import { fetchUpcoming, IclosedError } from "@/lib/iclosed";
import { readSession, requireSales } from "@/lib/sales/access";
import { handle } from "@/lib/sales/http";
import { findByIclosedId, fromIclosedCall, resolveCloser } from "@/lib/sales/iclosed-link";
import { createAppointment } from "@/lib/sales/repo";

export const dynamic = "force-dynamic";

/**
 * Synchronisation automatique des rendez-vous a venir.
 *
 * Appelee a l'ouverture de l'espace commercial, pour que les nouveaux bookings
 * iClosed apparaissent sans avoir a cliquer quoi que ce soit : le closer se
 * connecte, ses calls du jour sont deja la, avec le lien de visio.
 *
 * Trois garde-fous, sans lesquels une synchro de fond fait plus de mal que de
 * bien :
 *
 *  - elle ne traite que les rendez-vous A VENIR. Rejouer tout l'historique a
 *    chaque ouverture couterait le quota iClosed pour rien ;
 *  - elle ne fait que CREER. Les issues et les montants restent decides dans le
 *    CRM, une synchro ne doit jamais ecraser une saisie humaine ;
 *  - elle exige un setter par defaut. iClosed ne sait pas qui a chauffe le
 *    prospect, et un rendez-vous sans attribution fausse tout le suivi.
 */

/** Intervalle minimum entre deux synchros, en minutes. */
const COOLDOWN_MIN = 10;

export async function POST(req: NextRequest) {
  return handle(async () => {
    /*
     * Ouverte a toute l'equipe commerciale, pas seulement a l'admin : un closer
     * qui ouvre son espace le matin doit y trouver ses calls du jour meme si
     * l'admin n'a pas encore ouvert le sien. La synchro ne fait que creer des
     * rendez-vous avec l'attribution par defaut, elle ne lit ni n'ecrase rien
     * que le membre ne pourrait deja voir.
     */
    const session = requireSales(readSession(req));
    const settings = getSettings();
    const force = req.nextUrl.searchParams.get("force") === "1";

    if (!settings.salesAutoImport) {
      return { skipped: "off" as const, created: 0 };
    }

    const setterId = settings.salesDefaultSetterId;
    if (!setterId || !readDB().team.some((m) => m.id === setterId)) {
      // On le dit au lieu d'importer en silence sous une mauvaise attribution.
      return { skipped: "no-setter" as const, created: 0 };
    }

    // Le quota iClosed est de 200 appels par heure : inutile de le consommer a
    // chaque navigation entre deux onglets.
    const last = settings.salesLastSyncAt ? Date.parse(settings.salesLastSyncAt) : 0;
    if (!force && Date.now() - last < COOLDOWN_MIN * 60_000) {
      return { skipped: "cooldown" as const, created: 0 };
    }

    let calls;
    try {
      calls = await fetchUpcoming();
    } catch (e) {
      throw new Error(e instanceof IclosedError ? e.message : (e as Error).message);
    }

    // Closer de repli : la correspondance hote → closer d'abord, sinon le
    // closer par defaut des reglages, sinon personne (l'admin repartit).
    const defaultCloser = (db: ReturnType<typeof readDB>) =>
      db.team.find((m) => m.id === settings.salesDefaultCloserId && m.status !== "inactif");
    const closerFor = (db: ReturnType<typeof readDB>, call: (typeof calls)[number]) =>
      resolveCloser(db, call) ?? defaultCloser(db);

    let created = 0;
    let updated = 0;
    for (const call of calls) {
      const db = readDB();
      const existing = findByIclosedId(db, String(call.id));
      if (existing) {
        /*
         * Complete sans jamais ecraser.
         *
         * Le lien de visio peut apparaitre apres le booking (iClosed le genere
         * a la confirmation), et le closer n'est connu qu'une fois la
         * correspondance iClosed → CRM faite. On remplit ces deux trous ; les
         * saisies humaines (statut, notes, montants) restent intouchees.
         */
        const url = call.locationLinkInvitee || call.locationLink || "";
        const closer = existing.closerId ? undefined : closerFor(db, call);
        let touched = false;
        if (url && existing.iclosedUrl !== url) {
          existing.iclosedUrl = url;
          touched = true;
        }
        if (closer) {
          existing.closerId = closer.id;
          touched = true;
        }
        if (touched) {
          writeDB(db);
          updated += 1;
        }
        continue;
      }

      const input = fromIclosedCall(call, {
        setterId,
        // Correspondance iClosed, sinon closer par defaut, sinon non assigne.
        closerId: closerFor(db, call)?.id ?? "",
      });
      if (!input) continue;
      if (!input.igUsername) {
        input.igUsername = (input.email || input.name || `iclosed-${call.id}`).split("@")[0];
      }
      createAppointment(session, input);
      created += 1;
    }

    saveSettings({ salesLastSyncAt: new Date().toISOString() });
    return { skipped: null, examined: calls.length, created, updated };
  });
}

/** Etat de la synchro, pour l'afficher sans la declencher. */
export async function GET(req: NextRequest) {
  const session = readSession(req);
  if (!session.isAdmin) return NextResponse.json({ enabled: false });
  const s = getSettings();
  return NextResponse.json({
    enabled: s.salesAutoImport,
    setterId: s.salesDefaultSetterId,
    closerId: s.salesDefaultCloserId ?? "",
    lastSyncAt: s.salesLastSyncAt,
  });
}
