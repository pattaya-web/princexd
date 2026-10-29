"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@/lib/client";
import { fmtDateTime, relative } from "@/lib/format";
import { Card, Empty, ErrorNote, PageHeader, Spinner, useToast } from "@/components/ui";
import type { Draft } from "@/lib/types";

/**
 * Tout ce qui a ete tape ou colle dans l'app et sauvegarde automatiquement
 * (DraftAutosave) : prompts, transcripts, notes, messages… par page, du plus
 * recent au plus ancien. On copie, on rouvre la page (le champ est
 * re-rempli tout seul), ou on supprime.
 */

/** Nom lisible d'une page a partir de son chemin. */
function pageTitle(page: string): string {
  const path = page.split("?")[0];
  const names: [RegExp, string][] = [
    [/^\/studio/, "Studio IA"],
    [/^\/swipe\/reels/, "Tinder des Reels"],
    [/^\/swipe/, "Swipe file"],
    [/^\/youtube/, "Vidéos YouTube"],
    [/^\/meet/, "Lien Meet"],
    [/^\/sales\/utm/, "Liens UTM"],
    [/^\/sales\/messages/, "Messages"],
    [/^\/sales/, "Sales"],
    [/^\/eleves/, "Élèves"],
    [/^\/formation/, "Scale X"],
    [/^\/content-os/, "Content OS"],
    [/^\/content/, "Concurrence"],
    [/^\/boutiques/, "Boutiques"],
    [/^\/marque/, "Ma marque"],
    [/^\/reglages/, "Réglages"],
    [/^\/todo/, "To-do"],
    [/^\/production/, "Production"],
    [/^\/mediabuying/, "Media buying"],
    [/^\/instagram/, "Instagram"],
  ];
  const hit = names.find(([re]) => re.test(path));
  return hit ? hit[1] : path;
}

export default function BrouillonsPage() {
  const toast = useToast();
  const [rows, setRows] = useState<Draft[] | null>(null);
  const [error, setError] = useState("");
  const [open, setOpen] = useState<string | null>(null);

  const load = async () => {
    try {
      const r = await api<{ drafts: Draft[] }>("/api/drafts");
      setRows(r.drafts);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  };
  useEffect(() => {
    void load();
  }, []);

  const copy = async (v: string) => {
    try {
      await navigator.clipboard.writeText(v);
      toast("Copié.");
    } catch {
      toast("Copie impossible ici.", "err");
    }
  };
  const remove = async (d: Draft) => {
    await api(`/api/drafts?id=${encodeURIComponent(d.id)}`, { method: "DELETE" });
    setRows((r) => (r ?? []).filter((x) => x.id !== d.id));
  };
  const removeAll = async () => {
    if (!window.confirm("Supprimer tous les brouillons ? Les champs ne seront plus re-remplis.")) return;
    await api("/api/drafts?all=1", { method: "DELETE" });
    setRows([]);
  };

  const groups = new Map<string, Draft[]>();
  for (const d of rows ?? []) {
    const list = groups.get(d.page) ?? [];
    list.push(d);
    groups.set(d.page, list);
  }

  return (
    <div data-nodraft>
      <PageHeader
        title="Brouillons"
        subtitle="Tout ce que tu tapes ou colles dans l'app est sauvegardé automatiquement, même si tu changes de page. Quand tu reviens sur la page, le champ est re-rempli tout seul."
        actions={
          <>
            <button className="btn" onClick={() => void load()}>
              Actualiser
            </button>
            {rows && rows.length > 0 && (
              <button className="btn btn-ghost" onClick={() => void removeAll()}>
                Tout supprimer
              </button>
            )}
          </>
        }
      />
      {error && <ErrorNote>{error}</ErrorNote>}
      {!rows ? (
        <Card>
          <Spinner label="Chargement…" />
        </Card>
      ) : !rows.length ? (
        <Card>
          <Empty>Rien pour l&apos;instant : tape un prompt, un transcript ou une note quelque part, il apparaîtra ici.</Empty>
        </Card>
      ) : (
        <div className="flex flex-col gap-3">
          {[...groups.entries()].map(([page, list]) => (
            <Card key={page} padded={false} title={pageTitle(page)} subtitle={page} actions={<Link href={page} className="btn btn-sm">Ouvrir la page</Link>}>
              <ul>
                {list.map((d, i) => {
                  const expanded = open === d.id;
                  return (
                    <li key={d.id} className="px-4 py-3 flex flex-col gap-1.5" style={{ borderTop: i ? "1px solid var(--border)" : "none" }}>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[13px] font-semibold">{d.label || d.field.replace(/#\d+$/, "")}</span>
                        <span className="dim text-[11.5px]" title={fmtDateTime(d.updatedAt)}>
                          {relative(d.updatedAt)} · {d.value.length} caractères
                        </span>
                        <span className="ml-auto flex items-center gap-1">
                          <button type="button" className="btn btn-sm" onClick={() => void copy(d.value)}>
                            Copier
                          </button>
                          <button type="button" className="btn btn-sm btn-ghost" onClick={() => setOpen(expanded ? null : d.id)}>
                            {expanded ? "Réduire" : "Tout voir"}
                          </button>
                          <button type="button" className="btn btn-sm btn-ghost" onClick={() => void remove(d)} title="Supprimer ce brouillon">
                            ✕
                          </button>
                        </span>
                      </div>
                      <pre className={`text-[12.5px] leading-snug whitespace-pre-wrap break-words m-0 ${expanded ? "" : "line-clamp-3"}`} style={{ fontFamily: "inherit", color: "var(--text-2)" }}>
                        {d.value}
                      </pre>
                    </li>
                  );
                })}
              </ul>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
