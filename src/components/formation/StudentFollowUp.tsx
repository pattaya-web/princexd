"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/client";
import { Field, Modal, Spinner, useToast } from "@/components/ui";
import type { StudentFollowUpPayload } from "@/app/api/formation/tasks/route";

/**
 * Suivi d'un élève (admin, depuis Accès élèves) : où il en est dans la marche
 * à suivre, les étapes qu'on lui assigne, et les notes du coach. C'est ici
 * que Mady décide « il est prêt, je génère sa boutique ».
 */
export function StudentFollowUp({ studentId, onClose, onChanged }: { studentId: string; onClose: () => void; onChanged?: () => void }) {
  const toast = useToast();
  const [data, setData] = useState<StudentFollowUpPayload | null>(null);
  const [error, setError] = useState("");
  const [title, setTitle] = useState("");
  const [detail, setDetail] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await api<StudentFollowUpPayload>(`/api/formation/tasks?studentId=${encodeURIComponent(studentId)}`);
      setData(r);
      setNotes((n) => n || r.coachNotes);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }, [studentId]);

  useEffect(() => {
    void load();
  }, [load]);

  const call = async (init: RequestInit, ok?: string) => {
    setBusy(true);
    try {
      const r = await api<StudentFollowUpPayload>("/api/formation/tasks", init);
      setData(r);
      if (ok) toast(ok);
      onChanged?.();
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setBusy(false);
    }
  };

  const addTask = () => {
    if (!title.trim()) return;
    void call({ method: "POST", body: JSON.stringify({ studentId, title, detail }) }, "Étape assignée : il la voit dans Scale X.").then(() => {
      setTitle("");
      setDetail("");
    });
  };

  const fmt = (iso: string) => (iso ? new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Paris" }).format(new Date(iso)) : "jamais");

  return (
    <Modal open onClose={onClose} title={data ? `Suivi de ${data.student.name}` : "Suivi"} wide>
      {error && <div className="text-[13px]" style={{ color: "var(--bad)" }}>{error}</div>}
      {!data && !error && <Spinner label="Chargement…" />}
      {data && (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12.5px] dim">
            <span>
              Modules : <strong className="num">{data.modulesDone} / {data.modulesTotal}</strong>
            </span>
            <span>
              Étapes : <strong className="num">{data.steps.filter((s) => s.done).length + data.tasks.filter((t) => t.done).length} / {data.steps.length + data.tasks.length}</strong>
            </span>
            <span>Dernière visite : {fmt(data.student.portalLastSeenAt)}</span>
            <span className="flex-1" />
            <Link href="/boutiques" className="btn btn-sm btn-primary">
              Générer sa boutique
            </Link>
            <Link href="/eleves/onboarding" className="btn btn-sm btn-ghost">
              Message d&apos;onboarding
            </Link>
          </div>

          <div className="grid gap-4 md:grid-cols-2 items-start">
            <div className="card-flat p-3">
              <div className="label-xs mb-2">Marche à suivre</div>
              <div className="flex flex-col gap-1 max-h-[46vh] overflow-auto pr-1">
                {data.steps.map((s, i) => (
                  <label key={s.id} className="flex items-start gap-2 text-[13px] cursor-pointer py-0.5">
                    <input
                      type="checkbox"
                      className="mt-[3px]"
                      checked={s.done}
                      disabled={busy}
                      onChange={() => void call({ method: "PATCH", body: JSON.stringify({ studentId, stepId: s.id, done: !s.done }) })}
                    />
                    <span style={{ opacity: s.done ? 0.6 : 1, textDecoration: s.done ? "line-through" : "none" }}>
                      <span className="dim num mr-1">{String(i + 1).padStart(2, "0")}</span>
                      {s.title}
                    </span>
                  </label>
                ))}
                {!data.steps.length && <div className="dim text-[12.5px]">Aucune étape publiée.</div>}
              </div>
            </div>

            <div className="flex flex-col gap-3">
              <div className="card-flat p-3">
                <div className="label-xs mb-2">Étapes assignées à {data.student.name.split(" ")[0]}</div>
                {data.tasks.length === 0 && <div className="dim text-[12.5px] mb-2">Aucune pour l&apos;instant. Après un call, note-lui ses prochaines actions ici.</div>}
                <div className="flex flex-col gap-1.5">
                  {data.tasks.map((t) => (
                    <div key={t.id} className="flex items-start gap-2 text-[13px]">
                      <input type="checkbox" className="mt-[3px]" checked={t.done} disabled={busy} onChange={() => void call({ method: "PATCH", body: JSON.stringify({ studentId, taskId: t.id, done: !t.done }) })} />
                      <span className="flex-1 min-w-0" style={{ opacity: t.done ? 0.6 : 1, textDecoration: t.done ? "line-through" : "none" }}>
                        {t.title}
                        {t.detail && <span className="dim block text-[12px] whitespace-pre-line">{t.detail}</span>}
                      </span>
                      <button className="btn btn-sm btn-ghost !px-2" disabled={busy} onClick={() => void call({ method: "DELETE", body: JSON.stringify({ studentId, taskId: t.id }) })} title="Retirer">
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
                <form
                  className="flex flex-col gap-2 mt-3"
                  onSubmit={(e) => {
                    e.preventDefault();
                    addTask();
                  }}
                >
                  <input className="input" placeholder="Nouvelle étape : « Envoie-moi tes 3 produits avant vendredi »" value={title} onChange={(e) => setTitle(e.target.value)} />
                  <textarea className="input" rows={2} placeholder="Consigne (facultatif)" value={detail} onChange={(e) => setDetail(e.target.value)} />
                  <button type="submit" className="btn btn-sm btn-primary self-end" disabled={busy || !title.trim()}>
                    Assigner
                  </button>
                </form>
              </div>

              <Field label="Notes du coach" hint="Visibles de toi seulement.">
                <textarea className="input" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} onBlur={() => notes !== data.coachNotes && void call({ method: "PATCH", body: JSON.stringify({ studentId, coachNotes: notes }) }, "Notes enregistrées.")} />
              </Field>
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}
