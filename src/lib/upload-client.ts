"use client";

export interface Uploaded {
  name: string;
  url: string;
  size: number;
}

/** Au-dela, on n'essaie que l'envoi en flux : le multipart passerait par la memoire du serveur. */
const MULTIPART_MAX = 300 * 1024 * 1024;

/**
 * iPhone et iPad : Safari (et tout navigateur iOS, qui embarque WebKit) a
 * envoye des fichiers illisibles quand le corps brut de la requete etait un
 * File venant de la galerie photos. Le multipart, lui, lit le fichier en
 * entier avant l'envoi et passe sans probleme.
 */
function prefersMultipart(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  const iosLike = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  return iosLike;
}

function send(file: File, multipart: boolean, onProgress?: (fraction: number) => void): Promise<Uploaded> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", multipart ? "/api/upload" : `/api/upload?name=${encodeURIComponent(file.name)}`);
    if (!multipart) xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total);
    };
    xhr.onerror = () => reject(new Error("Connexion perdue pendant l'envoi."));
    xhr.onload = () => {
      let body: { name?: string; url?: string; size?: number; error?: string; unreadable?: boolean } = {};
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        body = {};
      }
      if (xhr.status >= 200 && xhr.status < 300 && body.url) {
        resolve({ name: body.name ?? file.name, url: body.url, size: body.size ?? file.size });
      } else {
        const err = new Error(body.error ?? `Envoi refusé (HTTP ${xhr.status}).`) as Error & { unreadable?: boolean };
        err.unreadable = Boolean(body.unreadable);
        reject(err);
      }
    };
    if (multipart) {
      const form = new FormData();
      form.append("file", file, file.name);
      xhr.send(form);
    } else {
      xhr.send(file);
    }
  });
}

/**
 * Envoi d'un fichier avec suivi de progression.
 *
 * `fetch` ne sait pas dire ou en est un envoi : sur un rush de 800 Mo depuis
 * un telephone, l'utilisateur regarde un spinner pendant trois minutes sans
 * savoir si ca avance. XMLHttpRequest, lui, publie la progression.
 *
 * Par defaut le fichier part tel quel dans le corps de la requete : le
 * serveur l'ecrit sur disque au fil de l'eau, sans le charger en memoire.
 * Sur iOS, ou pour un fichier que le serveur declare illisible, on repasse
 * par un envoi multipart (le serveur verifie l'entete du fichier recu).
 */
export async function uploadFile(file: File, onProgress?: (fraction: number) => void): Promise<Uploaded> {
  const small = file.size <= MULTIPART_MAX;
  if (prefersMultipart() && small) return send(file, true, onProgress);
  try {
    return await send(file, false, onProgress);
  } catch (e) {
    const err = e as Error & { unreadable?: boolean };
    if (err.unreadable && small) return send(file, true, onProgress);
    throw err;
  }
}

export function formatBytes(n: number) {
  if (n > 1e9) return `${(n / 1e9).toFixed(1)} Go`;
  if (n > 1e6) return `${Math.round(n / 1e6)} Mo`;
  return `${Math.round(n / 1e3)} Ko`;
}
