import { NextRequest, NextResponse } from "next/server";
import { getSettings, newId, readDB, writeDB } from "@/lib/db";
import { askText, KieError, parseJsonLoose } from "@/lib/kie";
import { buildAdScriptPrompt, SYSTEM_AD_SCRIPTER } from "@/lib/prompts";
import type { AdScript, AdScriptPlan } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

type Draft = Omit<AdScript, "id" | "status" | "text" | "fromInspiration" | "createdAt" | "updatedAt">;

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const strs = (v: unknown) => (Array.isArray(v) ? v.map(str).filter(Boolean) : []);

/**
 * « Sortir un script » : a partir de la transcription d'une pub d'inspiration,
 * le modele reecrit un script a tourner pour mon business, dans le dossier.
 *
 * Sans `url`, la transcription est celle collee dans le corps : ca permet de
 * partir d'un texte recupere ailleurs (sous-titres, prompteur d'un concurrent).
 */
export async function POST(req: NextRequest) {
  const { folderId, url, transcript, brief } = (await req.json().catch(() => ({}))) as {
    folderId?: string;
    url?: string;
    transcript?: string;
    brief?: string;
  };
  if (!folderId) return NextResponse.json({ error: "folderId manquant" }, { status: 400 });

  const folder = readDB().adFolders.find((f) => f.id === folderId);
  if (!folder) return NextResponse.json({ error: "Dossier introuvable" }, { status: 404 });

  const insp = url ? folder.inspirations.find((i) => i.url === url) : undefined;
  const source = transcript?.trim() || insp?.transcript?.trim() || "";
  if (!source) {
    return NextResponse.json(
      { error: "Aucune transcription : lance d'abord « Transcrire » sur la pub, ou colle son texte." },
      { status: 400 },
    );
  }

  const prompt = buildAdScriptPrompt({
    transcript: source,
    brandContext: getSettings().brandContext,
    brief,
    folderTitle: folder.title,
    inspirationNote: insp?.note,
  });

  try {
    const raw = await askText(prompt, SYSTEM_AD_SCRIPTER, 6000);
    const parsed = parseJsonLoose<Partial<Draft>>(raw);

    const plans: AdScriptPlan[] = Array.isArray(parsed.plans)
      ? parsed.plans.map((p, i) => {
          const plan = (p ?? {}) as Partial<AdScriptPlan>;
          return {
            n: Number(plan.n) || i + 1,
            visuel: str(plan.visuel),
            texteEcran: str(plan.texteEcran),
            voix: str(plan.voix),
          };
        })
      : [];
    const now = new Date().toISOString();
    const script: AdScript = {
      id: newId(),
      title: str(parsed.title) || "Script sans titre",
      status: "a-tourner",
      angle: str(parsed.angle),
      hook: str(parsed.hook),
      hooks: strs(parsed.hooks),
      duree: str(parsed.duree),
      plans,
      cta: str(parsed.cta),
      // Le texte au prompteur : les voix des plans mises bout a bout.
      text: plans.map((p) => p.voix).filter(Boolean).join("\n\n"),
      pourquoiCaMarche: strs(parsed.pourquoiCaMarche),
      notes: Array.isArray(parsed.notes) ? strs(parsed.notes).join("\n") : str(parsed.notes),
      fromInspiration: insp?.url ?? "",
      createdAt: now,
      updatedAt: now,
    };

    const fresh = readDB();
    const target = fresh.adFolders.find((f) => f.id === folderId);
    if (!target) return NextResponse.json({ error: "Dossier supprimé entre-temps" }, { status: 404 });
    target.scripts = [script, ...target.scripts];
    writeDB(fresh);

    return NextResponse.json({ script });
  } catch (e) {
    const err = e as KieError;
    return NextResponse.json({ error: err.message }, { status: err.code === 401 ? 401 : 502 });
  }
}
