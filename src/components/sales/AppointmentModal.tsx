"use client";

import { hasRole } from "@/lib/sales/roles";
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/client";
import { label } from "@/lib/format";
import { APPOINTMENT_SOURCES } from "@/lib/sales/constants";
import { Field, Modal, useToast } from "@/components/ui";
import type { PublicMember } from "@/lib/sales/repo";
import type { AppointmentSource, Session } from "@/lib/types";

/**
 * Saisie d'un rendez-vous par le setter.
 *
 * Contrainte principale : quelques secondes, pas un formulaire interminable.
 * Seuls le pseudo Instagram et le creneau sont obligatoires ; tout le reste
 * est optionnel et regroupe plus bas. Le champ Instagram prend le focus a
 * l'ouverture et Ctrl+Entree enregistre, pour que la souris ne serve jamais.
 */

const TIMEZONES = [
  "Europe/Paris",
  "Europe/London",
  "America/New_York",
  "America/Los_Angeles",
  "America/Sao_Paulo",
  "Asia/Dubai",
  "Africa/Casablanca",
  "Asia/Singapore",
  "Australia/Sydney",
];

/** Creneau par defaut : aujourd'hui, a la prochaine heure ronde. */
function defaultSlot() {
  const d = new Date();
  d.setMinutes(0, 0, 0);
  d.setHours(d.getHours() + 1);
  const pad = (n: number) => String(n).padStart(2, "0");
  return {
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
  };
}

export interface AppointmentModalProps {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  session: Session;
  members: PublicMember[];
}

export function AppointmentModal({ open, onClose, onSaved, session, members }: AppointmentModalProps) {
  const toast = useToast();
  const igRef = useRef<HTMLInputElement>(null);

  const setters = useMemo(() => members.filter((m) => hasRole(m, "setter") && m.status !== "inactif"), [members]);
  const closers = useMemo(() => members.filter((m) => hasRole(m, "closer") && m.status !== "inactif"), [members]);

  const slot = defaultSlot();
  const [igUsername, setIg] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [country, setCountry] = useState("");
  const [timezone, setTimezone] = useState("Europe/Paris");
  const [date, setDate] = useState(slot.date);
  const [time, setTime] = useState(slot.time);
  const [setterId, setSetterId] = useState(session.memberId);
  const [closerId, setCloserId] = useState("");
  const [source, setSource] = useState<AppointmentSource>("instagram-dm");
  const [iclosedUrl, setIclosedUrl] = useState("");
  const [notes, setNotes] = useState("");
  const [more, setMore] = useState(false);
  const [saving, setSaving] = useState(false);

  // Reinitialisation a chaque ouverture : rouvrir le formulaire ne doit jamais
  // proposer les restes du rendez-vous precedent.
  useEffect(() => {
    if (!open) return;
    const next = defaultSlot();
    setIg("");
    setName("");
    setEmail("");
    setPhone("");
    setCountry("");
    setDate(next.date);
    setTime(next.time);
    setCloserId("");
    setSource("instagram-dm");
    setIclosedUrl("");
    setNotes("");
    setMore(false);
    setSetterId(session.isAdmin ? (setters[0]?.id ?? "") : session.memberId);
    setTimeout(() => igRef.current?.focus(), 60);
  }, [open, session.isAdmin, session.memberId, setters]);

  const save = async () => {
    if (!igUsername.trim()) {
      toast("Le pseudo Instagram est obligatoire.", "err");
      igRef.current?.focus();
      return;
    }
    if (!date || !time) {
      toast("Renseigne la date et l'heure du rendez-vous.", "err");
      return;
    }
    setSaving(true);
    try {
      await api("/api/sales/appointments", {
        method: "POST",
        body: JSON.stringify({
          igUsername: igUsername.trim(),
          name: name.trim(),
          email: email.trim(),
          phone: phone.trim(),
          country: country.trim(),
          timezone,
          // Le creneau est saisi dans l'heure locale du navigateur puis
          // converti en ISO : la base ne stocke que de l'UTC.
          scheduledAt: new Date(`${date}T${time}`).toISOString(),
          setterId,
          closerId,
          source,
          iclosedUrl: iclosedUrl.trim(),
          setterNotes: notes.trim(),
        }),
      });
      toast("Rendez-vous enregistré.");
      onSaved();
      onClose();
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setSaving(false);
    }
  };

  const onKey = (e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") void save();
  };

  const clean = igUsername.trim().replace(/^@+/, "");

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Nouveau rendez-vous"
      footer={
        <>
          <span className="dim text-[11.5px] mr-auto hidden sm:inline">Ctrl + Entrée pour enregistrer</span>
          <button className="btn" onClick={onClose}>
            Annuler
          </button>
          <button className="btn btn-primary" onClick={() => void save()} disabled={saving}>
            {saving ? <span className="spinner" /> : "Enregistrer"}
          </button>
        </>
      }
    >
      <div onKeyDown={onKey} className="flex flex-col gap-3.5">
        {/* Instagram d'abord : c'est l'identifiant du lead. */}
        <Field label="Instagram">
          <div className="flex items-center gap-2">
            <span className="dim text-[15px] font-medium">@</span>
            <input
              ref={igRef}
              className="input"
              value={clean}
              placeholder="johnsmith"
              onChange={(e) => setIg(e.target.value)}
              autoComplete="off"
            />
            {clean && (
              <a
                href={`https://instagram.com/${clean}`}
                target="_blank"
                rel="noreferrer"
                className="btn btn-sm btn-ghost shrink-0"
                title="Ouvrir le profil"
              >
                ↗
              </a>
            )}
          </div>
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Date">
            <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label="Heure">
            <input className="input" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Fuseau du prospect">
            <select className="select" value={timezone} onChange={(e) => setTimezone(e.target.value)}>
              {TIMEZONES.map((tz) => (
                <option key={tz} value={tz}>
                  {tz}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Source">
            <select
              className="select"
              value={source}
              onChange={(e) => setSource(e.target.value as AppointmentSource)}
            >
              {APPOINTMENT_SOURCES.map((s) => (
                <option key={s} value={s}>
                  {label(s)}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Setter">
            {session.isAdmin ? (
              <select className="select" value={setterId} onChange={(e) => setSetterId(e.target.value)}>
                <option value="">— Choisir —</option>
                {setters.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            ) : (
              // Un setter enregistre toujours pour lui-meme : le champ est
              // affiche pour confirmer l'attribution, jamais modifiable.
              <input className="input" value={session.memberName} disabled />
            )}
          </Field>
          <Field label="Closer">
            <select className="select" value={closerId} onChange={(e) => setCloserId(e.target.value)}>
              <option value="">Non assigné</option>
              {closers.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <Field label="Contexte pour le closer">
          <textarea
            className="textarea"
            value={notes}
            placeholder="Situation, budget, objectif, objections entendues en DM…"
            onChange={(e) => setNotes(e.target.value)}
          />
        </Field>

        {/* Coordonnees : utiles mais rarement connues au moment du booking. */}
        {!more ? (
          <button className="btn btn-ghost btn-sm self-start" onClick={() => setMore(true)}>
            + Coordonnées et lien iClosed
          </button>
        ) : (
          <div className="grid sm:grid-cols-2 gap-3">
            <Field label="Nom complet">
              <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
            <Field label="Email">
              <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </Field>
            <Field label="Téléphone">
              <input className="input" value={phone} onChange={(e) => setPhone(e.target.value)} />
            </Field>
            <Field label="Pays">
              <input className="input" value={country} onChange={(e) => setCountry(e.target.value)} />
            </Field>
            <Field label="Lien du rendez-vous / iClosed" className="sm:col-span-2">
              <input
                className="input"
                value={iclosedUrl}
                placeholder="https://…"
                onChange={(e) => setIclosedUrl(e.target.value)}
              />
            </Field>
          </div>
        )}
      </div>
    </Modal>
  );
}
