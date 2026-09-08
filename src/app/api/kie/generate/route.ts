import { NextRequest, NextResponse } from "next/server";
import { createTask, KieError } from "@/lib/kie";
import { insert } from "@/lib/db";
import { getModel } from "@/lib/models";
import type { Generation } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const { model, input } = (await req.json()) as { model: string; input: Record<string, unknown> };
  const def = getModel(model);
  if (!def) return NextResponse.json({ error: `Modèle inconnu : ${model}` }, { status: 400 });

  // On nettoie les champs vides pour ne pas envoyer de null à KIE.
  const payload: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input ?? {})) {
    if (v === "" || v === null || v === undefined) continue;
    if (Array.isArray(v) && v.length === 0) continue;
    payload[k] = v;
  }

  const base = process.env.PUBLIC_BASE_URL?.trim();
  // Le callback n'est utile que si le tool est joignable depuis Internet.
  const callback = base && !base.includes("localhost") ? `${base}/api/kie/callback` : undefined;

  try {
    const taskId = await createTask(model, payload, callback);
    const row = insert("generations", {
      taskId,
      model,
      kind: def.kind,
      prompt: String(payload.prompt ?? ""),
      input: payload,
      state: "waiting",
      resultUrls: [],
      creditsConsumed: 0,
      failMsg: "",
      updatedAt: new Date().toISOString(),
    }) as unknown as Generation;
    return NextResponse.json(row);
  } catch (e) {
    const err = e as KieError;
    return NextResponse.json({ error: err.message }, { status: err.code === 401 ? 401 : 502 });
  }
}
