"use client";

import Link from "next/link";
import { useMemo, useState, type CSSProperties } from "react";
import { api } from "@/lib/client";
import { fmtDate, fmtDateTime, fmtMoney, relative } from "@/lib/format";
import { useSalesData } from "@/lib/sales/client";
import { Card, Empty, ErrorNote, PageHeader, Spinner, Tabs, useToast } from "@/components/ui";
import { SourceChip } from "@/components/sales/AttributionBlock";
import { LeadSheet } from "@/components/sales/LeadSheet";
import { useSales } from "@/components/sales/context";
import { BOOKING_STATUS_LABEL } from "@/lib/sales/business-types";
import { IclosedOptInsList } from "@/components/sales/IclosedOptIns";
import type { OverviewLeadRow } from "@/app/api/sales/leads/overview/route";
import type { IclosedContactRow } from "@/app/api/sales/iclosed/contacts/route";
import type { SourceChannel } from "@/lib/types";

const ACCENT = { "--accent": "#006dbc", "--accent-hover": "#005a9c", "--accent-soft": "#e6f1fa", "--accent-ring": "#9cc9ea", "--grad-accent": "linear-gradient(135deg, #006dbc 0%, #2a8fd8 100%)" } as CSSProperties;

type View = "organic" | "ads" | "all" | "iclosed";

const VIA_LABEL: Record<OverviewLeadRow["via"], string> = {
  utm: "utm du lien",
  meta: "clic Meta (fbclid / IDs)",
  page: "page d'opt-in",
  manual: "corrigé à la main",
  none: "inconnue",
};

const fold = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

/**
 * Leads : tous les inscrits Systeme.io avec leur provenance (page, funnel,
 * utm, clic Meta) et ce qu'ils sont devenus, puis les contacts iClosed qui
 * ont rempli le formulaire du calendrier sans réserver. La liste à appeler
 * (statuts, relances) vit à part, dans « Leads à appeler ».
 */
export default function LeadsOverviewPage() {
  const { session, version } = useSales();
  const toast = useToast();
  const [view, setView] = useState<View>("iclosed");
  const [query, setQuery] = useState("");
  const [sheetId, setSheetId] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);

  const { data, loading, error, reload } = useSalesData<{ rows: OverviewLeadRow[]; byChannel: Partial<Record<SourceChannel, number>>; lastSyncAt: string; syncError: string; currency: string }>(`/api/sales/leads/overview?v=${version}`);
  const { data: ic, loading: icLoading, reload: reloadIc } = useSalesData<{ rows: IclosedContactRow[]; fetchedAt: string; error: string }>(`/api/sales/iclosed/contacts?v=${version}`);
  const [icForcing, setIcForcing] = useState(false);

  const sync = async () => {
    setSyncing(true);
    try {
      const r = await api<{ examined: number; created: number; known: number }>("/api/sales/systemeio", { method: "POST" });
      toast(r.created ? `${r.created} nouveau${r.created > 1 ? "x" : ""} lead${r.created > 1 ? "s" : ""} récupéré${r.created > 1 ? "s" : ""}.` : `${r.examined} contact${r.examined > 1 ? "s" : ""} lu${r.examined > 1 ? "s" : ""} chez Systeme.io, ${r.known} déjà en base.`);
      void reload();
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setSyncing(false);
    }
  };

  const refreshIc = async () => {
    setIcForcing(true);
    try {
      await api("/api/sales/iclosed/contacts?force=1");
      void reloadIc();
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setIcForcing(false);
    }
  };

  const copy = async (v: string) => {
    try {
      await navigator.clipboard.writeText(v);
      toast("Copié.");
    } catch {
      toast("Copie impossible ici.", "err");
    }
  };

  const rows = data?.rows ?? [];
  const currency = data?.currency ?? "EUR";
  const isAds = (r: OverviewLeadRow) => r.sourceChannel === "META_ADS";
  const q = fold(query.trim());
  const matches = (hay: string[]) => !q || q.split(/\s+/).every((w) => fold(hay.join(" ")).includes(w));

  const shown = useMemo(() => {
    const base = view === "ads" ? rows.filter(isAds) : view === "organic" ? rows.filter((r) => !isAds(r)) : rows;
    return base.filter((r) => matches([r.name, r.email, r.phone, r.handle, r.igUsername, r.page, r.funnelLabel, r.utm.source, r.utm.campaign, r.utm.content]));
  }, [rows, view, q]); // eslint-disable-line react-hooks/exhaustive-deps

  const icRows = useMemo(() => (ic?.rows ?? []).filter((r) => matches([r.name, r.email, r.phone, r.country, r.leadName, r.notes, r.setterName])), [ic, q]); // eslint-disable-line react-hooks/exhaustive-deps

  const counts = { organic: rows.filter((r) => !isAds(r)).length, ads: rows.filter(isAds).length, all: rows.length, iclosed: ic?.rows.length ?? 0 };

  return (
    <div style={ACCENT}>
      <PageHeader
        title="Leads"
        subtitle={data?.lastSyncAt ? `Inscrits Systeme.io synchronisés ${relative(data.lastSyncAt)} · provenance de chaque lead et ce qu'il est devenu.` : "Tous les inscrits Systeme.io et leur provenance, plus ceux qui ont rempli le formulaire iClosed sans réserver."}
        actions={
          <>
            <Link href="/sales/leads/appels" className="btn" title="L'ancienne liste de travail des setters : statuts d'appel, relances, scripts">
              Liste à appeler
            </Link>
            {session.isAdmin && (
              <Link href="/sales/utm" className="btn" title="Créer des liens traqués">
                Liens UTM
              </Link>
            )}
            <button className="btn btn-primary" onClick={() => void sync()} disabled={syncing} title="Relire Systeme.io tout de suite">
              {syncing ? "Vérification…" : "Vérifier Systeme.io"}
            </button>
          </>
        }
      />

      {(error || data?.syncError) && <ErrorNote>{error || `Synchro Systeme.io : ${data?.syncError}`}</ErrorNote>}

      <div className="flex flex-wrap items-center gap-2 mb-3">
        <Tabs
          value={view}
          onChange={setView}
          options={[
            { value: "iclosed", label: "iClosed sans RDV", count: counts.iclosed },
            { value: "organic", label: "Organique", count: counts.organic },
            { value: "ads", label: "Ads", count: counts.ads },
            { value: "all", label: "Systeme.io · tous", count: counts.all },
          ]}
        />
        <div className="relative ml-auto w-full sm:w-[280px]">
          <input className="input !h-[32px] !text-[13px] pr-7" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Nom, téléphone, email, Instagram, page, campagne…" />
          {query && (
            <button type="button" className="absolute right-1.5 top-1/2 -translate-y-1/2 dim text-[12px] px-1" onClick={() => setQuery("")} title="Effacer">
              ✕
            </button>
          )}
        </div>
      </div>

      {view === "iclosed" ? (
        <Card
          title="Formulaire iClosed rempli, pas de rendez-vous"
          subtitle={ic?.fetchedAt ? `Lu chez iClosed ${relative(ic.fetchedAt)} · les 300 contacts les plus récents, hors RDV pris. À rappeler ou à relancer : ils étaient à un clic de réserver.` : "iClosed garde les coordonnées même quand la personne ne va pas au bout."}
          padded={false}
          actions={
            <button className="btn btn-sm" onClick={() => void refreshIc()} disabled={icForcing}>
              {icForcing ? "…" : "Actualiser"}
            </button>
          }
        >
          {ic?.error ? (
            <div className="p-4">
              <ErrorNote>{ic.error}</ErrorNote>
            </div>
          ) : icLoading && !ic ? (
            <div className="p-4">
              <Spinner label="Lecture d'iClosed…" />
            </div>
          ) : (
            <IclosedOptInsList rows={icRows} onChanged={() => void reloadIc()} onOpen={setSheetId} />
          )}
        </Card>
      ) : (
        <Card padded={false}>
          {loading && !data ? (
            <div className="p-4">
              <Spinner label="Chargement…" />
            </div>
          ) : shown.length === 0 ? (
            <Empty>{q ? "Aucun lead ne correspond." : "Aucun inscrit Systeme.io dans cette vue."}</Empty>
          ) : (
            <div className="scroll-x">
              <table className="table">
                <thead>
                  <tr>
                    <th>Inscription</th>
                    <th>Lead</th>
                    <th>Contact</th>
                    <th>Provenance</th>
                    <th>Détail</th>
                    <th>Devenu</th>
                    <th className="!text-right">CA</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((r) => (
                    <tr key={r.leadId}>
                      <td className="num text-[12px] whitespace-nowrap">
                        {fmtDateTime(r.optInAt)}
                        {r.optInCount > 1 && <div className="dim text-[10.5px]">{r.optInCount} inscriptions</div>}
                      </td>
                      <td className="min-w-[150px]">
                        <button type="button" className="text-[13px] font-medium hover:underline text-left" onClick={() => setSheetId(r.leadId)} title="Ouvrir la fiche (notes, historique)">
                          {r.name}
                        </button>
                        {r.country && <div className="dim text-[11px]">{r.country}</div>}
                      </td>
                      <td className="text-[12px] whitespace-nowrap">
                        {r.phone ? (
                          <button type="button" className="link num" onClick={() => void copy(r.phone)} title="Copier le numéro">
                            {r.phone}
                          </button>
                        ) : (
                          <span className="dim">—</span>
                        )}
                        <div className="dim text-[11px] truncate max-w-[200px]">{[r.email, r.igUsername ? `@${r.igUsername}` : ""].filter(Boolean).join(" · ")}</div>
                      </td>
                      <td className="min-w-[160px]">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <SourceChip channel={r.sourceChannel} />
                          <span className="text-[12.5px] font-medium">{r.funnelLabel}</span>
                        </div>
                        {r.page && (
                          <div className="dim text-[11px] mono truncate max-w-[220px]" title={r.sourceUrl}>
                            {r.page}
                          </div>
                        )}
                      </td>
                      <td className="text-[11.5px] min-w-[170px]">
                        <div className="dim">via {VIA_LABEL[r.via]}</div>
                        {(r.utm.source || r.utm.campaign) && (
                          <div className="mono truncate max-w-[260px]" title={`utm_source=${r.utm.source} utm_medium=${r.utm.medium} utm_campaign=${r.utm.campaign} utm_content=${r.utm.content} utm_term=${r.utm.term}`}>
                            {[r.utm.source, r.utm.medium, r.utm.campaign, r.utm.content].filter(Boolean).join(" · ")}
                          </div>
                        )}
                        {r.campaignName && <div className="truncate max-w-[260px]">{r.campaignName}</div>}
                        {r.adName && <div className="dim truncate max-w-[260px]">{r.adName}</div>}
                      </td>
                      <td className="text-[12px] whitespace-nowrap">
                        {r.saleStatus === "WON" ? (
                          <span style={{ color: "var(--good)", fontWeight: 600 }}>Closé{r.soldAt ? ` · ${fmtDate(r.soldAt)}` : ""}</span>
                        ) : r.bookingStatus ? (
                          <>
                            {BOOKING_STATUS_LABEL[r.bookingStatus]}
                            {r.appointmentAt && <div className="dim text-[11px]">{fmtDateTime(r.appointmentAt)}</div>}
                          </>
                        ) : (
                          <span className="dim">{r.callStatus ? `appel : ${r.callStatus}` : "pas de RDV"}</span>
                        )}
                        {r.setterName && <div className="dim text-[10.5px]">setter {r.setterName}</div>}
                      </td>
                      <td className="num text-right text-[12.5px] font-semibold">{r.revenue ? fmtMoney(r.revenue, currency) : <span className="dim">—</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      <LeadSheet id={sheetId} onClose={() => setSheetId(null)} onChanged={() => void reload()} />
    </div>
  );
}
