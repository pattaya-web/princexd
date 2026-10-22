"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/client";
import { CopyButton, Field, PageHeader, Toggle, useToast } from "@/components/ui";
import { fmtMoney } from "@/lib/format";
import { PAYMENT_OPTIONS, SOURCE_OPTIONS, type NewStudentDraft } from "@/lib/eleves/draft";
import type { ChatContext, ConfirmResult, LeadMatch, ParseResult } from "@/lib/eleves/new-student";

/**
 * Chat « Nouvel élève », pensé pour le téléphone.
 *
 * Tu écris une phrase (« Alexandre, closé 2500 en instant aujourd'hui, vient
 * d'Instagram »), le bot te montre ce qu'il a compris dans une fiche
 * modifiable, tu valides : lead, vente (Sales Dashboard), fiche élève, accès
 * à la plateforme et message d'onboarding sont créés d'un coup.
 */

type Msg =
  | { id: number; role: "user"; text: string }
  | { id: number; role: "bot"; text: string; warnings?: string[]; draft?: NewStudentDraft; matches?: LeadMatch[]; message?: string; locked?: boolean }
  | { id: number; role: "bot"; text: string; result: ConfirmResult };

/** Omit distribué sur l'union, sinon TypeScript ne garde que les champs communs. */
type NoId<T> = T extends unknown ? Omit<T, "id"> : never;

const EXAMPLES = [
  "Alexandre Martin, closé 2500 en instant aujourd'hui, vient d'Instagram",
  "Sarah, 3000 en 3 fois, payé 1000 hier, elle vient de YouTube, @sarah.shop",
  "Karim Benali closé 2000 le 20 octobre, contrat envoyé pas encore payé, parrainage",
];

const fmtDateTime = (iso: string) =>
  iso ? new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Paris" }).format(new Date(iso)) : "";

const STATUS_LABEL: Record<string, string> = {
  booked: "réservé",
  confirmed: "confirmé",
  rescheduled: "reprogrammé",
  completed: "passé",
  "no-show": "no-show",
  "follow-up": "à relancer",
  "closed-won": "closé",
  "closed-lost": "perdu",
};

export default function NouvelElevePage() {
  const toast = useToast();
  const [ctx, setCtx] = useState<ChatContext | null>(null);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState<"parse" | "confirm" | "">("");
  const [lastText, setLastText] = useState("");
  const endRef = useRef<HTMLDivElement>(null);
  const nextId = useRef(1);

  useEffect(() => {
    api<ChatContext>("/api/eleves/chat")
      .then(setCtx)
      .catch((e) => toast((e as Error).message, "err"));
    // Le toast est stable : on ne charge qu'une fois.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [msgs, busy]);

  const push = (m: NoId<Msg>) => setMsgs((list) => [...list, { ...m, id: nextId.current++ } as Msg]);

  const send = async (text: string) => {
    const t = text.trim();
    if (!t || busy) return;
    setInput("");
    setLastText(t);
    push({ role: "user", text: t });
    // Une seule fiche ouverte à la fois : les précédentes se figent.
    setMsgs((list) => list.map((m) => (m.role === "bot" && "draft" in m && m.draft ? { ...m, locked: true } : m)));
    setBusy("parse");
    try {
      const r = await api<ParseResult>("/api/eleves/chat", { method: "POST", body: JSON.stringify({ action: "parse", message: t }), timeoutMs: 60_000 });
      push({ role: "bot", text: r.reply, warnings: r.warnings, draft: r.draft, matches: r.matches });
    } catch (e) {
      push({ role: "bot", text: `Je n'ai pas pu lire ce message : ${(e as Error).message}` });
    } finally {
      setBusy("");
    }
  };

  const updateDraft = (id: number, patch: Partial<NewStudentDraft>) =>
    setMsgs((list) => list.map((m) => (m.id === id && m.role === "bot" && "draft" in m && m.draft ? { ...m, draft: { ...m.draft, ...patch } } : m)));

  const confirm = async (id: number, draft: NewStudentDraft) => {
    if (busy) return;
    setBusy("confirm");
    try {
      const r = await api<ConfirmResult>("/api/eleves/chat", { method: "POST", body: JSON.stringify({ action: "confirm", draft, message: lastText }), timeoutMs: 60_000 });
      setMsgs((list) => list.map((m) => (m.id === id && m.role === "bot" ? { ...m, locked: true } : m)));
      const bits = [
        `${r.studentCreated ? "Fiche élève créée" : "Fiche élève déjà existante, vente mise à jour"} pour ${r.student.name}.`,
        `Vente de ${fmtMoney(r.sale.contractValue, r.sale.currency)} enregistrée (${fmtMoney(r.sale.cashCollected, r.sale.currency)} encaissés)${r.lead.setterName ? `, setter ${r.lead.setterName}` : ""}, source ${r.lead.sourceLabel}.`,
        r.credentials ? "Accès à la plateforme créé." : "",
        ...r.notes,
      ].filter(Boolean);
      push({ role: "bot", text: bits.join(" "), result: r });
      toast("Élève ajouté, Sales Dashboard à jour.");
    } catch (e) {
      toast((e as Error).message, "err");
      push({ role: "bot", text: `Je n'ai rien écrit : ${(e as Error).message}` });
    } finally {
      setBusy("");
    }
  };

  const currency = ctx?.currency ?? "EUR";

  return (
    <div className="flex flex-col" style={{ minHeight: "calc(100dvh - 120px)" }}>
      <PageHeader
        title="Nouvel élève"
        subtitle="Dis-moi qui vient de rejoindre, le montant, comment il paie et d'où il vient. Je remplis le CRM, la vente, la fiche élève et son accès."
        actions={
          <>
            <Link href="/eleves/onboarding" className="btn btn-sm btn-ghost">
              Message d&apos;onboarding
            </Link>
            <Link href="/sales/dashboard" className="btn btn-sm btn-ghost">
              Sales Dashboard
            </Link>
          </>
        }
      />

      <div className="flex-1 flex flex-col gap-3 max-w-[760px] w-full mx-auto pb-4">
        {!msgs.length && (
          <div className="card p-4">
            <div className="text-[13px] font-semibold mb-1">Exemples</div>
            <div className="dim text-[12.5px] mb-3">Appuie pour pré-remplir. Je comprends les montants (2500, 2,5k), « en une fois », « en 3 fois », « payé 1000 », les dates (« hier », « le 22 octobre ») et la source (Instagram, YouTube, TikTok, Ads, parrainage…).</div>
            <div className="flex flex-col gap-2">
              {EXAMPLES.map((e) => (
                <button key={e} className="btn btn-sm text-left justify-start whitespace-normal" onClick={() => setInput(e)}>
                  {e}
                </button>
              ))}
            </div>
            {ctx && !ctx.hasAi && <div className="dim text-[12px] mt-3">Pas de clé IA (KIE) : lecture par règles seulement, ça marche pour les phrases simples.</div>}
            {ctx && !ctx.formConfigured && (
              <div className="text-[12px] mt-3" style={{ color: "var(--warning)" }}>
                Le lien du formulaire d&apos;onboarding n&apos;est pas renseigné :{" "}
                <Link href="/eleves/onboarding" className="underline">
                  ajoute-le
                </Link>{" "}
                avant d&apos;envoyer le premier message.
              </div>
            )}
          </div>
        )}

        {msgs.map((m) =>
          m.role === "user" ? (
            <div key={m.id} className="self-end max-w-[88%] rounded-2xl rounded-br-md px-3.5 py-2 text-[13.5px] leading-snug" style={{ background: "var(--accent)", color: "#fff" }}>
              {m.text}
            </div>
          ) : (
            <div key={m.id} className="self-start w-full max-w-[96%] flex flex-col gap-2">
              <div className="card-flat rounded-2xl rounded-bl-md px-3.5 py-2.5 text-[13.5px] leading-snug">
                {m.text}
                {"warnings" in m && m.warnings && m.warnings.length > 0 && (
                  <ul className="mt-2 flex flex-col gap-1 text-[12.5px]" style={{ color: "var(--warning)" }}>
                    {m.warnings.map((w) => (
                      <li key={w}>⚠ {w}</li>
                    ))}
                  </ul>
                )}
              </div>
              {"draft" in m && m.draft && ctx && (
                <DraftCard draft={m.draft} matches={m.matches ?? []} ctx={ctx} locked={Boolean(m.locked)} busy={busy === "confirm"} onChange={(p) => updateDraft(m.id, p)} onConfirm={() => void confirm(m.id, m.draft!)} />
              )}
              {"result" in m && <ResultCard r={m.result} currency={currency} />}
            </div>
          ),
        )}
        {busy === "parse" && <div className="self-start card-flat rounded-2xl rounded-bl-md px-3.5 py-2.5 text-[13px] dim">Je lis…</div>}
        <div ref={endRef} />
      </div>

      <form
        className="sticky bottom-0 -mx-3 px-3 pb-3 pt-2"
        style={{ background: "linear-gradient(to top, var(--bg) 70%, transparent)" }}
        onSubmit={(e) => {
          e.preventDefault();
          void send(input);
        }}
      >
        <div className="max-w-[760px] mx-auto flex items-end gap-2 card p-2">
          <textarea
            className="input flex-1 resize-none !py-2"
            rows={2}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send(input);
              }
            }}
            placeholder="Alexandre, closé 2500 en instant aujourd'hui, vient d'Instagram"
            disabled={busy === "confirm"}
          />
          <button type="submit" className="btn btn-primary" disabled={!input.trim() || Boolean(busy)}>
            {busy === "parse" ? "…" : "Envoyer"}
          </button>
        </div>
      </form>
    </div>
  );
}

/* ------------------------------ Fiche à valider ------------------------------ */

function DraftCard({
  draft,
  matches,
  ctx,
  locked,
  busy,
  onChange,
  onConfirm,
}: {
  draft: NewStudentDraft;
  matches: LeadMatch[];
  ctx: ChatContext;
  locked: boolean;
  busy: boolean;
  onChange: (p: Partial<NewStudentDraft>) => void;
  onConfirm: () => void;
}) {
  const d = draft;
  const dis = locked || busy;
  const numInput = (k: "contractValue" | "cashCollected" | "installments") => (
    <input className="input num" type="number" inputMode="numeric" min={0} value={d[k] || ""} onChange={(e) => onChange({ [k]: Number(e.target.value) || 0 })} disabled={dis} />
  );
  const canConfirm = Boolean(d.name.trim()) && d.contractValue > 0 && !dis;
  return (
    <div className="card p-3.5 flex flex-col gap-3" style={{ opacity: locked ? 0.7 : 1 }}>
      <div className="grid grid-cols-2 gap-2.5">
        <Field label="Nom prénom" className="col-span-2">
          <input className="input" value={d.name} onChange={(e) => onChange({ name: e.target.value })} disabled={dis} />
        </Field>
        <Field label={`Contrat (${ctx.currency})`}>{numInput("contractValue")}</Field>
        <Field label={`Encaissé aujourd'hui (${ctx.currency})`}>{numInput("cashCollected")}</Field>
        <Field label="Paiement">
          <select
            className="input"
            value={d.paymentType}
            disabled={dis}
            onChange={(e) => {
              const paymentType = e.target.value as NewStudentDraft["paymentType"];
              const patch: Partial<NewStudentDraft> = { paymentType };
              if (paymentType === "paid-in-full") patch.cashCollected = d.contractValue;
              if (paymentType === "installments" && !d.installments) {
                patch.installments = 2;
                patch.cashCollected = Math.round(d.contractValue / 2);
              }
              onChange(patch);
            }}
          >
            {PAYMENT_OPTIONS.map((o) => (
              <option key={o.key} value={o.key}>
                {o.label}
              </option>
            ))}
          </select>
        </Field>
        {d.paymentType === "installments" ? <Field label="Nombre de fois">{numInput("installments")}</Field> : <div />}
        <Field label="Date de la vente">
          <input className="input" type="date" value={d.soldAt} max={ctx.today} onChange={(e) => onChange({ soldAt: e.target.value })} disabled={dis} />
        </Field>
        <Field label="Source">
          <select className="input" value={d.source} onChange={(e) => onChange({ source: e.target.value })} disabled={dis}>
            {SOURCE_OPTIONS.map((o) => (
              <option key={o.key || "unknown"} value={o.key}>
                {o.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Offre" className="col-span-2">
          <input className="input" list="offres" value={d.offer} onChange={(e) => onChange({ offer: e.target.value })} disabled={dis} />
          <datalist id="offres">
            {ctx.offers.map((o) => (
              <option key={o.name} value={o.name} />
            ))}
          </datalist>
        </Field>
        <Field label="Téléphone (pour WhatsApp)">
          <input className="input" inputMode="tel" value={d.phone} onChange={(e) => onChange({ phone: e.target.value })} disabled={dis} placeholder="06…" />
        </Field>
        <Field label="Email">
          <input className="input" inputMode="email" value={d.email} onChange={(e) => onChange({ email: e.target.value })} disabled={dis} />
        </Field>
        <Field label="Instagram">
          <input className="input" value={d.igUsername} onChange={(e) => onChange({ igUsername: e.target.value.replace(/^@/, "") })} disabled={dis} placeholder="pseudo sans @" />
        </Field>
        {ctx.setters.length > 0 && (
          <Field label="Setter (si le lead n'en a pas)">
            <select className="input" value={d.setterId} onChange={(e) => onChange({ setterId: e.target.value })} disabled={dis}>
              <option value="">Aucun setter : moi</option>
              {ctx.setters.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </Field>
        )}
        <Field label="Notes" className="col-span-2">
          <input className="input" value={d.notes} onChange={(e) => onChange({ notes: e.target.value })} disabled={dis} placeholder="Objectif, contexte…" />
        </Field>
      </div>

      <div>
        <div className="label-xs mb-1.5">Lead du CRM</div>
        <div className="flex flex-col gap-1.5">
          <label className="flex items-start gap-2 text-[13px] cursor-pointer">
            <input type="radio" name={`lead-${d.soldAt}`} checked={!d.leadId} onChange={() => onChange({ leadId: "" })} disabled={dis} className="mt-1" />
            <span>
              Nouveau lead <span className="dim">(aucun des leads ci-dessous n&apos;est lui)</span>
            </span>
          </label>
          {matches.map((m) => (
            <label key={m.id} className="flex items-start gap-2 text-[13px] cursor-pointer">
              <input type="radio" name={`lead-${d.soldAt}`} checked={d.leadId === m.id} onChange={() => onChange({ leadId: m.id })} disabled={dis} className="mt-1" />
              <span className="min-w-0">
                <span className="font-medium">{m.name}</span>
                {m.handle && <span className="dim"> {m.handle}</span>}
                {m.isStudent && <span className="badge badge-warn !text-[10px] !py-0 ml-1.5">déjà élève</span>}
                {!m.isStudent && m.hasSale && <span className="badge !text-[10px] !py-0 ml-1.5">vente existante</span>}
                <span className="dim block text-[12px]">
                  {[m.setterName && `setter ${m.setterName}`, m.sourceLabel, m.lastAppointmentAt && `call ${STATUS_LABEL[m.lastAppointmentStatus] ?? m.lastAppointmentStatus} le ${fmtDateTime(m.lastAppointmentAt)}`, m.phone, m.email]
                    .filter(Boolean)
                    .join(" · ") || "aucun call"}
                </span>
              </span>
            </label>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <Toggle checked={d.createAccess} onChange={(v) => onChange({ createAccess: v })} label="Créer son accès à la plateforme" />
        <Toggle checked={d.contractSigned} onChange={(v) => onChange({ contractSigned: v })} label="Contrat signé" />
      </div>

      <button className="btn btn-primary w-full" onClick={onConfirm} disabled={!canConfirm}>
        {locked ? "Validé" : busy ? "Enregistrement…" : "Valider : créer l'élève et la vente"}
      </button>
    </div>
  );
}

/* --------------------------------- Résultat --------------------------------- */

function ResultCard({ r, currency }: { r: ConfirmResult; currency: string }) {
  return (
    <div className="card p-3.5 flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-2 text-[12.5px]">
        <div className="card-flat p-2.5">
          <div className="label-xs">Vente</div>
          <div className="font-semibold text-[15px]">{fmtMoney(r.sale.contractValue, r.sale.currency || currency)}</div>
          <div className="dim">{fmtMoney(r.sale.cashCollected, r.sale.currency || currency)} encaissés{r.sale.installments ? ` · ${r.sale.installments} fois` : ""}</div>
        </div>
        <div className="card-flat p-2.5">
          <div className="label-xs">Élève</div>
          <div className="font-semibold text-[15px] truncate">{r.student.name}</div>
          <div className="dim truncate">{r.student.program}</div>
        </div>
      </div>

      {r.credentials && (
        <div className="card-flat p-2.5 text-[13px]" style={{ borderColor: "var(--accent)" }}>
          <div className="label-xs">Accès plateforme (affiché une seule fois)</div>
          <div className="mono mt-1">Identifiant : {r.credentials.username}</div>
          <div className="mono">Mot de passe : {r.credentials.password}</div>
        </div>
      )}

      <div>
        <div className="label-xs mb-1">Message d&apos;onboarding</div>
        <pre className="card-flat p-3 text-[12.5px] leading-relaxed whitespace-pre-wrap font-sans max-h-[45vh] overflow-auto">{r.message}</pre>
      </div>

      <div className="flex flex-wrap gap-2">
        {r.whatsapp ? (
          <a className="btn btn-primary btn-sm" href={r.whatsapp} target="_blank" rel="noreferrer">
            Envoyer sur WhatsApp
          </a>
        ) : (
          <span className="dim text-[12px] self-center">Pas de numéro : copie le message et envoie-le toi-même.</span>
        )}
        <CopyButton text={r.message} label="Copier le message" />
        <Link href="/eleves" className="btn btn-sm btn-ghost">
          Fiche élève
        </Link>
        <Link href="/sales/dashboard" className="btn btn-sm btn-ghost">
          Sales Dashboard
        </Link>
      </div>
    </div>
  );
}
