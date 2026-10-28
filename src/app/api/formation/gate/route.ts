import { NextRequest } from "next/server";
import { readDB, writeDB } from "@/lib/db";
import { readSession, requireFormation } from "@/lib/sales/access";
import { handle } from "@/lib/sales/http";
import { GATE_TABS, gateState, isGateTab, normalizeShopUrl, type GateState } from "@/lib/formation-gate";
import { escTelegram, notifyOwner } from "@/lib/telegram";

export const dynamic = "force-dynamic";

export interface GatePayload extends GateState {
  isAdmin: boolean;
  preview: boolean;
  /** Vrai quand il y a un élève derrière la session (élève connecté, ou admin en « Voir comme »). */
  hasStudent: boolean;
  /** Adresse de la boutique de l'élève (étape « Ta boutique »), vide tant qu'il ne l'a pas donnée. */
  shopUrl: string;
}

function studentOf(req: NextRequest) {
  const session = requireFormation(readSession(req));
  const db = readDB();
  const student = session.role === "student" ? db.students.find((s) => s.id === session.memberId) : undefined;
  return { session, db, student };
}

/** L'état du parcours de l'élève connecté : quels onglets sont ouverts, lesquels sont faits. */
export async function GET(req: NextRequest) {
  return handle((): GatePayload => {
    const { session, student } = studentOf(req);
    return { ...gateState(student, { admin: session.isAdmin, preview: Boolean(session.impersonated) }), isAdmin: session.isAdmin, preview: Boolean(session.impersonated), hasStudent: Boolean(student), shopUrl: student?.shopUrl ?? "" };
  });
}

/**
 * L'élève avance :
 *  - « request » : il a rempli le formulaire d'onboarding et demande l'accès (Mady est prévenue sur Telegram) ;
 *  - « done » + tab : il marque une étape débloquée comme faite (ou la rouvre avec done: false) ;
 *    pour « boutique », il doit avoir donné l'adresse de sa boutique (shopUrl, dans le corps ou déjà enregistrée) ;
 *  - « shop » + shopUrl : il enregistre (ou corrige) l'adresse de sa boutique sans valider l'étape.
 * Chaque validation et chaque adresse préviennent Mady sur Telegram et nourrissent le suivi admin.
 */
export async function POST(req: NextRequest) {
  return handle(async (): Promise<GatePayload> => {
    const { session, db, student } = studentOf(req);
    const body = (await req.json().catch(() => ({}))) as { action?: string; tab?: string; done?: boolean; shopUrl?: string };
    const view = (): GatePayload => ({ ...gateState(student, { admin: session.isAdmin, preview: Boolean(session.impersonated) }), isAdmin: session.isAdmin, preview: Boolean(session.impersonated), hasStudent: Boolean(student), shopUrl: student?.shopUrl ?? "" });
    if (!student) {
      if (session.isAdmin) return view();
      throw new Error("Élève introuvable.");
    }
    if (session.impersonated) return view();

    const now = new Date().toISOString();
    if (body.action === "request") {
      if (!student.accessRequestedAt) {
        student.accessRequestedAt = now;
        writeDB(db);
        notifyOwner(`📝 <b>${escTelegram(student.name)}</b> a rempli le formulaire d'onboarding.\nÀ voir sur ton tableau de bord (bouton « Vu »).`);
      }
      return view();
    }
    /* L'adresse de la boutique : enregistrée seule, ou avec la validation de l'étape. */
    const saveShopUrl = (): boolean => {
      if (body.shopUrl === undefined) return false;
      const url = normalizeShopUrl(body.shopUrl);
      if (!url) throw new Error("Adresse de boutique illisible : tape ton nom de domaine (tamarque.com) ou ton adresse .myshopify.com.");
      if (url === student.shopUrl) return false;
      student.shopUrl = url;
      student.shopUrlAt = now;
      return true;
    };
    if (body.action === "shop") {
      if (saveShopUrl()) {
        writeDB(db);
        notifyOwner(`🛍 <b>${escTelegram(student.name)}</b> a donné l'adresse de sa boutique : ${escTelegram(student.shopUrl ?? "")}\nSuivi des élèves → sa fiche.`);
      }
      return view();
    }
    if (body.action === "done") {
      if (!isGateTab(body.tab)) throw new Error("Étape inconnue.");
      const state = gateState(student);
      const tab = state.tabs.find((t) => t.key === body.tab)!;
      if (!tab.unlocked) throw new Error("Cette étape n'est pas encore débloquée.");
      const shopChanged = saveShopUrl();
      if (body.done !== false && tab.key === "boutique" && !student.shopUrl) {
        throw new Error("Indique d'abord l'adresse de ta boutique (nom de domaine ou .myshopify.com) : Mady la récupère pour voir ton travail.");
      }
      const cur = new Set(student.tabsDone ?? []);
      const doneAt = { ...(student.tabsDoneAt ?? {}) };
      const wasDone = cur.has(tab.key);
      if (body.done === false) {
        cur.delete(tab.key);
        delete doneAt[tab.key];
      } else {
        cur.add(tab.key);
        if (!wasDone) doneAt[tab.key] = now;
      }
      student.tabsDone = Array.from(cur);
      student.tabsDoneAt = doneAt;
      writeDB(db);
      if (body.done !== false && !wasDone) {
        const idx = GATE_TABS.findIndex((t) => t.key === tab.key);
        const next = GATE_TABS[idx + 1];
        const shop = tab.key === "boutique" && student.shopUrl ? `\nBoutique : ${escTelegram(student.shopUrl)}` : "";
        notifyOwner(`✅ <b>${escTelegram(student.name)}</b> a validé l'étape ${idx + 1}/${GATE_TABS.length} « ${escTelegram(tab.label)} »${shop}\n${next ? `Suivant pour lui : ${escTelegram(next.label)}.` : "Parcours terminé 🚀"}`);
      } else if (shopChanged) {
        notifyOwner(`🛍 <b>${escTelegram(student.name)}</b> a corrigé l'adresse de sa boutique : ${escTelegram(student.shopUrl ?? "")}`);
      }
      return view();
    }
    throw new Error("Action inconnue.");
  });
}
