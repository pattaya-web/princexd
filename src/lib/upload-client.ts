"use client";

export interface Uploaded {
  name: string;
  url: string;
  size: number;
}

/**
 * Envoi d'un fichier avec suivi de progression.
 *
 * `fetch` ne sait pas dire ou en est un envoi : sur un rush de 800 Mo depuis
 * un telephone, l'utilisateur regarde un spinner pendant trois minutes sans
 * savoir si ca avance. XMLHttpRequest, lui, publie la progression.
 *
 * Le fichier part tel quel dans le corps de la requete (pas de multipart) :
 * le serveur l'ecrit sur disque au fil de l'eau, sans le charger en memoire.
 */
export function uploadFile(file: File, onProgress?: (fraction: number) => void): Promise<Uploaded> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `/api/upload?name=${encodeURIComponent(file.name)}`);
    xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total);
    };
    xhr.onerror = () => reject(new Error("Connexion perdue pendant l'envoi."));
    xhr.onload = () => {
      let body: { name?: string; url?: string; size?: number; error?: string } = {};
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        body = {};
      }
      if (xhr.status >= 200 && xhr.status < 300 && body.url) {
        resolve({ name: body.name ?? file.name, url: body.url, size: body.size ?? file.size });
      } else {
        reject(new Error(body.error ?? `Envoi refusé (HTTP ${xhr.status}).`));
      }
    };
    xhr.send(file);
  });
}

export function formatBytes(n: number) {
  if (n > 1e9) return `${(n / 1e9).toFixed(1)} Go`;
  if (n > 1e6) return `${Math.round(n / 1e6)} Mo`;
  return `${Math.round(n / 1e3)} Ko`;
}
