/**
 * Taches de fond en memoire.
 *
 * Derriere le proxy (Cloudflare, Traefik), une requete qui attend trop
 * longtemps est coupee : la page recoit une « Erreur 502 » nue pendant que
 * le serveur travaille encore. Les traitements longs (transcription,
 * traduction, analyse, script) demarrent donc ici : la route repond tout de
 * suite avec un identifiant, et la page vient lire l'etat toutes les deux
 * secondes.
 *
 * Deux usages :
 *  - `startJob` / `getJob` : une tache explicite avec ses etapes (transcription audio) ;
 *  - `respondAsJob` : n'importe quelle route POST existante, sans la reecrire.
 *    Si le navigateur envoie l'en-tete `x-bg-job: 1` (option `job: true` de
 *    `api()` cote client), la reponse de la route est produite en fond et
 *    rejouee telle quelle au `GET ?job=` suivant : memes codes, memes corps,
 *    donc meme gestion d'erreur cote page. Sans l'en-tete, la route repond
 *    comme avant.
 *
 * L'app tourne en un seul processus et une tache ne vit que quelques minutes :
 * la memoire suffit, la base n'a pas a en garder trace. Un redemarrage du
 * serveur efface tout, et la page relance simplement.
 */
import { NextRequest } from "next/server";
import { newId } from "./db";

export interface JobState<T> {
  status: "running" | "done" | "error";
  /** Etape en cours, en francais, affichee telle quelle. */
  step: string;
  startedAt: number;
  result?: T;
  error?: string;
}

/** Reponse HTTP mise de cote par `respondAsJob`, rejouee au GET. */
interface StoredResponse {
  __http: true;
  status: number;
  contentType: string;
  body: string;
}

const jobs = new Map<string, JobState<unknown>>();
const TTL = 20 * 60_000;
const JOB_MAX_MS = 15 * 60_000;
export const JOB_HEADER = "x-bg-job";

function sweep() {
  const now = Date.now();
  for (const [id, job] of jobs) if (now - job.startedAt > TTL) jobs.delete(id);
}

export function startJob<T>(run: (setStep: (step: string) => void) => Promise<T>): string {
  sweep();
  const id = newId();
  const job: JobState<T> = { status: "running", step: "Démarrage…", startedAt: Date.now() };
  jobs.set(id, job);
  // Garde-fou : une tache qui ne rend rien en 15 minutes est declaree en echec, la page arrete d attendre.
  const cap = new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Tâche abandonnée après 15 minutes sans réponse. Relance.")), JOB_MAX_MS));
  void Promise.race([run((step) => { job.step = step; }), cap])
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

/** Vrai si le navigateur demande une execution en fond. */
export const wantsJob = (req: NextRequest) => req.headers.get(JOB_HEADER) === "1";

/**
 * Execute `work` en fond si le navigateur l'a demande, sinon tout de suite.
 * `work` ne doit pas relire le corps de `req` apres coup : lire le corps
 * avant, ou passer par `respondAsJobBuffered`.
 */
export async function respondAsJob(req: NextRequest, work: () => Promise<Response>): Promise<Response> {
  if (!wantsJob(req)) return work();
  const jobId = startJob<StoredResponse>(async () => {
    const res = await work();
    return { __http: true, status: res.status, contentType: res.headers.get("content-type") ?? "application/json", body: await res.text() };
  });
  return Response.json({ jobId }, { status: 202 });
}

/**
 * Variante pour une route qui lit elle-meme `req.json()` ou `req.formData()` :
 * le corps est mis en memoire avant de repondre, puis la route recoit une
 * requete equivalente qu'elle peut lire tranquillement en fond.
 */
export async function respondAsJobBuffered<C>(req: NextRequest, ctx: C, handler: (req: NextRequest, ctx: C) => Promise<Response>): Promise<Response> {
  if (!wantsJob(req)) return handler(req, ctx);
  const body = await req.arrayBuffer();
  const copy = new NextRequest(req.url, { method: req.method, headers: req.headers, body });
  return respondAsJob(req, () => handler(copy, ctx));
}

/**
 * Reponse au `GET ?job=` : null si la requete ne porte pas de `job`, sinon
 * 202 tant que ca tourne, la reponse d'origine rejouee quand c'est fini
 * (`respondAsJob`), ou `{ status: "done", result }` pour un `startJob`.
 */
export function jobStatusResponse(req: NextRequest): Response | null {
  const id = req.nextUrl.searchParams.get("job");
  if (!id) return null;
  const job = getJob<unknown>(id);
  if (!job) return Response.json({ error: "Tâche introuvable (le serveur a peut-être redémarré) : relance." }, { status: 404 });
  if (job.status === "running") return Response.json({ status: "running", step: job.step, elapsed: elapsed(job) }, { status: 202 });
  if (job.status === "error") return Response.json({ status: "error", error: job.error }, { status: 502 });
  const r = job.result as StoredResponse | undefined;
  if (r && typeof r === "object" && r.__http) {
    jobs.delete(id);
    return new Response(r.body, { status: r.status, headers: { "content-type": r.contentType } });
  }
  return Response.json({ status: "done", step: job.step, elapsed: elapsed(job), result: job.result });
}
