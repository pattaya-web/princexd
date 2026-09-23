"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/client";
import { forgetSession, useSession } from "@/lib/sales/client";
import type { PublicMember } from "@/lib/sales/repo";
import { hasRole } from "@/lib/sales/roles";

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
export function ViewSwitcher() {
  const { session } = useSession();
  const [members, setMembers] = useState<PublicMember[]>([]);
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

  const viewAs = async (role: "setter" | "closer") => {
    const target = firstOf(role);
    if (!target) return;
    setBusy(role);
    try {
      /*
       * Un apercu n'a que les droits du membre incarne : il ne peut donc pas
       * en ouvrir un autre. On repasse d'abord par l'admin, sinon passer de
       * la vue setter a la vue closer echouerait en 403.
       */
      if (session.impersonated) {
        await api("/api/sales/session", { method: "DELETE" });
      }
      await api("/api/sales/session/view-as", {
        method: "POST",
        body: JSON.stringify({ memberId: target.id }),
      });
      forgetSession();
      // Rechargement complet plutot que router.refresh : le middleware doit
      // rejouer ses redirections avec le nouveau cookie, et tous les caches
      // memoire des collections doivent repartir de zero.
      window.location.href = "/sales";
    } finally {
      setBusy("");
    }
  };

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

  const current: "admin" | "setter" | "closer" = session.isAdmin
    ? "admin"
    : session.role === "closer"
      ? "closer"
      : "setter";

  const options: { key: "admin" | "setter" | "closer"; label: string; name?: string }[] = [
    { key: "admin", label: "Admin", name: "Moi" },
    { key: "setter", label: "Setter", name: firstOf("setter")?.name },
    { key: "closer", label: "Closer", name: firstOf("closer")?.name },
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
              onClick={() => (o.key === "admin" ? void backToAdmin() : void viewAs(o.key))}
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

      {/* Qui l'on incarne : sans ce rappel, on oublie qu'on est en apercu et on
          s'etonne de ne plus voir la moitie du tool. */}
      <div className="dim text-[10.5px] mt-1.5 truncate">
        {current === "admin" ? "Accès complet" : `Dans la peau de ${session.memberName}`}
      </div>
    </div>
  );
}
