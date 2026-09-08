"use client";

import { useMemo } from "react";
import { EntityView } from "@/components/EntityView";
import { Card, StatTile } from "@/components/ui";
import { useCollection } from "@/lib/client";
import { POSTS } from "@/lib/schemas";
import { fmtCompact, fmtInt, label, WEEKDAYS } from "@/lib/format";
import type { Post } from "@/lib/types";

/** Bande des 14 prochains jours : ce qui est prévu, et les trous à combler. */
function PlanningStrip({ posts }: { posts: Post[] }) {
  const days = useMemo(() => {
    const out: { date: Date; iso: string; items: Post[] }[] = [];
    for (let i = 0; i < 14; i++) {
      const d = new Date();
      d.setHours(0, 0, 0, 0);
      d.setDate(d.getDate() + i);
      const iso = d.toISOString().slice(0, 10);
      out.push({
        date: d,
        iso,
        items: posts.filter((p) => (p.plannedAt || p.publishedAt || "").slice(0, 10) === iso),
      });
    }
    return out;
  }, [posts]);

  return (
    <div className="scroll-x pb-1">
      <div className="flex gap-2 min-w-min">
        {days.map(({ date, iso, items }, i) => {
          const empty = items.length === 0;
          return (
            <div
              key={iso}
              className="w-[122px] shrink-0 rounded-[10px] p-2"
              style={{
                background: "var(--surface-2)",
                border: `1px solid ${empty ? "var(--border)" : "color-mix(in srgb, var(--accent) 35%, transparent)"}`,
              }}
            >
              <div className="flex items-baseline justify-between mb-1.5">
                <span className="text-[11.5px] font-semibold">
                  {i === 0 ? "Aujourd'hui" : WEEKDAYS[date.getDay()].slice(0, 3)}
                </span>
                <span className="dim text-[11px] num">{date.getDate()}</span>
              </div>
              {empty ? (
                <p className="dim text-[11px] py-1.5">Rien de prévu</p>
              ) : (
                <div className="flex flex-col gap-1">
                  {items.slice(0, 3).map((p) => (
                    <div
                      key={p.id}
                      className="text-[10.5px] leading-snug px-1.5 py-1 rounded-[5px] line-clamp-2"
                      style={{ background: "var(--surface)", border: "1px solid var(--border)" }}
                      title={p.title}
                    >
                      {p.title || "Sans titre"}
                    </div>
                  ))}
                  {items.length > 3 && <span className="dim text-[10.5px]">+{items.length - 3}</span>}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function ContenuPage() {
  const { rows } = useCollection<Post>("posts");

  return (
    <>
      <Card title="Les 14 prochains jours" subtitle="Renseigne « Prévu le » sur un post pour qu'il apparaisse ici." className="mb-4">
        <PlanningStrip posts={rows} />
      </Card>

      <EntityView
        spec={POSTS}
        title="Calendrier de contenu"
        subtitle="De l'idée au post publié. Une fois publié, remplis les stats : c'est ce qui alimente « Quoi spammer »."
        summary={(all) => {
          const posts = all as unknown as Post[];
          const published = posts.filter((p) => p.status === "publie");
          const withStats = published.filter((p) => p.views > 0);
          const pipeline = posts.filter((p) => p.status !== "publie");
          return (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <StatTile label="En production" value={fmtInt(pipeline.length)} hint={pipeline.length ? `${label(pipeline[0].status)} en tête` : undefined} />
              <StatTile label="Publiés" value={fmtInt(published.length)} />
              <StatTile
                label="Vues cumulées"
                value={fmtCompact(withStats.reduce((a, p) => a + p.views, 0))}
                hint={`${withStats.length} posts mesurés`}
              />
              <StatTile
                label="Stats manquantes"
                value={fmtInt(published.length - withStats.length)}
                hint="Posts publiés sans chiffres"
                accent={published.length - withStats.length > 0 ? "var(--warning)" : "var(--good)"}
              />
            </div>
          );
        }}
      />
    </>
  );
}
