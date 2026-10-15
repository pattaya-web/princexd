"use client";

import { TestimonialsLibrary } from "@/components/TestimonialsLibrary";

/**
 * Temoignages, cote monteur (2026-10-15) : la meme bibliotheque en lecture
 * seule, pour piocher directement dedans sans attendre un envoi. Le
 * middleware ne lui ouvre que la lecture de la collection.
 */
export default function MonteurTestimonialsPage() {
  return <TestimonialsLibrary readOnly />;
}
