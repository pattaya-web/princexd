/**
 * Jeton de session partage entre le middleware et les routes API.
 *
 * Le middleware tourne sur le runtime edge et n'a acces ni au systeme de
 * fichiers ni a `node:crypto` de facon confortable : il se contente donc de
 * LIRE la charge utile pour decider d'une redirection. La verification de
 * signature, elle, a lieu dans les routes API — c'est la seule frontiere de
 * securite qui compte, puisqu'un cookie se fabrique a la main.
 */
import type { SessionRole } from "../types";

export const SESSION_COOKIE = "mvp_session";
/** Cookie historique du monteur, conserve tel quel pour ne pas le deconnecter. */
export const LEGACY_ROLE_COOKIE = "mvp_role";

export interface SessionClaims {
  role: SessionRole;
  memberId: string;
  memberName: string;
  /**
   * Session ouverte par un admin pour visualiser l'espace d'un membre.
   *
   * Ne change rien aux droits — l'apercu a exactement ceux du membre, pas
   * ceux de l'admin. Sert uniquement a proposer « revenir admin » au lieu
   * d'une deconnexion, et a afficher un bandeau d'avertissement.
   */
  impersonated?: boolean;
  /** Emis le (ms). Sert a peremer les jetons trop vieux. */
  iat: number;
}

export const SESSION_MAX_AGE_S = 60 * 60 * 24 * 30;

function b64urlDecode(input: string): string {
  const pad = input.length % 4 === 0 ? "" : "=".repeat(4 - (input.length % 4));
  const b64 = input.replace(/-/g, "+").replace(/_/g, "/") + pad;
  // atob existe sur edge comme sur node moderne ; Buffer n'existe pas sur edge.
  const bytes = atob(b64);
  const arr = Uint8Array.from(bytes, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(arr);
}

/**
 * Lit la charge utile SANS verifier la signature.
 *
 * A n'utiliser que pour du confort d'affichage ou du routage. Toute decision
 * d'acces aux donnees passe par `readSession` cote serveur, qui verifie le
 * HMAC et relit le membre en base.
 */
export function peekClaims(token: string | undefined): SessionClaims | null {
  if (!token) return null;
  const [payload] = token.split(".");
  if (!payload) return null;
  try {
    const claims = JSON.parse(b64urlDecode(payload)) as SessionClaims;
    if (!claims?.role) return null;
    if (Date.now() - (claims.iat ?? 0) > SESSION_MAX_AGE_S * 1000) return null;
    return claims;
  } catch {
    return null;
  }
}
