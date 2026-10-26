import { NextRequest } from "next/server";
import { readDB, writeDB } from "@/lib/db";
import { readSession, requireFormation } from "@/lib/sales/access";
import { handle } from "@/lib/sales/http";
import { portalSettings } from "@/lib/formation-steps";
import { onboardingSettings, welcomeMessage } from "@/lib/onboarding";
import { escTelegram, notifyOwner } from "@/lib/telegram";
import type { ShopRequest, StudentPortalSettings } from "@/lib/types";

export const dynamic = "force-dynamic";

export interface DemarragePayload {
  student: { id: string; name: string; firstName: string } | null;
  isAdmin: boolean;
  preview: boolean;
  /** Message d'onboarding rendu pour la plateforme : sans prénom, sans la partie « ta plateforme » (il y est déjà). */
  welcome: string;
  whatsapp: string;
  bookingUrl: string;
  /** Video d'accompagnement (YouTube ou fichier), vide si aucune. */
  welcomeVideoUrl: string;
  /** Les liens nécessaires : BrandSearch, Claude Max, Shopify, Chrome Remote Desktop, Claude pour Chrome. */
  links: { label: string; href: string; note: string }[];
  /** Reglages complets du portail, pour que l'admin modifie la video depuis la page. Null pour un eleve. */
  portal: StudentPortalSettings | null;
  shopRequest: ShopRequest | null;
  /** Etapes du guide cochees par l'eleve (cles section:os:index). */
  guideDone: string[];
}

function studentOf(req: NextRequest) {
  const session = requireFormation(readSession(req));
  const db = readDB();
  const student = session.role === "student" ? db.students.find((s) => s.id === session.memberId) : undefined;
  return { session, db, student };
}

export async function GET(req: NextRequest) {
  return handle((): DemarragePayload => {
    const { session, db, student } = studentOf(req);
    const portal = portalSettings(db.settings);
    const ob = onboardingSettings(db.settings);
    // Les liens nécessaires, et rien d'autre (le formulaire et la vidéo sont sur l'accueil).
    const links = [
      { label: "BrandSearch", href: ob.brainsearchUrl, note: "recherche produit · lien de Mady" },
      { label: "Claude Max", href: ob.claudeUrl, note: "c'est lui qui construit ta boutique" },
      { label: "Shopify", href: ob.shopifyUrl, note: "1 € les premiers mois · lien de Mady" },
      { label: "Google Chrome Remote Desktop", href: "https://remotedesktop.google.com/access", note: "pour que Mady prenne la main" },
      { label: "Claude pour Chrome", href: "https://claude.ai/chrome", note: "Claude règle Shopify à ta place" },
    ].filter((l) => l.href);
    return {
      student: student ? { id: student.id, name: student.name, firstName: student.name.trim().split(/\s+/)[0] ?? student.name } : null,
      isAdmin: session.isAdmin,
      preview: Boolean(session.impersonated),
      welcome: welcomeMessage(db.settings),
      whatsapp: portal.whatsapp,
      bookingUrl: portal.bookingUrl,
      welcomeVideoUrl: portal.welcomeVideoUrl,
      links,
      portal: session.isAdmin ? portal : null,
      shopRequest: student?.shopRequest ?? null,
      guideDone: student?.guideDone ?? [],
    };
  });
}

/** L'élève coche (ou décoche) une étape du guide. */
export async function PATCH(req: NextRequest) {
  return handle(async (): Promise<{ preview: boolean; guideDone: string[] }> => {
    const { session, db, student } = studentOf(req);
    const body = (await req.json().catch(() => ({}))) as { key?: string; done?: boolean };
    const key = (body.key ?? "").trim().slice(0, 80);
    if (!/^[a-z0-9-]+:[a-z]*:\d+$/i.test(key)) throw new Error("Étape inconnue.");
    if (!student) {
      if (session.isAdmin) return { preview: true, guideDone: [] };
      throw new Error("Élève introuvable.");
    }
    if (session.impersonated) return { preview: true, guideDone: student.guideDone ?? [] };
    const cur = student.guideDone ?? [];
    student.guideDone = body.done ? (cur.includes(key) ? cur : [...cur, key]) : cur.filter((k) => k !== key);
    writeDB(db);
    return { preview: false, guideDone: student.guideDone };
  });
}

/** « Demande ta boutique à Mady » : enregistre la demande et prévient Mady sur Telegram. */
export async function POST(req: NextRequest) {
  return handle(async (): Promise<{ preview: boolean; shopRequest: ShopRequest | null }> => {
    const { session, db, student } = studentOf(req);
    const body = (await req.json().catch(() => ({}))) as { storeUrl?: string; note?: string };
    let storeUrl = (body.storeUrl ?? "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
    if (storeUrl && !storeUrl.includes(".")) storeUrl = `${storeUrl}.myshopify.com`;
    if (!/^[a-z0-9-]+\.myshopify\.com$/.test(storeUrl)) throw new Error("Donne l'adresse de ta boutique, du type ma-boutique.myshopify.com (Paramètres > Domaines).");
    const note = (body.note ?? "").trim().slice(0, 2000);
    if (!student) {
      if (session.isAdmin) return { preview: true, shopRequest: null };
      throw new Error("Élève introuvable.");
    }
    if (session.impersonated) return { preview: true, shopRequest: student.shopRequest ?? null };

    const now = new Date().toISOString();
    student.shopRequest = { requestedAt: now, storeUrl, note, status: "demandee" };
    writeDB(db);

    const base = (process.env.PUBLIC_BASE_URL?.trim() || "https://mvdyprince.fr").replace(/\/$/, "");
    notifyOwner(
      [
        `🛍 <b>Demande de boutique</b> : ${escTelegram(student.name)}`,
        `Boutique : <code>${escTelegram(storeUrl)}</code>`,
        note ? `Produit / notes : ${escTelegram(note)}` : "Pas de note.",
        "",
        `Générer : ${base}/boutiques`,
        `Suivi élève : ${base}/formation/eleves`,
      ].join("\n"),
    );
    return { preview: false, shopRequest: student.shopRequest };
  });
}
