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
  // Cookies : vide = on garde ; « CLEAR » = on efface.
  if (typeof body.igCookies === "string") {
    if (body.igCookies === "CLEAR") body.igCookies = "";
    else if (!body.igCookies.trim()) delete body.igCookies;
  }
  return NextResponse.json(publicView(saveSettings(body)));
}
