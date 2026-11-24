"use client";

import { Card, CopyButton, Tabs } from "@/components/ui";
import { useLocalState } from "@/lib/client";
import { QUICK_PROMPTS, type QuickPrompt } from "@/lib/studio/quick-prompts";

/** Onglet « Prompts » du Studio (admin) : les prompts à copier-coller en un clic. */
export function StudioQuickPrompts() {
  const [groupId, setGroupId] = useLocalState("studio-quick-prompts-group", QUICK_PROMPTS[0].id);
  const group = QUICK_PROMPTS.find((g) => g.id === groupId) ?? QUICK_PROMPTS[0];

  return (
    <div className="flex flex-col gap-4 max-w-4xl">
      {QUICK_PROMPTS.length > 1 && (
        <Tabs value={group.id} onChange={setGroupId} options={QUICK_PROMPTS.map((g) => ({ value: g.id, label: g.label }))} />
      )}
      {group.prompts.map((p) => (
        <PromptCard key={p.id} p={p} />
      ))}
      {group.footer && <p className="text-[13px] font-medium">{group.footer}</p>}
    </div>
  );
}

function PromptCard({ p }: { p: QuickPrompt }) {
  return (
    <Card title={p.title} actions={<CopyButton text={p.prompt} label="Copier le prompt" />}>
      <div className="flex flex-col gap-3 text-[13px] leading-relaxed">
        {p.intro && <p>{p.intro}</p>}
        <p>
          <strong>{p.part.label} :</strong> {p.part.text}
        </p>
        {p.slots && (
          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="text-left">
                <th className="py-1.5 pr-4 font-semibold" style={{ borderBottom: "1px solid var(--border)" }}>Case du Studio</th>
                <th className="py-1.5 font-semibold" style={{ borderBottom: "1px solid var(--border)" }}>Ce que tu mets</th>
              </tr>
            </thead>
            <tbody>
              {p.slots.map((s) => (
                <tr key={s.slot}>
                  <td className="py-1.5 pr-4" style={{ borderBottom: "1px solid var(--border)" }}>{s.slot}</td>
                  <td className="py-1.5" style={{ borderBottom: "1px solid var(--border)" }}>{s.value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div className="relative rounded-[10px]" style={{ background: "var(--surface-3)", border: "1px solid var(--border)" }}>
          <div className="absolute top-1.5 right-1.5">
            <CopyButton text={p.prompt} />
          </div>
          <pre className="whitespace-pre-wrap break-words font-mono text-[12px] leading-relaxed p-3.5 pr-20 max-h-[420px] overflow-auto">
            {p.prompt}
          </pre>
        </div>
      </div>
    </Card>
  );
}
