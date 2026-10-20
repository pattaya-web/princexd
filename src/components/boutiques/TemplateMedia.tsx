"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/client";
import { InfoNote, Modal, useToast } from "@/components/ui";
import type { MediaSlot } from "@/lib/boutique/theme-zip";

interface Props {
  /** Boutiques clientes (id + nom) pour choisir la cible de l'envoi. */
  shops: { id: string; name: string; domain: string }[];
  shopId: string;
  brandName: string;
}

type UploadState = { name: string; status: "pending" | "sending" | "ok" | "error"; message?: string; known: boolean };

/**
 * Les médias que le template attend (images / vidéos référencées par nom),
 * le brief à envoyer aux élèves, et l'envoi direct des fichiers reçus dans
 * Contenu → Fichiers de la boutique du client. Même nom = bonne place.
 */
export function TemplateMedia({ shops, shopId, brandName }: Props) {
  const toast = useToast();
  const [slots, setSlots] = useState<MediaSlot[] | null>(null);
  const [brief, setBrief] = useState("");
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState(shopId);
  const [uploads, setUploads] = useState<UploadState[]>([]);
  const [sending, setSending] = useState(false);

  useEffect(() => setTarget((t) => t || shopId), [shopId]);

  const load = useCallback(async () => {
    try {
      const r = await api<{ slots: MediaSlot[]; brief: string }>(`/api/boutiques/theme/media?brand=${encodeURIComponent(brandName)}`);
      setSlots(r.slots);
      setBrief(r.brief);
    } catch (e) {
      toast((e as Error).message, "err");
    }
  }, [brandName, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  const expected = useMemo(() => (slots ?? []).filter((s) => s.file), [slots]);
  const expectedNames = useMemo(() => new Set(expected.map((s) => s.file.toLowerCase())), [expected]);
  const pages = useMemo(() => Array.from(new Set(expected.map((s) => s.page))), [expected]);
  const shop = shops.find((s) => s.id === target);

  async function copyBrief() {
    try {
      await navigator.clipboard.writeText(brief);
      toast("Brief copié : colle-le à tes élèves.");
    } catch {
      window.prompt("Copie ce brief :", brief);
    }
  }

  async function send(files: File[]) {
    if (!shop) {
      toast("Choisis d'abord la boutique cliente.", "err");
      return;
    }
    const list = files.filter((f) => f.size > 0);
    if (!list.length) return;
    setSending(true);
    setUploads(list.map((f) => ({ name: f.name, status: "pending", known: expectedNames.has(f.name.toLowerCase()) })));
    for (const [i, f] of list.entries()) {
      setUploads((u) => u.map((x, k) => (k === i ? { ...x, status: "sending" } : x)));
      try {
        const res = await fetch("/api/boutiques/shops/files", {
          method: "POST",
          headers: { "x-file-name": encodeURIComponent(f.name), "x-shop-id": shop.id, "Content-Type": f.type || "application/octet-stream" },
          body: f,
        });
        const body = (await res.json().catch(() => ({}))) as { error?: string; status?: string };
        if (!res.ok) throw new Error(body.error ?? `Erreur ${res.status}`);
        setUploads((u) => u.map((x, k) => (k === i ? { ...x, status: "ok", message: body.status } : x)));
      } catch (e) {
        setUploads((u) => u.map((x, k) => (k === i ? { ...x, status: "error", message: (e as Error).message } : x)));
      }
    }
    setSending(false);
  }

  if (!slots) return <div className="dim text-[12px]">Lecture des médias du template…</div>;
  if (!expected.length) return <div className="dim text-[12px]">Ce template ne référence aucun média par nom : rien à fournir.</div>;

  return (
    <div className="grid gap-2.5 text-[13px]">
      <div>
        <span className="font-medium">{expected.length} médias attendus</span>
        <span className="dim"> · {expected.filter((s) => s.kind === "image").length} images, {expected.filter((s) => s.kind === "video").length} vidéos</span>
      </div>
      <div className="flex gap-1.5 flex-wrap">
        <button className="btn btn-sm" onClick={() => setOpen(true)}>
          Voir la liste
        </button>
        <button className="btn btn-sm btn-primary" onClick={copyBrief}>
          Copier le brief élèves
        </button>
      </div>

      <div className="grid gap-1.5 mt-1">
        <span className="label-xs">Envoyer les fichiers reçus dans la boutique</span>
        <select className="select select-sm" value={target} onChange={(e) => setTarget(e.target.value)} disabled={sending}>
          <option value="">Boutique cliente…</option>
          {shops.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name} ({s.domain})
            </option>
          ))}
        </select>
        <label
          className="rounded-xl grid place-items-center text-center px-3 py-4 cursor-pointer"
          style={{ border: "1.5px dashed var(--border-strong)", background: "var(--surface-2)", opacity: sending ? 0.6 : 1 }}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            if (!sending) void send(Array.from(e.dataTransfer.files));
          }}
        >
          <span className="text-[12.5px]">{sending ? "Envoi en cours…" : "Glisse ici les images / vidéos des élèves (ou clique)"}</span>
          <span className="dim text-[11px] mt-0.5">Elles vont dans Contenu → Fichiers de la boutique, avec leur nom. Même nom que la liste = affichée à la bonne place.</span>
          <input
            type="file"
            multiple
            hidden
            disabled={sending}
            accept="image/*,video/mp4,video/quicktime,video/webm,.svg"
            onChange={(e) => {
              const files = Array.from(e.target.files ?? []);
              e.target.value = "";
              void send(files);
            }}
          />
        </label>
        {uploads.length > 0 && (
          <ul className="grid gap-0.5 text-[12px] mono">
            {uploads.map((u, i) => (
              <li key={i} className="flex gap-2 items-baseline">
                <span style={{ color: u.status === "ok" ? "var(--ok, #1a7f37)" : u.status === "error" ? "var(--danger, #c0392b)" : "var(--text-2)" }}>
                  {u.status === "ok" ? "✓" : u.status === "error" ? "✗" : u.status === "sending" ? "…" : "·"}
                </span>
                <span className="truncate">{u.name}</span>
                {!u.known && u.status !== "error" && <span className="dim">(nom absent de la liste : envoyé quand même)</span>}
                {u.status === "error" && <span style={{ color: "var(--danger, #c0392b)" }}>{u.message}</span>}
              </li>
            ))}
          </ul>
        )}
      </div>

      <Modal open={open} onClose={() => setOpen(false)} title={`Médias du template (${expected.length})`} wide>
        <div className="grid gap-3">
          <InfoNote>
            Règle unique : chaque fichier porte exactement le nom indiqué (même extension). Déposé dans Contenu → Fichiers de la boutique, le thème l&apos;affiche tout seul au bon endroit. Le bouton « Copier le brief élèves » reprend cette liste en texte.
          </InfoNote>
          {pages.map((page) => (
            <div key={page}>
              <div className="font-semibold text-[13px] mb-1">{page}</div>
              <table className="w-full text-[12.5px]">
                <tbody>
                  {expected
                    .filter((s) => s.page === page)
                    .map((s, i) => (
                      <tr key={i} style={{ borderTop: "1px solid var(--border)" }}>
                        <td className="py-1 pr-3 mono whitespace-nowrap">{s.file}</td>
                        <td className="py-1 pr-3 dim">{s.kind === "video" ? "vidéo" : "image"}</td>
                        <td className="py-1 dim">
                          {[s.sectionName, s.blockName].filter(Boolean).join(" › ")} · {s.label}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      </Modal>
    </div>
  );
}
