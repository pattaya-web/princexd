"use client";

import { useState } from "react";
import Link from "next/link";
import { api } from "@/lib/client";
import { fmtDate, fmtInt, fmtMoney, fmtTime, label } from "@/lib/format";
import { periodQuery, useSalesData } from "@/lib/sales/client";
import { COMMERCIAL_ROLES, type CommercialRole } from "@/lib/sales/roles";
import { Card, Empty, ErrorNote, Field, InfoNote, Modal, PageHeader, Spinner, useToast } from "@/components/ui";
import { PeriodPicker } from "@/components/sales/bits";
import {
  blankCommission,
  CommissionFields,
  previewCommission,
  type CommissionDraft,
} from "@/components/sales/CommissionFields";
import { IclosedMapping } from "@/components/sales/IclosedMapping";
import { enterView } from "@/components/sales/ViewSwitcher";
import { ShiftPlanner } from "@/components/sales/ShiftPlanner";
import { useSales } from "@/components/sales/context";
import { describeRule, type LedgerRow } from "@/lib/sales/commissions";
import type { CommissionRule, TeamMember } from "@/lib/types";

interface MemberRow {
  id: string;
  name: string;
  role: TeamMember["role"];
  roles: CommercialRole[];
  status: TeamMember["status"];
  email: string;
  username: string;
  joinedAt: string;
  hasAccessCode: boolean;
  hasPassword: boolean;
  canLogin: boolean;
  rule?: CommissionRule | null;
  rules?: Partial<Record<CommercialRole, CommissionRule | null>>;
}

/** Type de compte : un commercial cumule un ou deux metiers, les autres n'en ont pas. */
type Kind = "commercial" | "admin" | "monteur" | "assistant";

const ROLE_NAMES: Record<CommercialRole, string> = { setter: "Setter", closer: "Closer" };

/** Mot de passe lisible, sans caracteres ambigus, assez long pour ne pas se deviner. */
function suggestPassword() {
  const alphabet = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < 10; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return out;
}

/** Identifiant propose depuis le nom : « Noa H » → « noa.h ». */
function suggestUsername(name: string) {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, ".")
    .replace(/^\.+|\.+$/g, "")
    .slice(0, 32);
}

const blankPerRole = (): Record<CommercialRole, CommissionDraft> => ({
  setter: blankCommission("setter"),
  closer: blankCommission("closer"),
});

/** Regle en vigueur d'un membre pour un metier, quelle que soit la forme recue. */
const ruleOf = (m: MemberRow, role: CommercialRole): CommissionRule | null =>
  m.rules?.[role] ?? (m.roles.length === 1 ? (m.rule ?? null) : null);

/** Brouillon de formulaire a partir d'une regle existante. */
const draftFrom = (rule: CommissionRule | null, role: CommercialRole): CommissionDraft =>
  rule
    ? {
        type: rule.type,
        pct: String(rule.pct),
        fixed: String(rule.fixed),
        monthly: String(rule.monthlyFixed ?? 0),
        basis: rule.basis,
        onlyQualified: rule.onlyQualified,
        effectiveFrom: new Date().toISOString().slice(0, 10),
      }
    : blankCommission(role);

/**
 * Panneau d'administration de l'equipe commerciale.
 *
 * Une ligne par personne, l'essentiel seulement : qui, quel metier, quel
 * tarif, ce qu'elle rapporte et ce qu'on lui doit. Le reste — planning,
 * acces, suppression — vit dans la fiche.
 *
 * Un membre peut etre setter ET closer : il a alors un tarif par metier et
 * apparait dans les deux classements. On le retire quand on veut — « Inactif »
 * coupe l'acces en gardant l'historique, « Supprimer » l'efface pour de bon.
 */
export default function TeamAccountsPage() {
  const { reloadMembers, bump, period, setPeriod, version } = useSales();
  const toast = useToast();

  const { data, loading, error, reload } = useSalesData<{ members: MemberRow[]; currency: string }>(
    `/api/sales/members?v=${version}`,
  );

  // Les performances viennent du grand livre : c'est la meme source que la page
  // Commissions, donc les deux ecrans ne peuvent pas afficher des chiffres
  // differents pour la meme personne.
  const { data: ledger } = useSalesData<{ rows: LedgerRow[] }>(
    `/api/sales/commissions?${periodQuery(period.period, period.from, period.to, { v: String(version) })}`,
  );

  // Heures pointees sur la periode, et qui est en session en ce moment.
  const { data: work, reload: reloadWork } = useSalesData<{ totals: { memberId: string; hours: number; sessions: number; openSince: string }[] }>(
    `/api/sales/work?${periodQuery(period.period, period.from, period.to, { v: String(version) })}`,
  );
  const workOf = (id: string) => work?.totals.find((t) => t.memberId === id);

  // Mon compte dans l'equipe (reglage), pour me proposer comme closer.
  const { data: settings, reload: reloadSettings } = useSalesData<{ salesOwnerMemberId?: string }>(`/api/settings?v=${version}`);
  const ownerMemberId = settings?.salesOwnerMemberId ?? "";
  const saveOwnerMember = async (id: string) => {
    try {
      await api("/api/settings", { method: "PATCH", body: JSON.stringify({ salesOwnerMemberId: id }) });
      toast(id ? "Compte associé : tes calls te seront proposés par défaut." : "Association retirée.");
      void reloadSettings();
    } catch (e) {
      toast((e as Error).message, "err");
    }
  };
  const closeSession = async (m: MemberRow) => {
    if (!window.confirm(`Terminer la session en cours de ${m.name} ?`)) return;
    try {
      await api("/api/sales/work", { method: "POST", body: JSON.stringify({ action: "stop", memberId: m.id }) });
      toast("Session clôturée.");
      void reloadWork();
    } catch (e) {
      toast((e as Error).message, "err");
    }
  };

  const [editing, setEditing] = useState<MemberRow | null>(null);
  const [creating, setCreating] = useState(false);
  const [ruleFor, setRuleFor] = useState<{ member: MemberRow; role: CommercialRole } | null>(null);
  const [deleting, setDeleting] = useState<MemberRow | null>(null);
  const [saving, setSaving] = useState(false);
  const [created, setCreated] = useState<{ name: string; username: string; password: string } | null>(null);
  const [planningFor, setPlanningFor] = useState<MemberRow | null>(null);

  /* Formulaire de compte */
  const [name, setName] = useState("");
  const [kind, setKind] = useState<Kind>("commercial");
  const [roles, setRoles] = useState<CommercialRole[]>(["setter"]);
  const [status, setStatus] = useState<TeamMember["status"]>("actif");
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [usernameTouched, setUsernameTouched] = useState(false);
  const [password, setPassword] = useState("");
  const [commissions, setCommissions] = useState<Record<CommercialRole, CommissionDraft>>(blankPerRole());
  const [commission, setCommission] = useState<CommissionDraft>(blankCommission("setter"));

  const currency = data?.currency ?? "USD";
  const members = data?.members ?? [];

  /*
   * Un setter-closer a deux lignes de grand livre : on les additionne pour
   * la vue d'ensemble, le detail par metier vit dans Commissions.
   */
  const perf = new Map<string, { appointments: number; sales: number; cash: number; due: number }>();
  for (const r of ledger?.rows ?? []) {
    const p = perf.get(r.memberId) ?? { appointments: 0, sales: 0, cash: 0, due: 0 };
    p.appointments += r.appointments;
    p.sales += r.sales;
    p.cash += r.cashCollected;
    p.due += r.due;
    perf.set(r.memberId, p);
  }

  const activeRoles: CommercialRole[] = kind === "commercial" ? roles : [];
  const paysCommission = activeRoles.length > 0;

  const toggleRole = (r: CommercialRole) => {
    setRoles((prev) => {
      const next = prev.includes(r) ? prev.filter((x) => x !== r) : [...prev, r];
      // Au moins un metier : un commercial sans metier n'existe pas.
      return next.length ? COMMERCIAL_ROLES.filter((x) => next.includes(x)) : prev;
    });
  };

  const fillForm = (m: MemberRow | null) => {
    setName(m?.name ?? "");
    setKind(m ? (m.roles.length ? "commercial" : (m.role as Kind)) : "commercial");
    setRoles(m?.roles.length ? m.roles : ["setter"]);
    setStatus(m?.status ?? "actif");
    setEmail(m?.email ?? "");
    setUsername(m?.username ?? "");
    setUsernameTouched(Boolean(m?.username));
    setPassword(m ? "" : suggestPassword());
    setCommissions(blankPerRole());
  };

  const openCreate = () => {
    fillForm(null);
    setCreating(true);
  };

  const openEdit = (m: MemberRow) => {
    fillForm(m);
    setEditing(m);
  };

  /** L'identifiant suit le nom tant qu'on ne l'a pas retouche a la main. */
  const changeName = (v: string) => {
    setName(v);
    if (!usernameTouched) setUsername(suggestUsername(v));
  };

  const accountPayload = () => ({
    name,
    status,
    email,
    ...(kind === "commercial" ? { roles } : { role: kind }),
  });

  const onboard = async () => {
    if (!name.trim()) return toast("Le nom est obligatoire.", "err");
    if (!username.trim()) return toast("L'identifiant est obligatoire.", "err");
    if (password.length < 6) return toast("Le mot de passe doit faire au moins 6 caractères.", "err");
    setSaving(true);
    try {
      await api("/api/sales/members", {
        method: "POST",
        body: JSON.stringify({
          ...accountPayload(),
          username,
          password,
          // Le compte et sa remuneration partent ensemble, un tarif par metier :
          // impossible de creer un setter qui ne toucherait rien parce qu'on a
          // oublie l'etape 2.
          ...(paysCommission
            ? {
                commissions: Object.fromEntries(
                  activeRoles.map((r) => {
                    const c = commissions[r];
                    return [
                      r,
                      {
                        type: c.type,
                        pct: Number(c.pct) || 0,
                        fixed: Number(c.fixed) || 0,
                        monthlyFixed: Number(c.monthly) || 0,
                        basis: c.basis,
                        onlyQualified: c.onlyQualified,
                        effectiveFrom: c.effectiveFrom,
                        currency,
                      },
                    ];
                  }),
                ),
              }
            : {}),
        }),
      });
      // Le mot de passe ne se reaffiche jamais ensuite : on le montre une fois,
      // en grand, pour qu'il soit transmis avant de fermer.
      setCreated({ name, username: username.trim().toLowerCase(), password });
      setCreating(false);
      void reload();
      reloadMembers();
      bump();
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setSaving(false);
    }
  };

  const saveMember = async () => {
    if (!editing || !name.trim()) return toast("Le nom est obligatoire.", "err");
    if (password && password.length < 6) return toast("Le mot de passe doit faire au moins 6 caractères.", "err");
    setSaving(true);
    try {
      await api("/api/sales/members", {
        method: "PATCH",
        // Un mot de passe vide veut dire « ne change rien » : sans cela,
        // ouvrir la fiche pour renommer quelqu'un lui couperait l'acces.
        body: JSON.stringify({
          id: editing.id,
          ...accountPayload(),
          username,
          ...(password ? { password } : {}),
        }),
      });
      toast("Compte mis à jour.");
      setEditing(null);
      void reload();
      reloadMembers();
      bump();
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setSaving(false);
    }
  };

  const removeMember = async () => {
    if (!deleting) return;
    setSaving(true);
    try {
      await api(`/api/sales/members?id=${encodeURIComponent(deleting.id)}`, { method: "DELETE" });
      toast(`${deleting.name} a été retiré de l'équipe.`);
      setDeleting(null);
      setEditing(null);
      void reload();
      reloadMembers();
      bump();
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setSaving(false);
    }
  };

  const openRule = (m: MemberRow, role: CommercialRole = m.roles[0]) => {
    setCommission(draftFrom(ruleOf(m, role), role));
    setRuleFor({ member: m, role });
  };

  /** Dans la fenetre Tarif d'un setter-closer : passer d'un metier a l'autre. */
  const switchRuleRole = (role: CommercialRole) => {
    if (!ruleFor) return;
    setCommission(draftFrom(ruleOf(ruleFor.member, role), role));
    setRuleFor({ member: ruleFor.member, role });
  };

  const saveRule = async () => {
    if (!ruleFor) return;
    setSaving(true);
    try {
      await api("/api/sales/commissions", {
        method: "POST",
        body: JSON.stringify({
          memberId: ruleFor.member.id,
          role: ruleFor.role,
          type: commission.type,
          pct: Number(commission.pct) || 0,
          fixed: Number(commission.fixed) || 0,
          monthlyFixed: Number(commission.monthly) || 0,
          basis: commission.basis,
          onlyQualified: commission.onlyQualified,
          currency,
          effectiveFrom: commission.effectiveFrom,
        }),
      });
      toast("Tarif enregistré.");
      setRuleFor(null);
      void reload();
      bump();
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setSaving(false);
    }
  };

  /* ------------------------- Champs partages ------------------------- */

  const accountFields = (
    <div className="grid sm:grid-cols-2 gap-3.5">
      <Field label="Nom">
        <input className="input" value={name} placeholder="Noa H" onChange={(e) => changeName(e.target.value)} autoFocus />
      </Field>
      <Field label="Email">
        <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      </Field>
      <Field label="Type de compte">
        <select className="select" value={kind} onChange={(e) => setKind(e.target.value as Kind)}>
          <option value="commercial">Commercial (setter / closer)</option>
          <option value="admin">Admin</option>
          <option value="monteur">Monteur</option>
          <option value="assistant">Assistant</option>
        </select>
      </Field>
      <Field label="Statut">
        <select className="select" value={status} onChange={(e) => setStatus(e.target.value as TeamMember["status"])}>
          <option value="actif">Actif</option>
          <option value="essai">Essai</option>
          <option value="inactif">Inactif — accès coupé</option>
        </select>
      </Field>
      {kind === "commercial" && (
        <Field label="Métiers — un ou les deux" className="sm:col-span-2">
          <div className="flex gap-2">
            {COMMERCIAL_ROLES.map((r) => {
              const on = roles.includes(r);
              return (
                <button
                  key={r}
                  type="button"
                  className={`btn ${on ? "btn-primary" : ""}`}
                  aria-pressed={on}
                  onClick={() => toggleRole(r)}
                >
                  {on ? "✓ " : ""}
                  {ROLE_NAMES[r]}
                </button>
              );
            })}
          </div>
        </Field>
      )}
    </div>
  );

  const credentialFields = (isNew: boolean) => (
    <div className="grid sm:grid-cols-2 gap-3.5">
      <Field label="Identifiant" hint="Lettres, chiffres, point ou tiret.">
        <input
          className="input mono"
          value={username}
          placeholder="noa.h"
          autoCapitalize="none"
          onChange={(e) => {
            setUsernameTouched(true);
            setUsername(e.target.value);
          }}
        />
      </Field>
      <Field label={isNew ? "Mot de passe" : "Nouveau mot de passe (vide = inchangé)"}>
        <div className="flex gap-2">
          <input
            className="input mono"
            value={password}
            placeholder={isNew ? "" : "Laisser vide pour conserver"}
            onChange={(e) => setPassword(e.target.value)}
          />
          <button type="button" className="btn btn-sm shrink-0" onClick={() => setPassword(suggestPassword())}>
            Générer
          </button>
        </div>
      </Field>
    </div>
  );

  /** Acces d'un membre, en un mot. */
  const access = (m: MemberRow) =>
    m.hasPassword ? (
      <span className="mono dim text-[11.5px]">{m.username}</span>
    ) : m.hasAccessCode ? (
      <span className="dim text-[11.5px]">ancien code</span>
    ) : (
      <span className="dim text-[11.5px]">pas d&apos;accès</span>
    );

  return (
    <>
      <PageHeader
        title="Équipe commerciale"
        actions={
          <>
            {/* Quel compte est le mien : mes calls me sont proposés par défaut quand je pose un rendez-vous. */}
            <select
              className="select select-sm !w-auto"
              value={ownerMemberId}
              onChange={(e) => void saveOwnerMember(e.target.value)}
              title="Si tu closes aussi : le compte de l'équipe qui te représente"
            >
              <option value="">Moi dans l&apos;équipe : personne</option>
              {members
                .filter((m) => m.roles.length > 0)
                .map((m) => (
                  <option key={m.id} value={m.id}>
                    Moi dans l&apos;équipe : {m.name}
                  </option>
                ))}
            </select>
            <PeriodPicker value={period} onChange={setPeriod} />
            <button className="btn btn-primary" onClick={openCreate}>
              + Onboarder
            </button>
          </>
        }
      />

      {error && (
        <div className="mb-4">
          <ErrorNote>{error}</ErrorNote>
        </div>
      )}

      {loading && !data ? (
        <Card>
          <Spinner label="Chargement…" />
        </Card>
      ) : !members.length ? (
        <Card>
          <Empty action={<button className="btn btn-primary" onClick={openCreate}>+ Onboarder un membre</button>}>
            Aucun membre. Onboarde ton premier setter : tu fixes son nom, ses métiers, sa rémunération, et tu
            lui transmets son identifiant et son mot de passe.
          </Empty>
        </Card>
      ) : (
        <Card padded={false}>
          <div className="scroll-x">
            <table className="table">
              <thead>
                <tr>
                  <th>Membre</th>
                  <th>Métier</th>
                  <th>Tarif</th>
                  <th className="text-right">Rdv</th>
                  <th className="text-right">Ventes</th>
                  <th className="text-right">Cash</th>
                  <th className="text-right" title="Heures pointées sur la période (Démarrer / Terminer ma session)">Heures</th>
                  <th className="text-right">À lui verser</th>
                  <th style={{ width: 260 }} />
                </tr>
              </thead>
              <tbody>
                {members.map((m) => {
                  const p = perf.get(m.id);
                  const commercial = m.roles.length > 0;
                  const inactive = m.status === "inactif";
                  return (
                    <tr key={m.id} style={inactive ? { opacity: 0.55 } : undefined}>
                      <td>
                        <div className="flex items-center gap-2">
                          <Link href={`/sales/membre/${m.id}`} className="link text-[13px] font-medium">
                            {m.name}
                          </Link>
                          {m.status !== "actif" && (
                            <span className={`badge ${inactive ? "badge-danger" : "badge-warn"}`}>{label(m.status)}</span>
                          )}
                        </div>
                        {access(m)}
                      </td>
                      <td>
                        <div className="flex gap-1 flex-wrap">
                          {commercial ? (
                            m.roles.map((r) => (
                              <span key={r} className="badge">
                                {ROLE_NAMES[r]}
                              </span>
                            ))
                          ) : (
                            <span className="badge">{label(m.role)}</span>
                          )}
                        </div>
                      </td>
                      <td className="text-[12.5px] max-w-[260px]">
                        {commercial ? (
                          m.roles.map((r) => {
                            const rule = ruleOf(m, r);
                            return (
                              <div key={r} className="leading-snug whitespace-nowrap">
                                {m.roles.length > 1 && <span className="dim">{ROLE_NAMES[r]} · </span>}
                                {rule ? (
                                  describeRule(rule, currency)
                                ) : (
                                  // Un commercial sans regle ne touche rien : a regler.
                                  <span style={{ color: "var(--warning)" }}>à définir</span>
                                )}
                              </div>
                            );
                          })
                        ) : (
                          <span className="dim">—</span>
                        )}
                      </td>
                      <td className="text-right num">{p ? fmtInt(p.appointments) : <span className="dim">—</span>}</td>
                      <td className="text-right num">{p ? fmtInt(p.sales) : <span className="dim">—</span>}</td>
                      <td className="text-right num">{p ? fmtMoney(p.cash, currency) : <span className="dim">—</span>}</td>
                      <td className="text-right num">
                        {(() => {
                          const w = workOf(m.id);
                          if (!w) return <span className="dim">—</span>;
                          return (
                            <div className="flex flex-col items-end gap-0.5">
                              <span>{w.hours} h</span>
                              {w.openSince && (
                                <button
                                  className="badge badge-good !text-[10px] !py-0 cursor-pointer"
                                  onClick={() => void closeSession(m)}
                                  title="En session en ce moment. Clic : la clôturer (s'il a oublié)."
                                >
                                  ● en session depuis {fmtTime(w.openSince)}
                                </button>
                              )}
                            </div>
                          );
                        })()}
                      </td>
                      <td
                        className="text-right num font-medium"
                        style={{ color: p && p.due > 0 ? "var(--warning)" : "var(--text-3)" }}
                      >
                        {p ? fmtMoney(p.due, currency) : <span className="dim">—</span>}
                      </td>
                      <td>
                        <div className="flex gap-1.5 justify-end flex-wrap">
                          {/* Ouvrir l'espace de CE compte, dans chacun de ses metiers :
                              le raccourci du menu ne prend que le premier de la liste. */}
                          {commercial &&
                            !inactive &&
                            m.roles.map((r) => (
                              <button
                                key={r}
                                className="btn btn-sm btn-ghost"
                                title={`Voir le tool comme ${m.name}, en ${ROLE_NAMES[r].toLowerCase()}`}
                                onClick={() => void enterView(m.id, r, false)}
                              >
                                {m.roles.length > 1 ? `Voir en ${ROLE_NAMES[r].toLowerCase()}` : "Voir son espace"}
                              </button>
                            ))}
                          {commercial && (
                            <button className="btn btn-sm" onClick={() => openRule(m)}>
                              Tarif
                            </button>
                          )}
                          <button className="btn btn-sm btn-ghost" onClick={() => openEdit(m)}>
                            Modifier
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <div className="mt-4">
        <BookingLinks members={members} version={version} />
        <IclosedMapping />
      </div>

      <ShiftPlanner
        memberId={planningFor?.id ?? ""}
        memberName={planningFor?.name ?? ""}
        open={planningFor !== null}
        onClose={() => setPlanningFor(null)}
      />

      {/* ------------------------------ Onboarding ----------------------------- */}
      <Modal
        open={creating}
        onClose={() => setCreating(false)}
        wide
        title="Onboarder un membre"
        footer={
          <>
            <button className="btn" onClick={() => setCreating(false)}>
              Annuler
            </button>
            <button className="btn btn-primary" onClick={() => void onboard()} disabled={saving}>
              {saving ? <span className="spinner" /> : "Créer le compte"}
            </button>
          </>
        }
      >
        <div className="flex flex-col gap-5">
          <div>
            <div className="label-xs mb-2.5">1 · Qui</div>
            {accountFields}
          </div>

          {paysCommission && (
            <div>
              <div className="label-xs mb-2.5">2 · Combien tu le paies</div>
              <div className="flex flex-col gap-4">
                {activeRoles.map((r) => (
                  <div key={r} className="card-flat p-4">
                    {activeRoles.length > 1 && (
                      <div className="text-[13px] font-medium mb-3">En tant que {ROLE_NAMES[r].toLowerCase()}</div>
                    )}
                    <div className="grid sm:grid-cols-2 gap-3.5">
                      <CommissionFields
                        value={commissions[r]}
                        onChange={(v) => setCommissions((prev) => ({ ...prev, [r]: v }))}
                        currency={currency}
                      />
                    </div>
                    <p className="muted text-[12.5px] mt-3">
                      {name || "Ce membre"} touchera <strong>{previewCommission(commissions[r], currency)}</strong>
                      {activeRoles.length > 1 ? ` comme ${ROLE_NAMES[r].toLowerCase()}` : ""}.
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div>
            <div className="label-xs mb-2.5">{paysCommission ? "3" : "2"} · Son accès</div>
            {credentialFields(true)}
          </div>
        </div>
      </Modal>

      {/* Confirmation : le mot de passe n'est lisible qu'ici, une seule fois. */}
      <Modal
        open={created !== null}
        onClose={() => setCreated(null)}
        title="Compte créé"
        footer={
          <button className="btn btn-primary" onClick={() => setCreated(null)}>
            J&apos;ai transmis les accès
          </button>
        }
      >
        {created && (
          <div className="flex flex-col gap-3">
            <p className="text-[13.5px] leading-relaxed">
              Transmets ces informations à <strong>{created.name}</strong>. Le mot de passe ne sera plus affiché
              après cette fenêtre — tu pourras toujours en définir un nouveau depuis « Modifier ».
            </p>
            <div className="card-flat px-4 py-3.5 flex flex-col gap-2.5">
              <span className="text-[13px]">
                <span className="label-xs block mb-0.5">Adresse</span>
                <span className="mono">{typeof window !== "undefined" ? `${window.location.origin}/login` : "/login"}</span>
              </span>
              <span className="text-[13px]">
                <span className="label-xs block mb-0.5">Identifiant</span>
                <span className="mono text-[15px]">{created.username}</span>
              </span>
              <span className="text-[13px]">
                <span className="label-xs block mb-0.5">Mot de passe</span>
                <span className="mono text-[15px]">{created.password}</span>
              </span>
            </div>
          </div>
        )}
      </Modal>

      {/* ------------------------------- Modifier ------------------------------ */}
      <Modal
        open={editing !== null}
        onClose={() => setEditing(null)}
        wide
        title={editing ? editing.name : ""}
        footer={
          <>
            {editing && editing.roles.length > 0 && (
              <button className="btn btn-ghost" onClick={() => setPlanningFor(editing)}>
                Planning
              </button>
            )}
            <button className="btn btn-danger" onClick={() => setDeleting(editing)}>
              Supprimer
            </button>
            <span className="flex-1" />
            <button className="btn" onClick={() => setEditing(null)}>
              Annuler
            </button>
            <button className="btn btn-primary" onClick={() => void saveMember()} disabled={saving}>
              {saving ? <span className="spinner" /> : "Enregistrer"}
            </button>
          </>
        }
      >
        <div className="flex flex-col gap-5">
          <div>
            <div className="label-xs mb-2.5">Compte</div>
            {accountFields}
          </div>
          <div>
            <div className="label-xs mb-2.5">Accès</div>
            {credentialFields(false)}
            {editing?.hasAccessCode && !editing.hasPassword && (
              <p className="muted text-[12.5px] mt-3">
                Ce membre se connecte encore avec son ancien code. Définis-lui un identifiant et un mot de
                passe pour passer au nouveau système.
              </p>
            )}
          </div>
        </div>
      </Modal>

      {/* ------------------------------ Supprimer ------------------------------ */}
      <Modal
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        title={deleting ? `Retirer ${deleting.name} ?` : ""}
        footer={
          <>
            <button className="btn" onClick={() => setDeleting(null)}>
              Annuler
            </button>
            <button
              className="btn btn-primary"
              style={{ background: "var(--critical)", borderColor: "var(--critical)" }}
              onClick={() => void removeMember()}
              disabled={saving}
            >
              {saving ? <span className="spinner" /> : "Supprimer définitivement"}
            </button>
          </>
        }
      >
        <div className="flex flex-col gap-3 text-[13.5px] leading-relaxed">
          <p>Son accès est coupé immédiatement et son compte disparaît de l&apos;équipe, avec ses tarifs et ses créneaux.</p>
          <p className="muted">
            Ses rendez-vous et ses ventes restent en base mais ne lui sont plus attribués. Pour garder
            l&apos;historique intact, passe plutôt le compte en <strong>Inactif</strong>.
          </p>
        </div>
      </Modal>

      {/* -------------------------------- Tarif -------------------------------- */}
      <Modal
        open={ruleFor !== null}
        onClose={() => setRuleFor(null)}
        title={ruleFor ? `Tarif — ${ruleFor.member.name}` : ""}
        footer={
          <>
            <button className="btn" onClick={() => setRuleFor(null)}>
              Annuler
            </button>
            <button className="btn btn-primary" onClick={() => void saveRule()} disabled={saving}>
              {saving ? <span className="spinner" /> : "Enregistrer"}
            </button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          {/* Un setter-closer a un tarif par metier : on choisit lequel on regle. */}
          {ruleFor && ruleFor.member.roles.length > 1 && (
            <div className="flex gap-2">
              {ruleFor.member.roles.map((r) => (
                <button
                  key={r}
                  type="button"
                  className={`btn btn-sm ${ruleFor.role === r ? "btn-primary" : ""}`}
                  onClick={() => switchRuleRole(r)}
                >
                  En tant que {ROLE_NAMES[r].toLowerCase()}
                </button>
              ))}
            </div>
          )}
          {ruleFor && ruleOf(ruleFor.member, ruleFor.role) && (
            <InfoNote>
              Tarif actuel : <strong>{describeRule(ruleOf(ruleFor.member, ruleFor.role), currency)}</strong>. Le
              nouveau s&apos;applique à partir de sa date d&apos;effet ; les commissions déjà gagnées gardent
              l&apos;ancien.
            </InfoNote>
          )}
          <div className="grid sm:grid-cols-2 gap-3.5">
            <CommissionFields value={commission} onChange={setCommission} currency={currency} />
          </div>
          <p className="muted text-[12.5px]">
            {ruleFor?.member.name} touchera <strong>{previewCommission(commission, currency)}</strong>
            {ruleFor && ruleFor.member.roles.length > 1 ? ` comme ${ROLE_NAMES[ruleFor.role].toLowerCase()}` : ""} à
            partir du {commission.effectiveFrom ? fmtDate(commission.effectiveFrom) : "jour même"}.
          </p>
        </div>
      </Modal>
    </>
  );
}

/* --------------------- Liens de reservation signes --------------------- */

/**
 * Un lien iClosed par setter.
 *
 * Le calendrier est le meme pour tous, mais chaque setter l'envoie avec sa
 * signature en parametre (utm_content = son identifiant). iClosed la garde
 * sur la reservation, et la synchro attribue le rendez-vous au bon setter
 * sans que personne ne declare rien. C'est la voie la plus sure ; la
 * declaration du prospect sur son accueil reste le filet de securite.
 */
function BookingLinks({ members, version }: { members: MemberRow[]; version: number }) {
  const toast = useToast();
  const { data, reload } = useSalesData<{ salesBookingUrl?: string }>(`/api/settings?v=${version}`);
  const [url, setUrl] = useState<string | null>(null);
  const current = url ?? data?.salesBookingUrl ?? "";
  const setters = members.filter((m) => m.roles.includes("setter") && m.status !== "inactif");

  const save = async () => {
    try {
      await api("/api/settings", { method: "PATCH", body: JSON.stringify({ salesBookingUrl: current.trim() }) });
      toast("Lien enregistré.");
      setUrl(null);
      void reload();
    } catch (e) {
      toast((e as Error).message, "err");
    }
  };

  const linkFor = (m: MemberRow) => {
    if (!current.trim()) return "";
    const u = new URL(current.trim());
    u.searchParams.set("utm_source", "setter");
    u.searchParams.set("utm_content", m.username || m.id);
    return u.toString();
  };

  const copy = async (m: MemberRow) => {
    const link = linkFor(m);
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      toast(`Lien de ${m.name} copié.`);
    } catch {
      window.prompt("Copie ce lien :", link);
    }
  };

  return (
    <Card
      title="Lien de réservation par setter"
      subtitle="Chaque setter envoie ce lien signé à son nom : les rendez-vous pris dessus lui sont attribués automatiquement."
    >
      <div className="flex flex-col gap-3">
        <div className="flex gap-2 items-end flex-wrap">
          <Field label="Ton lien de réservation iClosed" className="flex-1 min-w-[260px]">
            <input
              className="input"
              placeholder="https://app.iclosed.io/e/…"
              value={current}
              onChange={(e) => setUrl(e.target.value)}
            />
          </Field>
          <button className="btn btn-primary" onClick={() => void save()} disabled={url === null || url === (data?.salesBookingUrl ?? "")}>
            Enregistrer
          </button>
        </div>
        {!current.trim() ? (
          <p className="dim text-[12px]">Colle l&apos;adresse de ton calendrier iClosed, celle que tu envoies aux prospects.</p>
        ) : !setters.length ? (
          <p className="dim text-[12px]">Aucun setter actif.</p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {setters.map((m) => (
              <li key={m.id} className="flex items-center gap-2 flex-wrap text-[12.5px]">
                <span className="font-medium w-[120px] truncate">{m.name}</span>
                <code className="mono dim text-[11px] truncate flex-1 min-w-[200px]" title={linkFor(m)}>
                  {linkFor(m)}
                </code>
                <button className="btn btn-sm" onClick={() => void copy(m)}>
                  Copier
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}
