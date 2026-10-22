"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/client";
import { CopyButton } from "@/components/ui";
import { fmtMoney } from "@/lib/format";
import type { ChatContext, ConfirmResult } from "@/lib/eleves/new-student";
import type { TalkResult } from "@/lib/eleves/talk";
import type { AssistantSource } from "@/lib/assistant";

/**
 * Chat « Nouvel élève » : une petite fenêtre flottante en bas à droite (ou
 * la page /eleves/nouveau en grand). Tu parles à l'assistant (Claude), il te
 * pose ce qui manque, récapitule, et quand tu dis « ok » il enregistre le
 * lead, la vente, la fiche élève, l'accès plateforme et te donne le message
 * de bienvenue à envoyer sur WhatsApp.
 */

interface Msg {
  id: number;
  role: "user" | "assistant";
  text: string;
  result?: ConfirmResult;
  swipes?: { id: string; title: string; funnel: string; url: string }[];
  error?: boolean;
}

const GREETING = "Salut Mady 👋 Un élève à ajouter, un chiffre à vérifier, un reel à mettre dans le swipe file ? Dis-moi.";
const STORE = "princexd.nouvel-eleve.chat";
const EXAMPLES = ["Alexandre Martin, closé 2500 en instant aujourd'hui, vient d'Instagram", "Combien j'ai encaissé ce mois ?", "Combien de reels à tourner cette semaine ?", "Ajoute ce reel en TOFU : https://www.instagram.com/reel/…"];

/** Le modèle met parfois du gras markdown : on l'enlève, la bulle affiche du texte brut. */
const plain = (t: string) => t.replace(/**(.+?)**/g, "$1").replace(/^#+s*/gm, "");

function loadMsgs(): Msg[] {
  try {
    const raw = localStorage.getItem(STORE);
    if (raw) {
      const list = JSON.parse(raw) as Msg[];
      if (Array.isArray(list) && list.length) return list;
    }
  } catch {
    // Stockage indisponible : on repart de zéro.
  }
  return [{ id: 1, role: "assistant", text: GREETING }];
}

function useChat() {
  const [msgs, setMsgs] = useState<Msg[]>([{ id: 1, role: "assistant", text: GREETING }]);
  const [busy, setBusy] = useState(false);
  const [source, setSource] = useState<AssistantSource | "">("");
  const [ctx, setCtx] = useState<(ChatContext & { assistant: AssistantSource }) | null>(null);
  const loaded = useRef(false);

  useEffect(() => {
    setMsgs(loadMsgs());
    loaded.current = true;
    api<ChatContext & { assistant: AssistantSource }>("/api/eleves/chat")
      .then((c) => {
        setCtx(c);
        setSource(c.assistant);
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!loaded.current) return;
    try {
      localStorage.setItem(STORE, JSON.stringify(msgs.slice(-60)));
    } catch {
      // ignoré
    }
  }, [msgs]);

  const send = useCallback(
    async (text: string) => {
      const t = text.trim();
      if (!t || busy) return;
      const mine: Msg = { id: Date.now(), role: "user", text: t };
      const history = [...msgs, mine];
      setMsgs(history);
      setBusy(true);
      try {
        const firstUser = history.findIndex((m) => m.role === "user");
        const turns = history.slice(firstUser).filter((m) => !m.error).map((m) => ({ role: m.role, content: m.text }));
        const r = await api<TalkResult>("/api/eleves/chat", { method: "POST", body: JSON.stringify({ action: "talk", messages: turns }), timeoutMs: 90_000 });
        setSource(r.source);
        setMsgs((list) => [...list, { id: Date.now() + 1, role: "assistant", text: r.reply, result: r.result, swipes: r.swipes }]);
      } catch (e) {
        setMsgs((list) => [...list, { id: Date.now() + 1, role: "assistant", text: `Je n'ai pas pu répondre : ${(e as Error).message}`, error: true }]);
      } finally {
        setBusy(false);
      }
    },
    [busy, msgs],
  );

  const reset = useCallback(() => {
    setMsgs([{ id: Date.now(), role: "assistant", text: GREETING }]);
  }, []);

  return { msgs, busy, send, reset, source, ctx };
}

/* --------------------------------- Vues --------------------------------- */

export function NewStudentChat({ variant }: { variant: "widget" | "page" }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    try {
      setOpen(sessionStorage.getItem(`${STORE}.open`) === "1");
    } catch {
      // ignoré
    }
  }, []);
  const toggle = (v: boolean) => {
    setOpen(v);
    try {
      sessionStorage.setItem(`${STORE}.open`, v ? "1" : "0");
    } catch {
      // ignoré
    }
  };

  if (variant === "page") {
    return (
      <div className="card flex flex-col overflow-hidden" style={{ height: "calc(100dvh - 190px)", minHeight: 420 }}>
        <ChatBody />
      </div>
    );
  }

  return (
    <>
      {!open && (
        <button
          type="button"
          onClick={() => toggle(true)}
          aria-label="Ouvrir l'assistant"
          className="fixed right-4 bottom-4 z-40 flex items-center gap-2 rounded-full px-4 h-12 font-semibold text-[14px] shadow-lg"
          style={{ background: "var(--accent)", color: "#fff" }}
        >
          <span aria-hidden>💬</span>
          <span>Assistant</span>
        </button>
      )}
      {open && (
        <div
          className="fixed z-40 flex flex-col overflow-hidden rounded-2xl shadow-2xl border right-2 left-2 bottom-2 sm:left-auto sm:right-4 sm:bottom-4 sm:w-[400px]"
          style={{ background: "var(--surface, var(--bg))", borderColor: "var(--border)", height: "min(640px, 78dvh)" }}
        >
          <ChatBody onClose={() => toggle(false)} />
        </div>
      )}
    </>
  );
}

function ChatBody({ onClose }: { onClose?: () => void }) {
  const { msgs, busy, send, reset, source, ctx } = useChat();
  const [input, setInput] = useState("");
  const endRef = useRef<HTMLDivElement>(null);
  const currency = ctx?.currency ?? "EUR";

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [msgs, busy]);

  const submit = () => {
    const t = input;
    setInput("");
    void send(t);
  };

  const onlyGreeting = msgs.length === 1;

  return (
    <>
      <div className="flex items-center gap-2 px-3.5 py-2.5 border-b shrink-0" style={{ borderColor: "var(--border)" }}>
        <span aria-hidden>💬</span>
        <div className="min-w-0 flex-1">
          <div className="text-[13.5px] font-semibold leading-tight">Assistant</div>
          <div className="dim text-[11px] leading-tight">
            {source === "claude" ? "Claude" : source === "kie" ? "IA KIE (ajoute une clé Anthropic dans Réglages pour Claude)" : source === "none" ? "Aucune clé IA" : "Assistant"}
          </div>
        </div>
        <button type="button" className="btn btn-sm btn-ghost !px-2" onClick={reset} title="Nouvelle conversation" disabled={busy}>
          ↺
        </button>
        {onClose && (
          <button type="button" className="btn btn-sm btn-ghost !px-2" onClick={onClose} aria-label="Fermer">
            ✕
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-3 flex flex-col gap-2.5">
        {msgs.map((m) =>
          m.role === "user" ? (
            <div key={m.id} className="self-end max-w-[85%] rounded-2xl rounded-br-md px-3 py-2 text-[13.5px] leading-snug whitespace-pre-wrap break-words" style={{ background: "var(--accent)", color: "#fff" }}>
              {m.text}
            </div>
          ) : (
            <div key={m.id} className="self-start w-full max-w-[94%] flex flex-col gap-2">
              <div className="card-flat rounded-2xl rounded-bl-md px-3 py-2 text-[13.5px] leading-snug whitespace-pre-wrap break-words" style={m.error ? { color: "var(--warning)" } : undefined}>
                {plain(m.text)}
              </div>
              {m.result && <ResultCard r={m.result} currency={currency} />}
              {m.swipes && m.swipes.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {m.swipes.map((sw) => (
                    <Link key={sw.id} href="/swipe" className="btn btn-sm">
                      Voir dans Swipe file{sw.funnel ? ` · ${sw.funnel}` : ""}
                    </Link>
                  ))}
                </div>
              )}
            </div>
          ),
        )}
        {onlyGreeting && (
          <div className="flex flex-col gap-1.5 mt-1">
            {EXAMPLES.map((e) => (
              <button key={e} type="button" className="text-left rounded-xl border px-3 py-2 text-[12.5px] leading-snug whitespace-normal break-words" style={{ borderColor: "var(--border)" }} onClick={() => setInput(e)}>
                {e}
              </button>
            ))}
            {ctx && !ctx.formConfigured && (
              <div className="text-[12px] leading-snug mt-1" style={{ color: "var(--warning)" }}>
                Lien du formulaire d&apos;onboarding pas encore renseigné :{" "}
                <Link href="/eleves/onboarding" className="underline">
                  ajoute-le
                </Link>
                .
              </div>
            )}
          </div>
        )}
        {busy && <div className="self-start card-flat rounded-2xl rounded-bl-md px-3 py-2 text-[13px] dim">…</div>}
        <div ref={endRef} />
      </div>

      <form
        className="shrink-0 flex items-end gap-2 p-2 border-t"
        style={{ borderColor: "var(--border)", paddingBottom: "max(8px, env(safe-area-inset-bottom))" }}
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <textarea
          className="input flex-1 resize-none !py-2 !text-[14px]"
          rows={1}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          placeholder="Écris ici…"
          disabled={busy}
        />
        <button type="submit" className="btn btn-primary btn-sm h-[38px]" disabled={!input.trim() || busy}>
          Envoyer
        </button>
      </form>
    </>
  );
}

function ResultCard({ r, currency }: { r: ConfirmResult; currency: string }) {
  return (
    <div className="card p-3 flex flex-col gap-2.5 text-[12.5px]">
      <div className="flex flex-wrap gap-x-3 gap-y-1">
        <span className="font-semibold">{r.student.name}</span>
        <span>{fmtMoney(r.sale.contractValue, r.sale.currency || currency)}</span>
        <span className="dim">{fmtMoney(r.sale.cashCollected, r.sale.currency || currency)} encaissés</span>
      </div>
      {r.credentials && (
        <div className="card-flat p-2 mono text-[12px]" style={{ borderColor: "var(--accent)" }}>
          <div className="dim font-sans text-[11px]">Accès plateforme, affiché une seule fois</div>
          Identifiant : {r.credentials.username}
          <br />
          Mot de passe : {r.credentials.password}
        </div>
      )}
      <details>
        <summary className="cursor-pointer dim">Voir le message d&apos;onboarding</summary>
        <pre className="card-flat p-2.5 mt-1.5 text-[12px] leading-relaxed whitespace-pre-wrap font-sans max-h-[40vh] overflow-auto">{r.message}</pre>
      </details>
      <div className="flex flex-wrap gap-1.5">
        {r.whatsapp ? (
          <a className="btn btn-primary btn-sm" href={r.whatsapp} target="_blank" rel="noreferrer">
            Envoyer sur WhatsApp
          </a>
        ) : (
          <span className="dim self-center">Pas de numéro : copie le message.</span>
        )}
        <CopyButton text={r.message} label="Copier le message" />
        <Link href="/sales/dashboard" className="btn btn-sm btn-ghost">
          Sales Dashboard
        </Link>
      </div>
    </div>
  );
}
