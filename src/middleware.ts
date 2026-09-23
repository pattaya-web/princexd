import { NextRequest, NextResponse } from "next/server";
import { peekClaims, SESSION_COOKIE } from "@/lib/sales/session";

/**
 * Cloisonnement par role.
 *
 * Le middleware ne fait que du ROUTAGE : il evite qu'un setter atterrisse sur
 * une page qui ne le concerne pas, et coupe court aux appels d'API hors de son
 * perimetre. Il ne verifie pas la signature du jeton — un cookie se fabrique a
 * la main, donc la vraie frontiere de securite est dans les routes API, qui
 * verifient le HMAC et relisent le membre en base a chaque requete.
 *
 * Regle qui ne doit jamais bouger : sans cookie, on est le proprietaire du
 * tool et tout est ouvert. C'est le comportement historique.
 */

/* --- Monteur : inchange --- */
const EDITOR_PAGES = ["/monteur"];
const EDITOR_APIS = ["/api/auth/editor", "/api/sales/session", "/api/data/edits", "/api/upload", "/api/media/"];

/* --- Equipe commerciale --- */
const SALES_PAGES = ["/sales"];

/**
 * Pages de l'espace commercial reservees a l'admin.
 *
 * Le sous-menu les masque deja et les API refusent les donnees, mais l'adresse
 * reste tapable : sans ce filtre, un setter curieux atterrit sur un ecran vide
 * aux boutons inertes et croit a un bug.
 */
const SALES_ADMIN_PAGES = ["/sales/setters", "/sales/closers", "/sales/equipe", "/sales/membre"];

/**
 * Exception : sa propre fiche.
 *
 * Un setter doit pouvoir consulter ses chiffres et ses commissions ; il n'a
 * simplement pas a ouvrir celle d'un collegue. La route API refait la
 * verification de son cote.
 */
const isOwnProfile = (pathname: string, memberId: string) =>
  Boolean(memberId) && pathname === `/sales/membre/${memberId}`;
const SALES_APIS = ["/api/sales/", "/api/auth/editor", "/api/upload", "/api/media/"];

/**
 * Ouvert a tous, sans cookie :
 *  - la page de connexion, sans elle personne ne peut entrer ;
 *  - les medias, dont le nom est un identifiant aleatoire : les modeles KIE
 *    et les navigateurs des membres vont les chercher sans jeton ;
 *  - les webhooks et callbacks, appeles par des services tiers.
 */
const PUBLIC = ["/login", "/api/sales/session", "/api/media/", "/api/webhooks/", "/api/kie/callback"];

/**
 * Site en ligne : `OWNER_PASSWORD` est defini et l'absence de cookie ne vaut
 * plus proprietaire. Tout le monde passe par /login.
 */
const OWNER_AUTH = Boolean(process.env.OWNER_PASSWORD?.trim());

const matches = (pathname: string, prefixes: string[]) =>
  prefixes.some((p) => pathname === p || pathname.startsWith(p.endsWith("/") ? p : `${p}/`));

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (matches(pathname, PUBLIC)) return NextResponse.next();

  const claims = peekClaims(req.cookies.get(SESSION_COOKIE)?.value);
  const legacyEditor = req.cookies.get("mvp_role")?.value === "editor";
  const role = claims?.role ?? (legacyEditor ? "editor" : OWNER_AUTH ? "anonyme" : "owner");

  // Proprietaire et admin : aucun cloisonnement.
  if (role === "owner" || role === "admin") return NextResponse.next();

  if (role === "editor") {
    if (matches(pathname, EDITOR_PAGES) || matches(pathname, EDITOR_APIS)) return NextResponse.next();
    return deny(req, "/monteur");
  }

  if (role === "setter" || role === "closer") {
    /*
     * Le refus de `/api/data/*` est le point critique.
     *
     * Cette route generique n'a aucune notion d'attribution : elle rendrait
     * la collection `leads` entiere a qui la demande. L'equipe commerciale
     * passe donc exclusivement par `/api/sales/*`, ou chaque route filtre.
     */
    if (matches(pathname, SALES_ADMIN_PAGES) && !isOwnProfile(pathname, claims?.memberId ?? "")) {
      return deny(req, "/sales");
    }
    if (matches(pathname, SALES_PAGES) || matches(pathname, SALES_APIS)) return NextResponse.next();
    return deny(req, "/sales");
  }

  // Role inconnu ou compte desactive : retour a la connexion.
  return deny(req, "/login");
}

function deny(req: NextRequest, fallback: string) {
  if (req.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Accès refusé." }, { status: 403 });
  }
  return NextResponse.redirect(new URL(fallback, req.url));
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
  // Runtime Node : les variables d'environnement du serveur (OWNER_PASSWORD)
  // sont lues a l'execution, pas figees au build.
  runtime: "nodejs",
};
