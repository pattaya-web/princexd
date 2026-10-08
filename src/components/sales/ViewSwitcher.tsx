"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/client";
import { forgetSession, useSession } from "@/lib/sales/client";
import type { PublicMember } from "@/lib/sales/repo";
import { hasRole } from "@/lib/sales/roles";
import type { StudentAccessRow } from "@/lib/formation";

/**
 * Bascule entre les trois vues du tool : admin, setter, closer.
 *
 * Outil de construction, pose en bas de la barre laterale. Il evite de jongler
 * entre deux navigateurs pour verifier ce que voit reellement un membre.
 *
 * L'apercu n'est pas une vue degradee cote interface : le serveur emet un vrai
 * jeton de setter ou de closer, avec exactement ses droits. Si une donnee
 * apparait en apercu, c'est qu'elle apparaitrait aussi pour de vrai — c'est ce
 * qui en fait un test valable et pas une maquette.
 */
/**
 * Ouvre l'espace d'un membre, dans un metier donne, puis recharge le tool.
 *
 * Partage avec la page Comptes (« Voir son espace »). Un apercu en cours n'a
 * que les droits du membre incarne : on repasse d'abord par l'admin, sinon
 * passer d'un membre a l'autre echouerait en 403.
 */
export async function enterView(memberId: string, role: "setter" | "closer", impersonated: boolean) {
  if (impersonated) {
    await api("/api/sales/session", { method: "DELETE" });
  }
  await api("/api/sales/session/view-as", {
    method: "POST",
    body: JSON.stringify({ memberId, role }),
  });
  forgetSession();
  // Rechargement complet plutot que router.refresh : le middleware doit
  // rejouer ses redirections avec le nouveau cookie, et tous les caches
  // memoire des collections doivent repartir de zero.
  window.location.href = "/sales";
}

export function ViewSwitcher() {
  const { session } = useSession();
  const [members, setMembers] = useState<PublicMember[]>([]);
  const [students, setStudents] = useState<StudentAccessRow[]>([]);
  const [busy, setBusy] = useState("");

  // On ne charge l'annuaire que pour qui peut s'en servir.
  const canSwitch = session?.isAdmin || session?.impersonated;

  useEffect(() => {
    if (!canSwitch) return;
    let alive = true;
    api<{ members: PublicMember[] }>("/api/sales/members")
      .then((d) => {
        if (alive) setMembers(d.members);
      })
      .catch(() => {});
    // Les eleves avec un acces : pour ouvrir la plateforme dans leur peau.
    // En apercu (jeton d'un membre), cet appel est refuse : on l'ignore.
    api<{ students: StudentAccessRow[] }>("/api/formation/access")
      .then((d) => {
        if (alive) setStudents(d.students.filter((s) => s.hasPassword));
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [canSwitch]);

  if (!session || !canSwitch) return null;

  /**
   * Membre incarne pour un role donne.
   *
   * Tri alphabetique et non ordre de la base : sans cela, creer un nouveau
   * setter changerait silencieusement qui l'on incarne d'un jour a l'autre.
   */
  const firstOf = (role: "setter" | "closer") =>
    members
      .filter((m) => hasRole(m, role) && m.status !== "inactif")
      .sort((a, b) => a.name.localeCompare(b.name, "fr"))[0];

  const viewAs = async (role: "setter" | "closer", memberId?: string) => {
    const target = memberId ? members.find((m) => m.id === memberId) : firstOf(role);
    if (!target) return;
    setBusy(role);
    try {
      await enterView(target.id, role, Boolean(session.impersonated));
    } finally {
      setBusy("");
    }
  };

  /** L'espace de la VA outreach : un jeton « va » en apercu, puis sa page. */
  const viewAsVa = async () => {
    setBusy("va");
    try {
      if (session.impersonated) await api("/api/sales/session", { method: "DELETE" });
      await api("/api/sales/session/view-as", { method: "POST", body: JSON.stringify({ role: "va" }) });
      forgetSession();
      window.location.href = "/va/outreach";
    } finally {
      setBusy("");
    }
  };

  /*
   * Tous les comptes, un choix par metier : « Noa H · closer » et « Noa H ·
   * setter » sont deux entrees. Les boutons Setter / Closer restent un
   * raccourci vers le premier compte de chaque metier ; cette liste sert
   * quand on veut verifier ce que voit UNE personne precise.
   */
  const choices = members
    .filter((m) => m.status !== "inactif")
    .sort((a, b) => a.name.localeCompare(b.name, "fr"))
    .flatMap((m) =>
      (["setter", "closer"] as const)
        .filter((r) => hasRole(m, r))
        .map((r) => ({ key: `${m.id}:${r}`, memberId: m.id, role: r, label: `${m.name} · ${r}` })),
    );
  const currentKey = session.impersonated ? `${session.memberId}:${session.role}` : "";

  /** La plateforme de formation dans la peau d'un eleve precis. */
  const viewAsStudent = async (studentId: string) => {
    setBusy("student");
    try {
      if (session.impersonated) await api("/api/sales/session", { method: "DELETE" });
      await api("/api/sales/session/view-as", { method: "POST", body: JSON.stringify({ role: "student", studentId }) });
      forgetSession();
      window.location.href = "/formation";
    } finally {
      setBusy("");
    }
  };
  const firstStudent = students.slice().sort((a, b) => a.name.localeCompare(b.name, "fr"))[0];

  const backToAdmin = async () => {
    setBusy("admin");
    try {
      await api("/api/sales/session", { method: "DELETE" });
      forgetSession();
      window.location.href = "/sales";
    } finally {
      setBusy("");
    }
  };

  const current: "admin" | "setter" | "closer" | "va" | "student" = session.isAdmin
    ? "admin"
    : session.role === "va"
      ? "va"
      : session.role === "student"
        ? "student"
        : session.role === "closer"
          ? "closer"
          : "setter";

  const options: { key: "admin" | "setter" | "closer" | "va" | "student"; label: string; name?: string }[] = [
    { key: "admin", label: "Admin", name: "Moi" },
    { key: "setter", label: "Setter", name: firstOf("setter")?.name },
    { key: "closer", label: "Closer", name: firstOf("closer")?.name },
    { key: "va", label: "VA", name: "Outreach Instagram" },
    { key: "student", label: "Élève", name: firstStudent?.name },
  ];

  return (
    <div
      className="rounded-[10px] px-2.5 py-2 mb-2.5"
      style={{ background: "var(--surface-2)", border: "1px solid var(--border)" }}
    >
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <span className="label-xs">Vue</span>
        {session.impersonated && (
          <span className="badge badge-warn !text-[9.5px] !py-0">Aperçu</span>
        )}
      </div>

      <div className="flex gap-0.5 p-0.5 rounded-[7px]" style={{ background: "var(--surface-3)" }}>
        {options.map((o) => {
          const active = o.key === current;
          // Pas de membre de ce role en base : le bouton n'a rien a montrer.
          const disabled = o.key !== "admin" && !o.name;
          return (
            <button
              key={o.key}
              disabled={disabled || Boolean(busy)}
              title={disabled ? `Aucun ${o.label.toLowerCase()} créé` : o.name}
              onClick={() =>
                o.key === "admin"
                  ? void backToAdmin()
                  : o.key === "va"
                    ? void viewAsVa()
                    : o.key === "student"
                      ? firstStudent && void viewAsStudent(firstStudent.id)
                      : void viewAs(o.key)
              }
              className="flex-1 h-[24px] rounded-[5px] text-[11px] font-medium transition-colors"
              style={{
                background: active ? "var(--surface)" : "transparent",
                color: active ? "var(--text)" : disabled ? "var(--text-3)" : "var(--text-2)",
                boxShadow: active ? "var(--shadow)" : "none",
                opacity: disabled ? 0.45 : 1,
                cursor: disabled ? "not-allowed" : "pointer",
              }}
            >
              {busy === o.key ? "…" : o.label}
            </button>
          );
        })}
      </div>

      {/* Le compte precis a incarner, quel que soit son metier. */}
      {(choices.length > 0 || students.length > 0) && (
        <select
          className="select select-xs !text-[11px] mt-1.5"
          value={session.role === "student" && session.impersonated ? `student:${session.memberId}` : currentKey}
          disabled={Boolean(busy)}
          onChange={(e) => {
            const v = e.target.value;
            if (v.startsWith("student:")) return void viewAsStudent(v.slice("student:".length));
            const c = choices.find((x) => x.key === v);
            if (c) void viewAs(c.role, c.memberId);
            else void backToAdmin();
          }}
        >
          <option value="">Voir comme…</option>
          {choices.map((c) => (
            <option key={c.key} value={c.key}>
              {c.label}
            </option>
          ))}
          {students
            .slice()
            .sort((a, b) => a.name.localeCompare(b.name, "fr"))
            .map((s) => (
              <option key={`student:${s.id}`} value={`student:${s.id}`}>
                {s.name} · élève
              </option>
            ))}
        </select>
      )}

      {/* Qui l'on incarne : sans ce rappel, on oublie qu'on est en apercu et on
          s'etonne de ne plus voir la moitie du tool. */}
      <div className="dim text-[10.5px] mt-1.5 truncate">
        {current === "admin"
          ? "Accès complet"
          : current === "va"
            ? "Dans la peau de la VA (outreach)"
            : current === "student"
              ? `Dans la peau de ${session.memberName} (élève)`
              : `Dans la peau de ${session.memberName} (${session.role})`}
      </div>
    </div>
  );
}
