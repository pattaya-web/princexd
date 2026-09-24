"use client";

import { useEffect, useState } from "react";
import { useToast } from "./ui";

/**
 * Lecture et telechargement d'une video de createur.
 *
 * Deux sources, choisies pour ne jamais faire attendre :
 *  - le fichier en cache sur notre serveur, lu par plages (on peut avancer
 *    dedans) : s'il est deja la, on le joue tout de suite ;
 *  - sinon l'embed officiel Instagram s'affiche immediatement pendant que le
 *    serveur telecharge le fichier en arriere-plan. Des qu'il est pret, un
 *    bouton propose de passer au lecteur complet. Si le serveur echoue
 *    (Instagram bloque les serveurs sans session), l'embed reste, et c'est
 *    tout aussi lisible.
 */

const IG_POST = /instagram\.com\/(?:[^/]+\/)?(reel|reels|p|tv)\/([A-Za-z0-9_-]+)/;

export function igEmbedUrl(permalink: string): string | null {
  const m = permalink.match(IG_POST);
  if (!m) return null;
  const kind = m[1] === "p" ? "p" : "reel";
  return `https://www.instagram.com/${kind}/${m[2]}/embed/`;
}

type Ready = { src: string } | null;

export function CreatorPlayer({ permalink, src }: { permalink: string; src: string }) {
  const embed = igEmbedUrl(permalink);
  const [ready, setReady] = useState<Ready>(null);
  const [useVideo, setUseVideo] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    let alive = true;
    setReady(null);
    setUseVideo(false);
    setFailed(null);
    setChecked(false);
    const sep = src.includes("?") ? "&" : "?";

    // 1. Deja en cache ? Reponse en un aller-retour, sans telechargement.
    fetch(`${src}${sep}cached=1`, { cache: "no-store" })
      .then(async (res) => {
        const body = (await res.json().catch(() => ({}))) as { ok?: boolean; src?: string };
        if (!alive) return;
        if (res.ok && body.ok && body.src) {
          setReady({ src: body.src });
          setUseVideo(true);
          setChecked(true);
          return;
        }
        setChecked(true);
        // 2. Pas en cache : on prepare en fond. L'embed occupe l'ecran en attendant.
        return fetch(`${src}${sep}prepare=1`, { cache: "no-store" }).then(async (r2) => {
          const b2 = (await r2.json().catch(() => ({}))) as { ok?: boolean; src?: string; error?: string };
          if (!alive) return;
          if (r2.ok && b2.ok && b2.src) {
            setReady({ src: b2.src });
            // Sans embed possible (TikTok, YouTube), on bascule directement.
            if (!embed) setUseVideo(true);
          } else {
            setFailed(b2.error ?? `Erreur ${r2.status}`);
            if (!embed) setUseVideo(false);
          }
        });
      })
      .catch((e: Error) => {
        if (!alive) return;
        setChecked(true);
        setFailed(e.message);
      });
    return () => { alive = false; };
  }, [src, permalink, embed]);

  if (useVideo && ready) {
    return (
      <video
        src={ready.src}
        controls
        autoPlay
        playsInline
        preload="auto"
        className="w-full rounded-[9px]"
        style={{ maxHeight: "70vh", background: "#000" }}
      />
    );
  }

  if (embed) {
    return (
      <div className="w-full flex flex-col items-center gap-2">
        <iframe
          src={embed}
          title="Instagram"
          allow="autoplay; encrypted-media; picture-in-picture"
          allowFullScreen
          className="rounded-[9px]"
          style={{ width: "min(100%, 400px)", height: "min(72vh, 700px)", border: 0, background: "#000" }}
        />
        {ready ? (
          <button className="btn btn-sm btn-primary" onClick={() => setUseVideo(true)}>
            ▶ Lecteur complet prêt (avance rapide)
          </button>
        ) : failed ? (
          <span className="dim text-[11.5px] text-center">
            Lecture via Instagram, sans avance rapide : le serveur n&apos;a pas pu récupérer le fichier.
          </span>
        ) : checked ? (
          <span className="dim text-[11.5px] inline-flex items-center gap-1.5">
            <span className="spinner" /> Préparation du lecteur complet en arrière-plan…
          </span>
        ) : null}
      </div>
    );
  }

  if (failed) return <p className="text-[12.5px]" style={{ color: "var(--critical)" }}>{failed}</p>;

  return (
    <div className="w-full rounded-[9px] grid place-items-center" style={{ height: "min(60vh, 520px)", background: "var(--surface-2)" }}>
      <div className="flex flex-col items-center gap-2">
        <span className="spinner" />
        <span className="dim text-[12px]">Préparation de la vidéo… la première fois, ça prend quelques secondes.</span>
      </div>
    </div>
  );
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
