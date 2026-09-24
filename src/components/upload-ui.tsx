"use client";

import { useRef, useState, type DragEvent } from "react";
import { uploadFile, type Uploaded } from "@/lib/upload-client";

/**
 * Briques d'envoi de fichiers partagees entre les drives (montage, ads) :
 * la zone de depot, la barre de progression et l'envoi en serie.
 */

export interface Progress {
  name: string;
  index: number;
  total: number;
  fraction: number;
}

export function ProgressBar({ p }: { p: Progress }) {
  return (
    <div className="rounded-[8px] px-3 py-2" style={{ background: "var(--surface-2)" }}>
      <div className="flex justify-between text-[11.5px] mb-1">
        <span className="truncate flex-1 min-w-0">
          Envoi {p.index}/{p.total} · {p.name}
        </span>
        <span className="num dim ml-2">{Math.round(p.fraction * 100)} %</span>
      </div>
      <div className="h-[5px] rounded-full overflow-hidden" style={{ background: "var(--border)" }}>
        <div
          className="h-full rounded-full"
          style={{ width: `${p.fraction * 100}%`, background: "var(--accent)", transition: "width .2s" }}
        />
      </div>
    </div>
  );
}

/** Envoie plusieurs fichiers l'un apres l'autre en publiant la progression. */
export async function uploadMany(files: File[], onProgress: (p: Progress | null) => void): Promise<Uploaded[]> {
  const out: Uploaded[] = [];
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    onProgress({ name: f.name, index: i + 1, total: files.length, fraction: 0 });
    out.push(
      await uploadFile(f, (fr) => onProgress({ name: f.name, index: i + 1, total: files.length, fraction: fr })),
    );
  }
  onProgress(null);
  return out;
}

export function DropZone({
  label,
  hint,
  accept,
  multiple = true,
  disabled,
  compact,
  onFiles,
}: {
  label: string;
  hint?: string;
  accept?: string;
  multiple?: boolean;
  disabled?: boolean;
  compact?: boolean;
  onFiles: (files: File[]) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    if (disabled) return;
    const files = Array.from(e.dataTransfer.files ?? []);
    if (files.length) onFiles(multiple ? files : files.slice(0, 1));
  };
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => input.current?.click()}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={onDrop}
      className={`w-full rounded-[10px] px-4 text-center transition-colors ${compact ? "py-3" : "py-5"}`}
      style={{
        border: `1.5px dashed ${over ? "var(--accent)" : "var(--border-strong)"}`,
        background: over ? "color-mix(in srgb, var(--accent) 8%, transparent)" : "var(--surface-2)",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.6 : 1,
      }}
    >
      <span className="block text-[13px] font-medium">{label}</span>
      {hint && <span className="block dim text-[11.5px] mt-1">{hint}</span>}
      <input
        ref={input}
        type="file"
        hidden
        multiple={multiple}
        accept={accept}
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = "";
          if (files.length) onFiles(files);
        }}
      />
    </button>
  );
}
