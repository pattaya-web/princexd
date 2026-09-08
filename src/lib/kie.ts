import { getApiKey, getSettings } from "./db";

export const KIE_BASE = "https://api.kie.ai";

export class KieError extends Error {
  code: number;
  constructor(message: string, code = 500) {
    super(message);
    this.code = code;
  }
}

function headers() {
  const key = getApiKey();
  if (!key) {
    throw new KieError(
      "Aucune cle API KIE configuree (Reglages, ou KIE_API_KEY dans .env.local).",
      401,
    );
  }
  return { Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
}

async function kieFetch(pathname: string, init: RequestInit = {}) {
  const res = await fetch(`${KIE_BASE}${pathname}`, {
    ...init,
    headers: { ...headers(), ...(init.headers ?? {}) },
    cache: "no-store",
  });
  const text = await res.text();
  let json: { code?: number; msg?: string; data?: unknown };
  try {
    json = JSON.parse(text) as typeof json;
  } catch {
    throw new KieError(`Reponse KIE illisible (HTTP ${res.status}) : ${text.slice(0, 300)}`, res.status);
  }
  if (!res.ok || (json.code && json.code !== 200)) {
    throw new KieError(json.msg || `Erreur KIE (HTTP ${res.status})`, json.code || res.status);
  }
  return json.data;
}

/** GET /api/v1/chat/credit -> credits restants */
export async function getCredits(): Promise<number> {
  const data = await kieFetch("/api/v1/chat/credit", { method: "GET" });
  return typeof data === "number" ? data : Number((data as { credits?: number })?.credits ?? 0);
}

/** POST /api/v1/jobs/createTask -> taskId */
export async function createTask(
  model: string,
  input: Record<string, unknown>,
  callBackUrl?: string,
) {
  const body: Record<string, unknown> = { model, input };
  if (callBackUrl) body.callBackUrl = callBackUrl;
  const data = (await kieFetch("/api/v1/jobs/createTask", {
    method: "POST",
    body: JSON.stringify(body),
  })) as { taskId?: string; task_id?: string };
  const taskId = data?.taskId || data?.task_id;
  if (!taskId) throw new KieError("KIE n'a pas renvoye de taskId.");
  return taskId;
}

export interface TaskRecord {
  taskId: string;
  model: string;
  state: "waiting" | "queuing" | "generating" | "success" | "fail";
  resultUrls: string[];
  creditsConsumed: number;
  failMsg: string;
  progress: number;
}

/** GET /api/v1/jobs/recordInfo?taskId=... */
export async function getTask(taskId: string): Promise<TaskRecord> {
  const data = (await kieFetch(
    `/api/v1/jobs/recordInfo?taskId=${encodeURIComponent(taskId)}`,
    { method: "GET" },
  )) as Record<string, unknown>;

  let resultUrls: string[] = [];
  const raw = data?.resultJson;
  if (typeof raw === "string" && raw.trim()) {
    try {
      const parsed = JSON.parse(raw) as { resultUrls?: string[] };
      resultUrls = parsed.resultUrls ?? [];
    } catch {
      resultUrls = [];
    }
  }

  return {
    taskId: String(data?.taskId ?? taskId),
    model: String(data?.model ?? ""),
    state: (data?.state as TaskRecord["state"]) ?? "waiting",
    resultUrls,
    creditsConsumed: Number(data?.creditsConsumed ?? 0),
    failMsg: String(data?.failMsg ?? ""),
    progress: Number(data?.progress ?? 0),
  };
}

/**
 * Couche texte : traduction des scripts et analyse de contenu.
 * KIE expose un endpoint compatible OpenAI sur /v1/chat/completions.
 * Le message systeme y passe comme premier message de la conversation.
 */
export async function askText(prompt: string, system: string, maxTokens = 8000): Promise<string> {
  const key = getApiKey();
  if (!key) throw new KieError("Aucune cle API KIE configuree.", 401);
  const model = getSettings().kieTextModel;

  const res = await fetch(`${KIE_BASE}/v1/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      messages: [
        { role: "system", content: system },
        { role: "user", content: prompt },
      ],
    }),
    cache: "no-store",
  });

  const text = await res.text();
  if (!res.ok) {
    throw new KieError(`Erreur modele texte KIE (HTTP ${res.status}) : ${text.slice(0, 400)}`, res.status);
  }

  let json: {
    code?: number;
    msg?: string;
    choices?: { message?: { content?: string } }[];
    content?: { type: string; text?: string }[];
  };
  try {
    json = JSON.parse(text) as typeof json;
  } catch {
    throw new KieError(`Reponse texte illisible : ${text.slice(0, 300)}`);
  }

  // KIE renvoie HTTP 200 avec un code d'erreur applicatif (ex. 422 modele inconnu).
  if (json.code && json.code !== 200 && !json.choices) {
    throw new KieError(
      json.msg === "The model is not supported"
        ? `Le modele texte « ${model} » n'est pas disponible sur ton compte KIE. Change-le dans Reglages.`
        : json.msg || "Erreur du modele texte.",
      json.code,
    );
  }

  const openai = json.choices?.[0]?.message?.content;
  if (openai) return openai;
  // Filet de securite si l'endpoint bascule un jour au format Anthropic.
  const anthropic = json.content?.filter((c) => c.type === "text").map((c) => c.text ?? "").join("");
  if (anthropic) return anthropic;
  throw new KieError("Le modele texte a renvoye une reponse vide.");
}

/** Extrait le premier objet JSON d'une reponse LLM (tolere les blocs ```json). */
export function parseJsonLoose<T>(raw: string): T {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = (fenced ? fenced[1] : raw).trim();
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1) {
    throw new KieError("Le modele n'a pas renvoye de JSON exploitable.");
  }
  return JSON.parse(candidate.slice(start, end + 1)) as T;
}
