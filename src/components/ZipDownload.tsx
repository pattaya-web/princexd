"use client";

import { useState } from "react";
import { zipSync } from "fflate";
import { Field, Modal } from "@/components/ui";
import { dedupeNames } from "@/lib/creative-naming";

/**
 * Telechargement groupe du Studio (2026-11-05) : les creations selectionnees
 * partent dans un seul zip, au nom choisi juste avant. Tout se fait dans le
 * navigateur : chaque fichier passe par le relais /api/kie/download (le CDN de
 * KIE refuse la lecture depuis une autre origine), puis fflate assemble le zip
 * sans recompresser (images et videos le sont deja).
 */

export interface ZipFile {
  /** URL du rendu : CDN KIE (relaye) ou fichier local /api/media/… */
  url: string;
  /** Nom de base, sans extension. */
  name: string;
}

const EXT: Record<string, string> = {
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/webm": "webm",
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

function clean(name: string) {
  return name.replace(/[/\\?%*:|"<>\r\n]/g, "").trim();
}

function defaultName() {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `studio-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

async function fetchOne(f: ZipFile): Promise<{ bytes: Uint8Array; ext: string }> {
  const src = f.url.startsWith("/") || f.url.startsWith("data:") ? f.url : `/api/kie/download?url=${encodeURIComponent(f.url)}&name=x`;
  const res = await fetch(src);
  if (!res.ok) throw new Error(`fichier indisponible (${res.status})`);
  const type = (res.headers.get("content-type") ?? "").split(";")[0];
  const fromUrl = f.url.split("?")[0].split(".").pop() ?? "";
  const ext = EXT[type] ?? (/^[a-z0-9]{2,4}$/i.test(fromUrl) ? fromUrl.toLowerCase() : "bin");
  return { bytes: new Uint8Array(await res.arrayBuffer()), ext };
}

export function ZipDownloadButton({ files, className = "btn btn-sm" }: { files: ZipFile[]; className?: string }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const start = async () => {
    const folder = clean(name) || defaultName();
    setBusy(true);
    setDone(0);
    setError(null);
    try {
      const entries: Record<string, [Uint8Array, { level: 0 }]> = {};
      // Doublons : _2, _3, comme à l'upload chez Meta.
      const names = dedupeNames(files.map((f, i) => clean(f.name).slice(0, 80) || `creation-${i + 1}`));
      const failed: string[] = [];
      // 4 a la fois : assez pour aller vite, sans saturer une connexion lente.
      let next = 0;
      const worker = async () => {
        while (next < files.length) {
          const i = next++;
          const f = files[i];
          try {
            const { bytes, ext } = await fetchOne(f);
            // Le nom exact de la créa (S45_MIX1_HEMIOS_NAVY.png) : l'Ads uploader en fait le nom de la pub.
            entries[`${folder}/${names[i]}.${ext}`] = [bytes, { level: 0 }];
          } catch {
            failed.push(f.name || `création ${i + 1}`);
          }
          setDone((d) => d + 1);
        }
      };
      await Promise.all(Array.from({ length: Math.min(4, files.length) }, worker));
      if (!Object.keys(entries).length) throw new Error("Aucun fichier n'a pu être récupéré. Réessaie dans un instant.");

      const zip = zipSync(entries);
      const blob = new Blob([zip], { type: "application/zip" });
      const href = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = href;
      a.download = `${folder}.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(href), 60_000);

      if (failed.length) setError(`Zip téléchargé, mais ${failed.length} fichier${failed.length > 1 ? "s" : ""} manquant${failed.length > 1 ? "s" : ""} (lien expiré chez KIE).`);
      else setOpen(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button
        type="button"
        className={className}
        disabled={!files.length}
        onClick={() => {
          setName(defaultName());
          setError(null);
          setOpen(true);
        }}
        title={files.length ? "Télécharger la sélection dans un zip" : "Aucun rendu terminé dans la sélection"}
      >
        ↓ Télécharger ({files.length})
      </button>
      <Modal
        open={open}
        onClose={() => !busy && setOpen(false)}
        title={`Télécharger ${files.length} création${files.length > 1 ? "s" : ""}`}
        footer={
          <div className="flex justify-end gap-2">
            <button type="button" className="btn" onClick={() => setOpen(false)} disabled={busy}>
              Annuler
            </button>
            <button type="button" className="btn btn-primary" onClick={() => void start()} disabled={busy}>
              {busy ? (
                <>
                  <span className="spinner" /> {done} / {files.length}
                </>
              ) : (
                "↓ Télécharger le zip"
              )}
            </button>
          </div>
        }
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!busy) void start();
          }}
        >
          <Field label="Nom du dossier">
            <input
              className="input"
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onFocus={(e) => e.currentTarget.select()}
              placeholder={defaultName()}
              data-nodraft
            />
          </Field>
          <p className="dim text-[12px] mt-2">
            Tu recevras <strong>{clean(name) || defaultName()}.zip</strong> dans tes Téléchargements, avec un dossier du même nom à l&apos;intérieur.
          </p>
          {error && (
            <p className="text-[12px] mt-2" style={{ color: "var(--critical)" }}>
              {error}
            </p>
          )}
        </form>
      </Modal>
    </>
  );
}
