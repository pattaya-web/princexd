import { NextRequest, NextResponse } from "next/server";
import { askText, KieError, parseJsonLoose } from "@/lib/kie";
import { getSettings, insert, list } from "@/lib/db";
import { buildStoryPrompt, SYSTEM_STORY } from "@/lib/prompts";
import type { Story, StoryType } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const SLOTS: Story["slot"][] = ["matin", "midi", "aprem", "soir"];

export async function POST(req: NextRequest) {
  const { date } = (await req.json()) as { date: string };
  const settings = getSettings();
  const day = String(new Date(`${date}T12:00:00`).getDay());
  const types = settings.storyPlan[day] ?? ["value", "daily-life", "cta-call"];

  const slots = types.map((type, i) => ({ slot: SLOTS[i] ?? "soir", type }));

  // On nourrit le modèle avec la matière réelle : résultats élèves et calls closés.
  const students = list("students");
  const calls = list("calls");
  const recentWins = [
    ...students.filter((s) => s.result.trim()).slice(0, 6).map((s) => `- ${s.name} : ${s.result}`),
    ...calls
      .filter((c) => c.status === "closed" && c.value > 0)
      .slice(0, 4)
      .map((c) => `- Call closé avec ${c.contact} : ${c.value} €`),
  ].join("\n");

  try {
    const raw = await askText(
      buildStoryPrompt({ brandContext: settings.brandContext, date, slots, recentWins }),
      SYSTEM_STORY,
      6000,
    );
    const parsed = parseJsonLoose<{
      sequences: { slot: string; type: string; idea: string; script: string; objectif?: string }[];
    }>(raw);

    const created = parsed.sequences.map((seq) =>
      insert("stories", {
        date,
        slot: (SLOTS.includes(seq.slot as Story["slot"]) ? seq.slot : "soir") as Story["slot"],
        type: seq.type as StoryType,
        idea: seq.idea,
        script: seq.objectif ? `${seq.script}\n\nObjectif : ${seq.objectif}` : seq.script,
        done: false,
        views: 0,
        replies: 0,
        stickerTaps: 0,
        linkClicks: 0,
        callsBooked: 0,
      }),
    );

    return NextResponse.json({ created });
  } catch (e) {
    const err = e as KieError;
    return NextResponse.json({ error: err.message }, { status: err.code === 401 ? 401 : 502 });
  }
}
