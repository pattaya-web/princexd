"use client";

import Link from "next/link";
import { useState } from "react";
import { api } from "@/lib/client";
import { fmtDualDateTime, fmtMoney } from "@/lib/format";
import { Card, useToast } from "@/components/ui";
import type { AttentionBlock, AttentionItem, GoalBlock } from "@/app/api/sales/dashboard/route";

/* ------------------------------- À traiter ------------------------------ */

/**
 * Les trois listes qui faussent les chiffres tant qu'on ne les regle pas :
 * calls passes sans resultat, calls imminents non confirmes, calls sans
 * closer. Chaque ligne ouvre la fiche. La carte disparait quand tout est
 * propre : pas de carte vide qui rassure a tort.
 */
export function AttentionCard({ block }: { block: AttentionBlock }) {
  type Group = { key: keyof AttentionBlock; title: string; hint: string; tone: string; items: AttentionItem[] };
  const all: Group[] = [
    {
      key: "noOutcome",
      title: "Résultat à saisir",
      hint: "Calls passés toujours « posé » ou « confirmé » : le show rate ment tant qu'ils traînent.",
      tone: "var(--critical)",
      items: block.noOutcome,
    },
    {
      key: "unconfirmed",
      title: "À confirmer sous 48 h",
      hint: "Le lead n'a pas confirmé sa présence : ce sont les no-shows de demain.",
      tone: "var(--warning)",
      items: block.unconfirmed,
    },
    {
      key: "unassigned",
      title: "Sans closer",
      hint: "Calls à venir que personne ne prendra tant qu'ils ne sont pas attribués.",
      tone: "var(--serious)",
      items: block.unassigned,
    },
  ];
  const groups = all.filter((g) => g.items.length > 0);

  if (!groups.length) return null;

  return (
    <div className={`mb-4 grid gap-3 ${groups.length === 1 ? "" : groups.length === 2 ? "lg:grid-cols-2" : "lg:grid-cols-3"}`}>
      {groups.map((g) => (
        <Card
          key={g.key}
          padded={false}
          title={
            <span className="flex items-center gap-2 !text-[14px]">
              <span className="w-[8px] h-[8px] rounded-full shrink-0" style={{ background: g.tone }} />
              {g.title}
              <span className="badge !text-[10.5px] !py-0 num">{g.items.length}</span>
            </span>
          }
          subtitle={g.hint}
        >
          <ul>
            {g.items.map((it, i) => (
              <li key={it.id} style={{ borderBottom: i < g.items.length - 1 ? "1px solid var(--border)" : "none" }}>
                <Link
                  href={`/sales/rendez-vous?open=${it.id}`}
                  className="px-3.5 py-2 flex items-center justify-between gap-3 text-[12.5px] hover:bg-[var(--surface-2)]"
                >
                  <span className="font-medium truncate">{it.leadName}</span>
                  <span className="dim num text-[11.5px] shrink-0">
                    {fmtDualDateTime(it.at)} · {it.who}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      ))}
    </div>
  );
}

/* ---------------------------- Objectif du mois -------------------------- */

/**
 * Cash du mois civil face a l'objectif, avec la projection au rythme actuel.
 *
 * L'objectif se modifie sur place : c'est l'admin qui le fixe, et il le lit
 * ici tous les jours. Sans objectif, la carte propose d'en fixer un et
 * montre quand meme le cash du mois et celui du mois dernier.
 */
export function GoalCard({ goal, currency, onSaved }: { goal: GoalBlock; currency: string; onSaved: () => void }) {
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(goal.target || ""));
  const [busy, setBusy] = useState(false);

  const pct = goal.target > 0 ? Math.min((goal.cash / goal.target) * 100, 100) : 0;
  const onTrack = goal.target > 0 && goal.projected >= goal.target;
  const remaining = Math.max(0, goal.target - goal.cash);
  const daysLeft = Math.max(1, goal.daysInMonth - goal.dayOfMonth + 1);

  const save = async () => {
    setBusy(true);
    try {
      await api("/api/sales/goal", { method: "PATCH", body: JSON.stringify({ target: Number(draft) || 0 }) });
      toast(Number(draft) > 0 ? "Objectif du mois enregistré." : "Objectif retiré.");
      setEditing(false);
      onSaved();
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card
      title="Objectif du mois"
      subtitle={`Cash encaissé depuis le 1er, échéances comprises · jour ${goal.dayOfMonth} sur ${goal.daysInMonth}`}
      actions={
        editing ? (
          <>
            <input
              className="input !w-[140px] !h-[30px] num"
              type="number"
              min={0}
              step={500}
              value={draft}
              placeholder="ex. 20000"
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void save();
                if (e.key === "Escape") setEditing(false);
              }}
              autoFocus
            />
            <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => void save()}>
              Enregistrer
            </button>
            <button className="btn btn-sm" disabled={busy} onClick={() => setEditing(false)}>
              Annuler
            </button>
          </>
        ) : (
          <button
            className="btn btn-sm"
            onClick={() => {
              setDraft(String(goal.target || ""));
              setEditing(true);
            }}
          >
            {goal.target > 0 ? "Modifier l'objectif" : "Fixer un objectif"}
          </button>
        )
      }
    >
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 mb-3">
        <span
          className="text-[28px] sm:text-[32px] font-semibold num leading-none"
          style={{ letterSpacing: "-0.035em", color: "var(--emerald)" }}
        >
          {fmtMoney(goal.cash, currency)}
        </span>
        {goal.target > 0 ? (
          <span className="dim text-[13px] num">
            sur {fmtMoney(goal.target, currency)} · {pct.toFixed(0)} %
          </span>
        ) : (
          <span className="dim text-[13px]">aucun objectif fixé</span>
        )}
        <span className="dim text-[12px] num ml-auto">mois dernier : {fmtMoney(goal.lastMonth, currency)}</span>
      </div>

      {goal.target > 0 && (
        <>
          <div className="rounded-[6px] overflow-hidden" style={{ height: 10, background: "var(--surface-3)" }}>
            <div
              className="h-full rounded-[6px] transition-[width]"
              style={{
                width: `${Math.max(pct, goal.cash > 0 ? 1.5 : 0)}%`,
                background: onTrack ? "var(--emerald)" : "var(--grad-accent)",
              }}
            />
          </div>
          <div className="flex flex-wrap justify-between gap-2 mt-2 text-[12px]">
            <span style={{ color: onTrack ? "var(--good)" : "var(--text-2)" }}>
              {onTrack ? "✓ " : ""}Projection fin de mois au rythme actuel :{" "}
              <strong className="num">{fmtMoney(goal.projected, currency)}</strong>
            </span>
            {remaining > 0 ? (
              <span className="dim num">
                Reste {fmtMoney(remaining, currency)} · {fmtMoney(remaining / daysLeft, currency)} par jour sur {daysLeft} jour
                {daysLeft > 1 ? "s" : ""}
              </span>
            ) : (
              <span className="num" style={{ color: "var(--good)" }}>
                Objectif atteint 🎉
              </span>
            )}
          </div>
        </>
      )}
    </Card>
  );
}
