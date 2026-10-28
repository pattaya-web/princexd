"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/client";
import { forgetSession } from "@/lib/sales/client";
import { Card, CopyButton, Empty, ErrorNote, PageHeader, Spinner, useToast } from "@/components/ui";
import { StudentFollowUp } from "@/components/formation/StudentFollowUp";
import { GATE_TABS, shopHref } from "@/lib/formation-gate";
import { relative } from "@/lib/format";
import type { SuiviPayload, SuiviRow } from "@/app/api/formation/suivi/route";

/**
 * Suivi des élèves (admin) : le parcours Scale X de chaque élève, étape par
 * étape, avec la date de chaque validation. Mady voit qui est où, qui bloque,
 * et l'adresse de la boutique de chacun sans courir après personne.
 */

const fmtDay = (iso: string) => (iso ? new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short", timeZone: "Europe/Paris" }).format(new Date(iso)) : "");
const fmtFull = (iso: string) => (iso ? new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Paris" }).format(new Date(iso)) : "");

export default function StudentTrackingPage() {
  const toast = useToast();
  const [data, setData] = useState<SuiviPayload | null>(null);
  const [error, setError] = useState("");
  const [followUpId, setFollowUpId] = useState("");
  const [busyId, setBusyId] = useState("");
  const [filter, setFilter] = useState<"all" | "active" | "stuck">("all");

  const load = useCallback(async () => {
    try {
      setData(await api<SuiviPayload>("/api/formation/suivi"));
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const viewAs = async (s: SuiviRow) => {
    setBusyId(s.id);
    try {
      await api("/api/sales/session/view-as", { method: "POST", body: JSON.stringify({ role: "student", studentId: s.id }) });
      forgetSession();
      window.location.href = "/formation";
    } catch (e) {
      toast((e as Error).message, "err");
      setBusyId("");
    }
  };

  const rows = (data?.rows ?? []).filter((r) => {
    if (filter === "active") return r.portalAccess;
    if (filter === "stuck") {
      // Pas de visite depuis 7 jours et parcours pas fini : à relancer.
      const idle = !r.lastSeenAt || Date.now() - new Date(r.lastSeenAt).getTime() > 7 * 86_400_000;
      return r.current !== null && idle;
    }
    return true;
  });

  return (
    <div>
      <PageHeader
        title="Suivi des élèves"
        subtitle="Où en est chaque élève du parcours Scale X, étape par étape, avec la date de chaque validation. Clique un nom : son suivi (étapes assignées, notes)."
        actions={
          <div className="flex items-center gap-1.5">
            {(
              [
                { key: "all", label: "Tous" },
                { key: "active", label: "Accès ouvert" },
                { key: "stuck", label: "À relancer" },
              ] as const
            ).map((f) => (
              <button key={f.key} className={`btn btn-sm ${filter === f.key ? "btn-primary" : ""}`} onClick={() => setFilter(f.key)}>
                {f.label}
              </button>
            ))}
            <Link href="/formation/eleves" className="btn btn-sm btn-ghost">
              Accès élèves
            </Link>
          </div>
        }
      />
      {error && <div className="mb-3"><ErrorNote>{error}</ErrorNote></div>}
      {!data && !error && <Spinner label="Chargement du suivi…" />}

      {data && (
        <>
          {/* Combien d'élèves à chaque étape : d'un coup d'œil, où ça coince. */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5 mb-5">
            {GATE_TABS.map((t, i) => (
              <div key={t.key} className="card px-4 py-3">
                <div className="label-xs truncate">
                  {String(i + 1).padStart(2, "0")} · {t.label}
                </div>
                <div className="text-[24px] font-semibold num leading-none mt-2" style={{ color: data.counts[t.key] ? "var(--accent)" : undefined }}>
                  {data.counts[t.key]}
                </div>
                <div className="dim text-[11.5px] mt-1.5">en cours</div>
              </div>
            ))}
            <div className="card px-4 py-3">
              <div className="label-xs truncate">Parcours terminé</div>
              <div className="text-[24px] font-semibold num leading-none mt-2" style={{ color: data.counts.done ? "var(--good)" : undefined }}>
                {data.counts.done}
              </div>
              <div className="dim text-[11.5px] mt-1.5">campagnes lancées</div>
            </div>
          </div>

          <Card padded={false} title="Parcours" subtitle={`${rows.length} élève${rows.length > 1 ? "s" : ""} · ✓ = étape validée par l'élève, avec la date · ● = étape en cours`}>
            {rows.length === 0 ? (
              <Empty>Aucun élève dans ce filtre.</Empty>
            ) : (
              <div className="scroll-x">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Élève</th>
                      <th>Dernière visite</th>
                      {GATE_TABS.map((t, i) => (
                        <th key={t.key} className="whitespace-nowrap" title={t.doneLabel}>
                          {String(i + 1).padStart(2, "0")} {t.label}
                        </th>
                      ))}
                      <th>Boutique</th>
                      <th>Contact</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.id}>
                        <td>
                          <button type="button" className="text-[13px] font-semibold link text-left" onClick={() => setFollowUpId(r.id)} title="Ouvrir son suivi">
                            {r.name}
                          </button>
                          <div className="dim text-[11px] num">
                            {r.percent} % · {r.current ? `en cours : ${r.current.label}` : "parcours terminé 🚀"}
                            {!r.portalAccess && <span className="badge badge-warn !text-[10px] !py-0 ml-1.5">accès coupé</span>}
                          </div>
                        </td>
                        <td className="text-[12px] whitespace-nowrap" title={fmtFull(r.lastSeenAt)}>
                          {r.lastSeenAt ? relative(r.lastSeenAt) : <span className="dim">jamais</span>}
                        </td>
                        {r.tabs.map((t) => {
                          const isCurrent = r.current?.key === t.key;
                          return (
                            <td key={t.key} className="whitespace-nowrap">
                              {t.done ? (
                                <span className="text-[12px] font-semibold" style={{ color: "var(--good)" }} title={t.doneAt ? `Validée le ${fmtFull(t.doneAt)}` : "Validée (date non enregistrée)"}>
                                  ✓ {t.doneAt ? fmtDay(t.doneAt) : "fait"}
                                </span>
                              ) : isCurrent ? (
                                <span className="text-[12px] font-semibold" style={{ color: "var(--accent)" }}>
                                  ● en cours
                                </span>
                              ) : (
                                <span className="dim text-[12px]">—</span>
                              )}
                            </td>
                          );
                        })}
                        <td className="text-[12px]">
                          {r.shopUrl ? (
                            <a href={shopHref(r.shopUrl)} target="_blank" rel="noreferrer" className="link font-medium" title={`Donnée ${r.shopUrlAt ? relative(r.shopUrlAt) : ""}`}>
                              {r.shopUrl.replace(/^https?:\/\//, "")} ↗
                            </a>
                          ) : r.shopRequest ? (
                            <span className="dim" title="Adresse donnée dans la demande de boutique (Démarrage)">
                              {r.shopRequest.storeUrl} · {r.shopRequest.status === "livree" ? "livrée" : "demandée"}
                            </span>
                          ) : (
                            <span className="dim">pas encore</span>
                          )}
                        </td>
                        <td className="text-[12px] whitespace-nowrap">
                          <div className="flex items-center gap-1">
                            {r.phone ? (
                              <>
                                <span className="num">{r.phone}</span>
                                <CopyButton text={r.phone} />
                              </>
                            ) : r.igUsername ? (
                              <a href={`https://instagram.com/${r.igUsername.replace(/^@/, "")}`} target="_blank" rel="noreferrer" className="link">
                                @{r.igUsername.replace(/^@/, "")}
                              </a>
                            ) : r.email ? (
                              <span className="dim">{r.email}</span>
                            ) : (
                              <span className="dim">—</span>
                            )}
                          </div>
                        </td>
                        <td className="whitespace-nowrap text-right">
                          <button className="btn btn-sm" onClick={() => setFollowUpId(r.id)}>
                            Suivi
                          </button>
                          <button className="btn btn-sm btn-ghost ml-1" onClick={() => void viewAs(r)} disabled={busyId === r.id} title="Ouvrir la plateforme comme cet élève">
                            Voir comme
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <div className="mt-5">
            <Card padded={false} title="Derniers mouvements" subtitle="Chaque étape validée, chaque adresse de boutique donnée, chaque formulaire rempli. Tu reçois aussi chaque validation sur Telegram.">
              {data.events.length === 0 ? (
                <Empty>Rien encore : les validations des élèves apparaîtront ici.</Empty>
              ) : (
                <ul className="flex flex-col">
                  {data.events.map((e, i) => (
                    <li key={`${e.studentId}-${e.kind}-${e.at}-${i}`} className="flex items-center gap-3 px-3.5 py-2 text-[12.5px]" style={{ borderBottom: "1px solid var(--border)" }}>
                      <span className="w-[18px] text-center shrink-0">{e.kind === "step" ? "✓" : e.kind === "shop" ? "🛍" : "📝"}</span>
                      <button type="button" className="font-semibold link shrink-0" onClick={() => setFollowUpId(e.studentId)}>
                        {e.name}
                      </button>
                      <span className="truncate flex-1">
                        {e.kind === "shop" && e.url ? (
                          <>
                            a donné l&apos;adresse de sa boutique :{" "}
                            <a href={shopHref(e.url)} target="_blank" rel="noreferrer" className="link">
                              {e.url.replace(/^https?:\/\//, "")} ↗
                            </a>
                          </>
                        ) : (
                          e.label
                        )}
                      </span>
                      <span className="dim text-[11.5px] shrink-0 num" title={fmtFull(e.at)}>
                        {relative(e.at)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
        </>
      )}

      {followUpId && (
        <StudentFollowUp
          studentId={followUpId}
          onClose={() => {
            setFollowUpId("");
            void load();
          }}
        />
      )}
    </div>
  );
}
