/**
 * Taches de fond en memoire.
 *
 * Derriere Cloudflare, une requete qui attend plus de 100 s est coupee. Les
 * traitements longs (transcription, traduction, analyse d'image) demarrent
 * donc ici : la route repond tout de suite avec un identifiant, et la page
 * vient lire l'etat toutes les quelques secondes.
 *
 * L'app tourne en un seul processus et une tache ne vit que quelques minutes :
 * la memoire suffit, la base n'a pas a en garder trace. Un redemarrage du
 * serveur efface tout, et la page relance simplement.
 */
import { newId } from "./db";

export interface JobState<T> {
  status: "running" | "done" | "error";
  /** Etape en cours, en francais, affichee telle quelle. */
  step: string;
  startedAt: number;
  result?: T;
  error?: string;
}

const jobs = new Map<string, JobState<unknown>>();
const TTL = 20 * 60_000;

function sweep() {
  const now = Date.now();
  for (const [id, job] of jobs) if (now - job.startedAt > TTL) jobs.delete(id);
}

export function startJob<T>(run: (setStep: (step: string) => void) => Promise<T>): string {
  sweep();
  const id = newId();
  const job: JobState<T> = { status: "running", step: "Démarrage…", startedAt: Date.now() };
  jobs.set(id, job);
  void run((step) => { job.step = step; })
    .then((result) => { job.result = result; job.status = "done"; })
    .catch((e: Error) => { job.error = e.message || "Échec."; job.status = "error"; });
  return id;
}

export function getJob<T>(id: string): JobState<T> | undefined {
  return jobs.get(id) as JobState<T> | undefined;
}

/** Secondes ecoulees, pour le compteur affiche cote page. */
export function elapsed(job: JobState<unknown>): number {
  return Math.round((Date.now() - job.startedAt) / 1000);
}
