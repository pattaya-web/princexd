import { NextRequest } from "next/server";
import { newId, readDB, writeDB } from "@/lib/db";
import { hashPassword, normalizeUsername, readSession, requireAdmin, requireSales } from "@/lib/sales/access";
import { handle, required } from "@/lib/sales/http";
import { publicMember } from "@/lib/sales/repo";
import { describeRule, effectiveRule } from "@/lib/sales/commissions";
import { COMMISSION_TYPES } from "@/lib/sales/constants";
import { memberRoles, normalizeRoles, primaryRole, type CommercialRole } from "@/lib/sales/roles";
import type { CommissionRule, CommissionType, TeamMember } from "@/lib/types";

export const dynamic = "force-dynamic";

const KINDS = ["setter", "closer", "admin", "monteur", "assistant"] as const;

/**
 * Annuaire de l'equipe commerciale.
 *
 * Tout le monde y a acces : sans cela, un setter ne pourrait pas choisir le
 * closer a qui adresser son rendez-vous. En revanche les secrets ne sortent
 * jamais — `publicMember` les retire, et seul l'admin voit s'il en existe.
 */
export async function GET(req: NextRequest) {
  return handle(() => {
    const session = requireSales(readSession(req));
    const db = readDB();
    const currency = db.settings.salesCurrency || "USD";
    const now = new Date().toISOString();

    const members = db.team
      .filter((m) => memberRoles(m).length > 0 || m.role === "admin")
      .map((m) => {
        const base = publicMember(m);
        if (!session.isAdmin) {
          // Un membre non-admin n'a pas a savoir qui a un compte ni comment
          // ses collegues sont remuneres.
          return { ...base, hasAccessCode: false, hasPassword: false, canLogin: false, username: "", email: "" };
        }
        // Une regle par metier : un setter-closer en a deux.
        const rules: Partial<Record<CommercialRole, CommissionRule | null>> = {};
        const labels: string[] = [];
        for (const role of memberRoles(m)) {
          const rule = effectiveRule(db.commissionRules, m.id, now, role);
          rules[role] = rule;
          labels.push(
            memberRoles(m).length > 1 ? `${role === "setter" ? "Setter" : "Closer"} : ${describeRule(rule, currency)}` : describeRule(rule, currency),
          );
        }
        const first = primaryRole(memberRoles(m));
        return {
          ...base,
          rule: first ? (rules[first] ?? null) : null,
          rules,
          ruleLabel: labels.join(" · "),
          iclosedUserId: m.iclosedUserId ?? null,
        };
      });

    return { members, currency, isAdmin: session.isAdmin, me: session };
  });
}

/** Regle de commission a partir du corps d'une requete. */
function ruleFromBody(
  c: Record<string, unknown>,
  member: TeamMember,
  role: CommercialRole,
  defaultCurrency: string,
): CommissionRule {
  const type = c.type as CommissionType;
  if (!COMMISSION_TYPES.includes(type)) throw new Error("Type de commission inconnu.");

  const pct = Number(c.pct) || 0;
  if (pct < 0 || pct > 100) throw new Error("Le pourcentage doit être compris entre 0 et 100.");

  return {
    id: newId(),
    memberId: member.id,
    role,
    type,
    pct,
    fixed: Math.max(0, Number(c.fixed) || 0),
    basis: c.basis === "contract" ? "contract" : "cash",
    onlyQualified: Boolean(c.onlyQualified),
    currency: (c.currency as string) || defaultCurrency,
    // Par defaut la date d'entree : sans cela, les rendez-vous saisis le
    // jour meme ne declencheraient aucune commission.
    effectiveFrom: (c.effectiveFrom as string) || member.joinedAt || new Date().toISOString().slice(0, 10),
    active: true,
    notes: "",
    createdAt: member.createdAt,
  };
}

/** Un identifiant ne peut appartenir qu'a un seul membre. */
function assertUsernameFree(db: ReturnType<typeof readDB>, username: string, exceptId?: string) {
  const wanted = normalizeUsername(username);
  if (!wanted) return;
  if (!/^[a-z0-9._-]{3,32}$/.test(wanted)) {
    throw new Error("L'identifiant doit faire 3 à 32 caractères : lettres, chiffres, point, tiret.");
  }
  const taken = db.team.find((m) => m.id !== exceptId && normalizeUsername(m.username ?? "") === wanted);
  if (taken) throw new Error(`L'identifiant « ${wanted} » est déjà pris par ${taken.name}.`);
}

function assertPasswordOk(password: string) {
  if (password.length < 6) throw new Error("Le mot de passe doit faire au moins 6 caractères.");
}

/**
 * Onboarde un membre : le compte ET sa remuneration, en une seule operation.
 *
 * Les deux etaient separes au depart, et c'etait une mauvaise idee : on
 * pouvait creer un setter, oublier sa regle, et decouvrir un mois plus tard
 * qu'il n'avait aucune commission calculee. Ici, soit tout est enregistre,
 * soit rien ne l'est — une seule ecriture en base.
 */
export async function POST(req: NextRequest) {
  return handle(async () => {
    const session = requireAdmin(readSession(req));
    const body = (await req.json()) as Record<string, unknown>;
    const db = readDB();

    /*
     * Type de compte.
     *
     * Pour un commercial, `roles` porte la liste (setter, closer, ou les
     * deux) et `role` en garde le principal pour tout ce qui existait avant.
     */
    const roles = normalizeRoles(body.roles);
    let role = body.role as TeamMember["role"];
    if (roles.length) role = primaryRole(roles)!;
    if (!KINDS.includes(role)) throw new Error("Rôle inconnu.");
    const commercialRoles: CommercialRole[] = roles.length ? roles : role === "setter" || role === "closer" ? [role] : [];

    const username = normalizeUsername(String(body.username ?? ""));
    const password = String(body.password ?? "");
    if (username) {
      assertUsernameFree(db, username);
      if (!password) throw new Error("Un mot de passe est requis avec l'identifiant.");
      assertPasswordOk(password);
    }

    const accessCode = String(body.accessCode ?? "").trim();
    if (accessCode && db.team.some((m) => (m.accessCode ?? "").trim() === accessCode)) {
      // Deux membres avec le meme code rendraient la connexion ambigue.
      throw new Error("Ce code d'accès est déjà utilisé par un autre membre.");
    }

    const member: TeamMember = {
      id: newId(),
      name: required(body.name, "Le nom"),
      role,
      roles: commercialRoles,
      status: (body.status as TeamMember["status"]) || "actif",
      commissionPct: 0,
      target: 0,
      contact: String(body.contact ?? ""),
      notes: String(body.notes ?? ""),
      createdAt: new Date().toISOString(),
      email: String(body.email ?? ""),
      username,
      passwordHash: username ? hashPassword(password) : undefined,
      accessCode,
      joinedAt: String(body.joinedAt ?? new Date().toISOString().slice(0, 10)),
      timezone: String(body.timezone ?? "Europe/Paris"),
    };

    db.team.unshift(member);

    /* --- Remuneration, fixee des l'onboarding, une regle par metier --- */
    const currency = db.settings.salesCurrency || "USD";
    const rules: CommissionRule[] = [];
    const perRole = (body.commissions ?? {}) as Partial<Record<CommercialRole, Record<string, unknown>>>;
    const single = body.commission as Record<string, unknown> | undefined;

    for (const r of commercialRoles) {
      const c = perRole[r] ?? (commercialRoles.length === 1 ? single : undefined);
      if (!c) continue;
      const rule = ruleFromBody(c, member, r, currency);
      rules.push(rule);
      db.commissionRules.unshift(rule);
    }

    db.activityLogs.unshift({
      id: newId(),
      at: member.createdAt,
      actorId: session.memberId,
      actorName: session.memberName || "Moi",
      action: "member.created",
      entity: "member",
      entityId: member.id,
      summary: rules.length
        ? `Compte ${commercialRoles.join(" + ") || role} créé pour ${member.name} — ${rules
            .map((r) => describeRule(r, r.currency))
            .join(" · ")}`
        : `Compte ${commercialRoles.join(" + ") || role} créé pour ${member.name}`,
    });
    writeDB(db);
    return { ...publicMember(member), rule: rules[0] ?? null, rules };
  });
}

/**
 * Modifie un compte : renommer, changer de role, desactiver, redefinir
 * l'identifiant ou le mot de passe.
 */
export async function PATCH(req: NextRequest) {
  return handle(async () => {
    const session = requireAdmin(readSession(req));
    const body = (await req.json()) as Record<string, unknown>;
    const db = readDB();

    const id = required(body.id, "L'identifiant du membre");
    const member = db.team.find((m) => m.id === id);
    if (!member) throw new Error("Membre introuvable.");

    if (typeof body.name === "string" && body.name.trim()) member.name = body.name.trim();
    if (typeof body.email === "string") member.email = body.email.trim();
    if (typeof body.contact === "string") member.contact = body.contact;
    if (typeof body.notes === "string") member.notes = body.notes;
    if (typeof body.timezone === "string") member.timezone = body.timezone;

    if (Array.isArray(body.roles)) {
      const roles = normalizeRoles(body.roles);
      if (roles.length) {
        member.roles = roles;
        member.role = primaryRole(roles)!;
      }
    } else if (typeof body.role === "string" && KINDS.includes(body.role as (typeof KINDS)[number])) {
      member.role = body.role as TeamMember["role"];
      member.roles = member.role === "setter" || member.role === "closer" ? [member.role] : [];
    }
    if (typeof body.role === "string" && !["setter", "closer"].includes(body.role) && !Array.isArray(body.roles)) {
      // Passer admin ou monteur retire les metiers commerciaux.
      member.role = body.role as TeamMember["role"];
      member.roles = [];
    }

    if (typeof body.status === "string" && ["actif", "essai", "inactif"].includes(body.status)) {
      member.status = body.status as TeamMember["status"];
    }

    /*
     * Correspondance avec le compte iClosed.
     *
     * `null` la retire explicitement — sans ce cas, on ne pourrait jamais
     * defaire un mapping errone. Un meme compte iClosed ne peut pointer que
     * vers un seul membre, sinon l'attribution des calls devient ambigue.
     */
    if (body.iclosedUserId === null) {
      delete member.iclosedUserId;
    } else if (body.iclosedUserId !== undefined) {
      const uid = Number(body.iclosedUserId);
      if (!Number.isFinite(uid)) throw new Error("Identifiant iClosed invalide.");
      const taken = db.team.find((m) => m.id !== id && m.iclosedUserId === uid);
      if (taken) throw new Error(`Ce compte iClosed est déjà associé à ${taken.name}.`);
      member.iclosedUserId = uid;
    }

    /* --- Acces : identifiant, mot de passe, ancien code --- */
    if (typeof body.username === "string") {
      const username = normalizeUsername(body.username);
      assertUsernameFree(db, username, id);
      member.username = username;
    }
    if (typeof body.password === "string" && body.password) {
      assertPasswordOk(body.password);
      if (!member.username) throw new Error("Définis d'abord un identifiant.");
      member.passwordHash = hashPassword(body.password);
    }
    if (typeof body.accessCode === "string") {
      const code = body.accessCode.trim();
      if (code && db.team.some((m) => m.id !== id && (m.accessCode ?? "").trim() === code)) {
        throw new Error("Ce code d'accès est déjà utilisé par un autre membre.");
      }
      member.accessCode = code;
    }

    db.activityLogs.unshift({
      id: newId(),
      at: new Date().toISOString(),
      actorId: session.memberId,
      actorName: session.memberName || "Moi",
      action: "member.updated",
      entity: "member",
      entityId: member.id,
      summary: `Compte de ${member.name} mis à jour (${memberRoles(member).join(" + ") || member.role}, ${member.status})`,
    });
    writeDB(db);
    return publicMember(member);
  });
}

/**
 * Supprime un membre.
 *
 * Ses regles de commission, ses creneaux et ses versements partent avec lui.
 * Ses rendez-vous et ses ventes restent en base, mais ne sont plus attribues
 * a personne : ils n'apparaissent plus dans les classements ni dans le grand
 * livre. Pour garder l'historique, preferer « Inactif ».
 */
export async function DELETE(req: NextRequest) {
  return handle(async () => {
    const session = requireAdmin(readSession(req));
    const id = req.nextUrl.searchParams.get("id") ?? "";
    if (!id) throw new Error("Identifiant du membre manquant.");
    if (id === session.memberId) throw new Error("Tu ne peux pas supprimer ton propre compte.");

    const db = readDB();
    const member = db.team.find((m) => m.id === id);
    if (!member) throw new Error("Membre introuvable.");

    db.team = db.team.filter((m) => m.id !== id);
    db.commissionRules = db.commissionRules.filter((r) => r.memberId !== id);
    db.commissionPayments = db.commissionPayments.filter((p) => p.memberId !== id);
    db.shifts = db.shifts.filter((s) => s.memberId !== id);

    db.activityLogs.unshift({
      id: newId(),
      at: new Date().toISOString(),
      actorId: session.memberId,
      actorName: session.memberName || "Moi",
      action: "member.deleted",
      entity: "member",
      entityId: id,
      summary: `Compte de ${member.name} supprimé`,
    });
    writeDB(db);
    return { ok: true, id };
  });
}
