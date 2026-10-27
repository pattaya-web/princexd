"use client";

import { useRef, useState } from "react";
import { api } from "@/lib/client";
import { fmtDate } from "@/lib/format";
import { uploadFile } from "@/lib/upload-client";
import { useSalesData } from "@/lib/sales/client";
import { Card, Empty, Field, Modal, Spinner, useToast } from "@/components/ui";
import { useSales } from "./context";
import type { SettingExample } from "@/lib/types";

type Draft = Pick<SettingExample, "title" | "context" | "outcome" | "transcript" | "screenshots" | "notes"> & { id?: string };
const blank = (): Draft => ({ title: "", context: "", outcome: "booked", transcript: "", screenshots: [], notes: "" });

const OUTCOME_LABEL: Record<SettingExample["outcome"], string> = { booked: "RDV posé", "no-booking": "Pas de RDV", "": "—" };

/**
 * Exemples de setting : une conversation qui a marche, en captures et en
 * transcript (compte de Mady + compte du prospect), pour en tirer ensuite
 * un script complet. Le setter prend le reflexe de la poser ici ; l'admin
 * ou une IA en fait un script (« En faire un script » pre-remplit).
 */
export function SettingExamples({ onMakeScript }: { onMakeScript: (ex: SettingExample) => void }) {
  const { session } = useSales();
  const toast = useToast();
  const { data, loading, reload } = useSalesData<{ rows: SettingExample[] }>("/api/sales/setting-examples");
  const [editing, setEditing] = useState<Draft | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const rows = data?.rows ?? [];
  const canEdit = (ex: SettingExample) => session.isAdmin || ex.ownerId === session.memberId;

  const save = async (d: Draft) => {
    if (d.id) await api("/api/sales/setting-examples", { method: "PATCH", body: JSON.stringify(d) });
    else await api("/api/sales/setting-examples", { method: "POST", body: JSON.stringify(d) });
    toast("Exemple enregistré.");
    setEditing(null);
    void reload();
  };
  const remove = async (ex: SettingExample) => {
    if (!window.confirm(`Supprimer l'exemple « ${ex.title} » ?`)) return;
    try {
      await api("/api/sales/setting-examples", { method: "DELETE", body: JSON.stringify({ id: ex.id }) });
      void reload();
    } catch (e) {
      toast((e as Error).message, "err");
    }
  };

  return (
    <>
      <Card
        title="Exemples de setting"
        subtitle="Un setting qui a marché : captures de la conversation + transcript (ton compte et celui du prospect). On en tire ensuite un script complet."
        padded={false}
        actions={
          <button className="btn btn-sm btn-primary" onClick={() => setEditing(blank())}>
            + Ajouter un exemple
          </button>
        }
      >
        {loading && !data ? (
          <div className="p-4">
            <Spinner label="Chargement…" />
          </div>
        ) : rows.length === 0 ? (
          <Empty>Aucun exemple pour l&apos;instant. Dès qu&apos;une approche pose un rendez-vous, prends les captures et colle la conversation ici.</Empty>
        ) : (
          <ul>
            {rows.map((ex) => {
              const open = openId === ex.id;
              return (
                <li key={ex.id} style={{ borderBottom: "1px solid var(--border)" }}>
                  <button type="button" className="w-full text-left px-4 py-3 flex items-center gap-3 hover:bg-[var(--surface-2)]" onClick={() => setOpenId(open ? null : ex.id)}>
                    <span className="badge !text-[10.5px] !py-0 shrink-0" style={ex.outcome === "booked" ? { color: "var(--good)" } : ex.outcome === "no-booking" ? { color: "var(--critical)" } : undefined}>
                      {OUTCOME_LABEL[ex.outcome]}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="text-[13.5px] font-semibold block truncate">{ex.title}</span>
                      <span className="dim text-[11.5px] block truncate">
                        {ex.ownerName} · {fmtDate(ex.createdAt)}
                        {ex.context ? ` · ${ex.context}` : ""}
                        {ex.screenshots.length ? ` · ${ex.screenshots.length} capture${ex.screenshots.length > 1 ? "s" : ""}` : ""}
                      </span>
                    </span>
                    <span className="dim text-[11px]">{open ? "▲" : "▼"}</span>
                  </button>
                  {open && (
                    <div className="px-4 pb-4 flex flex-col gap-3">
                      {ex.screenshots.length > 0 && (
                        <div className="flex gap-2 flex-wrap">
                          {ex.screenshots.map((u) => (
                            <a key={u} href={u} target="_blank" rel="noreferrer" className="block rounded-[8px] overflow-hidden" style={{ border: "1px solid var(--border)" }}>
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img src={u} alt="" className="h-[160px] w-auto object-cover" />
                            </a>
                          ))}
                        </div>
                      )}
                      {ex.transcript && (
                        <pre className="text-[12.5px] leading-relaxed whitespace-pre-wrap rounded-[8px] px-3 py-2.5 max-h-[360px] overflow-auto" style={{ fontFamily: "inherit", background: "var(--surface-2)", border: "1px solid var(--border)" }}>
                          {ex.transcript}
                        </pre>
                      )}
                      {ex.notes && <div className="text-[12.5px] leading-snug whitespace-pre-wrap">{ex.notes}</div>}
                      <div className="flex items-center gap-2 flex-wrap">
                        <button className="btn btn-sm" onClick={() => onMakeScript(ex)} title="Ouvre un nouveau script pré-rempli avec la conversation">
                          En faire un script
                        </button>
                        {canEdit(ex) && (
                          <>
                            <button className="btn btn-sm" onClick={() => setEditing({ id: ex.id, title: ex.title, context: ex.context, outcome: ex.outcome, transcript: ex.transcript, screenshots: ex.screenshots, notes: ex.notes })}>
                              Modifier
                            </button>
                            <button className="btn btn-ghost btn-sm" style={{ color: "var(--critical)" }} onClick={() => void remove(ex)}>
                              Supprimer
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>
      {editing && <ExampleEditor draft={editing} onClose={() => setEditing(null)} onSave={save} />}
    </>
  );
}

function ExampleEditor({ draft, onClose, onSave }: { draft: Draft; onClose: () => void; onSave: (d: Draft) => Promise<void> }) {
  const toast = useToast();
  const [d, setD] = useState<Draft>(draft);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const set = (patch: Partial<Draft>) => setD((x) => ({ ...x, ...patch }));

  const addFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    setUploading(true);
    try {
      const urls: string[] = [];
      for (const f of Array.from(files).slice(0, 8)) {
        const up = await uploadFile(f);
        urls.push(up.url);
      }
      set({ screenshots: [...d.screenshots, ...urls].slice(0, 12) });
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const submit = async () => {
    setBusy(true);
    try {
      await onSave(d);
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={d.id ? "Modifier l'exemple" : "Nouvel exemple de setting"}
      wide
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={busy}>
            Annuler
          </button>
          <button className="btn btn-primary" onClick={() => void submit()} disabled={busy || uploading || !d.title.trim() || (!d.transcript.trim() && !d.screenshots.length)}>
            {busy ? <span className="spinner" /> : "Enregistrer"}
          </button>
        </>
      }
    >
      <div className="grid sm:grid-cols-[1fr_180px] gap-3">
        <Field label="Titre" hint="« Reel value → DM → RDV en 4 messages »">
          <input className="input" value={d.title} onChange={(e) => set({ title: e.target.value })} autoFocus />
        </Field>
        <Field label="Résultat">
          <select className="select" value={d.outcome} onChange={(e) => set({ outcome: e.target.value as Draft["outcome"] })}>
            <option value="booked">RDV posé</option>
            <option value="no-booking">Pas de RDV</option>
            <option value="">—</option>
          </select>
        </Field>
        <Field label="Contexte" className="sm:col-span-2" hint="D'où venait le prospect (like d'un reel value, story, lead LP…), quelle approche.">
          <input className="input" value={d.context} onChange={(e) => set({ context: e.target.value })} />
        </Field>
        <Field label="Transcript de la conversation" className="sm:col-span-2" hint="Colle les messages dans l'ordre, en indiquant qui parle : « Moi : … » / « Lui : … ».">
          <textarea className="textarea w-full !text-[13px] leading-relaxed" rows={12} value={d.transcript} onChange={(e) => set({ transcript: e.target.value })} />
        </Field>
        <Field label="Captures d'écran" className="sm:col-span-2" hint="Les screens de la conversation (jusqu'à 12).">
          <div className="flex flex-wrap gap-2 items-center">
            {d.screenshots.map((u) => (
              <span key={u} className="relative block rounded-[8px] overflow-hidden" style={{ border: "1px solid var(--border)" }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={u} alt="" className="h-[90px] w-auto object-cover" />
                <button type="button" className="absolute top-1 right-1 badge !text-[10px] !py-0 cursor-pointer" style={{ background: "var(--surface)" }} onClick={() => set({ screenshots: d.screenshots.filter((x) => x !== u) })}>
                  ✕
                </button>
              </span>
            ))}
            <input ref={fileRef} type="file" accept="image/*" multiple className="hidden" onChange={(e) => void addFiles(e.target.files)} />
            <button type="button" className="btn btn-sm" onClick={() => fileRef.current?.click()} disabled={uploading}>
              {uploading ? "Envoi…" : "+ Ajouter des captures"}
            </button>
          </div>
        </Field>
        <Field label="Notes" className="sm:col-span-2" hint="Ce qui a fait la différence, ce que tu referais.">
          <textarea className="textarea w-full" rows={3} value={d.notes} onChange={(e) => set({ notes: e.target.value })} />
        </Field>
      </div>
    </Modal>
  );
}
