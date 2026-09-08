"use client";

import { useEffect, useMemo, useState } from "react";
import { api, useCollection } from "@/lib/client";
import { GoalGauge, LineChart, SERIES } from "@/components/charts";
import { Card, Empty, ErrorNote, Field, PageHeader, Spinner, StatTile, Tabs, useToast } from "@/components/ui";
import { followerSeries, projectGoal } from "@/lib/analytics";
import { fmtCompact, fmtDate, fmtInt, todayISO } from "@/lib/format";
import type { FollowerPoint, Settings } from "@/lib/types";

type Range = "30" | "90" | "all";

export default function CroissancePage() {
  const { rows, loading, create, patch, destroy } = useCollection<FollowerPoint>("followers");
  const toast = useToast();

  const [settings, setSettings] = useState<Settings | null>(null);
  const [range, setRange] = useState<Range>("30");
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    date: todayISO(),
    followers: "",
    reach: "",
    profileVisits: "",
    linkClicks: "",
    accountsEngaged: "",
  });

  useEffect(() => {
    void api<Settings>("/api/settings").then(setSettings).catch(() => setSettings(null));
  }, []);

  const series = useMemo(() => followerSeries(rows), [rows]);
  const goal = useMemo(
    () => projectGoal(rows, settings?.followersGoal ?? 10000, settings?.followersStart ?? 9500),
    [rows, settings],
  );

  const windowed = useMemo(() => {
    if (range === "all") return series;
    const n = Number(range);
    return series.slice(-n);
  }, [series, range]);

  const last7 = series.slice(-7);
  const gained7 = last7.length >= 2 ? last7[last7.length - 1].followers - last7[0].followers : 0;

  const save = async () => {
    if (!form.followers.trim()) {
      setError("Le nombre d'abonnés est obligatoire.");
      return;
    }
    setError(null);
    const payload = {
      date: form.date,
      followers: Number(form.followers),
      reach: Number(form.reach || 0),
      profileVisits: Number(form.profileVisits || 0),
      linkClicks: Number(form.linkClicks || 0),
      accountsEngaged: Number(form.accountsEngaged || 0),
      notes: "",
    };
    try {
      // Un seul relevé par date : on écrase celui du jour s'il existe déjà.
      const existing = rows.find((r) => r.date === form.date);
      if (existing) await patch(existing.id, payload);
      else await create(payload);
      setForm({ date: todayISO(), followers: "", reach: "", profileVisits: "", linkClicks: "", accountsEngaged: "" });
      toast(existing ? "Relevé du jour mis à jour." : "Relevé enregistré.");
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <>
      <PageHeader
        title="Croissance"
        subtitle="Un relevé par jour. C'est la seule saisie manuelle vraiment indispensable du tool — elle nourrit l'objectif et les projections."
        actions={
          <Tabs
            value={range}
            onChange={setRange}
            options={[
              { value: "30", label: "30 j" },
              { value: "90", label: "90 j" },
              { value: "all", label: "Tout" },
            ]}
          />
        }
      />

      <div className="grid lg:grid-cols-[1fr_320px] gap-4 items-start">
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <StatTile
              label="Abonnés"
              value={fmtInt(goal.current)}
              trend={series.length >= 2 ? series[series.length - 1].delta : undefined}
              hint="Dernier relevé"
            />
            <StatTile
              label="7 derniers jours"
              value={`${gained7 >= 0 ? "+" : ""}${fmtInt(gained7)}`}
              hint={last7.length >= 2 ? `du ${fmtDate(last7[0].date)} à aujourd'hui` : "Pas assez de relevés"}
              accent={gained7 > 0 ? "var(--good)" : gained7 < 0 ? "var(--critical)" : undefined}
            />
            <StatTile
              label="Rythme actuel"
              value={`${goal.perDay >= 0 ? "+" : ""}${goal.perDay.toFixed(1).replace(".", ",")}`}
              hint="abonnés / jour, sur 14 relevés"
            />
            <StatTile
              label="Reste à faire"
              value={fmtInt(goal.remaining)}
              hint={
                goal.daysLeft !== null
                  ? `≈ ${goal.daysLeft} jours à ce rythme`
                  : goal.remaining === 0
                    ? "Objectif atteint 🎉"
                    : "Rythme trop faible pour projeter"
              }
              accent={goal.remaining === 0 ? "var(--good)" : undefined}
            />
          </div>

          <Card title="Courbe d'abonnés" subtitle={`${windowed.length} relevés affichés`}>
            {windowed.length < 2 ? (
              <Empty>Ajoute au moins deux relevés pour voir la courbe.</Empty>
            ) : (
              <LineChart
                points={windowed.map((p) => ({ label: fmtDate(p.date), values: [p.followers] }))}
                series={[{ name: "Abonnés", color: SERIES[0] }]}
                format={fmtCompact}
              />
            )}
          </Card>

          <Card title="Portée et trafic" subtitle="Comptes touchés, visites de profil et clics sur le lien en bio.">
            {windowed.length < 2 ? (
              <Empty>Renseigne la portée dans tes relevés pour alimenter ce graphique.</Empty>
            ) : (
              <LineChart
                points={windowed.map((p) => ({
                  label: fmtDate(p.date),
                  values: [p.reach, p.profileVisits, p.linkClicks],
                }))}
                series={[
                  { name: "Comptes touchés", color: SERIES[0] },
                  { name: "Visites de profil", color: SERIES[1] },
                  { name: "Clics sur le lien", color: SERIES[2] },
                ]}
                area={false}
                format={fmtCompact}
              />
            )}
          </Card>

          <Card title="Historique" padded={false}>
            {loading ? (
              <div className="p-4"><Spinner label="Chargement…" /></div>
            ) : !rows.length ? (
              <Empty>Aucun relevé pour l&apos;instant.</Empty>
            ) : (
              <div className="scroll-x">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Abonnés</th>
                      <th>Variation</th>
                      <th>Touchés</th>
                      <th>Visites</th>
                      <th>Clics</th>
                      <th style={{ width: 50 }} />
                    </tr>
                  </thead>
                  <tbody>
                    {[...series].reverse().map((p) => {
                      const row = rows.find((r) => r.date === p.date);
                      return (
                        <tr key={p.date}>
                          <td className="num">{fmtDate(p.date)}</td>
                          <td className="num font-semibold">{fmtInt(p.followers)}</td>
                          <td
                            className="num"
                            style={{ color: p.delta > 0 ? "var(--good)" : p.delta < 0 ? "var(--critical)" : "var(--text-3)" }}
                          >
                            {p.delta > 0 ? "+" : ""}
                            {p.delta || "—"}
                          </td>
                          <td className="num muted">{p.reach ? fmtCompact(p.reach) : "—"}</td>
                          <td className="num muted">{p.profileVisits ? fmtInt(p.profileVisits) : "—"}</td>
                          <td className="num muted">{p.linkClicks ? fmtInt(p.linkClicks) : "—"}</td>
                          <td>
                            {row && (
                              <button
                                className="btn btn-sm btn-danger"
                                onClick={() => void destroy(row.id)}
                                aria-label="Supprimer"
                              >
                                ✕
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>

        <div className="flex flex-col gap-4">
          <Card title="Objectif">
            <GoalGauge
              current={goal.current}
              goal={goal.goal}
              start={goal.start}
              caption={
                goal.remaining === 0 ? (
                  <span style={{ color: "var(--good)" }}>Objectif atteint. Fixe la barre plus haut dans Réglages.</span>
                ) : goal.daysLeft !== null ? (
                  <>
                    Encore <strong>{fmtInt(goal.remaining)}</strong> abonnés. À {goal.perDay.toFixed(1).replace(".", ",")}{" "}
                    par jour, tu y es dans <strong>{goal.daysLeft} jours</strong>
                    {goal.etaISO && <> — vers le {fmtDate(goal.etaISO)}</>}.
                  </>
                ) : (
                  <>
                    Encore <strong>{fmtInt(goal.remaining)}</strong> abonnés. Ton rythme sur les 14 derniers relevés ne
                    permet pas de projeter une date : il faut accélérer la production.
                  </>
                )
              }
            />
          </Card>

          <Card title="Relevé du jour" subtitle="Recopie les chiffres depuis les stats Instagram.">
            <div className="flex flex-col gap-3">
              <Field label="Date">
                <input className="input" type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
              </Field>
              <Field label="Abonnés">
                <input
                  className="input num"
                  type="number"
                  placeholder="9500"
                  value={form.followers}
                  onChange={(e) => setForm({ ...form, followers: e.target.value })}
                />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Comptes touchés">
                  <input className="input num" type="number" value={form.reach} onChange={(e) => setForm({ ...form, reach: e.target.value })} />
                </Field>
                <Field label="Visites profil">
                  <input className="input num" type="number" value={form.profileVisits} onChange={(e) => setForm({ ...form, profileVisits: e.target.value })} />
                </Field>
                <Field label="Clics lien">
                  <input className="input num" type="number" value={form.linkClicks} onChange={(e) => setForm({ ...form, linkClicks: e.target.value })} />
                </Field>
                <Field label="Comptes engagés">
                  <input className="input num" type="number" value={form.accountsEngaged} onChange={(e) => setForm({ ...form, accountsEngaged: e.target.value })} />
                </Field>
              </div>
              {error && <ErrorNote>{error}</ErrorNote>}
              <button className="btn btn-primary" onClick={() => void save()}>Enregistrer le relevé</button>
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}
