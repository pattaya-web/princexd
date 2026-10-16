"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/client";
import { fmtDateTime } from "@/lib/format";
import { FUNNELS, funnelLabel, SOURCE_CHANNEL_LABEL, SOURCE_CHANNELS } from "@/lib/sales/attribution";
import { Field, Modal, useToast } from "@/components/ui";
import type { Lead, SourceChannel } from "@/lib/types";

const CHANNEL_COLOR: Record<SourceChannel, string> = {
  META_ADS: "#006dbc",
  INSTAGRAM: "#dd2a7b",
  ORGANIC: "#16a34a",
  REFERRAL: "#b7791f",
  AFFILIATE: "#7c3aed",
  OTHER: "#64748b",
  UNKNOWN: "#9297b3",
};

export function SourceChip({ channel }: { channel: SourceChannel | "" | undefined }) {
  const c = channel || "UNKNOWN";
  return (
    <span className="badge !text-[10.5px] !py-0" style={{ color: CHANNEL_COLOR[c], borderColor: `color-mix(in srgb, ${CHANNEL_COLOR[c]} 35%, transparent)`, background: `color-mix(in srgb, ${CHANNEL_COLOR[c]} 8%, var(--surface))` }}>
      {SOURCE_CHANNEL_LABEL[c]}
    </span>
  );
}

interface MetaOption {
  id: string;
  name: string;
  parentId?: string;
  campaignId?: string;
}

/**
 * Source d'acquisition d'un lead sur sa fiche : first touch (celui qui
 * compte), last touch, booking. Modifiable uniquement a la main, avec
 * confirmation ; la modification est journalisee.
 */
/** Identifiant Meta avec son nom (quand l'instantane le connait) et un bouton Copier : l'ID reste la reference. */
function IdLine({ name, id }: { name: string; id: string }) {
  const [done, setDone] = useState(false);
  if (!id && !name) return <span>—</span>;
  return (
    <span className="flex items-center gap-1.5 min-w-0">
      <span className="truncate" title={name || id}>
        {name || <span className="mono text-[11.5px]">{id}</span>}
      </span>
      {id && (
        <>
          {name && <span className="mono dim text-[10.5px] shrink-0">{id}</span>}
          <button
            type="button"
            className="btn btn-ghost btn-sm !h-[20px] !px-1.5 !text-[10.5px] shrink-0"
            style={done ? { color: "var(--good)" } : undefined}
            title={`Copier ${id}`}
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(id);
                setDone(true);
                setTimeout(() => setDone(false), 1400);
              } catch {
                setDone(false);
              }
            }}
          >
            {done ? "✓" : "copier"}
          </button>
        </>
      )}
    </span>
  );
}

export interface AttributionMeta {
  campaignName: string;
  adsetName: string;
  adName: string;
  creative: { id: string; name: string; kind: string; thumbnailUrl: string; imageUrl: string } | null;
  syncedAt: string;
}

export interface AttributionBooking {
  provider: "iClosed" | "CRM";
  createdAt: string;
  scheduledAt: string;
  status: string;
  calendar?: string;
}

export function AttributionBlock({ lead, meta, booking, isAdmin, onChanged }: { lead: Lead; meta?: AttributionMeta | null; booking?: AttributionBooking | null; isAdmin: boolean; onChanged: (lead: Lead) => void }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [channel, setChannel] = useState<SourceChannel>(lead.sourceChannel ?? "UNKNOWN");
  const [funnel, setFunnel] = useState(lead.funnelSource ?? "");
  const [campaignId, setCampaignId] = useState(lead.campaignId ?? "");
  const [adsetId, setAdsetId] = useState(lead.adsetId ?? "");
  const [adId, setAdId] = useState(lead.adId ?? "");
  const [options, setOptions] = useState<{ campaigns: MetaOption[]; adsets: MetaOption[]; ads: MetaOption[] } | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setChannel(lead.sourceChannel ?? "UNKNOWN");
    setFunnel(lead.funnelSource ?? "");
    setCampaignId(lead.campaignId ?? "");
    setAdsetId(lead.adsetId ?? "");
    setAdId(lead.adId ?? "");
    setConfirm(false);
    // Campagnes / ad sets / ads connus du media buying, pour choisir sans retaper d'ID.
    void api<{ options: { campaigns: MetaOption[]; adsets: { id: string; name: string; campaignId: string }[]; ads: { id: string; name: string; adsetId: string; campaignId: string }[] } }>("/api/sales/business?preset=last30&groupBy=none")
      .then((r) => setOptions({ campaigns: r.options.campaigns, adsets: r.options.adsets.map((a) => ({ id: a.id, name: a.name, parentId: a.campaignId })), ads: r.options.ads.map((a) => ({ id: a.id, name: a.name, parentId: a.adsetId, campaignId: a.campaignId })) }))
      .catch(() => setOptions({ campaigns: [], adsets: [], ads: [] }));
  }, [open, lead]);

  const save = async () => {
    setSaving(true);
    try {
      const r = await api<{ lead: Lead }>(`/api/sales/leads/${lead.id}/attribution`, { method: "PATCH", body: JSON.stringify({ sourceChannel: channel, funnelSource: funnel, campaignId, adsetId, adId }) });
      toast("Source d'acquisition corrigée et journalisée.");
      onChanged(r.lead);
      setOpen(false);
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setSaving(false);
    }
  };

  const before = `${SOURCE_CHANNEL_LABEL[lead.sourceChannel ?? "UNKNOWN"]}${lead.funnelSource ? ` · ${funnelLabel(lead.funnelSource)}` : ""}`;
  const after = `${SOURCE_CHANNEL_LABEL[channel]}${funnel ? ` · ${funnelLabel(funnel)}` : ""}`;

  return (
    <div>
      <div className="label-xs mb-1.5 flex items-center justify-between">
        <span>Source d&apos;acquisition</span>
        {isAdmin && (
          <button type="button" className="link text-[11.5px] normal-case tracking-normal" onClick={() => setOpen(true)}>
            ✎ modifier l&apos;attribution
          </button>
        )}
      </div>
      <dl className="text-[12.5px] grid grid-cols-[110px_1fr] gap-y-1.5 gap-x-3">
        <dt className="dim">Canal</dt>
        <dd className="flex items-center gap-2 flex-wrap">
          <SourceChip channel={lead.sourceChannel} />
          {lead.attributionLocked && <span className="dim text-[11px]" title={`Corrigée à la main le ${fmtDateTime(lead.attributionOverriddenAt ?? "")}`}>verrouillée (manuelle)</span>}
          {!lead.attributionLocked && lead.firstTouchReliable && <span className="dim text-[11px]">fiable</span>}
        </dd>
        <dt className="dim">Funnel</dt>
        <dd>{lead.funnelSource ? funnelLabel(lead.funnelSource) : "—"}</dd>
        {(lead.firstTouchUtmCampaign || lead.firstTouchUtmContent || lead.firstTouchUtmTerm || lead.firstTouchUtmSource) && (
          <>
            <dt className="dim">UTM</dt>
            <dd className="min-w-0 text-[12px] flex flex-col gap-0.5">
              {lead.firstTouchUtmCampaign && <span className="truncate" title={lead.firstTouchUtmCampaign}><span className="dim">campagne</span> {lead.firstTouchUtmCampaign}</span>}
              {lead.firstTouchUtmContent && <span className="truncate" title={lead.firstTouchUtmContent}><span className="dim">contenu</span> {lead.firstTouchUtmContent}</span>}
              {lead.firstTouchUtmTerm && <span className="truncate" title={lead.firstTouchUtmTerm}><span className="dim">terme</span> {lead.firstTouchUtmTerm}</span>}
              {(lead.firstTouchUtmSource || lead.firstTouchUtmMedium) && <span className="dim mono text-[10.5px]">{[lead.firstTouchUtmSource, lead.firstTouchUtmMedium].filter(Boolean).join(" / ")}</span>}
            </dd>
          </>
        )}
        {(lead.sourceChannel === "META_ADS" || lead.campaignId || lead.adId) && (
          <>
            <dt className="dim">Campagne</dt>
            <dd className="min-w-0"><IdLine name={meta?.campaignName || lead.campaignName || ""} id={lead.campaignId ?? ""} /></dd>
            <dt className="dim">Ad set</dt>
            <dd className="min-w-0"><IdLine name={meta?.adsetName || lead.adsetName || ""} id={lead.adsetId ?? ""} /></dd>
            <dt className="dim">Créative</dt>
            <dd className="min-w-0">
              <IdLine name={meta?.adName || lead.adName || ""} id={lead.adId ?? ""} />
              {meta?.creative && (meta.creative.thumbnailUrl || meta.creative.imageUrl) && (
                <a href={meta.creative.imageUrl || meta.creative.thumbnailUrl} target="_blank" rel="noreferrer" className="block mt-1.5" title={`${meta.creative.name || "Créative"} (${meta.creative.kind})`}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={meta.creative.thumbnailUrl || meta.creative.imageUrl} alt={meta.creative.name || "Créative"} className="rounded-md max-h-[90px] w-auto" style={{ border: "1px solid var(--border)" }} />
                </a>
              )}
            </dd>
            {(lead.firstTouchPlacement || lead.firstTouchUtmSource || lead.firstTouchFbclid || lead.firstTouchFbc) && (
              <>
                <dt className="dim">Placement</dt>
                <dd className="text-[12px] truncate" title={[lead.firstTouchUtmSource, lead.firstTouchUtmMedium, lead.firstTouchUtmCampaign, lead.firstTouchUtmContent, lead.firstTouchUtmTerm].filter(Boolean).join(" / ")}>
                  {lead.firstTouchPlacement || "—"}
                  <span className="dim mono text-[10.5px]">
                    {[lead.firstTouchUtmSource, lead.firstTouchUtmMedium].filter(Boolean).length ? ` · ${[lead.firstTouchUtmSource, lead.firstTouchUtmMedium].filter(Boolean).join(" / ")}` : ""}
                    {lead.firstTouchFbclid || lead.firstTouchFbc ? " · clic Meta" : ""}
                  </span>
                </dd>
              </>
            )}
          </>
        )}
        {booking && (
          <>
            <dt className="dim">Booking</dt>
            <dd className="text-[12px]">
              {booking.provider} · réservé le {fmtDateTime(booking.createdAt)}
              <span className="dim"> · call {fmtDateTime(booking.scheduledAt)}{booking.calendar ? ` · ${booking.calendar.replace(/_/g, " ").toLowerCase()}` : ""}</span>
            </dd>
          </>
        )}
        <dt className="dim">First touch</dt>
        <dd className="num">{lead.firstTouchAt ? fmtDateTime(lead.firstTouchAt) : "—"}</dd>
        {lead.lastTouchSourceChannel && lead.lastTouchSourceChannel !== lead.sourceChannel && (
          <>
            <dt className="dim">Dernier contact</dt>
            <dd className="flex items-center gap-2">
              <SourceChip channel={lead.lastTouchSourceChannel} />
              <span className="dim text-[11px]">interaction, pas la source</span>
            </dd>
          </>
        )}
      </dl>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Modifier l'attribution"
        footer={
          confirm ? (
            <>
              <button className="btn" onClick={() => setConfirm(false)} disabled={saving}>Retour</button>
              <button className="btn btn-primary" onClick={() => void save()} disabled={saving}>
                {saving ? <span className="spinner" /> : "Confirmer"}
              </button>
            </>
          ) : (
            <>
              <button className="btn" onClick={() => setOpen(false)}>Annuler</button>
              <button className="btn btn-primary" onClick={() => setConfirm(true)}>Continuer</button>
            </>
          )
        }
      >
        {confirm ? (
          <p className="text-[14px] leading-relaxed">
            Vous allez modifier la source d&apos;acquisition de <strong>{lead.name}</strong> de <strong>{before}</strong> vers <strong>{after}</strong>. L&apos;attribution sera verrouillée et la modification journalisée. Confirmer ?
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            <div className="grid sm:grid-cols-2 gap-3">
              <Field label="Canal">
                <select
                  className="select"
                  value={channel}
                  onChange={(e) => {
                    const c = e.target.value as SourceChannel;
                    setChannel(c);
                    setFunnel(FUNNELS.find((f) => f.channel === c)?.key ?? "");
                  }}
                >
                  {SOURCE_CHANNELS.map((c) => (
                    <option key={c} value={c}>
                      {SOURCE_CHANNEL_LABEL[c]}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Funnel">
                <select className="select" value={funnel} onChange={(e) => setFunnel(e.target.value)}>
                  <option value="">—</option>
                  {FUNNELS.map((f) => (
                    <option key={f.key} value={f.key}>
                      {f.label}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            {channel === "META_ADS" && (
              <div className="grid sm:grid-cols-3 gap-3">
                <Field label="Campagne">
                  <select className="select" value={campaignId} onChange={(e) => { setCampaignId(e.target.value); setAdsetId(""); setAdId(""); }}>
                    <option value="">—</option>
                    {(options?.campaigns ?? []).map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Ad set">
                  <select className="select" value={adsetId} onChange={(e) => { setAdsetId(e.target.value); setAdId(""); }}>
                    <option value="">—</option>
                    {(options?.adsets ?? []).filter((a) => !campaignId || a.parentId === campaignId).map((a) => (
                      <option key={a.id} value={a.id}>{a.name}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Créative">
                  <select className="select" value={adId} onChange={(e) => setAdId(e.target.value)}>
                    <option value="">—</option>
                    {(options?.ads ?? []).filter((a) => (!adsetId || a.parentId === adsetId) && (!campaignId || a.campaignId === campaignId)).map((a) => (
                      <option key={a.id} value={a.id}>{a.name}</option>
                    ))}
                  </select>
                </Field>
              </div>
            )}
            <p className="dim text-[12px]">La source d&apos;acquisition est celle du premier contact. Un DM Instagram reçu plus tard reste une interaction : il ne change pas la source.</p>
          </div>
        )}
      </Modal>
    </div>
  );
}
