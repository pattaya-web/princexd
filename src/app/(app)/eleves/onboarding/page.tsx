"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/client";
import { Card, CopyButton, ErrorNote, Field, PageHeader, Spinner, useToast } from "@/components/ui";
import { ONBOARDING_TAGS, renderOnboarding } from "@/lib/onboarding";
import { waLink } from "@/lib/sales/templates";
import type { StudentOnboardingSettings } from "@/lib/types";
import type { OnboardingPayload, OnboardingStudentRow } from "@/app/api/eleves/onboarding/route";

/**
 * Message d'onboarding des élèves.
 *
 * Les liens (formulaire, affiliations) et le texte se règlent ici ; l'aperçu
 * se fait pour un élève réel, avec son identifiant de plateforme, et se copie
 * ou s'ouvre dans WhatsApp. Le chat « Nouvel élève » produit le même message,
 * mot de passe compris, au moment où l'accès est créé.
 */

const fmtDate = (iso: string) =>
  iso ? new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "short", timeZone: "Europe/Paris" }).format(new Date(iso)) : "";

export default function OnboardingPage() {
  const toast = useToast();
  const [data, setData] = useState<OnboardingPayload | null>(null);
  const [error, setError] = useState("");
  const [form, setForm] = useState<StudentOnboardingSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [studentId, setStudentId] = useState("");
  const [busyId, setBusyId] = useState("");

  const load = useCallback(async () => {
    try {
      const d = await api<OnboardingPayload>("/api/eleves/onboarding");
      setData(d);
      setForm((f) => f ?? d.settings);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const dirty = useMemo(() => Boolean(data && form && JSON.stringify(form) !== JSON.stringify(data.settings)), [data, form]);

  const save = async () => {
    if (!form) return;
    setSaving(true);
    try {
      const r = await api<{ settings: StudentOnboardingSettings }>("/api/eleves/onboarding", { method: "PATCH", body: JSON.stringify(form) });
      setData((d) => (d ? { ...d, settings: r.settings } : d));
      setForm(r.settings);
      toast("Message d'onboarding enregistré.");
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setSaving(false);
    }
  };

  const markSent = async (s: OnboardingStudentRow, sent: boolean) => {
    setBusyId(s.id);
    try {
      await api("/api/eleves/onboarding", { method: "POST", body: JSON.stringify({ studentId: s.id, sent }) });
      await load();
      toast(sent ? `Message marqué envoyé à ${s.name}.` : "Marque retirée.");
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setBusyId("");
    }
  };

  const student = data?.students.find((s) => s.id === studentId) ?? null;
  const preview = form
    ? renderOnboarding(form, {
        name: student?.name || "Alexandre Martin",
        username: student?.username || (student ? "" : "alexandre.martin"),
        baseUrl: data?.baseUrl ?? "",
      })
    : "";
  const set = (k: keyof StudentOnboardingSettings, v: string) => setForm((f) => (f ? { ...f, [k]: v } : f));

  return (
    <div>
      <PageHeader
        title="Onboarding élèves"
        subtitle="Le message envoyé dès qu'un élève rejoint l'accompagnement : formulaire, outils à installer (avec tes liens affiliés), accès à la plateforme."
        actions={
          <>
            <Link href="/eleves/nouveau" className="btn btn-sm btn-primary">
              Nouvel élève (chat)
            </Link>
            <Link href="/eleves" className="btn btn-sm btn-ghost">
              Fiches élèves
            </Link>
          </>
        }
      />

      {error && <ErrorNote>{error}</ErrorNote>}
      {!data && !error && <Spinner label="Chargement…" />}

      {data && form && (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] items-start">
          <div className="flex flex-col gap-4">
            <Card title="Liens" subtitle="Le formulaire sert à affiner ton avatar client avec le temps. Les liens affiliés remplacent les balises du message.">
              <div className="flex flex-col gap-3">
                <Field label="Formulaire d'onboarding" hint={form.formUrl ? undefined : "Pas encore renseigné : le message dira « lien à venir »."}>
                  <input className="input" value={form.formUrl} onChange={(e) => set("formUrl", e.target.value)} placeholder="https://…" inputMode="url" />
                </Field>
                <Field label="Shopify (1 €), lien affilié">
                  <input className="input" value={form.shopifyUrl} onChange={(e) => set("shopifyUrl", e.target.value)} inputMode="url" />
                </Field>
                <Field label="Claude Pro Max (90 €/mois)" hint="Mets ton lien affilié quand tu en auras un ; sinon la page d'abonnement Claude.">
                  <input className="input" value={form.claudeUrl} onChange={(e) => set("claudeUrl", e.target.value)} inputMode="url" />
                </Field>
                <Field label="BrandSearch, plan Starter (63 $/mois)" hint="Lien affilié de Mady (code royalscale), posé par défaut. Il sert aussi au bouton BrandSearch de la page Recherche produit.">
                  <input className="input" value={form.brainsearchUrl} onChange={(e) => set("brainsearchUrl", e.target.value)} inputMode="url" />
                </Field>
              </div>
            </Card>

            <Card
              title="Message"
              subtitle="Tutoiement, direct, dans l'ordre où l'élève doit agir. Les balises sont remplacées à la copie."
              actions={
                <button className="btn btn-sm btn-ghost" onClick={() => set("message", data.defaultMessage)} disabled={form.message === data.defaultMessage}>
                  Texte par défaut
                </button>
              }
            >
              <textarea className="input font-mono text-[12.5px] leading-relaxed" rows={26} value={form.message} onChange={(e) => set("message", e.target.value)} />
              <div className="flex flex-wrap gap-1.5 mt-2">
                {ONBOARDING_TAGS.map((t) => (
                  <span key={t.tag} className="badge !text-[10.5px]" title={t.label}>
                    {t.tag} <span className="dim ml-1">{t.label}</span>
                  </span>
                ))}
              </div>
              <div className="flex items-center justify-end gap-2 mt-3">
                {dirty && <span className="dim text-[12px]">Modifications non enregistrées</span>}
                <button className="btn btn-sm btn-primary" onClick={() => void save()} disabled={saving || !dirty}>
                  {saving ? "Enregistrement…" : "Enregistrer"}
                </button>
              </div>
            </Card>
          </div>

          <div className="flex flex-col gap-4 lg:sticky lg:top-4">
            <Card title="Aperçu et envoi" subtitle="Choisis un élève : son prénom et son identifiant remplacent les balises. Le mot de passe n'est connu qu'à la création de l'accès (chat Nouvel élève ou Accès élèves).">
              <div className="flex flex-col gap-3">
                <select className="input" value={studentId} onChange={(e) => setStudentId(e.target.value)}>
                  <option value="">Exemple (Alexandre Martin)</option>
                  {data.students.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                      {s.onboardingSentAt ? ` · envoyé le ${fmtDate(s.onboardingSentAt)}` : ""}
                    </option>
                  ))}
                </select>
                {student && !student.username && (
                  <div className="dim text-[12px] leading-snug">
                    {student.name} n&apos;a pas encore d&apos;accès à la plateforme :{" "}
                    <Link href="/formation/eleves" className="underline">
                      crée-le dans Accès élèves
                    </Link>{" "}
                    pour que l&apos;identifiant apparaisse.
                  </div>
                )}
                <pre className="card-flat p-3 text-[12.5px] leading-relaxed whitespace-pre-wrap font-sans max-h-[60vh] overflow-auto">{preview}</pre>
                <div className="flex flex-wrap gap-2">
                  <CopyButton text={preview} label="Copier le message" />
                  {student?.phone && (
                    <a className="btn btn-sm" href={waLink(student.phone, preview)} target="_blank" rel="noreferrer">
                      Ouvrir dans WhatsApp
                    </a>
                  )}
                  {student && (
                    <button className="btn btn-sm btn-ghost" disabled={busyId === student.id} onClick={() => void markSent(student, !student.onboardingSentAt)}>
                      {student.onboardingSentAt ? `Envoyé le ${fmtDate(student.onboardingSentAt)} · retirer` : "Marquer comme envoyé"}
                    </button>
                  )}
                </div>
              </div>
            </Card>

            {data.students.some((s) => !s.onboardingSentAt) && (
              <Card title="À qui il n'a pas encore été envoyé" padded={false}>
                <ul className="divide-y" style={{ borderColor: "var(--border)" }}>
                  {data.students
                    .filter((s) => !s.onboardingSentAt)
                    .slice(0, 12)
                    .map((s) => (
                      <li key={s.id} className="flex items-center justify-between gap-2 px-4 py-2 text-[13px]">
                        <button className="text-left min-w-0 flex-1 hover:underline" onClick={() => setStudentId(s.id)}>
                          <span className="font-medium">{s.name}</span>
                          <span className="dim ml-2 text-[12px]">{s.startedAt ? `depuis le ${fmtDate(s.startedAt)}` : ""}{s.username ? " · accès créé" : " · pas d'accès"}</span>
                        </button>
                        <button className="btn btn-sm btn-ghost" disabled={busyId === s.id} onClick={() => void markSent(s, true)}>
                          Envoyé ✓
                        </button>
                      </li>
                    ))}
                </ul>
              </Card>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
