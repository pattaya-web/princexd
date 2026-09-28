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

/**
 * Cloudflare (plan gratuit) refuse tout corps de requete au-dela de 100 Mo :
 * il coupe la connexion apres le premier mega-octet, et le navigateur ne
 * voit qu'une erreur reseau. Au-dela de ce seuil, on decoupe le fichier en
 * morceaux envoyes l'un apres l'autre ; le serveur les recolle.
 */
const CHUNKED_FROM = 90 * 1024 * 1024;
const CHUNK_SIZE = 32 * 1024 * 1024;
/** Tentatives par morceau sur coupure reseau : la liaison est instable. */
const CHUNK_RETRIES = 3;

interface Reply { name?: string; url?: string; size?: number; error?: string; unreadable?: boolean; ok?: boolean }

function request(
  url: string,
  body: Blob | FormData,
  contentType: string | null,
  onProgress?: (loaded: number, total: number) => void,
): Promise<{ status: number; body: Reply }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    if (contentType) xhr.setRequestHeader("Content-Type", contentType);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) onProgress(e.loaded, e.total);
    };
    xhr.onerror = () => reject(new Error("Connexion perdue pendant l'envoi."));
    xhr.onload = () => {
      let parsed: Reply = {};
      try {
        parsed = JSON.parse(xhr.responseText);
      } catch {
        parsed = {};
      }
      resolve({ status: xhr.status, body: parsed });
    };
    xhr.send(body);
  });
}

function refusal(status: number, body: Reply): Error & { unreadable?: boolean } {
  const err = new Error(body.error ?? `Envoi refusé (HTTP ${status}).`) as Error & { unreadable?: boolean };
  err.unreadable = Boolean(body.unreadable);
  return err;
}

async function send(file: File, multipart: boolean, onProgress?: (fraction: number) => void): Promise<Uploaded> {
  let body: Blob | FormData = file;
  if (multipart) {
    const form = new FormData();
    form.append("file", file, file.name);
    body = form;
  }
  const { status, body: reply } = await request(
    multipart ? "/api/upload" : `/api/upload?name=${encodeURIComponent(file.name)}`,
    body,
    multipart ? null : file.type || "application/octet-stream",
    (loaded, total) => onProgress?.(loaded / total),
  );
  if (status >= 200 && status < 300 && reply.url) {
    return { name: reply.name ?? file.name, url: reply.url, size: reply.size ?? file.size };
  }
  throw refusal(status, reply);
}

/** Identifiant d'envoi cote navigateur : lettres et chiffres, valide par le serveur. */
function uploadId(): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  let id = "";
  for (let i = 0; i < 20; i++) id += alphabet[Math.floor(Math.random() * alphabet.length)];
  return id;
}

async function sendChunked(file: File, onProgress?: (fraction: number) => void): Promise<Uploaded> {
  const id = uploadId();
  const parts = Math.ceil(file.size / CHUNK_SIZE);
  const type = file.type || "application/octet-stream";
  for (let part = 1; part <= parts; part++) {
    const offset = (part - 1) * CHUNK_SIZE;
    const chunk = file.slice(offset, Math.min(file.size, offset + CHUNK_SIZE), type);
    const url =
      `/api/upload?name=${encodeURIComponent(file.name)}&upload=${id}` +
      `&part=${part}&parts=${parts}&offset=${offset}&size=${file.size}`;
    let lastError: Error | null = null;
    for (let attempt = 1; attempt <= CHUNK_RETRIES; attempt++) {
      try {
        const { status, body } = await request(url, chunk, type, (loaded) => onProgress?.((offset + loaded) / file.size));
        if (status >= 200 && status < 300) {
          if (part === parts) {
            if (!body.url) throw refusal(status, body);
            return { name: body.name ?? file.name, url: body.url, size: body.size ?? file.size };
          }
          lastError = null;
          break;
        }
        // Refus franc du serveur (extension, taille, fichier illisible) : inutile d'insister.
        throw refusal(status, body);
      } catch (e) {
        const err = e as Error;
        if (!err.message.startsWith("Connexion perdue")) throw err;
        lastError = err;
        // Petite pause avant de renvoyer le meme morceau.
        await new Promise((r) => setTimeout(r, 1500 * attempt));
      }
    }
    if (lastError) throw lastError;
  }
  throw new Error("Envoi incomplet.");
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
  // Gros rush : par morceaux, seule facon de passer Cloudflare (voir CHUNKED_FROM).
  if (file.size > CHUNKED_FROM) return sendChunked(file, onProgress);
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

/** Au-dela, on ne copie pas en memoire : un rush de 800 Mo reste un simple handle. */
const CLONE_MAX = 64 * 1024 * 1024;

/**
 * Recupere les fichiers d'un <input type="file"> de facon sure.
 *
 * Vider `input.value` tout de suite apres le choix (pour pouvoir rechoisir le
 * meme fichier) invalidait le fichier sur telephone : le navigateur liberait
 * la copie temporaire de la galerie avant que l'envoi ne l'ait lue, et le
 * serveur recevait un corps vide ou des octets sans rapport. On copie donc
 * d'abord les fichiers raisonnables en memoire, puis seulement on vide le
 * champ ; un gros fichier garde son handle et le champ n'est pas vide.
 */
export async function takeFiles(input: HTMLInputElement): Promise<File[]> {
  const picked = Array.from(input.files ?? []);
  const files = await Promise.all(
    picked.map(async (f) => {
      if (f.size > CLONE_MAX) return f;
      try {
        return new File([await f.arrayBuffer()], f.name, { type: f.type, lastModified: f.lastModified });
      } catch {
        return f;
      }
    }),
  );
  if (files.every((f, i) => f !== picked[i])) {
    try { input.value = ""; } catch { /* certains navigateurs refusent : sans consequence */ }
  }
  return files;
}

/**
 * Fichiers images (et videos) d'un collage Ctrl+V.
 *
 * Une capture d'ecran arrive sans nom, ou nommee « image.png » : on lui
 * donne un nom date pour la retrouver dans les vignettes et les fiches.
 */
export function clipboardFiles(e: ClipboardEvent): File[] {
  const out: File[] = [];
  const items = e.clipboardData?.items ? Array.from(e.clipboardData.items) : [];
  for (const it of items) {
    if (it.kind !== "file") continue;
    const f = it.getAsFile();
    if (!f) continue;
    if (!f.type.startsWith("image/") && !f.type.startsWith("video/")) continue;
    const generic = !f.name || /^image\.(png|jpe?g|webp|gif)$/i.test(f.name) || /^blob$/i.test(f.name);
    const ext = f.type === "image/jpeg" ? "jpg" : f.type.split("/")[1]?.replace("quicktime", "mov") || "png";
    const stamp = new Date().toISOString().slice(0, 19).replace(/[T:]/g, "-");
    out.push(generic ? new File([f], `capture-${stamp}.${ext}`, { type: f.type, lastModified: Date.now() }) : f);
  }
  return out;
}

/** Fichiers deposes par glisser-deposer, images et videos seulement. */
export function droppedFiles(e: { dataTransfer: DataTransfer | null }): File[] {
  return Array.from(e.dataTransfer?.files ?? []).filter((f) => f.type.startsWith("image/") || f.type.startsWith("video/") || /\.(png|jpe?g|webp|gif|heic|heif|avif|mp4|mov|webm|m4v)$/i.test(f.name));
}

export function formatBytes(n: number) {
  if (n > 1e9) return `${(n / 1e9).toFixed(1)} Go`;
  if (n > 1e6) return `${Math.round(n / 1e6)} Mo`;
  return `${Math.round(n / 1e3)} Ko`;
}
