import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";
import { sessionSecret } from "../sales/access";

/**
 * Chiffrement des jetons Meta au repos.
 *
 * AES-256-GCM avec une cle derivee du secret de session (ou de
 * `META_TOKEN_SECRET` si defini). Le jeton ne quitte jamais le serveur : la
 * base n'en contient que la version chiffree, l'API n'en renvoie que les
 * quatre derniers caracteres, et les journaux n'en voient jamais la couleur.
 */

function key(): Buffer {
  const raw = process.env.META_TOKEN_SECRET?.trim() || sessionSecret();
  return createHash("sha256").update(raw).digest();
}

export function encryptToken(plain: string): string {
  if (!plain) return "";
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString("base64url")}.${tag.toString("base64url")}.${enc.toString("base64url")}`;
}

export function decryptToken(stored: string): string {
  if (!stored) return "";
  const [v, iv, tag, enc] = stored.split(".");
  if (v !== "v1" || !iv || !tag || !enc) throw new Error("Jeton Meta illisible : reconnecte le compte.");
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  try {
    return Buffer.concat([decipher.update(Buffer.from(enc, "base64url")), decipher.final()]).toString("utf8");
  } catch {
    throw new Error("Jeton Meta illisible (secret de chiffrement change ?) : reconnecte le compte.");
  }
}

/** « …a1b2 » : de quoi reconnaitre un jeton, jamais de quoi s'en servir. */
export function tokenHint(plain: string): string {
  return plain.length >= 4 ? `…${plain.slice(-4)}` : "";
}

/** Pour les messages d'erreur et les logs : on ne montre jamais un jeton entier. */
export function redactToken(text: string, token: string): string {
  if (!token || token.length < 8) return text;
  return text.split(token).join(`[token ${tokenHint(token)}]`);
}
