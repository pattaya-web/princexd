import { NextRequest, NextResponse } from "next/server";
import { getSettings, saveSettings } from "@/lib/db";
import { BRAND_SECTIONS, compileBrand, EMPTY_BRAND, hasBrand } from "@/lib/brand";
import { SUGGESTED_BRAND } from "@/lib/brand-suggested";
import type { BrandProfile } from "@/lib/types";

export const dynamic = "force-dynamic";

/** La fiche de marque et le bloc compilé tel qu'il part dans les prompts. */
export async function GET() {
  const s = getSettings();
  const saved = { ...EMPTY_BRAND, ...(s.brand ?? {}) };
  // Rien d'enregistré : on propose la fiche construite depuis les documents de Mady, à relire puis enregistrer.
  const suggested = !hasBrand(saved);
  const brand = suggested ? SUGGESTED_BRAND : saved;
  return NextResponse.json({ brand, suggested, compiled: suggested ? s.brandContext : compileBrand(brand), legacy: suggested ? s.brandContext : "" });
}

/** `{ brand }` : enregistre la fiche et recompile le contexte lu par tous les prompts. */
export async function PUT(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { brand?: Partial<BrandProfile> };
  const brand: BrandProfile = { ...EMPTY_BRAND };
  for (const s of BRAND_SECTIONS) {
    const v = body.brand?.[s.key];
    brand[s.key] = typeof v === "string" ? v.trim().slice(0, 12000) : "";
  }
  const compiled = compileBrand(brand);
  saveSettings(hasBrand(brand) ? { brand, brandContext: compiled } : { brand });
  const s = getSettings();
  return NextResponse.json({ brand, suggested: false, compiled: hasBrand(brand) ? compiled : s.brandContext, legacy: !hasBrand(brand) ? s.brandContext : "" });
}
