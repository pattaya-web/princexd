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

/** `audio` : false = fichier sans piste son (le lecteur le dit), null = inconnu. */
type Ready = { src: string; audio: boolean | null } | null;

export function CreatorPlayer({ permalink, src, onReady }: { permalink: string; src: string; onReady?: (localSrc: string) => void }) {
  const toast = useToast();
  const embed = igEmbedUrl(permalink);
  const [ready, setReady] = useState<Ready>(null);
  const [useVideo, setUseVideo] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const [checked, setChecked] = useState(false);
  const [refetching, setRefetching] = useState(false);
  const sep = src.includes("?") ? "&" : "?";

  /** Re-telecharge le fichier par l'API officielle (fichier muet ou abime). */
  const refetch = async () => {
    setRefetching(true);
    try {
      const r = await fetch(`${src}${sep}refetch=1`, { cache: "no-store" });
      const b = (await r.json().catch(() => ({}))) as { ok?: boolean; src?: string; audio?: boolean | null; error?: string };
      if (!r.ok || !b.ok || !b.src) throw new Error(b.error ?? `Erreur ${r.status}`);
      // Nouvelle adresse (cache-busting) : le navigateur relit le fichier.
      setReady({ src: `${b.src}?r=${Date.now()}`, audio: b.audio ?? null });
      setUseVideo(true);
      toast(b.audio === false ? "Fichier re-téléchargé, mais toujours sans piste audio : la source Instagram est muette." : "Fichier re-téléchargé.");
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setRefetching(false);
    }
  };

  useEffect(() => {
    let alive = true;
    setReady(null);
    setUseVideo(false);
    setFailed(null);
    setChecked(false);

    // 1. Deja en cache ? Reponse en un aller-retour, sans telechargement.
    fetch(`${src}${sep}cached=1`, { cache: "no-store" })
      .then(async (res) => {
        const body = (await res.json().catch(() => ({}))) as { ok?: boolean; src?: string; audio?: boolean | null };
        if (!alive) return;
        if (res.ok && body.ok && body.src) {
          setReady({ src: body.src, audio: body.audio ?? null });
          setUseVideo(true);
          setChecked(true);
          onReady?.(body.src);
          return;
        }
        setChecked(true);
        // 2. Pas en cache : on prepare en fond. L'embed occupe l'ecran en attendant.
        return fetch(`${src}${sep}prepare=1`, { cache: "no-store" }).then(async (r2) => {
          const b2 = (await r2.json().catch(() => ({}))) as { ok?: boolean; src?: string; audio?: boolean | null; error?: string };
          if (!alive) return;
          if (r2.ok && b2.ok && b2.src) {
            setReady({ src: b2.src, audio: b2.audio ?? null });
            onReady?.(b2.src);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src, permalink, embed]);

  if (useVideo && ready) {
    return (
      <div className="w-full flex flex-col gap-2">
        <video
          key={ready.src}
          src={ready.src}
          controls
          autoPlay
          playsInline
          preload="auto"
          className="w-full rounded-[9px]"
          style={{ maxHeight: "70vh", background: "#000" }}
        />
        {ready.audio === false ? (
          <div className="flex items-center gap-2 flex-wrap text-[12px] px-2.5 py-2 rounded-md" style={{ background: "var(--surface-2)", color: "var(--critical)" }}>
            <span>Ce fichier n&apos;a pas de piste audio : ce n&apos;est pas ton casque. Le serveur peut le reprendre depuis Instagram.</span>
            <button type="button" className="btn btn-sm" disabled={refetching} onClick={() => void refetch()}>
              {refetching ? "Re-téléchargement…" : "Re-télécharger avec le son"}
            </button>
          </div>
        ) : (
          <span className="dim text-[11px]">
            Fichier serveur{ready.audio ? " · piste audio présente (si rien ne sort, vérifie le mélangeur de volume Windows pour Edge)" : ""}
          </span>
        )}
      </div>
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
            ▶ Lecteur complet prêt (avance rapide, son)
          </button>
        ) : failed ? (
          <span className="dim text-[11.5px] text-center">
            Lecture via Instagram : le lecteur démarre muet, clique sur son icône haut-parleur pour le son. Le serveur n&apos;a pas pu récupérer le fichier (pas d&apos;avance rapide).
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
