"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import { useMb } from "@/components/mediabuying/context";
import { BudgetModal, CompareModal, ConfirmModal, CreativeModal, DuplicateModal, PhaseBadge, copyText } from "@/components/mediabuying/bits";
import { ColumnsPicker, DEFAULT_COLUMNS, EntityTable } from "@/components/mediabuying/EntityTable";
import { Card, ErrorNote, Modal, PageHeader, Spinner, Tabs, useToast } from "@/components/ui";
import { useLocalState } from "@/lib/client";
import { PHASE_LABEL, PHASES, type EntityLevel, type EntityRow, type MetricKey, type Phase, type WinnerStatus } from "@/lib/mediabuying/types";

type PhaseFilter = Phase | "all";

/**
 * Campaigns → Ad sets → Ads, comme Ads Manager : un clic sur une campagne
 * montre ses ad sets, un clic sur un ad set ses ads, avec le fil d'Ariane.
 * Les onglets du haut changent de niveau en gardant le perimetre.
 */
function CampaignsInner() {
  const mb = useMb();
  const router = useRouter();
  const params = useSearchParams();
  const toast = useToast();
  const o = mb.overview;

  const level = (params.get("level") as EntityLevel) || (params.get("adset") ? "ad" : params.get("campaign") ? "adset" : "campaign");
  const campaignId = params.get("campaign") ?? "";
  const adsetId = params.get("adset") ?? "";
  const [phase, setPhase] = useState<PhaseFilter>("all");
  const [columns, setColumns] = useLocalState<Record<EntityLevel, MetricKey[]>>("mb.columns.v2", DEFAULT_COLUMNS);
  const [pickCols, setPickCols] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [confirm, setConfirm] = useState<{ title: string; body: string; danger?: boolean; run: () => Promise<void> } | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [budgetRow, setBudgetRow] = useState<EntityRow | null>(null);
  const [creative, setCreative] = useState<EntityRow | null>(null);
  const [compare, setCompare] = useState(false);
  const [dupRow, setDupRow] = useState<EntityRow | null>(null);
  const [notesRow, setNotesRow] = useState<EntityRow | null>(null);
  const [notes, setNotes] = useState("");

  // Changer de perimetre vide la selection : elle n'a de sens que dans une liste.
  useEffect(() => setSelected(new Set()), [level, campaignId, adsetId]);

  const go = (next: { level?: EntityLevel; campaign?: string; adset?: string }) => {
    const p = new URLSearchParams();
    const lv = next.level ?? level;
    const c = next.campaign ?? (lv === "campaign" ? "" : campaignId);
    const a = next.adset ?? (lv === "ad" ? adsetId : "");
    if (lv !== "campaign") p.set("level", lv);
    if (c) p.set("campaign", c);
    if (a && lv === "ad") p.set("adset", a);
    router.push(`/mediabuying/campaigns${p.size ? `?${p}` : ""}`);
  };

  const campaign = o?.campaigns.find((c) => c.id === campaignId) ?? null;
  const adset = o?.adsets.find((a) => a.id === adsetId) ?? null;

  const rows = useMemo<EntityRow[]>(() => {
    if (!o) return [];
    let list: EntityRow[] = level === "campaign" ? o.campaigns : level === "adset" ? o.adsets : o.ads;
    if (level !== "campaign" && campaignId) list = list.filter((r) => r.campaignId === campaignId);
    if (level === "ad" && adsetId) list = list.filter((r) => r.parentId === adsetId);
    if (phase !== "all") list = list.filter((r) => r.phase === phase);
    return list;
  }, [o, level, campaignId, adsetId, phase]);

  const counts = (ph: PhaseFilter) => (o ? (ph === "all" ? o.campaigns.length : o.campaigns.filter((c) => c.phase === ph).length) : 0);

  const withBusy = async (ids: string[], fn: () => Promise<void>) => {
    setBusy((b) => new Set([...b, ...ids]));
    try {
      await fn();
    } finally {
      setBusy((b) => {
        const n = new Set(b);
        for (const id of ids) n.delete(id);
        return n;
      });
    }
  };

  const toggleStatus = (r: EntityRow) => {
    const next = r.status === "active" ? "PAUSED" : "ACTIVE";
    setConfirm({
      title: next === "PAUSED" ? `Mettre en pause ${r.name} ?` : `Activer ${r.name} ?`,
      body: next === "PAUSED" ? `Tu vas mettre en pause : ${r.name}. La diffusion s'arrête chez Meta.` : `Tu vas activer : ${r.name}. La diffusion reprend chez Meta.`,
      danger: next === "PAUSED",
      run: () => withBusy([r.id], async () => {
        await mb.act(`/api/mediabuying/entities/${r.id}/status`, { method: "PATCH", body: JSON.stringify({ connectionId: mb.connection!.id, level: r.level, status: next }) }, `${r.name} ${next === "PAUSED" ? "mis en pause" : "activé"}.`);
      }),
    });
  };

  const bulkStatus = (next: "ACTIVE" | "PAUSED") => {
    const list = rows.filter((r) => selected.has(r.id) && (next === "PAUSED" ? r.status === "active" : r.status === "paused"));
    if (!list.length) return toast("Rien à faire sur la sélection.", "err");
    setConfirm({
      title: `${next === "PAUSED" ? "Mettre en pause" : "Activer"} ${list.length} élément${list.length > 1 ? "s" : ""} ?`,
      body: list.map((r) => r.name).join(", "),
      danger: next === "PAUSED",
      run: () => withBusy(list.map((r) => r.id), async () => {
        for (const r of list) {
          await mb.act(`/api/mediabuying/entities/${r.id}/status`, { method: "PATCH", body: JSON.stringify({ connectionId: mb.connection!.id, level: r.level, status: next }) });
        }
        toast(`${list.length} élément${list.length > 1 ? "s" : ""} ${next === "PAUSED" ? "mis en pause" : "activé(s)"}.`);
      }),
    });
  };

  const copyPostIds = async () => {
    const list = rows.filter((r) => selected.has(r.id) && r.postId);
    if (!list.length) return toast("Aucun Post ID dans la sélection.", "err");
    if (await copyText(list.map((r) => r.postId).join("\n"))) {
      toast(`${list.length} Post ID copié${list.length > 1 ? "s" : ""} ✓`);
      mb.logEvent("ad", list.map((r) => r.id).join(","), list.map((r) => r.name).join(", "), "postId.copyMany", `${list.length} Post IDs copiés : ${list.map((r) => r.name).join(", ")}`);
    }
  };

  const markWinners = async (v: WinnerStatus) => {
    const list = rows.filter((r) => selected.has(r.id));
    for (const r of list) await mb.act("/api/mediabuying/internal", { method: "PATCH", body: JSON.stringify({ connectionId: mb.connection!.id, adId: r.id, winnerStatus: v }) });
    toast(`${list.length} ad${list.length > 1 ? "s" : ""} marquée${list.length > 1 ? "s" : ""} « ${v || "—"} ».`);
  };

  const exportCsv = () => {
    const list = rows.filter((r) => !selected.size || selected.has(r.id));
    const cols = columns[level];
    const head = ["name", "status", "phase", "budget", ...cols, "postId", "health", "verdict", "reason"];
    const lines = list.map((r) => [r.name, r.status, r.phase, r.budget?.amount ?? "", ...cols.map((k) => r.metrics[k] ?? ""), r.postId, r.health, r.recommendation.verdict, r.recommendation.reason].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","));
    const blob = new Blob([[head.join(","), ...lines].join("\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `mediabuying-${level}-${o?.range.from}-${o?.range.to}.csv`;
    a.click();
    mb.logEvent(level, "", "", "export.csv", `Export CSV de ${list.length} ${level}(s)`);
  };

  const promoteToScaling = () => {
    const list = rows.filter((r) => selected.has(r.id) && r.level === "ad");
    if (!list.length) return toast("Sélectionne des ads à promouvoir.", "err");
    router.push(`/mediabuying/builder?phase=scaling-testing&ads=${list.map((r) => r.id).join(",")}`);
  };

  const selectedRows = rows.filter((r) => selected.has(r.id));
  const crumbs = (
    <nav className="flex items-center gap-1.5 text-[12.5px] flex-wrap">
      <button className={`link ${level === "campaign" ? "font-semibold" : ""}`} onClick={() => go({ level: "campaign", campaign: "", adset: "" })}>
        Toutes les campagnes
      </button>
      {campaign && (
        <>
          <span className="dim">›</span>
          <button className={`link ${level === "adset" ? "font-semibold" : ""}`} onClick={() => go({ level: "adset", campaign: campaign.id, adset: "" })}>
            {campaign.name}
          </button>
        </>
      )}
      {adset && level === "ad" && (
        <>
          <span className="dim">›</span>
          <span className="font-semibold">{adset.name}</span>
        </>
      )}
    </nav>
  );

  return (
    <>
      <PageHeader
        title="Campagnes"
        subtitle="Campaigns → Ad sets → Ads. Clique une ligne pour descendre d'un niveau ; chaque action chez Meta demande confirmation."
        actions={
          <div className="flex items-center gap-1.5 flex-wrap">
            {PHASES.map((p) => (
              <button key={p} type="button" className={`btn btn-sm ${phase === p ? "btn-primary" : ""}`} onClick={() => setPhase(phase === p ? "all" : p)}>
                {PHASE_LABEL[p]} <span className="num opacity-70">{counts(p)}</span>
              </button>
            ))}
          </div>
        }
      />
      {mb.error && <div className="mb-3"><ErrorNote>{mb.error}</ErrorNote></div>}
      {!o && <Spinner label="Chargement…" />}
      {o && (
        <Card padded={false}>
          <div className="flex flex-wrap items-center gap-2 px-3 sm:px-4 py-2.5" style={{ borderBottom: "1px solid var(--border)" }}>
            <Tabs
              value={level}
              onChange={(lv) => go({ level: lv })}
              options={[
                { value: "campaign", label: "Campaigns", count: o.campaigns.length },
                { value: "adset", label: "Ad sets", count: campaignId ? o.adsets.filter((a) => a.campaignId === campaignId).length : o.adsets.length },
                { value: "ad", label: "Ads", count: adsetId ? o.ads.filter((a) => a.parentId === adsetId).length : campaignId ? o.ads.filter((a) => a.campaignId === campaignId).length : o.ads.length },
              ]}
            />
            {crumbs}
            <div className="ml-auto relative flex items-center gap-1.5">
              {phase !== "all" && (
                <span className="flex items-center gap-1">
                  <PhaseBadge phase={phase} />
                  <button className="btn btn-ghost btn-sm !h-[24px]" onClick={() => setPhase("all")}>
                    ✕
                  </button>
                </span>
              )}
              <button className="btn btn-sm" onClick={() => setPickCols((v) => !v)}>
                Colonnes
              </button>
              <ColumnsPicker open={pickCols} onClose={() => setPickCols(false)} value={columns[level]} onChange={(v) => setColumns({ ...columns, [level]: v })} />
            </div>
          </div>

          {selected.size > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 px-3 sm:px-4 py-2" style={{ background: "var(--accent-soft)", borderBottom: "1px solid var(--border)" }}>
              <span className="text-[12.5px] font-semibold num mr-1">{selected.size} sélectionné{selected.size > 1 ? "s" : ""}</span>
              <button className="btn btn-sm" onClick={() => bulkStatus("PAUSED")}>Pause</button>
              <button className="btn btn-sm" onClick={() => bulkStatus("ACTIVE")}>Activate</button>
              {level === "ad" && (
                <>
                  <button className="btn btn-sm" onClick={() => void copyPostIds()}>Copy Post IDs</button>
                  <button className="btn btn-sm" onClick={promoteToScaling}>Move / Duplicate to Scaling</button>
                  <button className="btn btn-sm" onClick={() => void markWinners("winner")}>⭐ Mark winner</button>
                  <button className="btn btn-sm" onClick={() => void markWinners("loser")}>Mark loser</button>
                  <button className="btn btn-sm" disabled={selected.size < 2 || selected.size > 5} onClick={() => setCompare(true)} title="2 à 5 ads">Compare</button>
                </>
              )}
              <button className="btn btn-sm" onClick={exportCsv}>Export</button>
              <button className="btn btn-ghost btn-sm ml-auto" onClick={() => setSelected(new Set())}>Tout désélectionner</button>
            </div>
          )}

          <EntityTable
            level={level}
            rows={rows}
            currency={o.currency}
            columns={columns[level]}
            conversionsConnected={o.conversionsConnected}
            selected={selected}
            onSelect={setSelected}
            onOpen={level === "campaign" ? (r) => go({ level: "adset", campaign: r.id, adset: "" }) : level === "adset" ? (r) => go({ level: "ad", campaign: r.campaignId, adset: r.id }) : (r) => setCreative(r)}
            onToggleStatus={toggleStatus}
            onBudget={setBudgetRow}
            onCreative={setCreative}
            onWinner={(r, v) => void mb.act("/api/mediabuying/internal", { method: "PATCH", body: JSON.stringify({ connectionId: mb.connection!.id, adId: r.id, winnerStatus: v }) }, `${r.name} : ${v || "tag retiré"}.`)}
            onNotes={(r) => {
              setNotesRow(r);
              setNotes(r.notes);
            }}
            onDuplicate={setDupRow}
            onCopiedPostId={(r) => mb.logEvent("ad", r.id, r.name, "postId.copy", `Post ID de ${r.name} copié`)}
            busy={busy}
            showDeltas={phase === "scaling-testing"}
            subtitle={
              level === "ad" && !adsetId
                ? (r) => `${o.campaigns.find((c) => c.id === r.campaignId)?.name.replace(/\s*\|\s*/g, " · ") ?? ""} › ${o.adsets.find((a) => a.id === r.parentId)?.name ?? ""}`
                : level === "adset" && !campaignId
                  ? (r) => o.campaigns.find((c) => c.id === r.campaignId)?.name ?? ""
                  : undefined
            }
          />
          <div className="px-4 py-2 dim text-[11px]">
            {rows.length} ligne{rows.length > 1 ? "s" : ""} · période {o.range.from} → {o.range.to} · CTR et CPC sont des CTR lien / CPC lien.
          </div>
        </Card>
      )}

      <ConfirmModal
        open={confirm !== null}
        title={confirm?.title ?? ""}
        danger={confirm?.danger}
        busy={confirmBusy}
        onClose={() => setConfirm(null)}
        onConfirm={async () => {
          if (!confirm) return;
          setConfirmBusy(true);
          try {
            await confirm.run();
          } finally {
            setConfirmBusy(false);
            setConfirm(null);
          }
        }}
      >
        {confirm?.body}
      </ConfirmModal>
      <BudgetModal
        row={budgetRow}
        currency={mb.currency}
        open={budgetRow !== null}
        onClose={() => setBudgetRow(null)}
        onApply={async (amount) => {
          if (!budgetRow || !mb.connection) return;
          await withBusy([budgetRow.id], async () => {
            await mb.act(`/api/mediabuying/entities/${budgetRow.id}/budget`, { method: "PATCH", body: JSON.stringify({ connectionId: mb.connection!.id, level: budgetRow.level, amount, type: budgetRow.budget?.type ?? "daily" }) }, `Budget de ${budgetRow.name} mis à jour.`);
          });
        }}
      />
      <CreativeModal
        row={creative}
        open={creative !== null}
        onClose={() => setCreative(null)}
        currency={mb.currency}
        campaignName={o?.campaigns.find((c) => c.id === creative?.campaignId)?.name ?? ""}
        adsetName={o?.adsets.find((a) => a.id === creative?.parentId)?.name ?? ""}
        onCopied={() => creative && mb.logEvent("ad", creative.id, creative.name, "postId.copy", `Post ID de ${creative.name} copié`)}
      />
      <CompareModal rows={selectedRows.slice(0, 5)} open={compare} onClose={() => setCompare(false)} currency={mb.currency} />
      <DuplicateModal
        row={dupRow}
        open={dupRow !== null}
        onClose={() => setDupRow(null)}
        parents={dupRow?.level === "ad" ? (o?.adsets ?? []).map((a) => ({ id: a.id, name: a.name })) : dupRow?.level === "adset" ? (o?.campaigns ?? []).map((c) => ({ id: c.id, name: c.name })) : []}
        onSubmit={async (target) => {
          if (!dupRow || !mb.connection) return;
          await mb.act("/api/mediabuying/duplicate", { method: "POST", body: JSON.stringify({ connectionId: mb.connection.id, level: dupRow.level, id: dupRow.id, ...target }) }, `${dupRow.name} dupliqué (en pause).`);
        }}
      />
      <Modal
        open={notesRow !== null}
        onClose={() => setNotesRow(null)}
        title={notesRow ? `Note interne · ${notesRow.name}` : ""}
        footer={
          <>
            <button className="btn" onClick={() => setNotesRow(null)}>Annuler</button>
            <button
              className="btn btn-primary"
              onClick={async () => {
                if (!notesRow || !mb.connection) return;
                await mb.act("/api/mediabuying/internal", { method: "PATCH", body: JSON.stringify({ connectionId: mb.connection.id, adId: notesRow.id, notes }) }, "Note enregistrée.");
                setNotesRow(null);
              }}
            >
              Enregistrer
            </button>
          </>
        }
      >
        <textarea className="textarea" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="« 1 lead → 1 booking », « hook à retester »…" autoFocus />
        <p className="dim text-[11.5px] mt-2">Interne à l&apos;outil : Meta n&apos;est pas modifié.</p>
      </Modal>
    </>
  );
}

export default function CampaignsPage() {
  return (
    <Suspense fallback={<Spinner label="Chargement…" />}>
      <CampaignsInner />
    </Suspense>
  );
}
