import { NextRequest, NextResponse } from "next/server";
import { getSettings, saveSettings } from "@/lib/db";
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
  const elEnv = Boolean(process.env.ELEVENLABS_API_KEY?.trim());
  const elKey = elEnv ? process.env.ELEVENLABS_API_KEY!.trim() : (s.elevenLabsApiKey ?? "");
  const hfSingle = process.env.HIGGSFIELD_API_KEY?.trim();
  const hfEnv = Boolean(hfSingle || (process.env.HIGGSFIELD_API_KEY_ID?.trim() && process.env.HIGGSFIELD_API_KEY_SECRET?.trim()));
  const hfSecret = hfSingle || (hfEnv ? process.env.HIGGSFIELD_API_KEY_SECRET!.trim() : (s.higgsfieldKeySecret ?? ""));

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
    editorAccessCode: s.editorAccessCode,
    // Les cookies restent sur le serveur : on ne renvoie que leur presence.
    igCookies: "",
    igCookiesSet: Boolean(s.igCookies?.trim()),
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
  if (typeof body.higgsfieldKeySecret === "string" && !body.higgsfieldKeySecret.trim()) delete body.higgsfieldKeySecret;
  // Nouveau solde Higgsfield saisi : on date la saisie pour ne deduire que les rendus suivants.
  if (typeof body.higgsfieldBalanceUsd === "number") {
    if (body.higgsfieldBalanceUsd !== getSettings().higgsfieldBalanceUsd) body.higgsfieldBalanceAt = new Date().toISOString();
  } else if (body.higgsfieldBalanceUsd === null || body.higgsfieldBalanceUsd === undefined) {
    delete body.higgsfieldBalanceUsd;
  }
  // Cookies : vide = on garde ; « CLEAR » = on efface.
  if (typeof body.igCookies === "string") {
    if (body.igCookies === "CLEAR") body.igCookies = "";
    else if (!body.igCookies.trim()) delete body.igCookies;
  }
  return NextResponse.json(publicView(saveSettings(body)));
}
