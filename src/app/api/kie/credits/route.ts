import { NextRequest, NextResponse } from "next/server";
import { getCredits, KieError } from "@/lib/kie";
import { getSettings } from "@/lib/db";
import { scopeError, studioScope, withScope } from "@/lib/studio-tenant";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const { creditUsdRate, usdToEur } = getSettings();
  // Eleve : le solde de SON compte KIE.
  let scope;
  try {
    scope = studioScope(req);
  } catch (e) {
    const { error, status } = scopeError(e);
    return NextResponse.json({ error, credits: null, usd: null, eur: null, rate: creditUsdRate, usdToEur }, { status });
  }
  try {
    const credits = await withScope(scope, () => getCredits());
    return NextResponse.json({
      credits,
      usd: credits * creditUsdRate,
      eur: credits * creditUsdRate * usdToEur,
      rate: creditUsdRate,
      usdToEur,
    });
  } catch (e) {
    const err = e as KieError;
    return NextResponse.json(
      { error: err.message, credits: null, usd: null, eur: null, rate: creditUsdRate, usdToEur },
      { status: err.code === 401 ? 401 : 502 },
    );
  }
}
