import fs from "node:fs";
import path from "node:path";
import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";
import { readDB } from "../db";
import type { Session, SessionRole, Student, TeamMember } from "../types";
import { memberRoles, primaryRole, sessionHas, type CommercialRole } from "./roles";
import { LEGACY_ROLE_COOKIE, SESSION_COOKIE, SESSION_MAX_AGE_S, type SessionClaims } from "./session";

/* ----------------------------- Signature ------------------------------- */

const SECRET_PATH = path.join(process.cwd(), "data", ".session-secret");

/**
 * Secret de signature, persiste hors de `db.json`.
 *
 * Volontairement pas dans les reglages : `/api/settings` renvoie l'objet
 * complet au navigateur, un secret y serait expose au premier chargement.
 */
function secret(): string {
  const fromEnv = process.env.SESSION_SECRET?.trim();
  if (fromEnv) return fromEnv;
  try {
    if (fs.existsSync(SECRET_PATH)) {
      const existing = fs.readFileSync(SECRET_PATH, "utf8").trim();
      if (existing) return existing;
    }
  } catch {
    // Lecture impossible : on regenere plus bas.
  }
  const generated = randomBytes(32).toString("hex");
  try {
    fs.mkdirSync(path.dirname(SECRET_PATH), { recursive: true });
    fs.writeFileSync(SECRET_PATH, generated, "utf8");
  } catch {
    // Disque en lecture seule : le secret ne survit pas au redemarrage, ce qui
    // deconnecte l'equipe mais ne compromet rien.
  }
  return generated;
}

/** Le meme secret sert a chiffrer les jetons Meta (lib/mediabuying/crypto). */
export const sessionSecret = secret;

const b64url = (s: string) => Buffer.from(s, "utf8").toString("base64url");

const sign = (payload: string) => createHmac("sha256", secret()).update(payload).digest("base64url");

export function issueToken(claims: Omit<SessionClaims, "iat">): string {
  const payload = b64url(JSON.stringify({ ...claims, iat: Date.now() }));
  return `${payload}.${sign(payload)}`;
}

/** Verification a temps constant : une comparaison naive fuit le secret. */
function verify(token: string): SessionClaims | null {
  const [payload, mac] = token.split(".");
  if (!payload || !mac) return null;

  const expected = Buffer.from(sign(payload));
  const got = Buffer.from(mac);
  if (expected.length !== got.length || !timingSafeEqual(expected, got)) return null;

  try {
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as SessionClaims;
    if (Date.now() - (claims.iat ?? 0) > SESSION_MAX_AGE_S * 1000) return null;
    return claims;
  } catch {
    return null;
  }
}

/* ---------------------------- Mots de passe ----------------------------- */

const SCRYPT_KEYLEN = 64;

/**
 * Hache un mot de passe defini par l'admin.
 *
 * scrypt avec un sel par compte : deux membres avec le meme mot de passe
 * n'ont pas le meme hash, et une fuite de `db.json` ne livre pas les mots
 * de passe en clair.
 */
export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, SCRYPT_KEYLEN).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string | undefined): boolean {
  if (!stored) return false;
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const expected = Buffer.from(hash, "hex");
  const got = scryptSync(password, salt, SCRYPT_KEYLEN);
  return expected.length === got.length && timingSafeEqual(expected, got);
}

/** Identifiant normalise : la casse et les espaces ne comptent pas. */
export const normalizeUsername = (u: string) => u.trim().toLowerCase();

/* ------------------------------ Session -------------------------------- */

const OWNER: Session = { role: "owner", roles: [], memberId: "", memberName: "Moi", isAdmin: true };
const EDITOR: Session = { role: "editor", roles: [], memberId: "", memberName: "Monteur", isAdmin: false };
/** La VA de prospection Instagram : une seule page, rien d'autre. */
const VA: Session = { role: "va", roles: [], memberId: "", memberName: "VA Outreach", isAdmin: false, canLogout: true };
const ANON: Session = { role: "anonyme", roles: [], memberId: "", memberName: "", isAdmin: false };

/* --------------------------- Mot de passe proprietaire --------------------- */

/**
 * Mode hebergé : le proprietaire doit lui aussi se connecter.
 *
 * Tant que `OWNER_PASSWORD` n'est pas defini (usage local), l'absence de
 * cookie vaut proprietaire, comme depuis toujours. Des qu'il est defini (site
 * en ligne), personne n'entre sans jeton : le proprietaire se connecte avec ce
 * mot de passe et recoit un jeton signe `role: owner`.
 */
export function ownerAuthEnabled(): boolean {
  return Boolean(process.env.OWNER_PASSWORD?.trim());
}

export function verifyOwnerPassword(password: string): boolean {
  const expected = process.env.OWNER_PASSWORD?.trim() ?? "";
  if (!expected || !password) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(password);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function issueOwnerToken(): string {
  return issueToken({ role: "owner", memberId: "", memberName: "Moi" });
}

/* ------------------------------ Acces VA -------------------------------- */

/**
 * Identifiants de la VA outreach.
 *
 * L'environnement (VA_USERNAME / VA_PASSWORD) l'emporte, comme pour les cles
 * API ; a defaut, l'identifiant et le mot de passe haches saisis dans
 * Reglages. Rien n'est jamais ecrit en dur dans le code ni envoye au
 * navigateur.
 */
export function verifyVaLogin(username: string, password: string): boolean {
  const u = normalizeUsername(username);
  if (!u || !password) return false;
  const envUser = process.env.VA_USERNAME?.trim();
  const envPass = process.env.VA_PASSWORD?.trim();
  if (envUser && envPass) {
    if (normalizeUsername(envUser) !== u) return false;
    const a = Buffer.from(envPass);
    const b = Buffer.from(password);
    return a.length === b.length && timingSafeEqual(a, b);
  }
  const s = readDB().settings;
  if (!s.vaUsername || !s.vaPasswordHash) return false;
  return normalizeUsername(s.vaUsername) === u && verifyPassword(password, s.vaPasswordHash);
}

export function issueVaToken(): string {
  return issueToken({ role: "va", memberId: "", memberName: "VA Outreach" });
}

/* ------------------------------ Acces eleve ------------------------------ */

/**
 * Connexion d'un eleve a la plateforme de formation.
 *
 * L'identifiant et le mot de passe sont poses par l'admin sur la fiche de
 * l'eleve (« Accès élèves »). On parcourt tous les eleves avant de repondre,
 * comme pour l'equipe : s'arreter au premier echec laisserait deviner quels
 * identifiants existent.
 */
export function findStudentByLogin(username: string, password: string): Student | null {
  const u = normalizeUsername(username);
  if (!u || !password) return null;
  let hit: Student | null = null;
  for (const s of readDB().students) {
    if (normalizeUsername(s.username ?? "") !== u || !s.passwordHash) continue;
    if (verifyPassword(password, s.passwordHash)) hit = hit ?? s;
  }
  return hit;
}

export function issueStudentToken(student: Student, impersonated = false): string {
  return issueToken({ role: "student", memberId: student.id, memberName: student.name, impersonated });
}

function studentSession(student: Student, impersonated: boolean): Session {
  return {
    role: "student",
    roles: [],
    memberId: student.id,
    memberName: student.name,
    isAdmin: false,
    canLogout: true,
    impersonated,
  };
}

/** La plateforme de formation : les eleves et l'admin, personne d'autre. */
export function requireFormation(session: Session): Session {
  if (session.isAdmin || session.role === "student") return session;
  throw new Forbidden("Cet espace est réservé aux élèves de la formation.");
}

/** L'outreach Instagram : la VA et l'admin, personne d'autre. */
export function requireOutreach(session: Session): Session {
  if (session.isAdmin || session.role === "va") return session;
  throw new Forbidden("This area is reserved for Instagram outreach.");
}

/**
 * Role de session d'un membre, deduit de sa fiche en base — jamais du cookie.
 *
 * Un membre setter ET closer recoit « setter » comme role principal (c'est
 * ce qui pilote le routage), et ses deux metiers dans `roles`.
 */
export function memberSessionRole(member: TeamMember): SessionRole {
  if (member.role === "admin") return "admin";
  if (member.role === "monteur") return "editor";
  return primaryRole(memberRoles(member)) ?? "anonyme";
}

/**
 * Construit la session complete d'un membre.
 *
 * `only` restreint la session a un seul metier : c'est ce que fait l'apercu
 * « voir comme closer » d'un membre setter + closer. Sans cela, l'apercu
 * retombait toujours sur le metier principal (setter) et la vue closer etait
 * impossible a verifier. Ignore si le membre n'a pas ce metier.
 */
export function sessionFor(member: TeamMember, impersonated = false, only?: CommercialRole): Session {
  let role = memberSessionRole(member);
  let roles = role === "setter" || role === "closer" ? memberRoles(member) : [];
  if (only && roles.includes(only)) {
    role = only;
    roles = [only];
  }
  return {
    role,
    roles,
    memberId: member.id,
    memberName: member.name,
    isAdmin: role === "admin",
    impersonated,
  };
}

/**
 * Session courante.
 *
 * Aucun cookie = moi. C'est le comportement historique du tool : je ne me
 * connecte pas pour ouvrir mon propre dashboard, et le module commercial ne
 * doit surtout pas m'en fermer la porte.
 */
export function readSession(req: NextRequest): Session {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const claims = token ? verify(token) : null;

  // Proprietaire connecte par mot de passe (site en ligne).
  if (claims?.role === "owner" && !claims.memberId) {
    return ownerAuthEnabled() ? { ...OWNER, canLogout: true } : OWNER;
  }

  /*
   * Eleve : jeton « student » portant l'id de sa fiche. La fiche fait foi : un
   * eleve dont l'acces a ete coupe garde un cookie valide mais n'entre plus.
   * En apercu (admin qui regarde), l'acces coupe n'empeche pas de verifier
   * ce qu'il verrait.
   */
  if (claims?.role === "student" && claims.memberId) {
    const student = readDB().students.find((s) => s.id === claims.memberId);
    if (!student) return ANON;
    if (!student.portalAccess && !claims.impersonated) return ANON;
    return studentSession(student, Boolean(claims.impersonated));
  }

  if (claims?.memberId) {
    // Le jeton dit qui vous etes ; la base dit si vous existez encore. Un
    // membre desactive — ou supprime — garde un cookie valide mais perd tout
    // acces.
    const member = readDB().team.find((m) => m.id === claims.memberId);
    if (!member || member.status === "inactif") return ANON;
    // En apercu, le jeton peut demander un seul metier (voir sessionFor).
    const only = claims.impersonated && (claims.role === "setter" || claims.role === "closer") ? claims.role : undefined;
    return sessionFor(member, Boolean(claims.impersonated), only);
  }

  // VA outreach : jeton sans membre, un seul espace. En apercu (admin qui
  // regarde), memes droits, juste le bandeau et le retour admin en plus.
  if (claims?.role === "va" && !claims.memberId) return claims.impersonated ? { ...VA, impersonated: true } : VA;

  // Monteur entre par le code global (jeton sans membre) ou par l'ancien cookie.
  if (claims?.role === "editor") return EDITOR;
  if (req.cookies.get(LEGACY_ROLE_COOKIE)?.value === "editor") return EDITOR;

  // Site en ligne : sans jeton, personne. En local : moi.
  return ownerAuthEnabled() ? ANON : OWNER;
}

/* ----------------------------- Permissions ------------------------------ */

export class Forbidden extends Error {
  status = 403;
  constructor(message = "Accès refusé.") {
    super(message);
  }
}

export function requireSales(session: Session): Session {
  if (session.isAdmin || session.role === "setter" || session.role === "closer") return session;
  throw new Forbidden("Cet espace est réservé à l'équipe commerciale.");
}

export function requireAdmin(session: Session): Session {
  if (session.isAdmin) return session;
  throw new Forbidden("Action réservée à l'administrateur.");
}

/** La session agit-elle en tant que setter ? (ou closer) */
export const actsAs = (session: Session, role: CommercialRole) => sessionHas(session, role);

/**
 * Le membre peut-il voir cette ligne ?
 *
 * Cacher un bouton dans l'interface ne protege rien : c'est cette fonction,
 * appelee dans chaque route, qui empeche un setter de lire les rendez-vous
 * d'un autre en tapant l'API a la main. Un membre qui cumule les deux
 * metiers voit ce qu'il a pose ET ce qu'il doit closer.
 */
export function canSee(session: Session, row: { setterId?: string; closerId?: string }): boolean {
  if (session.isAdmin) return true;
  if (actsAs(session, "setter") && row.setterId === session.memberId) return true;
  if (actsAs(session, "closer") && row.closerId === session.memberId) return true;
  return false;
}

/**
 * Le closer est seul maitre du resultat d'un call ; le setter, seul maitre du
 * contexte qu'il a saisi. L'admin corrige tout.
 */
export function canWriteOutcome(session: Session, row: { closerId?: string }): boolean {
  if (session.isAdmin) return true;
  return actsAs(session, "closer") && row.closerId === session.memberId;
}

export function canWriteSetterFields(session: Session, row: { setterId?: string }): boolean {
  if (session.isAdmin) return true;
  return actsAs(session, "setter") && row.setterId === session.memberId;
}

/** Un membre ne consulte que sa propre fiche ; l'admin consulte tout le monde. */
export function canSeeMember(session: Session, memberId: string): boolean {
  return session.isAdmin || session.memberId === memberId;
}

/**
 * Controle d'acces fait dans la route elle-meme.
 *
 * Les routes qui recoivent un fichier (upload, image-edit, transcription)
 * sont sorties du middleware : en mode Node, celui-ci consommait le debut du
 * corps de la requete (les 12 premiers Ko d'un fichier arrivaient amputes et
 * un multipart perdait son premier champ). Elles verifient donc leur session
 * ici, avec les memes roles que le middleware leur accordait.
 */
export function refuseUnless(req: NextRequest, roles: SessionRole[]): Response | null {
  const session = readSession(req);
  if (session.isAdmin || session.role === "owner") return null;
  if (roles.includes(session.role)) return null;
  return Response.json({ error: "Accès refusé." }, { status: 403 });
}
