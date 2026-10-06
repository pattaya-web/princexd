"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/client";
import { fmtDate, fmtInt } from "@/lib/format";
import { useSession } from "@/lib/sales/client";
import { Card, CopyButton, Empty, ErrorNote, Field, Modal, PageHeader, Spinner, useToast } from "@/components/ui";
import { mapContacts, OUTREACH_LABEL, OUTREACH_STATUSES, OUTREACH_TONE, parseCsv, type CsvMapping } from "@/lib/outreach";
import type { OutreachListRow } from "@/app/api/outreach/lists/route";
import type { OutreachContact, OutreachList, OutreachStatus } from "@/lib/types";

/**
 * Prospection Instagram pour la VA.
 *
 * Une page d'execution, pas un CRM : CSV → contact → Instagram → message
 * envoye → ligne verte → contact suivant. Tout est a un clic, rien ne demande
 * confirmation, chaque changement part tout de suite en base. La couleur
 * de la ligne dit l'etat : vert contacte, jaune a repondu, rouge probleme.
 *
 * L'admin a la meme page avec en plus l'import CSV, la gestion des listes et
 * la correction manuelle des statuts.
 */

const FILTERS: { key: OutreachStatus | "all"; label: string }[] = [
  { key: "all", label: "All" },
  { key: "to-contact", label: "To Contact" },
  { key: "contacted", label: "Contacted" },
  { key: "replied", label: "Replied" },
  { key: "issue", label: "Issue" },
];

const LAST_LIST_KEY = "outreach:last-list";

/** Fond de ligne : la couleur du statut, assez douce pour rester lisible. */
function rowStyle(status: OutreachStatus, focused: boolean): React.CSSProperties {
  const tone = OUTREACH_TONE[status];
  return {
    background: tone ? `color-mix(in srgb, ${tone} 22%, var(--surface))` : "var(--surface)",
    boxShadow: tone ? `inset 4px 0 0 ${tone}` : focused ? "inset 4px 0 0 var(--accent)" : "inset 4px 0 0 transparent",
    outline: focused ? "2px solid var(--accent)" : "none",
    outlineOffset: -2,
    transition: "background 0.15s",
  };
}

function StatusPill({ status }: { status: OutreachStatus }) {
  const tone = OUTREACH_TONE[status];
  return (
    <span
      className="badge !text-[11px] font-semibold"
      style={tone ? { background: tone, color: "#fff", borderColor: "transparent" } : undefined}
    >
      {OUTREACH_LABEL[status]}
    </span>
  );
}

export default function OutreachPage() {
  const { session } = useSession();
  const isAdmin = Boolean(session?.isAdmin);
  const toast = useToast();

  /* ------------------------------- Listes -------------------------------- */
  const [lists, setLists] = useState<OutreachListRow[] | null>(null);
  const [listsError, setListsError] = useState("");
  const [listId, setListId] = useState<string>("");

  /* ------------------------------- Message ------------------------------- */
  const [message, setMessage] = useState("");
  const [editingMessage, setEditingMessage] = useState(false);
  const [messageDraft, setMessageDraft] = useState("");
  const [savingMessage, setSavingMessage] = useState(false);
  const saveMessage = async () => {
    setSavingMessage(true);
    try {
      const r = await api<{ message: string }>("/api/outreach/message", { method: "PATCH", body: JSON.stringify({ message: messageDraft }) });
      setMessage(r.message);
      setEditingMessage(false);
      toast("Message enregistré. La VA le voit dès son prochain chargement.");
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setSavingMessage(false);
    }
  };
  /** Copie le DM dans le presse-papiers : un clic, puis Instagram. */
  const copyMessage = async () => {
    try {
      await navigator.clipboard.writeText(message);
      toast("Message copié. Colle-le dans le DM Instagram.");
    } catch {
      toast("Copie impossible : sélectionne le texte et copie-le à la main.", "err");
    }
  };

  const loadLists = useCallback(async () => {
    try {
      const r = await api<{ lists: OutreachListRow[]; message: string }>("/api/outreach/lists");
      setLists(r.lists);
      setMessage(r.message);
      setListsError("");
      return r.lists;
    } catch (e) {
      setListsError((e as Error).message);
      return [];
    }
  }, []);

  useEffect(() => {
    void loadLists().then((ls) => {
      if (!ls.length) return;
      let remembered = "";
      try {
        remembered = window.localStorage.getItem(LAST_LIST_KEY) ?? "";
      } catch {
        // Stockage indisponible : on ouvre la plus recente.
      }
      setListId((cur) => cur || (ls.some((l) => l.id === remembered) ? remembered : ls[0].id));
    });
  }, [loadLists]);

  useEffect(() => {
    if (!listId) return;
    try {
      window.localStorage.setItem(LAST_LIST_KEY, listId);
    } catch {
      // Sans stockage, la liste se rechoisit au prochain passage.
    }
  }, [listId]);

  /* ------------------------------ Contacts ------------------------------- */
  const [list, setList] = useState<OutreachList | null>(null);
  const [contacts, setContacts] = useState<OutreachContact[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const loadContacts = useCallback(async (id: string, silent = false) => {
    if (!id) return;
    if (!silent) setLoading(true);
    try {
      const r = await api<{ list: OutreachList; contacts: OutreachContact[] }>(`/api/outreach/lists/${id}`);
      setList(r.list);
      setContacts(r.contacts);
      setError("");
    } catch (e) {
      if (!silent) setError((e as Error).message);
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    setFilter("all");
    setQuery("");
    setFocusId(null);
    void loadContacts(listId);
  }, [listId, loadContacts]);

  // Si l'admin corrige un statut pendant que la VA travaille, elle le voit
  // sans recharger : relecture silencieuse quand l'onglet redevient visible.
  useEffect(() => {
    if (!listId) return;
    const onVisible = () => {
      if (document.visibilityState === "visible") void loadContacts(listId, true);
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [listId, loadContacts]);

  /* --------------------------- Filtres & recherche ------------------------ */
  const [filter, setFilter] = useState<OutreachStatus | "all">("all");
  const [query, setQuery] = useState("");
  const counts = useMemo(() => {
    const c: Record<OutreachStatus, number> = { "to-contact": 0, contacted: 0, replied: 0, issue: 0 };
    for (const x of contacts) c[x.status] += 1;
    return c;
  }, [contacts]);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase().replace(/^@/, "");
    return contacts
      .map((c, i) => ({ c, n: i + 1 }))
      .filter(({ c }) => (filter === "all" || c.status === filter) && (!q || c.username.includes(q) || c.name.toLowerCase().includes(q)));
  }, [contacts, filter, query]);

  /* ------------------------------ Statuts -------------------------------- */
  const [focusId, setFocusId] = useState<string | null>(null);
  const rowRefs = useRef(new Map<string, HTMLElement>());
  const focusTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** Met en avant la prochaine ligne « To Contact » apres celle qu'on vient de traiter. */
  const goNext = (fromId: string) => {
    const order = shown.map(({ c }) => c);
    const idx = order.findIndex((c) => c.id === fromId);
    const next = order.slice(idx + 1).find((c) => c.status === "to-contact" && c.id !== fromId) ?? order.find((c) => c.status === "to-contact" && c.id !== fromId);
    if (!next) {
      setFocusId(null);
      return;
    }
    setFocusId(next.id);
    requestAnimationFrame(() => {
      rowRefs.current.get(next.id)?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
    if (focusTimer.current) clearTimeout(focusTimer.current);
    focusTimer.current = setTimeout(() => setFocusId((cur) => (cur === next.id ? null : cur)), 4000);
  };

  const setStatus = async (c: OutreachContact, status: OutreachStatus) => {
    if (c.status === status) return;
    const before = c.status;
    // Optimiste : la ligne change de couleur a l'instant, la base suit.
    setContacts((cur) => cur.map((x) => (x.id === c.id ? { ...x, status, statusAt: new Date().toISOString() } : x)));
    if (status === "contacted") goNext(c.id);
    try {
      await api(`/api/outreach/contacts/${c.id}`, { method: "PATCH", body: JSON.stringify({ status }) });
      setLists((cur) =>
        cur?.map((l) =>
          l.id === c.listId ? { ...l, counts: { ...l.counts, [before]: Math.max(0, l.counts[before] - 1), [status]: l.counts[status] + 1 } } : l,
        ) ?? cur,
      );
    } catch (e) {
      setContacts((cur) => cur.map((x) => (x.id === c.id ? { ...x, status: before } : x)));
      toast(`Non enregistré : ${(e as Error).message}`, "err");
    }
  };

  /* ------------------------------- Import -------------------------------- */
  const [importing, setImporting] = useState(false);
  const [importName, setImportName] = useState("");
  const [importFile, setImportFile] = useState<{ name: string; mapping: CsvMapping } | null>(null);
  const [importBusy, setImportBusy] = useState(false);

  const readFile = async (file: File) => {
    const text = await file.text();
    const mapping = mapContacts(parseCsv(text));
    setImportFile({ name: file.name, mapping });
    if (!importName.trim()) setImportName(file.name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim());
  };

  const doImport = async () => {
    if (!importFile || !importName.trim()) return;
    setImportBusy(true);
    try {
      const r = await api<{ list: OutreachListRow }>("/api/outreach/lists", {
        method: "POST",
        body: JSON.stringify({ name: importName.trim(), fileName: importFile.name, contacts: importFile.mapping.contacts }),
      });
      toast(`Liste « ${r.list.name} » créée : ${r.list.total} contacts.`);
      setImporting(false);
      setImportFile(null);
      setImportName("");
      await loadLists();
      setListId(r.list.id);
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setImportBusy(false);
    }
  };

  const deleteList = async (l: OutreachListRow) => {
    if (!window.confirm(`Supprimer la liste « ${l.name} » et ses ${l.total} contacts ? Cette action est définitive.`)) return;
    try {
      await api(`/api/outreach/lists/${l.id}`, { method: "DELETE" });
      toast("Liste supprimée.");
      const ls = await loadLists();
      if (listId === l.id) setListId(ls[0]?.id ?? "");
    } catch (e) {
      toast((e as Error).message, "err");
    }
  };

  const [showLists, setShowLists] = useState(false);
  const current = lists?.find((l) => l.id === listId);
  const progress = current && current.total ? Math.round(((current.total - counts["to-contact"]) / current.total) * 100) : 0;

  return (
    <>
      <PageHeader
        title="Outreach"
        actions={
          <>
            {lists && lists.length > 0 && (
              <select className="select !w-auto max-w-[260px]" value={listId} onChange={(e) => setListId(e.target.value)} title="Liste en cours">
                {lists.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name} · {l.total - l.counts["to-contact"]}/{l.total}
                  </option>
                ))}
              </select>
            )}
            {isAdmin && (
              <>
                <button className="btn" onClick={() => setShowLists((v) => !v)}>
                  {showLists ? "Masquer les listes" : "Toutes les listes"}
                </button>
                <button className="btn btn-primary" onClick={() => setImporting(true)}>
                  + Importer un CSV
                </button>
              </>
            )}
          </>
        }
      />

      {listsError && (
        <div className="mb-4">
          <ErrorNote>{listsError}</ErrorNote>
        </div>
      )}

      {/* ------------------------------- Le message -------------------------------- */}
      {lists && (
        <Card
          title="Message à envoyer"
          subtitle="Copie-le, ouvre Instagram, colle-le dans le DM, reviens cliquer « Mark Contacted »."
          className="mb-4"
          actions={
            editingMessage ? undefined : (
              <>
                <CopyButton text={message} label="Copier le message" />
                {isAdmin && (
                  <button
                    className="btn btn-sm"
                    onClick={() => {
                      setMessageDraft(message);
                      setEditingMessage(true);
                    }}
                  >
                    ✎ Modifier
                  </button>
                )}
              </>
            )
          }
        >
          {editingMessage ? (
            <div className="flex flex-col gap-2">
              <textarea className="input w-full !text-[14px] leading-relaxed" rows={3} value={messageDraft} onChange={(e) => setMessageDraft(e.target.value)} autoFocus />
              <div className="flex gap-2 justify-end">
                <button className="btn btn-sm" onClick={() => setEditingMessage(false)} disabled={savingMessage}>
                  Annuler
                </button>
                <button className="btn btn-sm btn-primary" onClick={() => void saveMessage()} disabled={savingMessage || !messageDraft.trim()}>
                  {savingMessage ? <span className="spinner" /> : "Enregistrer"}
                </button>
              </div>
            </div>
          ) : (
            <p
              className="text-[15px] leading-relaxed whitespace-pre-wrap select-all rounded-[10px] px-3.5 py-3"
              style={{ background: "var(--surface-2)", border: "1px dashed var(--border-strong)" }}
            >
              {message}
            </p>
          )}
        </Card>
      )}

      {/* ------------------------------ Listes (admin) ----------------------------- */}
      {isAdmin && showLists && lists && (
        <Card title="Toutes les listes" subtitle="Chaque import est une liste à part. Son avancement est gardé pour toujours." padded={false} className="mb-4">
          {!lists.length ? (
            <Empty>Aucune liste. Importe ton premier CSV.</Empty>
          ) : (
            <div className="scroll-x">
              <table className="table">
                <thead>
                  <tr>
                    <th>Liste</th>
                    <th>Importée le</th>
                    <th className="text-right">Total</th>
                    <th className="text-right">To Contact</th>
                    <th className="text-right">Contacted</th>
                    <th className="text-right">Replied</th>
                    <th className="text-right">Issues</th>
                    <th>Avancement</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {lists.map((l) => {
                    const done = l.total ? Math.round(((l.total - l.counts["to-contact"]) / l.total) * 100) : 0;
                    return (
                      <tr key={l.id} style={{ background: l.id === listId ? "var(--accent-soft)" : undefined }}>
                        <td>
                          <button className="text-[12.5px] font-medium text-left hover:underline" onClick={() => setListId(l.id)}>
                            {l.name}
                          </button>
                          {l.fileName && <div className="dim text-[11px] truncate max-w-[220px]">{l.fileName}</div>}
                        </td>
                        <td className="num text-[12px]">{fmtDate(l.createdAt)}</td>
                        <td className="text-right num">{fmtInt(l.total)}</td>
                        <td className="text-right num">{fmtInt(l.counts["to-contact"])}</td>
                        <td className="text-right num" style={{ color: "var(--good)" }}>{fmtInt(l.counts.contacted)}</td>
                        <td className="text-right num" style={{ color: "var(--warning)" }}>{fmtInt(l.counts.replied)}</td>
                        <td className="text-right num" style={{ color: "var(--critical)" }}>{fmtInt(l.counts.issue)}</td>
                        <td style={{ minWidth: 140 }}>
                          <div className="flex items-center gap-2">
                            <div className="flex-1 rounded-[6px] overflow-hidden" style={{ height: 8, background: "var(--surface-3)" }}>
                              <div className="h-full" style={{ width: `${done}%`, background: "var(--good)" }} />
                            </div>
                            <span className="num text-[11.5px] dim">{done} %</span>
                          </div>
                        </td>
                        <td className="text-right">
                          <button className="btn btn-sm btn-ghost" style={{ color: "var(--critical)" }} onClick={() => void deleteList(l)}>
                            Supprimer
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {/* --------------------------------- Vide ---------------------------------- */}
      {lists && !lists.length && (
        <Card>
          <Empty
            action={
              isAdmin ? (
                <button className="btn btn-primary" onClick={() => setImporting(true)}>
                  + Importer un CSV
                </button>
              ) : undefined
            }
          >
            {isAdmin ? "Aucune liste pour l'instant. Importe un CSV de contacts Instagram pour commencer." : "Aucune liste à traiter pour le moment."}
          </Empty>
        </Card>
      )}

      {/* ------------------------------ Compteurs ------------------------------- */}
      {listId && (
        <>
          <div className="card px-4 py-3 mb-3 flex flex-col gap-3">
            <div className="flex items-center gap-3 flex-wrap">
              <span className="text-[15px] font-semibold truncate">{list?.name ?? current?.name ?? "…"}</span>
              <span className="dim text-[12px] num">
                Total : {fmtInt(contacts.length)} · To Contact : {fmtInt(counts["to-contact"])} · Contacted : {fmtInt(counts.contacted)} · Replied :{" "}
                {fmtInt(counts.replied)} · Issues : {fmtInt(counts.issue)}
              </span>
              <span className="ml-auto flex items-center gap-2 min-w-[140px]">
                <div className="flex-1 rounded-[6px] overflow-hidden" style={{ height: 8, background: "var(--surface-3)" }}>
                  <div className="h-full transition-[width]" style={{ width: `${progress}%`, background: "var(--good)" }} />
                </div>
                <span className="num text-[12px] font-semibold">{progress} %</span>
              </span>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <div className="flex gap-1 p-1 rounded-[10px] overflow-x-auto scroll-x" style={{ background: "var(--surface-3)" }}>
                {FILTERS.map((f) => {
                  const active = filter === f.key;
                  const n = f.key === "all" ? contacts.length : counts[f.key];
                  return (
                    <button
                      key={f.key}
                      onClick={() => setFilter(f.key)}
                      className="px-3 h-[32px] rounded-[7px] text-[12.5px] font-medium whitespace-nowrap flex items-center gap-1.5"
                      style={{
                        background: active ? "var(--surface)" : "transparent",
                        color: active ? "var(--text)" : "var(--text-2)",
                        boxShadow: active ? "var(--shadow)" : "none",
                      }}
                    >
                      {f.key !== "all" && OUTREACH_TONE[f.key] && <span className="w-[8px] h-[8px] rounded-full" style={{ background: OUTREACH_TONE[f.key] }} />}
                      {f.label}
                      <span className="num dim">{fmtInt(n)}</span>
                    </button>
                  );
                })}
              </div>
              <input
                className="input !h-[36px] flex-1 min-w-[180px]"
                placeholder="Rechercher un @username ou un nom…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
          </div>

          {/* -------------------------------- Tableau -------------------------------- */}
          {error && (
            <div className="mb-3">
              <ErrorNote>{error}</ErrorNote>
            </div>
          )}
          {loading && !contacts.length ? (
            <Card>
              <Spinner label="Chargement des contacts…" />
            </Card>
          ) : !shown.length ? (
            <Card>
              <Empty>{contacts.length ? "Aucun contact ne correspond à ce filtre." : "Cette liste est vide."}</Empty>
            </Card>
          ) : (
            <>
              {/* Grand écran : un tableau. */}
              <Card padded={false} className="hidden md:block">
                <table className="table">
                  <thead>
                    <tr>
                      <th style={{ width: 48 }}>#</th>
                      <th>Name</th>
                      <th>Instagram</th>
                      <th>Status</th>
                      <th className="text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map(({ c, n }) => (
                      <tr
                        key={c.id}
                        ref={(el) => {
                          if (el) rowRefs.current.set(c.id, el);
                          else rowRefs.current.delete(c.id);
                        }}
                        style={rowStyle(c.status, focusId === c.id)}
                      >
                        <td className="num dim text-[12px]">{n}</td>
                        <td className="text-[13px]">{c.name || <span className="dim">—</span>}</td>
                        <td>
                          <a href={`https://instagram.com/${c.username}`} target="_blank" rel="noreferrer" className="text-[13.5px] font-semibold" style={{ color: "var(--accent)" }}>
                            @{c.username}
                          </a>
                        </td>
                        <td>
                          {isAdmin ? (
                            <select className="select select-sm !w-auto !text-[12px] font-semibold" value={c.status} onChange={(e) => void setStatus(c, e.target.value as OutreachStatus)}>
                              {OUTREACH_STATUSES.map((s) => (
                                <option key={s} value={s}>
                                  {OUTREACH_LABEL[s]}
                                </option>
                              ))}
                            </select>
                          ) : (
                            <StatusPill status={c.status} />
                          )}
                        </td>
                        <td>
                          <div className="flex items-center justify-end gap-1.5 flex-wrap">
                            <button className="btn btn-sm btn-ghost" onClick={() => void copyMessage()} title="Copier le message à envoyer">
                              📋 Copy message
                            </button>
                            <a href={`https://instagram.com/${c.username}`} target="_blank" rel="noreferrer" className="btn btn-sm">
                              Open Instagram ↗
                            </a>
                            <button className={`btn btn-sm ${c.status === "contacted" ? "" : "btn-primary"}`} onClick={() => void setStatus(c, "contacted")} disabled={c.status === "contacted"}>
                              {c.status === "contacted" ? "✓ Contacted" : "Mark Contacted"}
                            </button>
                            <button className="btn btn-sm btn-ghost" onClick={() => void setStatus(c, "replied")} disabled={c.status === "replied"} title="The lead replied">
                              Replied
                            </button>
                            <button className="btn btn-sm btn-ghost" style={{ color: "var(--critical)" }} onClick={() => void setStatus(c, "issue")} disabled={c.status === "issue"} title="Profile not found, blocked, wrong account…">
                              Issue
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Card>

              {/* Téléphone : une carte par contact, gros boutons. */}
              <ul className="md:hidden flex flex-col gap-2">
                {shown.map(({ c, n }) => (
                  <li
                    key={c.id}
                    ref={(el) => {
                      if (el) rowRefs.current.set(c.id, el);
                      else rowRefs.current.delete(c.id);
                    }}
                    className="card px-3.5 py-3"
                    style={rowStyle(c.status, focusId === c.id)}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <a href={`https://instagram.com/${c.username}`} target="_blank" rel="noreferrer" className="text-[16px] font-semibold truncate" style={{ color: "var(--accent)" }}>
                        @{c.username}
                      </a>
                      <span className="flex items-center gap-2 shrink-0">
                        <span className="dim num text-[11.5px]">#{n}</span>
                        {isAdmin ? (
                          <select className="select select-sm !w-auto !text-[12px] font-semibold" value={c.status} onChange={(e) => void setStatus(c, e.target.value as OutreachStatus)}>
                            {OUTREACH_STATUSES.map((s) => (
                              <option key={s} value={s}>
                                {OUTREACH_LABEL[s]}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <StatusPill status={c.status} />
                        )}
                      </span>
                    </div>
                    {c.name && <div className="text-[13px] mt-0.5 truncate">{c.name}</div>}
                    <button className="btn btn-ghost w-full !h-[40px] mt-3" onClick={() => void copyMessage()}>
                      📋 Copy message
                    </button>
                    <div className="grid grid-cols-2 gap-2 mt-2">
                      <a href={`https://instagram.com/${c.username}`} target="_blank" rel="noreferrer" className="btn !h-[46px] !text-[14px]">
                        Open Instagram ↗
                      </a>
                      <button className={`btn !h-[46px] !text-[14px] ${c.status === "contacted" ? "" : "btn-primary"}`} onClick={() => void setStatus(c, "contacted")} disabled={c.status === "contacted"}>
                        {c.status === "contacted" ? "✓ Contacted" : "Mark Contacted"}
                      </button>
                      <button className="btn btn-ghost !h-[40px]" onClick={() => void setStatus(c, "replied")} disabled={c.status === "replied"}>
                        Replied
                      </button>
                      <button className="btn btn-ghost !h-[40px]" style={{ color: "var(--critical)" }} onClick={() => void setStatus(c, "issue")} disabled={c.status === "issue"}>
                        Issue
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}

      {/* -------------------------------- Import --------------------------------- */}
      <Modal
        open={importing}
        onClose={() => {
          if (!importBusy) {
            setImporting(false);
            setImportFile(null);
          }
        }}
        title="Importer une liste de contacts"
        footer={
          <>
            <button className="btn" onClick={() => setImporting(false)} disabled={importBusy}>
              Annuler
            </button>
            <button className="btn btn-primary" onClick={() => void doImport()} disabled={importBusy || !importFile || !importFile.mapping.contacts.length || !importName.trim()}>
              {importBusy ? <span className="spinner" /> : `Créer la liste${importFile ? ` (${fmtInt(importFile.mapping.contacts.length)} contacts)` : ""}`}
            </button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <Field label="Nom de la liste" hint="Ex. INSYDER - Active Leads 07 Oct, Old Leads October, Competitor Followers 01.">
            <input className="input" value={importName} onChange={(e) => setImportName(e.target.value)} placeholder="Competitor Followers 01" autoFocus />
          </Field>
          <Field label="Fichier CSV" hint="Colonnes reconnues : username, instagram, instagram_username, handle, url… et full_name / name pour le nom. Une seule colonne de pseudos marche aussi.">
            <input
              type="file"
              accept=".csv,text/csv,text/plain"
              className="input !py-1.5"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void readFile(f);
              }}
            />
          </Field>
          {importFile && (
            <div className="card-flat px-3.5 py-3 text-[12.5px] flex flex-col gap-1">
              <div>
                <strong>{importFile.name}</strong> · {fmtInt(importFile.mapping.contacts.length)} contact{importFile.mapping.contacts.length > 1 ? "s" : ""} prêt
                {importFile.mapping.contacts.length > 1 ? "s" : ""}
              </div>
              <div className="dim">
                Pseudo lu dans « {importFile.mapping.usernameColumn || "?"} »{importFile.mapping.nameColumn ? `, nom dans « ${importFile.mapping.nameColumn} »` : ", pas de colonne nom"}.
                {importFile.mapping.skipped > 0 && ` ${importFile.mapping.skipped} ligne${importFile.mapping.skipped > 1 ? "s" : ""} sans pseudo ignorée${importFile.mapping.skipped > 1 ? "s" : ""}.`}
                {importFile.mapping.duplicates > 0 && ` ${importFile.mapping.duplicates} doublon${importFile.mapping.duplicates > 1 ? "s" : ""} retiré${importFile.mapping.duplicates > 1 ? "s" : ""}.`}
              </div>
              {importFile.mapping.contacts.length > 0 && (
                <div className="dim truncate">
                  Aperçu : {importFile.mapping.contacts.slice(0, 6).map((c) => `@${c.username}`).join(", ")}
                  {importFile.mapping.contacts.length > 6 ? "…" : ""}
                </div>
              )}
              {!importFile.mapping.contacts.length && <ErrorNote>Aucun pseudo Instagram trouvé dans ce fichier.</ErrorNote>}
            </div>
          )}
        </div>
      </Modal>
    </>
  );
}
