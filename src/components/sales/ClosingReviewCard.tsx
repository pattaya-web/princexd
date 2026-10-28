"use client";

import Link from "next/link";
import { Fragment, useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { api } from "@/lib/client";
import { Card, CopyButton, Empty, ErrorNote, Modal, useToast } from "@/components/ui";
import { fmtDateTime, fmtMoney, relative } from "@/lib/format";
import type { ReviewCall, ClosingScript, CallOutcome } from "@/lib/fathom-review";
import type { CallReview } from "@/lib/types";
import type { CallsReviewPayload } from "@/app/api/sales/calls-review/route";

/**
 * Sales Dashboard → « Mes calls de closing » : les calls enregistres par
 * Fathom, l'analyse IA de chacun (points forts, points a ameliorer,
 * objections, phrases qui closent) et le script de closing redige a partir
 * des vrais calls.
 */

const OUTCOME: Record<CallOutcome, { label: string; color: string }> = {
  won: { label: "Closé", color: "var(--good)" },
  lost: { label: "Perdu", color: "var(--critical)" },
  open: { label: "À statuer", color: "var(--warning)" },
};

const scoreColor = (s: number) => (s >= 8 ? "var(--good)" : s >= 6 ? "var(--warning)" : "var(--critical)");

/* ------------------------------ Markdown minimal ------------------------------- */

/** **gras** et « citations » dans une ligne, sans bibliotheque. */
function inline(s: string): ReactNode {
  const parts = s.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((p, i) => (p.startsWith("**") && p.endsWith("**") ? <strong key={i}>{p.slice(2, -2)}</strong> : <Fragment key={i}>{p}</Fragment>));
}

/** Le script (markdown simple du modele) en HTML lisible : titres, listes, paragraphes. */
export function ScriptView({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  let list: string[] = [];
  const flush = () => {
    if (!list.length) return;
    blocks.push(
      <ul key={`ul-${blocks.length}`} className="flex flex-col gap-1 pl-4 my-1.5 list-disc">
        {list.map((l, i) => (
          <li key={i} className="text-[13px] leading-relaxed">
            {inline(l)}
          </li>
        ))}
      </ul>,
    );
    list = [];
  };
  for (const raw of text.split("\n")) {
    const line = raw.trimEnd();
    const li = /^\s*[-*•]\s+(.*)$/.exec(line);
    if (li) {
      list.push(li[1]);
      continue;
    }
    flush();
    if (!line.trim()) continue;
    if (line.startsWith("# ")) blocks.push(<h2 key={blocks.length} className="text-[20px] font-semibold mt-2 mb-1" style={{ letterSpacing: "-0.02em" }}>{inline(line.slice(2))}</h2>);
    else if (line.startsWith("## ")) blocks.push(<h3 key={blocks.length} className="text-[15px] font-semibold mt-5 mb-1.5 pb-1" style={{ borderBottom: "1px solid var(--border)", color: "var(--accent)" }}>{inline(line.slice(3))}</h3>);
    else if (line.startsWith("### ")) blocks.push(<h4 key={blocks.length} className="text-[13.5px] font-semibold mt-3 mb-1">{inline(line.slice(4))}</h4>);
    else if (line.startsWith("> ")) blocks.push(<blockquote key={blocks.length} className="text-[13px] italic pl-3 my-1.5" style={{ borderLeft: "3px solid var(--accent-ring)" }}>{inline(line.slice(2))}</blockquote>);
    else blocks.push(<p key={blocks.length} className="text-[13px] leading-relaxed my-1">{inline(line)}</p>);
  }
  flush();
  return <div>{blocks}</div>;
}

/* ------------------------------ Detail d'une analyse ------------------------------- */

function Pts({ title, items, color }: { title: string; items: string[]; color: string }) {
  if (!items.length) return null;
  return (
    <div>
      <div className="label-xs mb-1" style={{ color }}>
        {title}
      </div>
      <ul className="flex flex-col gap-1">
        {items.map((s, i) => (
          <li key={i} className="text-[12.5px] leading-relaxed flex gap-2">
            <span className="shrink-0" style={{ color }}>
              •
            </span>
            <span>{s}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ReviewDetail({ r, call }: { r: CallReview; call: ReviewCall }) {
  return (
    <div className="flex flex-col gap-4 px-4 py-4" style={{ background: "color-mix(in srgb, var(--surface-2) 60%, transparent)" }}>
      {r.summary && <p className="text-[13px] leading-relaxed">{r.summary}</p>}
      {r.nextTime && (
        <div className="rounded-lg px-3.5 py-2.5 text-[13px] flex gap-2 items-start" style={{ background: "color-mix(in srgb, var(--accent) 10%, transparent)", border: "1px solid color-mix(in srgb, var(--accent) 35%, transparent)" }}>
          <span className="shrink-0">🎯</span>
          <span>
            <strong>Au prochain call :</strong> {r.nextTime}
          </span>
        </div>
      )}
      <div className="grid md:grid-cols-2 gap-4">
        <Pts title="À améliorer" items={r.improvements} color="var(--critical)" />
        <Pts title="Ce qui a marché" items={r.strengths} color="var(--good)" />
      </div>
      {r.objections.length > 0 && (
        <div>
          <div className="label-xs mb-1.5">Objections entendues</div>
          <div className="flex flex-col gap-2">
            {r.objections.map((o, i) => (
              <div key={i} className="rounded-lg px-3 py-2 text-[12.5px] leading-relaxed" style={{ border: "1px solid var(--border)" }}>
                <div>
                  <strong>« {o.objection} »</strong>
                </div>
                {o.handled && (
                  <div className="dim mt-0.5">
                    Traitée : {o.handled}
                  </div>
                )}
                {o.better && (
                  <div className="mt-0.5" style={{ color: "var(--good)" }}>
                    Mieux : {o.better}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
      {r.keyLines.length > 0 && (
        <div>
          <div className="label-xs mb-1.5">Les phrases qui ont fait avancer le call</div>
          <ul className="flex flex-col gap-1.5">
            {r.keyLines.map((l, i) => (
              <li key={i} className="text-[12.5px] italic pl-3" style={{ borderLeft: "3px solid var(--accent-ring)" }}>
                « {l} »
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="dim text-[11.5px] flex flex-wrap gap-x-3 gap-y-1">
        <span>Analysé {relative(r.createdAt)}</span>
        {r.transcriptChars > 0 && <span>{new Intl.NumberFormat("fr-FR").format(Math.round(r.transcriptChars / 6))} mots de transcript</span>}
        {call.fathomUrl && (
          <a href={call.fathomUrl} target="_blank" rel="noreferrer" className="link">
            Enregistrement Fathom ↗
          </a>
        )}
      </div>
    </div>
  );
}

/* ------------------------------ La carte ------------------------------- */

export function ClosingReviewCard({ currency = "EUR" }: { currency?: string }) {
  const toast = useToast();
  const [data, setData] = useState<CallsReviewPayload | null>(null);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<"all" | CallOutcome>("all");
  const [open, setOpen] = useState<string>("");
  const [busy, setBusy] = useState<string>("");
  /** Analyse en serie : « 2/5 ». */
  const [progress, setProgress] = useState("");
  const [scriptOpen, setScriptOpen] = useState(false);
  const [scriptBusy, setScriptBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await api<CallsReviewPayload>("/api/sales/calls-review"));
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const patchCall = (call: ReviewCall) => setData((d) => (d ? { ...d, calls: d.calls.map((c) => (c.appointmentId === call.appointmentId ? call : c)) } : d));

  const analyze = async (c: ReviewCall) => {
    setBusy(c.appointmentId);
    try {
      const r = await api<{ call: ReviewCall; review: CallReview }>("/api/sales/calls-review", { method: "POST", body: JSON.stringify({ action: "analyze", appointmentId: c.appointmentId }), timeoutMs: 240_000 });
      patchCall(r.call);
      setOpen(c.appointmentId);
      return true;
    } catch (e) {
      toast(`${c.leadName} : ${(e as Error).message}`, "err");
      return false;
    } finally {
      setBusy("");
    }
  };

  /* Les calls closés pas encore analysés, un par un (chaque analyse prend 30 s à 2 min). */
  const analyzeAll = async () => {
    const todo = (data?.calls ?? []).filter((c) => c.outcome === "won" && !c.review);
    if (!todo.length) return;
    let done = 0;
    for (const c of todo) {
      setProgress(`${done + 1}/${todo.length}`);
      const ok = await analyze(c);
      if (!ok) break;
      done++;
    }
    setProgress("");
    toast(done === todo.length ? `${done} call${done > 1 ? "s" : ""} analysé${done > 1 ? "s" : ""}.` : `${done}/${todo.length} analysés, arrêt sur une erreur.`);
  };

  const buildScript = async () => {
    setScriptBusy(true);
    try {
      const s = await api<ClosingScript>("/api/sales/calls-review", { method: "POST", body: JSON.stringify({ action: "script" }), timeoutMs: 300_000 });
      setData((d) => (d ? { ...d, script: s } : d));
      setScriptOpen(true);
      toast("Ton script de closing est prêt.");
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setScriptBusy(false);
    }
  };

  const calls = data?.calls ?? [];
  const rows = useMemo(() => calls.filter((c) => filter === "all" || c.outcome === filter), [calls, filter]);
  const counts = useMemo(() => ({ won: calls.filter((c) => c.outcome === "won").length, lost: calls.filter((c) => c.outcome === "lost").length, open: calls.filter((c) => c.outcome === "open").length }), [calls]);
  const wonTodo = calls.filter((c) => c.outcome === "won" && !c.review).length;
  const reviewedWon = calls.filter((c) => c.outcome === "won" && c.review).length;
  const avg = useMemo(() => {
    const scored = calls.filter((c) => c.review);
    return scored.length ? scored.reduce((a, c) => a + (c.review?.score ?? 0), 0) / scored.length : null;
  }, [calls]);
  const script = data?.script ?? null;

  return (
    <>
      <Card
        padded={false}
        title="Mes calls de closing"
        subtitle="Chaque call enregistré par Fathom, relu par l'IA : ce qui a marché, ce qu'il faut améliorer, les objections. Et ton script de closing, construit sur tes vrais calls."
        actions={
          <>
            {avg !== null && (
              <span className="text-[12px] dim mr-1" title="Note moyenne des calls analysés">
                moyenne <strong className="num" style={{ color: scoreColor(avg) }}>{avg.toFixed(1).replace(".", ",")}/10</strong>
              </span>
            )}
            {wonTodo > 0 && (
              <button className="btn btn-sm" onClick={() => void analyzeAll()} disabled={Boolean(busy) || scriptBusy} title="Analyse chaque call closé pas encore relu, un par un">
                {progress ? `Analyse ${progress}…` : `Analyser les ${wonTodo} call${wonTodo > 1 ? "s" : ""} closé${wonTodo > 1 ? "s" : ""}`}
              </button>
            )}
            {script && (
              <button className="btn btn-sm" onClick={() => setScriptOpen(true)}>
                Voir mon script
              </button>
            )}
            <button className="btn btn-sm btn-primary" onClick={() => void buildScript()} disabled={scriptBusy || Boolean(busy) || reviewedWon === 0} title={reviewedWon === 0 ? "Analyse d'abord au moins un call closé" : "Rédige (ou met à jour) ton script à partir des calls analysés"}>
                {scriptBusy ? "Rédaction en cours…" : script ? "Mettre à jour mon script" : "Rédiger mon script de closing"}
            </button>
          </>
        }
      >
        {error && (
          <div className="p-4">
            <ErrorNote>{error}</ErrorNote>
          </div>
        )}
        {data && !data.configured && (
          <div className="p-4 text-[13px]">
            Aucune clé Fathom : ajoute-la dans{" "}
            <Link href="/reglages" className="link">
              Réglages → Fathom
            </Link>{" "}
            pour que les enregistrements de tes calls arrivent ici.
          </div>
        )}
        {data && data.configured && calls.length === 0 && <Empty>Aucun call enregistré par Fathom pour le moment. Dès qu'un call est enregistré et rattaché à un rendez-vous, il apparaît ici.</Empty>}
        {calls.length > 0 && (
          <>
            <div className="flex items-center gap-1.5 px-4 pt-3 pb-2 flex-wrap">
              {(
                [
                  { key: "all", label: `Tous (${calls.length})` },
                  { key: "won", label: `Closés (${counts.won})` },
                  { key: "lost", label: `Perdus (${counts.lost})` },
                  { key: "open", label: `À statuer (${counts.open})` },
                ] as const
              ).map((f) => (
                <button key={f.key} className={`btn btn-sm ${filter === f.key ? "btn-primary" : "btn-ghost"}`} onClick={() => setFilter(f.key)}>
                  {f.label}
                </button>
              ))}
            </div>
            <div className="scroll-x">
              <table className="table">
                <thead>
                  <tr>
                    <th>Lead</th>
                    <th>Call</th>
                    <th>Issue</th>
                    <th className="text-right">Contrat</th>
                    <th>Note</th>
                    <th>Au prochain call</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((c) => {
                    const r = c.review;
                    const isOpen = open === c.appointmentId;
                    const o = OUTCOME[c.outcome];
                    return (
                      <Fragment key={c.appointmentId}>
                        <tr className={r ? "cursor-pointer row-hover" : ""} onClick={r ? () => setOpen(isOpen ? "" : c.appointmentId) : undefined}>
                          <td>
                            <Link href={`/sales/rendez-vous?open=${c.appointmentId}`} className="text-[13px] font-semibold link" onClick={(e) => e.stopPropagation()} title="Ouvrir dans le CRM">
                              {c.leadName}
                            </Link>
                            {c.closerName && <div className="dim text-[11px]">{c.closerName}</div>}
                          </td>
                          <td className="text-[12px] whitespace-nowrap num">{fmtDateTime(c.at)}</td>
                          <td>
                            <span className="text-[12px] font-semibold" style={{ color: o.color }}>
                              {o.label}
                            </span>
                          </td>
                          <td className="text-right num text-[12.5px] whitespace-nowrap">{c.amount ? fmtMoney(c.amount, c.currency || currency) : <span className="dim">—</span>}</td>
                          <td>
                            {r ? (
                              <span className="text-[14px] font-semibold num" style={{ color: scoreColor(r.score) }}>
                                {r.score}/10
                              </span>
                            ) : (
                              <span className="dim text-[12px]">pas analysé</span>
                            )}
                          </td>
                          <td className="text-[12px] max-w-[360px]">{r?.nextTime ? <span className="line-clamp-2">{r.nextTime}</span> : <span className="dim">—</span>}</td>
                          <td className="whitespace-nowrap text-right">
                            <button
                              className={`btn btn-sm ${r ? "btn-ghost" : ""}`}
                              onClick={(e) => {
                                e.stopPropagation();
                                void analyze(c);
                              }}
                              disabled={Boolean(busy) || scriptBusy}
                              title={r ? "Refaire l'analyse de ce call" : "Relire le transcript Fathom et sortir le debrief"}
                            >
                              {busy === c.appointmentId ? "Analyse…" : r ? "Relancer" : "Analyser"}
                            </button>
                            {r && (
                              <button className="btn btn-sm btn-ghost ml-1" onClick={(e) => { e.stopPropagation(); setOpen(isOpen ? "" : c.appointmentId); }}>
                                {isOpen ? "Replier" : "Détail"}
                              </button>
                            )}
                          </td>
                        </tr>
                        {r && isOpen && (
                          <tr>
                            <td colSpan={7} className="!p-0">
                              <ReviewDetail r={r} call={c} />
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                  {rows.length === 0 && (
                    <tr>
                      <td colSpan={7}>
                        <Empty>Aucun call dans ce filtre.</Empty>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Card>

      <Modal
        open={scriptOpen && Boolean(script)}
        onClose={() => setScriptOpen(false)}
        title="Mon script de closing"
        wide
        footer={
          script ? (
            <div className="flex items-center justify-between gap-3 flex-wrap w-full">
              <span className="dim text-[12px]">
                Rédigé {relative(script.at)} à partir de {script.calls} call{script.calls > 1 ? "s" : ""} analysé{script.calls > 1 ? "s" : ""}.
              </span>
              <div className="flex items-center gap-1.5">
                <CopyButton text={script.text} label="Copier le script" />
                <button className="btn btn-sm" onClick={() => void buildScript()} disabled={scriptBusy}>
                  {scriptBusy ? "Rédaction…" : "Mettre à jour"}
                </button>
              </div>
            </div>
          ) : undefined
        }
      >
        {script && <ScriptView text={script.text} />}
      </Modal>
    </>
  );
}
