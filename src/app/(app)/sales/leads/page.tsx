"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { api } from "@/lib/client";
import { fmtDateTime, fmtTime, isoToParisInput, label, parisDay, parisToIso, parisWeekday, relative } from "@/lib/format";
import { useSalesData } from "@/lib/sales/client";
import { hasRole } from "@/lib/sales/roles";
import { DEFAULT_FUNNELS, SOURCE_CHANNEL_LABEL, SOURCE_CHANNELS } from "@/lib/sales/attribution";
import { Card, Empty, ErrorNote, Field, Modal, PageHeader, Spinner, useToast } from "@/components/ui";
import { useSales } from "@/components/sales/context";
import { LeadSheet } from "@/components/sales/LeadSheet";
import { renderTemplate, sortedTemplates, waLink } from "@/lib/sales/templates";
import type { CallBucket, CallLeadRow } from "@/app/api/sales/leads/route";
import { fmtIdle } from "@/lib/sales/takeover";
import type { PublicMember } from "@/lib/sales/repo";
import type { LeadCallStatus, MessageTemplate, SalesFunnel, SourceChannel } from "@/lib/types";

/* ------------------------------- Couleurs ------------------------------ */

const COLOR = {
  new: "#94a3b8",
  yellow: "#eab308",
  blue: "#3b82f6",
  violet: "#a855f7",
  green: "#22c55e",
  red: "#ef4444",
  whatsapp: "#25d366",
  orange: "#f97316",
} as const;

/** Couleur d'accent de la page : la meme que le CRM et le Sales Dashboard. */
const ACCENT = { "--accent": "#006dbc", "--accent-hover": "#005a9c", "--accent-soft": "#e6f1fa", "--accent-ring": "#9cc9ea", "--grad-accent": "linear-gradient(135deg, #006dbc 0%, #2a8fd8 100%)" } as CSSProperties;

const TONE: Record<CallBucket, string> = { takeover: COLOR.orange, new: COLOR.new, retry: COLOR.blue, due: COLOR.blue, later: COLOR.yellow, talking: COLOR.violet, booked: COLOR.green, lost: COLOR.red, done: COLOR.green };

/*
 * Une seule idee : un lead sans reponse se relance. « A relancer » = a faire
 * maintenant (rappel ou relance arrivee a echeance, ou rien de programme) ;
 * « En attente » = message envoye ou relance programmee, pas encore due.
 */
type FilterKey = "all" | "takeover" | "new" | "due" | "waiting" | "talking" | "lost";
const FILTERS: { key: FilterKey; label: string; color?: string; buckets: CallBucket[] }[] = [
  { key: "all", label: "Tous", buckets: ["takeover", "due", "new", "retry", "later", "talking", "lost"] },
  { key: "takeover", label: "À reprendre", color: COLOR.orange, buckets: ["takeover"] },
  { key: "new", label: "Nouveaux", color: COLOR.new, buckets: ["new"] },
  { key: "due", label: "À relancer", color: COLOR.blue, buckets: ["due", "retry"] },
  { key: "waiting", label: "En attente", color: COLOR.yellow, buckets: ["later"] },
  { key: "talking", label: "Joints, RDV à fixer", color: COLOR.violet, buckets: ["talking"] },
  { key: "lost", label: "Perdus · leads froids", color: COLOR.red, buckets: ["lost"] },
];

const STATUS_LABEL: Record<LeadCallStatus, string> = {
  "no-answer": "Pas de réponse",
  "message-sent": "Message WA envoyé",
  callback: "À rappeler",
  reached: "Joint",
  "not-interested": "Pas intéressé",
  "wrong-number": "Faux numéro",
  "no-whatsapp": "Pas de WhatsApp",
  cold: "Lead froid · sans réponse",
};

const COUNTRY: Record<string, string> = { FR: "France", BE: "Belgique", CH: "Suisse", CA: "Canada", AE: "Émirats", MA: "Maroc", DZ: "Algérie", TN: "Tunisie", LU: "Luxembourg" };
function localHint(country?: string): string {
  const tz: Record<string, string> = { CA: "America/Toronto", AE: "Asia/Dubai", MA: "Africa/Casablanca", DZ: "Africa/Algiers", TN: "Africa/Tunis", CH: "Europe/Zurich", BE: "Europe/Brussels", LU: "Europe/Luxembourg" };
  const zone = country ? tz[country] : "";
  if (!zone) return "";
  try {
    return new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: zone }).format(new Date());
  } catch {
    return "";
  }
}

function Dot({ color }: { color: string }) {
  return <span className="inline-block w-[9px] h-[9px] rounded-full shrink-0" style={{ background: color, boxShadow: `0 0 0 2px color-mix(in srgb, ${color} 25%, transparent)` }} />;
}

async function copy(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** Numero avec bouton copier : on colle dans WhatsApp, pas d'onglet qui s'ouvre. */
/** Un template en widget : son nom (clic = lire / modifier) et Copier. `active` = le dernier copie, celui que WhatsApp preremplit. */
function TemplateChip({ t, active, copied, onOpen, onCopy }: { t: MessageTemplate; active: boolean; copied: boolean; onOpen: () => void; onCopy: () => void }) {
  return (
    <span className="inline-flex items-stretch rounded-lg overflow-hidden h-[32px]" style={{ border: `1px solid ${active ? "var(--accent)" : "var(--border)"}`, background: active ? "var(--accent-soft)" : "var(--surface)" }}>
      <button type="button" className="px-3 text-[12.5px] font-medium hover:underline max-w-[220px] truncate" onClick={onOpen} title={`${t.name} — clic pour lire ou modifier`} style={{ color: active ? "var(--accent)" : "var(--text)" }}>
        {t.isFavorite ? "⭐ " : ""}
        {t.name}
      </button>
      <button
        type="button"
        className="px-2.5 text-[11.5px] font-semibold"
        onClick={onCopy}
        title="Copier le message"
        style={{ borderLeft: `1px solid ${active ? "var(--accent)" : "var(--border)"}`, background: copied ? "var(--good)" : "var(--surface-2)", color: copied ? "#fff" : "var(--text-2)" }}
      >
        {copied ? "Copié ✓" : "Copier"}
      </button>
    </span>
  );
}

/** Lecture et modification d'un template depuis la page Leads : le texte, Copier, Enregistrer (admin). */
function TemplateEditor({ t, isAdmin, onClose, onSaved, onCopy }: { t: MessageTemplate; isAdmin: boolean; onClose: () => void; onSaved: (t: MessageTemplate) => void; onCopy: (text: string) => Promise<boolean> }) {
  const toast = useToast();
  const [text, setText] = useState(t.content);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const dirty = text !== t.content;
  const save = async () => {
    setBusy(true);
    try {
      const r = await api<{ template: MessageTemplate }>(`/api/sales/templates/${t.id}`, { method: "PATCH", body: JSON.stringify({ content: text }) });
      toast("Message enregistré.");
      onSaved(r.template);
      onClose();
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open
      onClose={onClose}
      title={t.name}
      footer={
        <>
          <span className="dim text-[11.5px] mr-auto">{t.category}</span>
          <button className="btn" onClick={onClose} disabled={busy}>
            Fermer
          </button>
          <button
            className="btn"
            style={done ? { background: "var(--good)", borderColor: "var(--good)", color: "#fff" } : undefined}
            onClick={async () => {
              if (await onCopy(text)) {
                setDone(true);
                setTimeout(() => setDone(false), 1500);
              }
            }}
          >
            {done ? "Copié ✓" : "Copier"}
          </button>
          {isAdmin && (
            <button className="btn btn-primary" onClick={() => void save()} disabled={busy || !dirty || !text.trim()}>
              {busy ? <span className="spinner" /> : "Enregistrer"}
            </button>
          )}
        </>
      }
    >
      <textarea className="textarea w-full !text-[13.5px] leading-relaxed" rows={12} value={text} onChange={(e) => setText(e.target.value)} autoFocus />
      <p className="dim text-[11.5px] mt-2">{isAdmin ? "Enregistrer modifie le template pour tout le monde. Copier prend le texte tel qu'affiché, même non enregistré." : "Copier prend le texte tel qu'affiché, même modifié."}</p>
    </Modal>
  );
}

function PhoneCopy({ phone }: { phone: string }) {
  const [done, setDone] = useState(false);
  if (!phone) return <span className="badge badge-warn !text-[10px] !py-0">Pas de numéro</span>;
  return (
    <span className="inline-flex items-center gap-1.5">
      <a href={`tel:${phone}`} className="num text-[14.5px] font-semibold sm:pointer-events-none sm:text-[color:var(--text)]" title="Appeler (téléphone)">
        {phone}
      </a>
      <button
        type="button"
        className="btn btn-sm !h-[24px] !px-2 !text-[11px]"
        style={done ? { borderColor: COLOR.green, color: COLOR.green } : undefined}
        onClick={async () => {
          if (await copy(phone)) {
            setDone(true);
            setTimeout(() => setDone(false), 1400);
          }
        }}
        title="Copier le numéro"
      >
        {done ? "Copié ✓" : "Copier"}
      </button>
    </span>
  );
}

/* ---------------------------------- Page --------------------------------- */

/**
 * Leads a traiter, en deux colonnes : ceux qui viennent des publicites et
 * ceux qui viennent de l'organique, chacun filtrable par funnel. Chaque
 * ligne se traite sans quitter la page : copier le numero, appeler, noter
 * « pas de reponse » ou « message WhatsApp envoye », rappel, joint, RDV pris
 * (le call part dans Rendez-vous et l'Agenda). Le script du funnel est a
 * un clic pour le message a envoyer.
 */
export default function LeadsPage() {
  const { session, members, version, bump } = useSales();
  const toast = useToast();
  const [booking, setBooking] = useState<CallLeadRow | null>(null);
  const [callbackFor, setCallbackFor] = useState<CallLeadRow | null>(null);
  const [cancelPending, setCancelPending] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [busy, setBusy] = useState("");
  const [filter, setFilter] = useState<FilterKey>("all");
  /* Recherche : nom, telephone, email, Instagram, notes ; envoyee au serveur apres une courte pause de frappe. */
  const [query, setQuery] = useState("");
  const [q, setQ] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setQ(query.trim()), 250);
    return () => clearTimeout(t);
  }, [query]);
  const [sheetId, setSheetId] = useState<string | null>(null);
  const [funnels, setFunnels] = useState<SalesFunnel[]>(DEFAULT_FUNNELS);
  const [reoptinFunnel, setReoptinFunnel] = useState<string | null>(null);
  const [templates, setTemplates] = useState<MessageTemplate[]>([]);
  const loadTemplates = () =>
    api<{ rows: MessageTemplate[] }>("/api/sales/templates")
      .then((r) => setTemplates(r.rows))
      .catch(() => undefined);
  /* Panneau des messages : favoris (ou tous), replie ou non, dernier copie (prerempli dans WhatsApp). */
  const [showAll, setShowAll] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<MessageTemplate | null>(null);
  const [activeTemplateId, setActiveTemplateId] = useState("");
  const [copiedId, setCopiedId] = useState("");
  useEffect(() => {
    try {
      setActiveTemplateId(localStorage.getItem("leads.messages.active") ?? "");
    } catch {
      // stockage indisponible : valeurs par defaut
    }
  }, []);
  const activeTemplates = useMemo(() => sortedTemplates(templates).filter((t) => t.isActive), [templates]);
  const panelTemplates = showAll ? activeTemplates : activeTemplates.filter((t) => t.isFavorite);
  const activeTemplate = activeTemplates.find((t) => t.id === activeTemplateId) ?? null;
  const copyTemplate = async (t: MessageTemplate) => {
    if (!(await copy(t.content))) {
      toast("Copie impossible ici : sélectionne le texte et copie-le à la main.", "err");
      return;
    }
    setCopiedId(t.id);
    setActiveTemplateId(t.id);
    try {
      localStorage.setItem("leads.messages.active", t.id);
    } catch {
      // sans importance
    }
    setTimeout(() => setCopiedId((c) => (c === t.id ? "" : c)), 1500);
  };
  const [funnelsOpen, setFunnelsOpen] = useState(false);
  const [scriptFor, setScriptFor] = useState<{ funnel: SalesFunnel; lead: CallLeadRow } | null>(null);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [deleting, setDeleting] = useState(false);
  const [pick, setPick] = useState<{ ads: Set<string>; organic: Set<string> }>({ ads: new Set(), organic: new Set() });

  const setters = useMemo(() => members.filter((m) => hasRole(m, "setter") && m.status !== "inactif"), [members]);

  const { data, loading, error, reload } = useSalesData<{
    rows: CallLeadRow[];
    counts: Record<CallBucket, number> & { notInterested: number; hidden: number };
    lastSyncAt: string;
    syncError: string;
    pool: boolean;
    takeoverMin: number;
    defaultCloserId: string;
    ownerMemberId: string;
  }>(`/api/sales/leads?v=${version}${q ? `&q=${encodeURIComponent(q)}` : ""}`, { every: 15_000 });

  const loadFunnels = () =>
    api<{ rows: SalesFunnel[]; reoptinFunnel?: string | null }>("/api/sales/funnels")
      .then((r) => {
        setFunnels(r.rows);
        setReoptinFunnel(r.reoptinFunnel ?? null);
      })
      .catch(() => undefined);
  useEffect(() => {
    void loadFunnels();
    void loadTemplates();
  }, []);

  const refresh = () => {
    void reload();
    bump();
    window.dispatchEvent(new Event("sales:changed"));
  };

  const setStatus = async (lead: CallLeadRow, status: LeadCallStatus, callbackAt?: string, note?: string, cancelAppointment = false) => {
    setBusy(lead.id);
    try {
      await api(`/api/sales/leads/${lead.id}`, { method: "PATCH", body: JSON.stringify({ action: "status", status, callbackAt, note, cancelAppointment }) });
      toast(status === "callback" && callbackAt ? `Rappel noté pour le ${fmtDateTime(callbackAt)}.` : status === "not-interested" ? `${lead.name} sort de la liste.` : `${lead.name} : ${STATUS_LABEL[status].toLowerCase()}.`);
      refresh();
    } catch (e) {
      toast((e as Error).message, "err");
      void reload(true);
    } finally {
      setBusy("");
    }
  };

  const assign = async (lead: CallLeadRow, setterId: string) => {
    try {
      await api(`/api/sales/leads/${lead.id}`, { method: "PATCH", body: JSON.stringify({ action: "assign", setterId }) });
      toast(setterId ? "Lead réattribué." : "Lead remis à tout le monde.");
      void reload();
    } catch (e) {
      toast((e as Error).message, "err");
    }
  };

  /** Regle de reprise : la conversation d'un autre setter dort depuis trop longtemps, je la prends. */
  const takeover = async (lead: CallLeadRow) => {
    setBusy(lead.id);
    try {
      await api(`/api/sales/leads/${lead.id}`, { method: "PATCH", body: JSON.stringify({ action: "takeover" }) });
      toast(`${lead.name} est à toi : réponds-lui maintenant et note-le ici.`);
      refresh();
    } catch (e) {
      toast((e as Error).message, "err");
      void reload(true);
    } finally {
      setBusy("");
    }
  };

  const reopen = async (lead: CallLeadRow) => {
    setBusy(lead.id);
    try {
      await api(`/api/sales/leads/${lead.id}`, { method: "PATCH", body: JSON.stringify({ action: "reopen" }) });
      toast(`${lead.name} est de retour dans la liste.`);
      refresh();
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setBusy("");
    }
  };

  const remove = async (leads: CallLeadRow[]) => {
    if (!leads.length) return;
    const label = leads.length === 1 ? leads[0].name : `${leads.length} leads`;
    if (!window.confirm(`Supprimer ${label} ? C'est définitif : la fiche, ses notes et son historique disparaissent.`)) return;
    setDeleting(true);
    try {
      const r = await api<{ deleted: number; kept: string[] }>("/api/sales/leads", { method: "DELETE", body: JSON.stringify({ ids: leads.map((l) => l.id) }) });
      toast(r.kept.length ? `${r.deleted} supprimé(s). Gardé(s) (rendez-vous à venir) : ${r.kept.join(", ")}.` : `${r.deleted} supprimé${r.deleted > 1 ? "s" : ""}.`);
      setSelected(new Set());
      refresh();
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setDeleting(false);
    }
  };

  const [backfilling, setBackfilling] = useState(false);
  /** Import de tout l'historique Systeme.io : les anciens inscrits arrivent en leads froids. */
  const backfill = async () => {
    if (!window.confirm("Importer TOUT l'historique Systeme.io des funnels déclarés ? Les inscrits de plus de 30 jours arriveront en « lead froid » (comptés, consultables, pas dans la liste à appeler). Rien n'est dupliqué.")) return;
    setBackfilling(true);
    try {
      const r = await api<{ examined: number; created: number; updated: number; skipped: number }>("/api/sales/systemeio/backfill", { method: "POST", timeoutMs: 180_000 });
      toast(`${r.examined} contacts lus · ${r.created} nouveau${r.created > 1 ? "x" : ""} lead${r.created > 1 ? "s" : ""} · ${r.updated} complété${r.updated > 1 ? "s" : ""} · ${r.skipped} hors funnels.`);
      refresh();
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setBackfilling(false);
    }
  };

  const sync = async () => {
    setSyncing(true);
    try {
      const r = await api<{ examined: number; created: number; known: number; inBase: { toCall: number } }>("/api/sales/systemeio", { method: "POST" });
      toast(r.created ? `${r.created} nouveau${r.created > 1 ? "x" : ""} lead${r.created > 1 ? "s" : ""} récupéré${r.created > 1 ? "s" : ""}.` : `${r.examined} contact${r.examined > 1 ? "s" : ""} lu${r.examined > 1 ? "s" : ""} chez Systeme.io, ${r.known} déjà en base.`);
      refresh();
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setSyncing(false);
    }
  };

  /** Changement de statut, avec les garde-fous (rendez-vous existant, raison de perte). */
  const choose = (l: CallLeadRow, v: string) => {
    const booked = l.bucket === "booked";
    if (v === "booked") return setBooking(l);
    let cancel = false;
    if (booked) {
      if (!window.confirm(`${l.name} a un rendez-vous. Changer son statut annule ce rendez-vous. Continuer ?`)) return;
      cancel = true;
    }
    if (v === "callback") {
      setCancelPending(cancel);
      return setCallbackFor(l);
    }
    if (v === "not-interested") {
      const reason = window.prompt("Pas intéressé : pourquoi ? (optionnel)") ?? null;
      if (reason === null) return;
      return void setStatus(l, "not-interested", undefined, reason, cancel);
    }
    if (v === "delete") return void remove([l]);
    if (v === "reopen") return void reopen(l);
    void setStatus(l, v as LeadCallStatus, undefined, undefined, cancel);
  };

  /**
   * « WA envoye » : le setter a envoye le message lui-meme (copie ou
   * WhatsApp). On le note dans l'historique du lead avec le dernier template
   * copie, et le lead passe « message envoye ». Rien n'est envoye par l'outil.
   */
  const markSent = async (l: CallLeadRow) => {
    setBusy(l.id);
    try {
      await api(`/api/sales/leads/${l.id}`, {
        method: "PATCH",
        body: JSON.stringify({ action: "message", templateId: activeTemplate?.id, templateName: activeTemplate?.name, channel: activeTemplate?.channel ?? "whatsapp", next: "tomorrow" }),
      });
      toast(`${l.name} : WhatsApp envoyé, relance demain matin.`);
      refresh();
    } catch (e) {
      toast((e as Error).message, "err");
      void reload(true);
    } finally {
      setBusy("");
    }
  };

  const rows = data?.rows ?? [];
  const c = data?.counts;
  const funnelOf = (l: CallLeadRow) => funnels.find((f) => f.key === (l.funnelSource ?? "")) ?? null;
  const funnelLabelOf = (l: CallLeadRow) => funnelOf(l)?.label ?? l.funnelSource ?? "—";
  // En recherche, tout ce qui correspond s'affiche, meme hors liste (RDV pris, closes, call fait).
  const shown = q ? rows : rows.filter((r) => FILTERS.find((f) => f.key === filter)?.buckets.includes(r.bucket));
  const isAds = (l: CallLeadRow) => (l.sourceChannel ?? "UNKNOWN") === "META_ADS";

  const columns: { key: "ads" | "organic"; title: string; hint: string; rows: CallLeadRow[] }[] = [
    { key: "ads", title: "Leads Ads", hint: "Venus d'une publicité Meta (LP, utm, fbclid).", rows: shown.filter(isAds) },
    { key: "organic", title: "Leads organiques", hint: "Instagram, YouTube, bouche à oreille, funnels organiques.", rows: shown.filter((l) => !isAds(l)) },
  ];

  const selectedRows = shown.filter((r) => selected.has(r.id));

  return (
    <div style={ACCENT}>
      <PageHeader
        title="Leads"
        subtitle={data?.lastSyncAt ? `Inscrits Systeme.io synchronisés ${relative(data.lastSyncAt)}. Cadence : appel → pas de réponse → WhatsApp → relance J+1 → J+3 → lead froid. Traite « À relancer » de haut en bas.` : "Les prospects qui viennent de laisser leurs coordonnées."}
        actions={
          <>
            {session.isAdmin && (
              <button className="btn" onClick={() => setFunnelsOpen(true)} title="Déclarer les funnels : URL d'opt-in, canal, script">
                ⚙ Funnels
              </button>
            )}
            {session.isAdmin && (
              <button className="btn" onClick={() => void backfill()} disabled={backfilling} title="Relire tous les contacts Systeme.io depuis le début">
                {backfilling ? <span className="spinner" /> : "Importer tout l'historique"}
              </button>
            )}
            <button className="btn" onClick={() => void sync()} disabled={syncing} title="Relire Systeme.io tout de suite">
              {syncing ? <span className="spinner" /> : "↻ Vérifier les nouveaux"}
            </button>
          </>
        }
      />

      {(error || data?.syncError) && (
        <div className="mb-4">
          <ErrorNote>{error || `Synchro Systeme.io : ${data?.syncError}`}</ErrorNote>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-1.5 mb-3">
        {/* Recherche : colle un nom, un numero ou un mail. Retrouve aussi les leads hors liste. */}
        <span className="relative inline-flex items-center mr-1">
          <input
            className="input !h-[32px] !text-[12.5px] !pl-8 !pr-7 w-[260px]"
            placeholder="Rechercher : nom, téléphone, email…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setQuery("");
            }}
          />
          <span className="absolute left-2.5 dim text-[13px] pointer-events-none">⌕</span>
          {query && (
            <button type="button" className="absolute right-1.5 dim text-[12px] px-1" onClick={() => setQuery("")} title="Effacer">
              ✕
            </button>
          )}
        </span>
        {q && (
          <span className="text-[12.5px] dim mr-1">
            {rows.length} résultat{rows.length > 1 ? "s" : ""}
          </span>
        )}
        {FILTERS.map((f) => {
          const n = f.buckets.reduce((acc, k) => acc + (c?.[k] ?? 0), 0);
          const active = filter === f.key;
          return (
            <button
              key={f.key}
              type="button"
              onClick={() => setFilter(f.key)}
              className="flex items-center gap-1.5 h-[30px] px-3 rounded-full text-[12.5px] font-medium transition-colors"
              style={{ background: active ? (f.color ? `color-mix(in srgb, ${f.color} 28%, var(--surface))` : "var(--surface)") : "var(--surface-2)", border: `1px solid ${active ? (f.color ?? "var(--text-2)") : "var(--border)"}`, color: active ? "var(--text)" : "var(--text-2)" }}
            >
              {f.color && <Dot color={f.color} />}
              {f.label}
              <span className="num opacity-70">{n}</span>
            </button>
          );
        })}
        {(c?.booked ?? 0) > 0 && (
          <Link href="/sales/rendez-vous" className="flex items-center gap-1.5 h-[30px] px-3 rounded-full text-[12.5px] font-medium ml-auto" style={{ border: `1px solid ${COLOR.green}`, color: COLOR.green }}>
            <Dot color={COLOR.green} />
            {c!.booked} RDV pris → Rendez-vous
          </Link>
        )}
        {session.isAdmin && selectedRows.length > 0 && (
          <span className="flex items-center gap-1.5 ml-auto">
            <button className="btn btn-sm btn-danger !h-[28px]" disabled={deleting} onClick={() => void remove(selectedRows)}>
              {deleting ? <span className="spinner" /> : `Supprimer ${selectedRows.length}`}
            </button>
            <button className="btn btn-ghost btn-sm !h-[28px]" onClick={() => setSelected(new Set())}>✕</button>
          </span>
        )}
      </div>

      {/* Messages : de petits widgets, nom + Copier. Un clic sur le nom ouvre le texte, modifiable. Le dernier copie preremplit WhatsApp. */}
      <div className="card-flat px-4 py-3 mb-4 flex items-center gap-x-3 gap-y-2 flex-wrap">
        <span className="text-[12.5px] font-semibold shrink-0">Messages</span>
        {panelTemplates.length === 0 && <span className="dim text-[12px]">Aucun template actif.</span>}
        {panelTemplates.map((t) => (
          <TemplateChip key={t.id} t={t} active={t.id === activeTemplateId} copied={copiedId === t.id} onOpen={() => setEditingTemplate(t)} onCopy={() => void copyTemplate(t)} />
        ))}
        <span className="flex items-center gap-1 ml-auto">
          {activeTemplates.some((t) => !t.isFavorite) && (
            <button className="btn btn-ghost btn-sm !h-[28px] !text-[11.5px]" onClick={() => setShowAll((v) => !v)}>
              {showAll ? "Favoris" : `Tous (${activeTemplates.length})`}
            </button>
          )}
          {session.isAdmin && (
            <Link href="/sales/messages" className="btn btn-ghost btn-sm !h-[28px] !text-[11.5px]" title="Créer, réordonner, favoris, catégories">
              Gérer
            </Link>
          )}
        </span>
      </div>

      {loading && !data ? (
        <Card>
          <Spinner label="Chargement…" />
        </Card>
      ) : !rows.length ? (
        <Card>
          <Empty>
            {c?.hidden ? (
              <>{c.hidden} lead{c.hidden > 1 ? "s" : ""} existe{c.hidden > 1 ? "nt" : ""} mais {c.hidden > 1 ? "sont attribués" : "est attribué"} à un autre setter.</>
            ) : (
              <>Personne à traiter pour l&apos;instant. Les nouveaux inscrits apparaîtront ici tout seuls.</>
            )}
          </Empty>
        </Card>
      ) : (
        <div className="grid lg:grid-cols-2 gap-4 items-start">
          {columns.map((col) => {
            const colFunnels = [...new Set(col.rows.map((l) => l.funnelSource ?? ""))];
            const picked = pick[col.key];
            const visible = picked.size ? col.rows.filter((l) => picked.has(l.funnelSource ?? "")) : col.rows;
            return (
              <Card
                key={col.key}
                padded={false}
                title={
                  <span className="flex items-center gap-2">
                    {col.title}
                    <span className="badge !text-[10.5px] !py-0 num">{visible.length}</span>
                  </span>
                }
                subtitle={col.hint}
              >
                {/* Funnels de la colonne : un clic filtre, plusieurs se cumulent (A/B tests). */}
                {colFunnels.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 px-3.5 py-2" style={{ borderBottom: "1px solid var(--border)" }}>
                    {colFunnels.map((k) => {
                      const f = funnels.find((x) => x.key === k);
                      const active = picked.has(k);
                      const n = col.rows.filter((l) => (l.funnelSource ?? "") === k).length;
                      return (
                        <button
                          key={k || "none"}
                          type="button"
                          className="h-[26px] px-2.5 rounded-full text-[11.5px] font-medium"
                          style={{ background: active ? "var(--accent-soft)" : "var(--surface-2)", border: `1px solid ${active ? "var(--accent)" : "var(--border)"}`, color: active ? "var(--accent)" : "var(--text-2)" }}
                          onClick={() =>
                            setPick((p) => {
                              const next = new Set(p[col.key]);
                              if (next.has(k)) next.delete(k);
                              else next.add(k);
                              return { ...p, [col.key]: next };
                            })
                          }
                          title={f?.match ? `Reconnu par : ${f.match}` : "Funnel"}
                        >
                          {f?.label ?? (k || "sans funnel")} <span className="num opacity-70">{n}</span>
                        </button>
                      );
                    })}
                    {picked.size > 0 && (
                      <button type="button" className="btn btn-ghost btn-sm !h-[26px] !text-[11px]" onClick={() => setPick((p) => ({ ...p, [col.key]: new Set() }))}>
                        ✕ tous
                      </button>
                    )}
                  </div>
                )}
                {visible.length === 0 ? (
                  <Empty>Rien dans cette colonne avec ces filtres.</Empty>
                ) : (
                  <ul>
                    {visible.map((l) => {
                      const tone = TONE[l.bucket];
                      const lost = l.bucket === "lost";
                      const f = funnelOf(l);
                      const local = localHint(l.country);
                      const isBusy = busy === l.id;
                      const since = l.optInAt || l.createdAt;
                      const statusText =
                        l.bucket === "takeover"
                          ? `À reprendre · ${l.takeover?.ownerName ?? "setter"} sans action depuis ${fmtIdle(l.takeover?.idleMin ?? 0)}`
                          : l.bucket === "booked"
                            ? "RDV pris"
                            : l.bucket === "done"
                              ? label(l.stage)
                              : l.callStatus
                                ? STATUS_LABEL[l.callStatus]
                                : "Jamais appelé";
                      // Mon lead qui dort : avertissement avant qu'un autre puisse le reprendre.
                      const atRisk = l.takeoverInMin !== undefined && l.idleMin !== undefined && !session.isAdmin && l.setterId === session.memberId;
                      const waText = activeTemplate ? renderTemplate(activeTemplate.content, { name: l.name }) : "";
                      return (
                        <li key={l.id} className="px-5 py-4" style={{ borderBottom: "1px solid var(--border)", opacity: lost ? 0.7 : 1, background: selected.has(l.id) ? "var(--accent-soft)" : undefined }}>
                          <div className="flex items-start gap-3.5">
                            {session.isAdmin && (
                              <input type="checkbox" className="mt-[7px]" checked={selected.has(l.id)} onChange={() => setSelected((p) => { const n = new Set(p); if (n.has(l.id)) n.delete(l.id); else n.add(l.id); return n; })} />
                            )}
                            <div className="min-w-0 flex-1">
                              {/* Ligne 1 : qui, et ou il en est. */}
                              <div className="flex items-center gap-2.5 flex-wrap">
                                <button type="button" className="text-[15px] font-semibold hover:underline text-left leading-tight" onClick={() => setSheetId(l.id)} title="Ouvrir la fiche (notes, historique)">
                                  {l.name}
                                </button>
                                <span className="inline-flex items-center gap-1.5 h-[22px] px-2 rounded-full text-[11.5px] font-medium whitespace-nowrap" style={{ background: `color-mix(in srgb, ${tone} 14%, transparent)`, color: tone }}>
                                  <Dot color={tone} />
                                  {statusText}
                                  {l.callStatus === "callback" && l.callbackAt ? ` · ${fmtDateTime(l.callbackAt)}` : ""}
                                  {l.callStatus === "no-answer" && (l.callAttempts ?? 0) > 1 ? ` (${l.callAttempts}×)` : ""}
                                  {l.followUpAt && (l.callStatus === "no-answer" || l.callStatus === "message-sent") ? ` · relance ${fmtDateTime(l.followUpAt)}` : ""}
                                </span>
                                <span className="badge !text-[10.5px] !py-0" title={f?.match ? `Reconnu par : ${f.match}` : "Funnel"}>
                                  {funnelLabelOf(l)}
                                </span>
                                {l.country && l.country !== "FR" && (
                                  <span className="dim text-[12px]">
                                    {COUNTRY[l.country] ?? l.country}
                                    {local ? ` · ${local} chez lui` : ""}
                                  </span>
                                )}
                              </div>

                              {/* Ligne 2 : le numero pret a copier, et le contexte. */}
                              <div className="flex items-center gap-x-4 gap-y-1.5 flex-wrap mt-2 text-[12.5px]">
                                <PhoneCopy phone={l.phone ?? ""} />
                                <span className="dim num" title="Heure d'inscription (France)">
                                  Inscrit {fmtDateTime(since)} <span className="opacity-70">({relative(since)})</span>
                                </span>
                                {l.email && <span className="dim truncate max-w-[240px]" title={l.email}>{l.email}</span>}
                              </div>
                              {l.notes && <div className="dim text-[12px] mt-1.5 truncate" title={l.notes}>✎ {l.notes.split("\n")[0]}</div>}
                              {atRisk && (
                                <div className="text-[12px] mt-1.5 font-medium" style={{ color: COLOR.orange }} title="Règle du setting : une conversation sans action pendant 1 h peut être reprise par un autre setter">
                                  {l.takeoverInMin! > 0
                                    ? `⏳ Sans action depuis ${fmtIdle(l.idleMin!)} · un autre setter pourra reprendre dans ${l.takeoverInMin} min`
                                    : `⚠️ Sans action depuis ${fmtIdle(l.idleMin!)} · un autre setter peut reprendre maintenant`}
                                </div>
                              )}

                              {/* Ligne 3 : la sequence d'appel en un clic. */}
                              <div className="flex items-center gap-2 flex-wrap mt-3">
                                {l.bucket === "takeover" ? (
                                  <>
                                    {!session.isAdmin && (
                                      <button
                                        className="btn btn-sm !h-[32px] font-semibold"
                                        style={{ background: COLOR.orange, borderColor: COLOR.orange, color: "#fff" }}
                                        disabled={isBusy}
                                        onClick={() => void takeover(l)}
                                        title={`${l.takeover?.ownerName ?? "Le setter"} n'a rien fait sur cette conversation depuis ${fmtIdle(l.takeover?.idleMin ?? 0)} : tu peux la reprendre, elle devient à toi.`}
                                      >
                                        🔁 Reprendre la conversation
                                      </button>
                                    )}
                                    <button className="btn btn-sm !h-[32px]" onClick={() => setSheetId(l.id)} title="Lire les notes et l'historique avant de reprendre">
                                      Ouvrir la fiche
                                    </button>
                                  </>
                                ) : l.bucket === "done" || l.bucket === "booked" ? (
                                  <button className="btn btn-sm !h-[32px]" onClick={() => setSheetId(l.id)} title="Hors de la liste à appeler : l'issue se pose depuis la fiche">
                                    Ouvrir la fiche
                                  </button>
                                ) : lost ? (
                                  <button className="btn btn-sm !h-[32px]" disabled={isBusy} onClick={() => choose(l, "reopen")}>
                                    Remettre dans la liste
                                  </button>
                                ) : (
                                  <>
                                    <button className="btn btn-sm !h-[32px]" disabled={isBusy} onClick={() => choose(l, "no-answer")} title="Appelé, pas de réponse">
                                      ☏ Pas de réponse
                                    </button>
                                    {l.phone && (
                                      <a
                                        className="btn btn-sm !h-[32px] font-semibold"
                                        style={{ background: COLOR.whatsapp, borderColor: COLOR.whatsapp, color: "#fff" }}
                                        href={waLink(l.phone, waText)}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        title={activeTemplate ? `Ouvre WhatsApp avec « ${activeTemplate.name} » prérempli. Rien n'est envoyé.` : "Ouvre la conversation WhatsApp (copie d'abord un message pour le préremplir)"}
                                      >
                                        WhatsApp ↗
                                      </a>
                                    )}
                                    <button className="btn btn-sm !h-[32px]" disabled={isBusy} onClick={() => void markSent(l)} title={activeTemplate ? `Note « ${activeTemplate.name} » envoyé dans l'historique` : "Note le message envoyé dans l'historique"}>
                                      ✓ WA envoyé
                                    </button>
                                    {f?.script && (
                                      <button className="btn btn-sm !h-[32px]" onClick={() => setScriptFor({ funnel: f, lead: l })} title="Script du funnel à copier">
                                        📋 Script
                                      </button>
                                    )}
                                    <button className="btn btn-sm !h-[32px]" disabled={isBusy} onClick={() => choose(l, "callback")}>
                                      ⏰ À rappeler
                                    </button>
                                    <button className="btn btn-sm !h-[32px]" disabled={isBusy} onClick={() => choose(l, "reached")} style={{ borderColor: COLOR.violet, color: COLOR.violet }}>
                                      Joint
                                    </button>
                                    <button className="btn btn-sm btn-primary !h-[32px]" disabled={isBusy} onClick={() => choose(l, "booked")} title="Rendez-vous pris : le call part dans l'Agenda">
                                      ✓ RDV pris
                                    </button>
                                    <select className="select select-sm !h-[32px] !w-auto" value="" disabled={isBusy} onChange={(e) => choose(l, e.target.value)} title="Autres statuts">
                                      <option value="">…</option>
                                      <option value="not-interested">Pas intéressé</option>
                                      <option value="wrong-number">Faux numéro</option>
                                      <option value="no-whatsapp">Pas de WhatsApp</option>
                                      <option value="cold">Lead froid (sans réponse)</option>
                                      {session.isAdmin && <option value="delete">Supprimer</option>}
                                    </select>
                                  </>
                                )}
                                {session.isAdmin && setters.length > 0 && (
                                  <select className="select select-sm !h-[32px] !w-auto ml-auto" value={l.setterId ?? ""} onChange={(e) => void assign(l, e.target.value)} title="Setter">
                                    <option value="">Tout le monde</option>
                                    {setters.map((m) => (
                                      <option key={m.id} value={m.id}>{m.name}</option>
                                    ))}
                                  </select>
                                )}
                                {!session.isAdmin && l.setterName && <span className="dim text-[11.5px] ml-auto">{l.setterName}</span>}
                              </div>
                            </div>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </Card>
            );
          })}
        </div>
      )}

      <LeadSheet id={sheetId} onClose={() => setSheetId(null)} onChanged={refresh} />

      {editingTemplate && (
        <TemplateEditor
          t={editingTemplate}
          isAdmin={session.isAdmin}
          onClose={() => setEditingTemplate(null)}
          onCopy={async (text) => {
            const ok = await copy(text);
            if (ok) {
              setActiveTemplateId(editingTemplate.id);
              try {
                localStorage.setItem("leads.messages.active", editingTemplate.id);
              } catch {
                // sans importance
              }
            } else toast("Copie impossible ici : sélectionne le texte et copie-le à la main.", "err");
            return ok;
          }}
          onSaved={(t) => setTemplates((list) => list.map((x) => (x.id === t.id ? t : x)))}
        />
      )}


      {callbackFor && (
        <CallbackModal
          lead={callbackFor}
          onClose={() => {
            setCallbackFor(null);
            setCancelPending(false);
          }}
          onPick={async (at, note) => {
            const l = callbackFor;
            const cancel = cancelPending;
            setCallbackFor(null);
            setCancelPending(false);
            await setStatus(l, "callback", at, note, cancel);
          }}
        />
      )}

      {booking && (
        <BookModal
          lead={booking}
          isAdmin={session.isAdmin}
          memberId={session.memberId}
          defaultCloserId={hasRole(session, "closer") && session.memberId ? session.memberId : session.isAdmin && data?.ownerMemberId ? data.ownerMemberId : (data?.defaultCloserId ?? "")}
          members={members}
          onClose={() => setBooking(null)}
          onDone={() => {
            setBooking(null);
            refresh();
          }}
        />
      )}

      {scriptFor && <ScriptModal funnel={scriptFor.funnel} lead={scriptFor.lead} onClose={() => setScriptFor(null)} />}

      {funnelsOpen && (
        <FunnelsModal
          funnels={funnels}
          reoptinFunnel={reoptinFunnel}
          onClose={() => setFunnelsOpen(false)}
          onSaved={() => {
            void loadFunnels();
            refresh();
          }}
        />
      )}
    </div>
  );
}

/* ------------------------------ Script du funnel ------------------------ */

/** Le script du funnel, avec le prenom du lead deja remplace, a copier. */
function ScriptModal({ funnel, lead, onClose }: { funnel: SalesFunnel; lead: CallLeadRow; onClose: () => void }) {
  const first = (lead.name || "").split(" ")[0] || "";
  const text = funnel.script.replace(/\{\{\s*prenom\s*\}\}|\{\{\s*prénom\s*\}\}|\{prenom\}/gi, first).replace(/\{\{\s*nom\s*\}\}|\{nom\}/gi, lead.name);
  const [done, setDone] = useState(false);
  return (
    <Modal
      open
      onClose={onClose}
      title={`Script · ${funnel.label}`}
      footer={
        <>
          <button className="btn" onClick={onClose}>Fermer</button>
          <button
            className="btn btn-primary"
            onClick={async () => {
              if (await copy(text)) {
                setDone(true);
                setTimeout(() => setDone(false), 1500);
              }
            }}
          >
            {done ? "Copié ✓" : "Copier le script"}
          </button>
        </>
      }
    >
      <pre className="whitespace-pre-wrap text-[13px] leading-relaxed" style={{ fontFamily: "inherit" }}>{text}</pre>
      <p className="dim text-[11.5px] mt-3">Dans le script, « {"{{prenom}}"} » et « {"{{nom}}"} » sont remplacés automatiquement.</p>
    </Modal>
  );
}

/* ------------------------------ Funnels (admin) ------------------------- */

function FunnelsModal({ funnels, reoptinFunnel, onClose, onSaved }: { funnels: SalesFunnel[]; reoptinFunnel: string | null; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [rows, setRows] = useState<SalesFunnel[]>(funnels.map((f) => ({ ...f })));
  const [busy, setBusy] = useState(false);
  const [reattribute, setReattribute] = useState(true);
  // null = « le premier funnel Meta Ads » (défaut), "" = ne rien changer, sinon la clé d'un funnel.
  const [reoptin, setReoptin] = useState<string | null>(reoptinFunnel);
  const set = (i: number, patch: Partial<SalesFunnel>) => setRows((r) => r.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const save = async () => {
    setBusy(true);
    try {
      const r = await api<{ rows: SalesFunnel[]; reattributed: number }>("/api/sales/funnels", { method: "PUT", body: JSON.stringify({ rows, reattribute, reoptinFunnel: reoptin }) });
      toast(`Funnels enregistrés${r.reattributed ? ` · ${r.reattributed} lead(s) réattribué(s)` : ""}.`);
      onSaved();
      onClose();
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open
      onClose={onClose}
      title="Funnels"
      wide
      footer={
        <>
          <label className="flex items-center gap-2 text-[12px] mr-auto">
            <input type="checkbox" checked={reattribute} onChange={(e) => setReattribute(e.target.checked)} />
            Réattribuer les leads d&apos;opt-in selon ces funnels
          </label>
          <button className="btn" onClick={onClose} disabled={busy}>Annuler</button>
          <button className="btn btn-primary" onClick={() => void save()} disabled={busy}>
            {busy ? <span className="spinner" /> : "Enregistrer"}
          </button>
        </>
      }
    >
      <p className="dim text-[12.5px] mb-3">
        Un funnel = une page d&apos;opt-in (ou un tag Systeme.io), un canal (Ads, organique…) et un script. Les leads dont l&apos;URL d&apos;inscription contient un des morceaux indiqués sont rangés dans ce funnel. Les leads Meta avec utm ou fbclid restent toujours en Ads.
      </p>
      <div className="flex flex-col gap-3">
        {rows.map((f, i) => (
          <div key={i} className="card-flat p-3 grid sm:grid-cols-[1fr_150px_1fr_auto] gap-2 items-start">
            <Field label="Nom">
              <input className="input !h-[34px]" value={f.label} onChange={(e) => set(i, { label: e.target.value })} placeholder="LP1 Ads" />
            </Field>
            <Field label="Canal">
              <select className="select !h-[34px]" value={f.channel} onChange={(e) => set(i, { channel: e.target.value as SourceChannel })}>
                {SOURCE_CHANNELS.filter((c) => c !== "UNKNOWN").map((c) => (
                  <option key={c} value={c}>{SOURCE_CHANNEL_LABEL[c]}</option>
                ))}
              </select>
            </Field>
            <Field label="Reconnu par (URL ou tag, virgules)">
              <input className="input !h-[34px] mono !text-[12px]" value={f.match} onChange={(e) => set(i, { match: e.target.value })} placeholder="masterclass-organique, tag-organique" />
            </Field>
            <button className="btn btn-ghost btn-sm mt-5" onClick={() => setRows((r) => r.filter((_, j) => j !== i))} title="Retirer">✕</button>
            <Field label="Script (appel / message WhatsApp)" className="sm:col-span-4">
              <textarea className="textarea !min-h-[70px] !text-[12.5px]" value={f.script} onChange={(e) => set(i, { script: e.target.value })} placeholder={"Salut {{prenom}}, c'est Mady. Je t'ai appelé suite à ton inscription à la masterclass…"} />
            </Field>
            <div className="dim text-[11px] sm:col-span-4 mono">clé : {f.key || "(générée)"}</div>
          </div>
        ))}
        <button className="btn btn-sm self-start" onClick={() => setRows((r) => [...r, { key: "", label: "", channel: "ORGANIC", match: "", script: "" }])}>
          + Funnel
        </button>
      </div>
      <div className="card-flat p-3 mt-4">
        <Field label="Réinscription dont Systeme.io ne dit pas la page → funnel">
          <select className="select !h-[34px]" value={reoptin === null ? "__ads__" : reoptin} onChange={(e) => setReoptin(e.target.value === "__ads__" ? null : e.target.value)}>
            <option value="__ads__">Le premier funnel Meta Ads (défaut)</option>
            <option value="">Ne rien changer (garder le funnel historique)</option>
            {rows.filter((f) => f.key).map((f) => (
              <option key={f.key} value={f.key}>{f.label || f.key}</option>
            ))}
          </select>
        </Field>
        <p className="dim text-[12px] mt-2">
          Un contact déjà inscrit chez Systeme.io qui se réinscrit (par exemple via la pub) arrive par le webhook avec l&apos;URL de sa première inscription, pas celle du jour. Pour avoir la page exacte, ajoute dans le funnel Systeme.io une règle d&apos;automatisation « formulaire d&apos;étape soumis → envoyer un webhook » vers <span className="mono">/api/webhooks/systemeio</span> : ce réglage ne sert alors plus.
        </p>
      </div>
    </Modal>
  );
}

/* ------------------------------ À rappeler ------------------------------ */

function CallbackModal({ lead, onClose, onPick }: { lead: CallLeadRow; onClose: () => void; onPick: (atIso: string, note: string) => Promise<void> }) {
  const defaultAt = useMemo(() => {
    const d = new Date(Date.now() + 2 * 3600_000);
    d.setMinutes(0, 0, 0);
    return isoToParisInput(d);
  }, []);
  const [at, setAt] = useState(defaultAt);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const quick = (label: string, value: () => string): ReactNode => (
    <button type="button" className="btn btn-sm" onClick={() => setAt(value())}>
      {label}
    </button>
  );
  const nextMonday = () => parisDay(((8 - parisWeekday()) % 7) || 7);
  return (
    <Modal
      open
      onClose={onClose}
      title={`Rappeler ${lead.name}`}
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={busy}>Annuler</button>
          <button
            className="btn btn-primary"
            disabled={busy || !at}
            onClick={async () => {
              setBusy(true);
              try {
                await onPick(parisToIso(at), note);
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? <span className="spinner" /> : "Noter le rappel"}
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-3.5">
        <div className="flex gap-1.5 flex-wrap">
          {quick("Dans 1 h", () => isoToParisInput(new Date(Date.now() + 3600_000)).slice(0, 14) + "00")}
          {quick("Ce soir 18 h", () => `${parisDay(0)}T18:00`)}
          {quick("Demain 10 h", () => `${parisDay(1)}T10:00`)}
          {quick("Demain 14 h", () => `${parisDay(1)}T14:00`)}
          {quick("Lundi 10 h", () => `${nextMonday()}T10:00`)}
        </div>
        <Field label="Date et heure du rappel (heure de Paris)">
          <input className="input" type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} />
        </Field>
        <Field label="Note" hint="Ce qu'il a dit, pour reprendre la conversation au bon endroit.">
          <textarea className="input w-full" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        <p className="dim text-[12px]">Il remontera en haut de la liste et dans la cloche dès que l&apos;heure sera passée.</p>
      </div>
    </Modal>
  );
}

/* ------------------------------ RDV pris ------------------------------- */

function BookModal({ lead, isAdmin, memberId, defaultCloserId, members, onClose, onDone }: { lead: CallLeadRow; isAdmin: boolean; memberId: string; defaultCloserId: string; members: PublicMember[]; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const closers = useMemo(() => members.filter((m) => hasRole(m, "closer")), [members]);
  const setters = useMemo(() => members.filter((m) => hasRole(m, "setter")), [members]);
  const defaultAt = useMemo(() => {
    const d = new Date(Date.now() + 24 * 3600_000);
    d.setMinutes(0, 0, 0);
    return isoToParisInput(d);
  }, []);
  const [at, setAt] = useState(defaultAt);
  const [closerId, setCloserId] = useState(closers.some((m) => m.id === defaultCloserId) ? defaultCloserId : "");
  const [setterId, setSetterId] = useState(lead.setterId || memberId);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const quick = (label: string, value: () => string): ReactNode => (
    <button type="button" className="btn btn-sm" onClick={() => setAt(value())}>
      {label}
    </button>
  );

  const submit = async () => {
    setBusy(true);
    try {
      await api("/api/sales/appointments", {
        method: "POST",
        body: JSON.stringify({
          leadId: lead.id,
          igUsername: lead.igUsername ?? "",
          name: lead.name,
          email: lead.email ?? "",
          phone: lead.phone ?? "",
          country: lead.country ?? "",
          timezone: lead.timezone || "Europe/Paris",
          scheduledAt: parisToIso(at),
          setterId,
          closerId,
          source: "inbound",
          setterNotes: notes,
        }),
      });
      toast(`RDV posé avec ${lead.name} le ${fmtDateTime(parisToIso(at))} (${fmtTime(parisToIso(at), "Asia/Dubai")} DXB) : il est dans l'Agenda.`);
      onDone();
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={`RDV pris avec ${lead.name}`}
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={busy}>Annuler</button>
          <button className="btn btn-primary" onClick={() => void submit()} disabled={busy || !at}>
            {busy ? <span className="spinner" /> : "Enregistrer le RDV"}
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-3.5">
        <div className="flex gap-1.5 flex-wrap">
          {quick("Demain 10 h", () => `${parisDay(1)}T10:00`)}
          {quick("Demain 14 h", () => `${parisDay(1)}T14:00`)}
          {quick("Demain 18 h", () => `${parisDay(1)}T18:00`)}
          {quick("Après-demain 10 h", () => `${parisDay(2)}T10:00`)}
        </div>
        <Field label="Date et heure du call (heure de Paris)">
          <input className="input" type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} />
        </Field>
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="Closer">
            <select className="select" value={closerId} onChange={(e) => setCloserId(e.target.value)}>
              <option value="">À attribuer plus tard</option>
              {closers.map((m) => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </select>
          </Field>
          {isAdmin && (
            <Field label="Setter">
              <select className="select" value={setterId} onChange={(e) => setSetterId(e.target.value)}>
                <option value="">—</option>
                {setters.map((m) => (
                  <option key={m.id} value={m.id}>{m.name}</option>
                ))}
              </select>
            </Field>
          )}
        </div>
        <Field label="Notes pour le closer" hint="Ce qu'il cherche, son objection, son budget…">
          <textarea className="input w-full" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
        <p className="dim text-[12px]">Le rendez-vous apparaît aussitôt dans Rendez-vous, l&apos;Agenda et la cloche (à confirmer sous 48 h).</p>
      </div>
    </Modal>
  );
}
