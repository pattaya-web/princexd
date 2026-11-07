"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/client";
import { Card, useToast } from "@/components/ui";
import { relative } from "@/lib/format";
import { shopHref } from "@/lib/formation-gate";
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

/** Boutique pas encore regardée : jamais vue, ou adresse changée depuis le dernier « Vu ». */
const shopPending = (s: StudentAccessRow) => Boolean(s.shopUrl) && (!s.shopReviewedAt || s.shopReviewedAt < (s.shopUrlAt || ""));

/**
 * « Boutiques à checker » (2026-11-07) : chaque élève qui donne l'adresse de
 * sa boutique à l'étape « Ta boutique » arrive ici, lien cliquable. Un clic
 * « Vu » la retire ; si l'élève change d'adresse, elle revient. Rien tant
 * qu'il n'y a rien à regarder. Réservé à l'admin.
 */
export function ShopInbox() {
  const toast = useToast();
  const [rows, setRows] = useState<StudentAccessRow[] | null>(null);
  const [busy, setBusy] = useState("");

  const load = useCallback(async () => {
    try {
      const r = await api<StudentAccessPayload>("/api/formation/access");
      setRows(r.students.filter(shopPending).sort((a, b) => b.shopUrlAt.localeCompare(a.shopUrlAt)));
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
      await api(`/api/formation/access/${s.id}`, { method: "PATCH", body: JSON.stringify({ shopReviewed: true }) });
      toast(`Boutique de ${s.name} marquée vue.`);
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
      title={`🛍 Boutiques d'élèves à checker · ${rows.length}`}
      actions={
        <Link href="/formation/suivi" className="btn btn-sm">
          Suivi des élèves
        </Link>
      }
      padded={false}
    >
      <ul>
        {rows.map((s, i) => (
          <li key={s.id} className="px-3.5 py-2.5 flex items-center gap-3" style={{ borderBottom: i < rows.length - 1 ? "1px solid var(--border)" : "none" }}>
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-semibold truncate">{s.name}</div>
              <a href={shopHref(s.shopUrl)} target="_blank" rel="noreferrer" className="link text-[12.5px] font-medium truncate block">
                {s.shopUrl.replace(/^https?:\/\//, "")} ↗
              </a>
              <div className="dim text-[11.5px]">envoyée {relative(s.shopUrlAt)}</div>
            </div>
            <a href={shopHref(s.shopUrl)} target="_blank" rel="noreferrer" className="btn btn-sm !h-[26px] !text-[11.5px]">
              Ouvrir
            </a>
            <button type="button" className="btn btn-sm btn-primary !h-[26px] !text-[11.5px]" onClick={() => void seen(s)} disabled={busy === s.id} title="Je l'ai regardée : elle sort de la liste (elle revient si l'élève change d'adresse)">
              ✓ Vu
            </button>
          </li>
        ))}
      </ul>
    </Card>
  );
}
