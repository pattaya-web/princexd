import { NextResponse } from "next/server";
import { Forbidden } from "./access";

/**
 * Enveloppe commune aux routes du module.
 *
 * Traduit une exception metier en reponse HTTP correcte plutot qu'en 500
 * opaque, et evite de recopier le meme try/catch dans une douzaine de
 * fichiers.
 */
export async function handle<T>(fn: () => Promise<T> | T) {
  try {
    return NextResponse.json(await fn());
  } catch (e) {
    if (e instanceof Forbidden) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    const message = e instanceof Error ? e.message : "Erreur inattendue.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

/** Champ obligatoire, avec un message utilisable tel quel dans un toast. */
export function required(value: unknown, name: string): string {
  const s = typeof value === "string" ? value.trim() : "";
  if (!s) throw new Error(`${name} est obligatoire.`);
  return s;
}

export const num = (v: unknown, fallback = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};
