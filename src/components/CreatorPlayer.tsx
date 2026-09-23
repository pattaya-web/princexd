"use client";

import { useEffect, useState } from "react";
import { useToast } from "./ui";

/**
 * Lecture et telechargement d'une video de createur.
 *
 * Le lecteur demande d'abord au serveur de mettre la video en cache
 * (`?prepare=1`) : une fois le fichier chez nous, il est lu par plages et
 * on peut avancer dedans librement. Si le serveur n'y arrive pas (Instagram
 * bloque les serveurs sans session), on retombe sur l'embed officiel
 * Instagram, qui lit toujours mais sans barre de progression.
 */

const IG_POST = /instagram\.com\/(?:[^/]+\/)?(reel|reels|p|tv)\/([A-Za-z0-9_-]+)/;

export function igEmbedUrl(permalink: string): string | null {
  const m = permalink.match(IG_POST);
  if (!m) return null;
  const kind = m[1] === "p" ? "p" : "reel";
  return `https://www.instagram.com/${kind}/${m[2]}/embed/`;
}

type State = { kind: "loading" } | { kind: "video"; src: string } | { kind: "embed"; src: string } | { kind: "error"; message: string };

export function CreatorPlayer({ permalink, src }: { permalink: string; src: string }) {
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    let alive = true;
    setState({ kind: "loading" });
    const sep = src.includes("?") ? "&" : "?";
    fetch(`${src}${sep}prepare=1`, { cache: "no-store" })
      .then(async (res) => {
        const body = (await res.json().catch(() => ({}))) as { ok?: boolean; src?: string; error?: string };
        if (!alive) return;
        if (res.ok && body.ok && body.src) {
          setState({ kind: "video", src: body.src });
          return;
        }
        const embed = igEmbedUrl(permalink);
        if (embed) setState({ kind: "embed", src: embed });
        else setState({ kind: "error", message: body.error ?? `Erreur ${res.status}` });
      })
      .catch((e: Error) => {
        if (!alive) return;
        const embed = igEmbedUrl(permalink);
        if (embed) setState({ kind: "embed", src: embed });
        else setState({ kind: "error", message: e.message });
      });
    return () => { alive = false; };
  }, [src, permalink]);

  if (state.kind === "loading") {
    return (
      <div className="w-full rounded-[9px] grid place-items-center" style={{ height: "min(60vh, 520px)", background: "var(--surface-2)" }}>
        <div className="flex flex-col items-center gap-2">
          <span className="spinner" />
          <span className="dim text-[12px]">Préparation de la vidéo… la première fois, ça prend quelques secondes.</span>
        </div>
      </div>
    );
  }

  if (state.kind === "video") {
    return (
      <video
        src={state.src}
        controls
        autoPlay
        playsInline
        preload="auto"
        className="w-full rounded-[9px]"
        style={{ maxHeight: "70vh", background: "#000" }}
      />
    );
  }

  if (state.kind === "embed") {
    return (
      <div className="w-full flex flex-col items-center gap-2">
        <iframe
          src={state.src}
          title="Instagram"
          allow="autoplay; encrypted-media; picture-in-picture"
          allowFullScreen
          className="rounded-[9px]"
          style={{ width: "min(100%, 400px)", height: "min(72vh, 700px)", border: 0, background: "#000" }}
        />
        <span className="dim text-[11.5px] text-center">
          Lecture via Instagram, sans avance rapide : le serveur n&apos;a pas pu récupérer le fichier. Ajoute tes cookies
          Instagram dans Réglages pour le lecteur complet.
        </span>
      </div>
    );
  }

  return <p className="text-[12.5px]" style={{ color: "var(--critical)" }}>{state.message}</p>;
}

/** Verifie que le serveur sait obtenir le fichier, puis lance le telechargement. */
export function DownloadButton({
  href,
  label = "Télécharger",
  className = "btn btn-sm btn-primary",
  style,
}: {
  href: string;
  label?: string;
  className?: string;
  style?: React.CSSProperties;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  const go = async () => {
    setBusy(true);
    try {
      const res = await fetch(`${href}&probe=1`, { cache: "no-store" });
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !body.ok) {
        const msg = body.error ?? `Erreur ${res.status}`;
        toast(
          /429|login|cookies|rate/i.test(msg)
            ? "Instagram refuse le téléchargement depuis le serveur. Ajoute tes cookies Instagram dans Réglages pour l'autoriser."
            : msg,
          "err",
        );
        return;
      }
      window.location.href = href;
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setBusy(false);
    }
  };

  return (
    <button type="button" className={className} style={style} onClick={() => void go()} disabled={busy} title="Télécharger la vidéo">
      {busy ? <span className="spinner" /> : label}
    </button>
  );
}
