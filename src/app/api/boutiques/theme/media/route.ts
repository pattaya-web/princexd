import { NextRequest, NextResponse } from "next/server";
import { refuseUnless } from "@/lib/sales/access";
import { loadTemplateZip, mediaBrief, mediaSlots } from "@/lib/boutique/theme-zip";

export const dynamic = "force-dynamic";

/** Les médias (images / vidéos) que le template attend, et le brief texte pour les élèves (`?brand=`). */
export async function GET(req: NextRequest) {
  const denied = refuseUnless(req, []);
  if (denied) return denied;
  const tpl = await loadTemplateZip();
  if (!tpl) return NextResponse.json({ slots: [], brief: "" });
  const slots = mediaSlots(tpl.files);
  return NextResponse.json({ slots, brief: mediaBrief(slots, req.nextUrl.searchParams.get("brand") ?? "") });
}
