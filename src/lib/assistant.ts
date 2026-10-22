import Anthropic from "@anthropic-ai/sdk";
import { getApiKey, getSettings } from "./db";
import { askText } from "./kie";

/**
 * Assistant conversationnel du tool (chat « Nouvel élève »).
 *
 * Claude (API Anthropic, clé ANTHROPIC_API_KEY ou Réglages) quand une clé est
 * là ; sinon le modèle texte KIE déjà utilisé partout, en repli, pour que le
 * chat réponde quand même. Le système reste court et stable (mis en cache
 * côté Anthropic), la partie qui change à chaque tour est passée à part.
 */

export const CLAUDE_MODEL = "claude-opus-5-5";

export type AssistantSource = "claude" | "kie" | "none";

export function getAnthropicKey(): string {
  return process.env.ANTHROPIC_API_KEY?.trim() || (getSettings().anthropicApiKey ?? "").trim();
}

export function assistantSource(): AssistantSource {
  if (getAnthropicKey() || process.env.ANTHROPIC_USE_PROFILE) return "claude";
  if (getApiKey()) return "kie";
  return "none";
}

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

function client(): Anthropic | null {
  const key = getAnthropicKey();
  if (key) return new Anthropic({ apiKey: key, timeout: 60_000, maxRetries: 1 });
  // Poste de dev : profil « ant auth login », sans clé explicite.
  if (process.env.ANTHROPIC_USE_PROFILE) return new Anthropic({ timeout: 60_000, maxRetries: 1 });
  return null;
}

/**
 * Une réponse de l'assistant.
 * `stable` : consignes qui ne bougent pas d'un tour à l'autre ; `dynamic` :
 * date, candidats du CRM, etc. Jette avec un message lisible en cas d'échec.
 */
export async function assistantReply(stable: string, dynamic: string, turns: ChatTurn[], maxTokens = 1500): Promise<{ text: string; source: AssistantSource }> {
  const messages = turns.filter((t) => t.content.trim());
  if (!messages.length || messages[0].role !== "user") throw new Error("La conversation doit commencer par ton message.");

  const anthropic = client();
  if (anthropic) {
    const res = await anthropic.beta.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: maxTokens,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "low" },
      system: [
        { type: "text", text: stable, cache_control: { type: "ephemeral" } },
        { type: "text", text: dynamic },
      ],
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
    });
    if (res.stop_reason === "refusal") return { text: "Je ne peux pas répondre à ça. Dis-moi plutôt qui vient de rejoindre l'accompagnement.", source: "claude" };
    const text = res.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();
    return { text, source: "claude" };
  }

  if (!getApiKey()) throw new Error("Aucune clé IA : ajoute une clé Anthropic (Réglages → Assistant Claude) ou une clé KIE.");
  // Repli KIE : une seule entrée, on lui donne la conversation en clair.
  const transcript = messages.map((m) => `${m.role === "user" ? "Mady" : "Assistant"} : ${m.content}`).join("\n\n");
  // KIE rend parfois « 2 times retry fail » sans raison : une seconde chance avant de montrer l'erreur.
  let text = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      text = await askText(`${transcript}\n\nAssistant :`, `${stable}\n\n${dynamic}`, maxTokens);
      break;
    } catch (e) {
      if (attempt === 1) throw e;
    }
  }
  return { text: text.trim(), source: "kie" };
}
