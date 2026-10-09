"use client";

import { useEffect, useState } from "react";
import { useMb } from "@/components/mediabuying/context";
import { Card, Field, InfoNote, PageHeader, useToast } from "@/components/ui";
import { api } from "@/lib/client";
import type { MediaBuyingSettings } from "@/lib/mediabuying/types";

type NumKey = Exclude<keyof MediaBuyingSettings, "id" | "connectionId" | "rankingMetric" | "updatedAt">;

const GROUPS: { title: string; subtitle: string; fields: { key: NumKey; label: string; hint: string; unit: "money" | "pct" | "int" }[] }[] = [
  {
    title: "Cibles de coût",
    subtitle: "Au-dessus de ces valeurs, l'entité passe en Watch puis en Weak.",
    fields: [
      { key: "targetCpl", label: "Target CPL", hint: "Coût par lead visé.", unit: "money" },
      { key: "targetCpb", label: "Target CPB", hint: "Coût par booking visé.", unit: "money" },
      { key: "targetCac", label: "Target CAC", hint: "Coût par vente visé (offre ~3 000 €).", unit: "money" },
      { key: "maxCpc", label: "Max CPC link", hint: "Au-delà, le trafic coûte trop cher.", unit: "money" },
      { key: "maxCostLpv", label: "Max cost / LPV", hint: "Coût maximal d'une landing page view.", unit: "money" },
    ],
  },
  {
    title: "Seuils de jugement",
    subtitle: "Pour ne pas couper trop tôt… ni laisser brûler du budget.",
    fields: [
      { key: "minCtr", label: "Min CTR link (%)", hint: "Sous ce CTR : Weak. Au double : Strong.", unit: "pct" },
      { key: "maxSpendWithoutLead", label: "Max spend without lead", hint: "Dépensé sans aucun lead → recommandation KILL.", unit: "money" },
      { key: "minLpvBeforeKill", label: "Min LPV before kill", hint: "En dessous, trop tôt pour juger.", unit: "int" },
      { key: "minLeadsBeforeBookingJudgement", label: "Min leads before booking judgement", hint: "Nombre de leads avant de s'inquiéter d'un zéro booking.", unit: "int" },
    ],
  },
  {
    title: "Objectifs de leads par phase",
    subtitle: "Barre de progression de chaque campagne (modifiable par campagne).",
    fields: [
      { key: "leadGoalTesting", label: "Lead goal Testing", hint: "", unit: "int" },
      { key: "leadGoalScaling", label: "Lead goal Scaling-Testing", hint: "", unit: "int" },
      { key: "leadGoalHyper", label: "Lead goal Hyper-Scaling", hint: "", unit: "int" },
    ],
  },
];

export default function MbSettingsPage() {
  const mb = useMb();
  const toast = useToast();
  const [form, setForm] = useState<MediaBuyingSettings | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!mb.connection) return setForm(null);
    void api<MediaBuyingSettings>(`/api/mediabuying/settings?connectionId=${mb.connection.id}`).then(setForm).catch((e) => toast((e as Error).message, "err"));
  }, [mb.connection, toast]);

  const save = async () => {
    if (!form || !mb.connection) return;
    setSaving(true);
    try {
      const r = await api<MediaBuyingSettings>("/api/mediabuying/settings", { method: "PATCH", body: JSON.stringify({ ...form, connectionId: mb.connection.id }) });
      setForm(r);
      toast("Réglages enregistrés. Santé et recommandations recalculées.");
      void mb.reload();
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Réglages media buying"
        subtitle={mb.connection ? `Cibles du compte « ${mb.connection.name} » (${mb.currency}).` : "Choisis un compte."}
        actions={
          <button className="btn btn-primary" onClick={() => void save()} disabled={!form || saving}>
            {saving ? <span className="spinner" /> : "Enregistrer"}
          </button>
        }
      />
      <div className="mb-4">
        <InfoNote>Ces valeurs colorent la santé et écrivent la recommandation KEEP / WATCH / KILL. Elles ne déclenchent jamais d&apos;action : couper ou scaler reste ta décision.</InfoNote>
      </div>
      {form && (
        <div className="grid lg:grid-cols-3 gap-3">
          {GROUPS.map((g) => (
            <Card key={g.title} title={g.title} subtitle={g.subtitle}>
              <div className="flex flex-col gap-3">
                {g.fields.map((f) => (
                  <Field key={f.key} label={f.label} hint={f.hint || undefined}>
                    <div className="flex items-center gap-2">
                      <input className="input num" inputMode="decimal" value={String(form[f.key])} onChange={(e) => setForm({ ...form, [f.key]: Number(e.target.value.replace(",", ".")) || 0 })} />
                      <span className="dim text-[12px] w-[40px]">{f.unit === "money" ? mb.currency : f.unit === "pct" ? "%" : ""}</span>
                    </div>
                  </Field>
                ))}
              </div>
            </Card>
          ))}
          <Card title="Top créatives" subtitle="Classement par défaut du cockpit.">
            <Field label="Classer par">
              <select className="select" value={form.rankingMetric} onChange={(e) => setForm({ ...form, rankingMetric: e.target.value as MediaBuyingSettings["rankingMetric"] })}>
                <option value="costPerBooking">Cost / Booking</option>
                <option value="bookings">Bookings</option>
                <option value="sales">Ventes</option>
                <option value="cac">CAC</option>
                <option value="roas">ROAS</option>
                <option value="cpl">CPL</option>
              </select>
            </Field>
          </Card>
          <Card title="Nommage" subtitle="Les campagnes nommées ainsi se classent toutes seules.">
            <pre className="mono text-[11.5px] leading-relaxed whitespace-pre-wrap" style={{ color: "var(--text-2)" }}>
{`[TESTING] | {offer} | ABO
[SCALING-TESTING] | {offer} | ABO
[HYPER-SCALING] | {offer} | CBO

Ad sets : {FORMAT} | BROAD | {COUNTRY}
          BROAD | FR | BATCH 01
Ads : V1, V2, V3…`}
            </pre>
          </Card>
        </div>
      )}
    </>
  );
}
