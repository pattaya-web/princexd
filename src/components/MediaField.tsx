"use client";

/* eslint-disable @next/next/no-img-element */

import { useEffect, useRef, useState } from "react";
import { Field } from "@/components/ui";
import type { ModelField } from "@/lib/models";
import { VideoThumb } from "@/components/MediaThumb";
import { ThumbImg } from "@/components/MediaThumb";
import { takeFiles } from "@/lib/upload-client";
import { clipboardFiles, droppedFiles } from "@/lib/upload-client";

/**
 * Champ media pour le Studio.
 *
 * Les modeles KIE ne lisent que des URL publiques : le fichier choisi est donc
 * televerse immediatement, et c'est l'URL renvoyee qui alimente le formulaire.
 * L'utilisateur ne voit jamais d'URL, seulement sa vignette.
 */

/**
 * On accepte tout ce que le navigateur classe comme image/video, plus les
 * extensions que Windows n'associe pas toujours a un type MIME. Un filtre trop
 * strict fait apparaitre les fichiers en grise dans le selecteur, sans dire
 * pourquoi.
 */
const ACCEPT: Record<string, string> = {
  image: "image/*,.jfif,.jpe,.jif,.heic,.heif,.avif,.bmp,.tif,.tiff",
  video: "video/*,.mkv,.m4v,.3gp,.hevc",
  audio: "audio/*,.m4a,.opus",
};

/**
 * Format reel d'un fichier, lu dans ses octets d'en-tete.
 *
 * `file.type` vient de l'extension et ment reguliermement : l'image d'exemple
 * de la doc KIE s'appelle « .png » alors que c'est un WEBP, et Kling la refuse
 * en le disant explicitement — il inspecte le contenu, pas le nom. Renommer ne
 * change rien au format ; il faut donc savoir ce qu'on a vraiment en main.
 */
async function sniff(file: File): Promise<"jpeg" | "png" | "other"> {
  const head = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return "jpeg";
  if (head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47) return "png";
  return "other";
}

/**
 * Normalise une image vers ce que les modeles savent lire.
 *
 * Kling n'accepte que du JPEG et du PNG — pas de WEBP, pas d'AVIF, pas de HEIC.
 * Trois cas :
 *
 *  - Deja du JPEG ou du PNG : on se contente de corriger l'extension si elle
 *    ment (.jfif, .jpe, .jif sont des JPEG : un renommage suffit, sans perte).
 *  - Autre format decodable par le navigateur (webp, avif, gif, bmp, tiff) :
 *    on le reencode en PNG via un canvas.
 *  - Indecodable (HEIC hors Safari) : on laisse passer, et le modele repondra
 *    avec un message que la route de generation traduit en francais.
 */
export async function toSupportedImage(file: File): Promise<File> {
  const real = await sniff(file);
  const lower = file.name.toLowerCase();

  if (real === "jpeg" || real === "png") {
    const ext = real === "jpeg" ? ".jpg" : ".png";
    const type = real === "jpeg" ? "image/jpeg" : "image/png";
    const ok = real === "jpeg" ? lower.endsWith(".jpg") || lower.endsWith(".jpeg") : lower.endsWith(".png");
    if (ok && file.type === type) return file;
    const base = file.name.replace(/\.[^.]+$/, "");
    return new File([file], base + ext, { type });
  }

  try {
    const bitmap = await createImageBitmap(file);
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close();

    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!blob) return file;

    const base = file.name.replace(/\.[^.]+$/, "");
    return new File([blob], `${base}.png`, { type: "image/png" });
  } catch {
    return file;
  }
}

interface Item {
  /** Identifiant local : stable pendant l'envoi, avant que l'URL existe. */
  id: string;
  url: string;
  name: string;
  /** Apercu local (blob:) affiche tout de suite, le temps que l'envoi se termine. */
  preview?: string;
  pending?: boolean;
}

let seq = 0;
const newId = () => `m${Date.now().toString(36)}${(seq++).toString(36)}`;

function Thumb({ item, kind, onRemove, small }: { item: Item; kind: string; onRemove: () => void; small?: boolean }) {
  return (
    <span
      className="relative rounded-[8px] overflow-hidden shrink-0"
      style={{ width: small ? 52 : 68, height: small ? 52 : 84, background: "var(--surface-3)", border: "1px solid var(--border)" }}
      title={item.name}
    >
      {item.pending ? (
        <>
          {item.preview && <img src={item.preview} alt="" className="w-full h-full object-cover" style={{ opacity: 0.6 }} />}
          <span className="absolute inset-0 grid place-items-center">
            <span className="spinner" />
          </span>
        </>
      ) : kind === "video" ? (
        <VideoThumb src={item.url} />
      ) : kind === "audio" ? (
        <span className="w-full h-full grid place-items-center text-[18px] dim">♪</span>
      ) : (
        <ThumbImg src={item.url} />
      )}
      <button
        type="button"
        onClick={onRemove}
        title="Retirer"
        className="absolute top-1 right-1 grid place-items-center rounded-full text-[12px] leading-none"
        style={{ width: 19, height: 19, background: "rgb(0 0 0 / 0.62)", color: "#fff" }}
      >
        ×
      </button>
    </span>
  );
}

export function MediaField({
  field,
  value,
  onChange,
  disabled,
  compact,
}: {
  field: ModelField;
  /** Chaine unique pour `file`, tableau d'URL pour `files`. */
  value: string | string[];
  onChange: (v: string | string[]) => void;
  disabled?: boolean;
  /** Panneau flottant du Studio : vignettes 52 px, sans titre (le nom passe en infobulle). */
  compact?: boolean;
}) {
  const multiple = field.type === "files";
  const kind = field.accept ?? "image";
  const max = field.max ?? (multiple ? 4 : 1);

  const [items, setItems] = useState<Item[]>(() => {
    const urls = multiple ? (Array.isArray(value) ? value : []) : value ? [String(value)] : [];
    return urls.map((u) => ({ id: newId(), url: u, name: u.split("/").pop() ?? "média" }));
  });
  const [error, setError] = useState<string | null>(null);

  /*
   * La liste vit aussi dans une ref : plusieurs envois se chevauchent (deux
   * selections rapprochees, un Ctrl+V pendant un envoi) et chacun doit
   * repartir de la liste a jour. Avec la valeur capturee au rendu, le
   * deuxieme envoi ecrasait le premier : « j'en mets deux, il n'en reste
   * qu'une ».
   */
  const itemsRef = useRef(items);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const commit = (next: Item[]) => {
    itemsRef.current = next;
    setItems(next);
    const ready = next.filter((i) => !i.pending).map((i) => i.url);
    onChangeRef.current(multiple ? ready : (ready[0] ?? ""));
  };

  const remove = (id: string) => {
    const it = itemsRef.current.find((x) => x.id === id);
    if (it?.preview) URL.revokeObjectURL(it.preview);
    commit(itemsRef.current.filter((x) => x.id !== id));
  };

  const upload = async (files: File[]) => {
    const room = Math.max(max - itemsRef.current.length, 0);
    const batch = files.slice(0, room);
    setError(files.length > room ? `${max} ${kind === "video" ? "vidéos" : kind === "audio" ? "fichiers" : "photos"} maximum pour ce champ : ${files.length - room} non ajoutée${files.length - room > 1 ? "s" : ""}.` : null);
    if (!batch.length) return;

    // Les vignettes apparaissent tout de suite, dans l'ordre choisi ; les envois partent en parallele.
    const slots: Item[] = batch.map((f) => ({
      id: newId(),
      url: "",
      name: f.name,
      preview: kind === "image" ? URL.createObjectURL(f) : undefined,
      pending: true,
    }));
    commit([...itemsRef.current, ...slots]);

    await Promise.all(
      batch.map(async (raw, i) => {
        const slot = slots[i];
        try {
          const f = kind === "image" ? await toSupportedImage(raw) : raw;
          const form = new FormData();
          form.append("file", f, f.name);
          const res = await fetch("/api/kie/upload", { method: "POST", body: form });
          const body = (await res.json()) as { url?: string; error?: string };
          if (!res.ok || body.error || !body.url) throw new Error(body.error ?? `Erreur ${res.status}`);
          // Retiree entre-temps : on ne la remet pas.
          if (!itemsRef.current.some((x) => x.id === slot.id)) return;
          commit(itemsRef.current.map((x) => (x.id === slot.id ? { ...x, url: body.url!, pending: false } : x)));
          if (slot.preview) URL.revokeObjectURL(slot.preview);
        } catch (e) {
          setError(`${raw.name} : ${(e as Error).message}`);
          remove(slot.id);
        }
      }),
    );
  };

  const full = items.length >= max;

  /* Ctrl+V : une capture d'ecran devient une image de reference. Le premier champ libre la prend. */
  const stateRef = useRef({ full, disabled });
  stateRef.current = { full, disabled };
  useEffect(() => {
    if (kind !== "image") return;
    const onPaste = (e: ClipboardEvent) => {
      if (e.defaultPrevented || stateRef.current.full || stateRef.current.disabled) return;
      const files = clipboardFiles(e).filter((f) => f.type.startsWith("image/"));
      if (!files.length) return;
      e.preventDefault();
      void upload(files);
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind]);
  const [over, setOver] = useState(false);
  const dropProps = {
    onDragOver: (e: React.DragEvent) => { e.preventDefault(); e.stopPropagation(); if (!over) setOver(true); },
    onDragLeave: () => setOver(false),
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setOver(false);
      if (disabled || full) return;
      const files = droppedFiles(e);
      if (files.length) void upload(files);
    },
  };
  const word = kind === "video" ? "vidéo" : kind === "audio" ? "audio" : "photo";

  const tiles = (
      <div className="flex gap-2 items-center flex-wrap">
        {items.map((it) => (
          <Thumb key={it.id} item={it} kind={kind} small={compact} onRemove={() => remove(it.id)} />
        ))}

        {!full && (
          <label
            className="rounded-[8px] flex flex-col items-center justify-center gap-0.5 shrink-0"
            style={{
              width: compact ? 52 : 68,
              height: compact ? 52 : 84,
              border: `1px dashed ${over ? "var(--accent)" : "var(--border-strong)"}`,
              background: over ? "color-mix(in srgb, var(--accent) 8%, transparent)" : undefined,
              cursor: disabled ? "not-allowed" : "pointer",
            }}
            title={`${compact ? `${field.label} : c` : "C"}lique, dépose ${kind === "image" ? "une image" : "un fichier"} ici${kind === "image" ? ", ou colle une capture (Ctrl+V)" : ""}`}
            {...dropProps}
          >
            <span className="text-[17px] dim leading-none">+</span>
            <span className="dim text-[10px]">{word}</span>
            <input
              type="file"
              hidden
              multiple={multiple}
              accept={ACCEPT[kind]}
              disabled={disabled}
              onChange={async (e) => {
                const files = await takeFiles(e.currentTarget);
                if (files.length) void upload(files);
              }}
            />
          </label>
        )}
      </div>
  );
  const err = error && (
    <span className="text-[11.5px] block mt-1.5" style={{ color: "var(--critical)" }}>
      {error}
    </span>
  );

  if (compact) {
    return (
      <div className="max-w-[236px]">
        {tiles}
        {err}
      </div>
    );
  }
  return (
    <Field label={field.label}>
      {tiles}
      {err}
    </Field>
  );
}
