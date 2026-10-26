"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/client";
import { Card, useToast } from "@/components/ui";
import { relative } from "@/lib/format";
import type { StudentAccessPayload } from "@/app/api/formation/access/route";
import type { StudentAccessRow } from "@/lib/formation";

/**
 * Notification sur le tableau de bord de Mady : les élèves qui viennent de
 * dire « j'ai rempli le formulaire d'onboarding ». Un clic « Vu » la retire
 * (l'élève voit alors « Mady a bien reçu ton formulaire »). Rien tant qu'il
 * n'y a personne. Réservé à l'admin : ailleurs l'appel échoue en silence.
 */
export function OnboardingInbox() {
  const toast = useToast();
  const [rows, setRows] = useState<StudentAccessRow[] | null>(null);
  const [busy, setBusy] = useState("");

  const load = useCallback(async () => {
    try {
      const r = await api<StudentAccessPayload>("/api/formation/access");
      setRows(r.students.filter((s) => s.accessRequestedAt && !s.accessApprovedAt).sort((a, b) => b.accessRequestedAt.localeCompare(a.accessRequestedAt)));
    } catch {
      setRows([]);
    }
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(() => document.visibilityState === "visible" && void load(), 120_000);
    return () => clearInterval(t);
  }, [load]);

  const seen = async (s: StudentAccessRow) => {
    setBusy(s.id);
    try {
      await api(`/api/formation/access/${s.id}`, { method: "PATCH", body: JSON.stringify({ accessApproved: true }) });
      toast(`Formulaire de ${s.name} marqué vu.`);
      await load();
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setBusy("");
    }
  };

  if (!rows?.length) return null;

  return (
    <Card
      title={`📝 Formulaire d'onboarding reçu · ${rows.length}`}
      actions={
        <Link href="/formation/eleves" className="btn btn-sm">
          Accès élèves
        </Link>
      }
      padded={false}
    >
      <ul>
        {rows.map((s, i) => (
          <li key={s.id} className="px-3.5 py-2.5 flex items-center gap-3" style={{ borderBottom: i < rows.length - 1 ? "1px solid var(--border)" : "none" }}>
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-semibold truncate">{s.name}</div>
              <div className="dim text-[11.5px]">a rempli le formulaire {relative(s.accessRequestedAt)}</div>
            </div>
            <button type="button" className="btn btn-sm btn-primary !h-[26px] !text-[11.5px]" onClick={() => void seen(s)} disabled={busy === s.id} title="Je l'ai bien reçu : l'élève le voit">
              ✓ Vu
            </button>
          </li>
        ))}
      </ul>
    </Card>
  );
}
