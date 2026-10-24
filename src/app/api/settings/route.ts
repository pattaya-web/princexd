import { NextRequest, NextResponse } from "next/server";
import { getSettings, saveSettings } from "@/lib/db";
import { hashPassword } from "@/lib/sales/access";
import { telegramGetMe } from "@/lib/telegram";
import type { Settings } from "@/lib/types";

export const dynamic = "force-dynamic";

function mask(key: string) {
  return key ? `${key.slice(0, 8)}…${key.slice(-4)}` : "";
}

/** Les clés API ne sortent jamais en clair vers le client : on renvoie un masque. */
function publicView(s: Settings) {
  const kieEnv = Boolean(process.env.KIE_API_KEY?.trim());
  const kieKey = kieEnv ? process.env.KIE_API_KEY!.trim() : s.kieApiKey;
  const icEnv = Boolean(process.env.ICLOSED_API_KEY?.trim());
  const icKey = icEnv ? process.env.ICLOSED_API_KEY!.trim() : s.iclosedApiKey;
  const igEnv = Boolean(process.env.IG_ACCESS_TOKEN?.trim());
  const igKey = igEnv ? process.env.IG_ACCESS_TOKEN!.trim() : s.igAccessToken;
  const oaEnv = Boolean(process.env.OPENAI_API_KEY?.trim());
  const oaKey = oaEnv ? process.env.OPENAI_API_KEY!.trim() : s.openaiApiKey;
  const gmEnv = Boolean(process.env.GEMINI_API_KEY?.trim());
  const gmKey = gmEnv ? process.env.GEMINI_API_KEY!.trim() : (s.geminiApiKey ?? "");
  const anEnv = Boolean(process.env.ANTHROPIC_API_KEY?.trim());
  const anKey = anEnv ? process.env.ANTHROPIC_API_KEY!.trim() : (s.anthropicApiKey ?? "");
  const elEnv = Boolean(process.env.ELEVENLABS_API_KEY?.trim());
  const elKey = elEnv ? process.env.ELEVENLABS_API_KEY!.trim() : (s.elevenLabsApiKey ?? "");
  const sioEnv = Boolean(process.env.SYSTEMEIO_API_KEY?.trim());
  const sioKey = sioEnv ? process.env.SYSTEMEIO_API_KEY!.trim() : (s.systemeioApiKey ?? "");
  const hfSingle = process.env.HIGGSFIELD_API_KEY?.trim();
  const hfEnv = Boolean(hfSingle || (process.env.HIGGSFIELD_API_KEY_ID?.trim() && process.env.HIGGSFIELD_API_KEY_SECRET?.trim()));
  const hfSecret = hfSingle || (hfEnv ? process.env.HIGGSFIELD_API_KEY_SECRET!.trim() : (s.higgsfieldKeySecret ?? ""));
  const tgEnv = Boolean(process.env.TELEGRAM_BOT_TOKEN?.trim());
  const tgKey = tgEnv ? process.env.TELEGRAM_BOT_TOKEN!.trim() : (s.telegramBotToken ?? "");

  return {
    ...s,
    kieApiKey: "",
    kieApiKeyMask: mask(kieKey),
    kieApiKeySource: kieEnv ? "env" : kieKey ? "reglages" : "absente",
    iclosedApiKey: "",
    iclosedApiKeyMask: mask(icKey),
    iclosedApiKeySource: icEnv ? "env" : icKey ? "reglages" : "absente",
    igAccessToken: "",
    igAccessTokenMask: mask(igKey),
    igAccessTokenSource: igEnv ? "env" : igKey ? "reglages" : "absente",
    igUserId: process.env.IG_USER_ID?.trim() || s.igUserId,
    openaiApiKey: "",
    openaiApiKeyMask: mask(oaKey),
    openaiApiKeySource: oaEnv ? "env" : oaKey ? "reglages" : "absente",
    geminiApiKey: "",
    geminiApiKeyMask: mask(gmKey),
    geminiApiKeySource: gmEnv ? "env" : gmKey ? "reglages" : "absente",
    anthropicApiKey: "",
    anthropicApiKeyMask: mask(anKey),
    anthropicApiKeySource: anEnv ? "env" : anKey ? "reglages" : "absente",
    elevenLabsApiKey: "",
    elevenLabsApiKeyMask: mask(elKey),
    elevenLabsApiKeySource: elEnv ? "env" : elKey ? "reglages" : "absente",
    // Cle unique « id:secret » : l'ID est la partie avant les deux-points.
    higgsfieldKeyId: hfEnv
      ? (process.env.HIGGSFIELD_API_KEY_ID?.trim() || (hfSingle?.includes(":") ? hfSingle.split(":")[0] : ""))
      : (s.higgsfieldKeyId ?? ""),
    higgsfieldKeySecret: "",
    higgsfieldKeyMask: mask(hfSecret),
    higgsfieldKeySource: hfEnv ? "env" : hfSecret ? "reglages" : "absente",
    systemeioApiKey: "",
    systemeioApiKeyMask: mask(sioKey),
    systemeioApiKeySource: sioEnv ? "env" : sioKey ? "reglages" : "absente",
    systemeioWebhookSecret: "",
    systemeioWebhookSecretSet: Boolean(process.env.SYSTEMEIO_WEBHOOK_SECRET?.trim() || s.systemeioWebhookSecret),
    editorAccessCode: s.editorAccessCode,
    // Les cookies restent sur le serveur : on ne renvoie que leur presence.
    igCookies: "",
    igCookiesSet: Boolean(s.igCookies?.trim()),
    // Acces VA : l'environnement l'emporte ; le hash ne sort jamais.
    vaUsername: process.env.VA_USERNAME?.trim() || s.vaUsername || "",
    vaPasswordHash: "",
    vaPasswordSet: Boolean(process.env.VA_PASSWORD?.trim() || s.vaPasswordHash),
    vaSource: process.env.VA_USERNAME?.trim() && process.env.VA_PASSWORD?.trim() ? "env" : s.vaPasswordHash ? "reglages" : "absente",
    // Bot Telegram : le jeton ne sort jamais, seulement son masque et sa provenance.
    telegramBotToken: "",
    telegramBotTokenMask: mask(tgKey),
    telegramBotTokenSource: tgEnv ? "env" : tgKey ? "reglages" : "absente",
  };
}

export async function GET() {
  return NextResponse.json(publicView(getSettings()));
}

export async function PATCH(req: NextRequest) {
  const body = (await req.json()) as Partial<Settings>;
  // Une chaîne vide ne doit pas effacer une clé déjà enregistrée.
  if (typeof body.kieApiKey === "string" && !body.kieApiKey.trim()) delete body.kieApiKey;
  if (typeof body.iclosedApiKey === "string" && !body.iclosedApiKey.trim()) delete body.iclosedApiKey;
  if (typeof body.igAccessToken === "string" && !body.igAccessToken.trim()) delete body.igAccessToken;
  if (typeof body.openaiApiKey === "string" && !body.openaiApiKey.trim()) delete body.openaiApiKey;
  if (typeof body.elevenLabsApiKey === "string" && !body.elevenLabsApiKey.trim()) delete body.elevenLabsApiKey;
  if (typeof body.anthropicApiKey === "string" && !body.anthropicApiKey.trim()) delete body.anthropicApiKey;
  if (typeof body.geminiApiKey === "string" && !body.geminiApiKey.trim()) delete body.geminiApiKey;
  delete (body as Record<string, unknown>).geminiApiKeyMask;
  delete (body as Record<string, unknown>).geminiApiKeySource;
  if (typeof body.higgsfieldKeySecret === "string" && !body.higgsfieldKeySecret.trim()) delete body.higgsfieldKeySecret;
  if (typeof body.systemeioApiKey === "string" && !body.systemeioApiKey.trim()) delete body.systemeioApiKey;
  if (typeof body.systemeioWebhookSecret === "string" && !body.systemeioWebhookSecret.trim()) delete body.systemeioWebhookSecret;
  // Jeton Telegram : vide = on garde ; « CLEAR » = on efface ; sinon on le verifie aupres de Telegram.
  const rawBody = body as Record<string, unknown>;
  delete rawBody.telegramBotTokenMask;
  delete rawBody.telegramBotTokenSource;
  if (typeof body.telegramBotToken === "string") {
    const token = body.telegramBotToken.trim();
    if (token === "CLEAR") {
      body.telegramBotToken = "";
      body.telegramBotUsername = "";
      body.telegramUpdateOffset = 0;
    } else if (!token) delete body.telegramBotToken;
    else {
      try {
        body.telegramBotUsername = await telegramGetMe(token);
        body.telegramBotToken = token;
        body.telegramUpdateOffset = 0;
        body.telegramLastError = "";
      } catch (e) {
        return NextResponse.json({ error: `Jeton Telegram refusé : ${e instanceof Error ? e.message : String(e)}` }, { status: 400 });
      }
    }
  }
  if (typeof body.salesTakeoverMin === "number" && !(body.salesTakeoverMin >= 0)) delete body.salesTakeoverMin;
  if (body.weeklyReelTargets) {
    const t = body.weeklyReelTargets as unknown as Record<string, unknown>;
    const n = (v: unknown) => Math.max(0, Math.round(Number(v) || 0));
    body.weeklyReelTargets = { TOFU: n(t.TOFU), MOFU: n(t.MOFU), BOFU: n(t.BOFU) };
  }
  // Nouveau solde Higgsfield saisi : on date la saisie pour ne deduire que les rendus suivants.
  if (typeof body.higgsfieldBalanceUsd === "number") {
    if (body.higgsfieldBalanceUsd !== getSettings().higgsfieldBalanceUsd) body.higgsfieldBalanceAt = new Date().toISOString();
  } else if (body.higgsfieldBalanceUsd === null || body.higgsfieldBalanceUsd === undefined) {
    delete body.higgsfieldBalanceUsd;
  }
  // Mot de passe VA : hache a l'arrivee, jamais stocke en clair. Vide = on garde.
  const raw = body as Record<string, unknown>;
  if (typeof raw.vaPassword === "string") {
    if (raw.vaPassword.trim()) {
      if (raw.vaPassword.trim().length < 6) {
        return NextResponse.json({ error: "Le mot de passe de la VA doit faire au moins 6 caractères." }, { status: 400 });
      }
      body.vaPasswordHash = hashPassword(raw.vaPassword.trim());
    }
    delete raw.vaPassword;
  }
  delete raw.vaPasswordSet;
  delete raw.vaSource;
  if (typeof body.vaUsername === "string") body.vaUsername = body.vaUsername.trim().toLowerCase();
  // Cookies : vide = on garde ; « CLEAR » = on efface.
  if (typeof body.igCookies === "string") {
    if (body.igCookies === "CLEAR") body.igCookies = "";
    else if (!body.igCookies.trim()) delete body.igCookies;
  }
  return NextResponse.json(publicView(saveSettings(body)));
}
