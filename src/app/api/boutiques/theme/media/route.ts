import { NextRequest, NextResponse } from "next/server";
import { refuseUnless } from "@/lib/sales/access";
import { loadTemplateZip, mediaSlots, studentMessage } from "@/lib/boutique/theme-zip";

export const dynamic = "force-dynamic";

/** Les médias (images / vidéos) que le template attend, et le brief texte pour les élèves (`?brand=`). */
export async function GET(req: NextRequest) {
  const denied = refuseUnless(req, []);
  if (denied) return denied;
  const brand = req.nextUrl.searchParams.get("brand") ?? "";
  const tpl = await loadTemplateZip();
  const slots = tpl ? mediaSlots(tpl.files) : [];
  return NextResponse.json({ slots, message: studentMessage(slots, brand) });
}
