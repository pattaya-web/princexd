"use client";

import { CopyButton } from "@/components/ui";

/**
 * Réseau / Contact (onglet de Ressources, Scale X) : les agents de sourcing,
 * le transitaire et les agences Meta que Mady recommande, avec le message
 * en anglais à copier pour le premier contact. Page statique : les contacts
 * vivent ici.
 */

interface Channel {
  label: string;
  value: string;
  href?: string;
}

interface Contact {
  name: string;
  role: string;
  channels: Channel[];
}

const AGENTS: Contact[] = [
  {
    name: "Agent de sourcing",
    role: "Prix du produit, échantillons, envoi vers ton marché",
    channels: [
      { label: "WhatsApp", value: "+86 182 6902 3600", href: "https://wa.me/8618269023600" },
      { label: "WeChat", value: "18269023600" },
      { label: "Skype", value: "live:.cid.6746b31f0fa8443" },
    ],
  },
  {
    name: "Ship Bee",
    role: "Agent / expédition",
    channels: [{ label: "WhatsApp", value: "+63 939 787 6128", href: "https://wa.me/639397876128" }],
  },
];

const META_AGENCIES = ["rank_flex", "NextGenz12", "lorea_metaplug", "metatrust_support", "aaonboarding"];

const AGENT_MESSAGE = `Hello, I run an e-commerce store and I'm looking for a reliable sourcing agent. I got your contact from someone I trust.

Here is my product: [product link or photo]

Could you tell me:
- the product price (per unit, and for 50 / 100 units)
- the shipping cost and delivery time to [country]

Thank you!`;

export function ReseauContacts() {
  return (
    <div className="flex flex-col gap-5">
      <section className="card p-5">
        <div className="label-xs" style={{ letterSpacing: "0.12em" }}>
          01 / AGENTS
        </div>
        <p className="text-[13.5px] mt-2 leading-relaxed max-w-[64ch]">Les agents qui sourcent ton produit et l&apos;envoient à tes clients. Écris-leur en anglais avec le message plus bas, en leur envoyant le lien ou la photo du produit.</p>
        <ul className="mt-4 flex flex-col gap-3">
          {AGENTS.map((a) => (
            <li key={a.name} className="rounded-[10px] px-4 py-3" style={{ background: "var(--surface-2)", border: "1px solid var(--border)" }}>
              <div className="text-[14.5px] font-semibold leading-tight">{a.name}</div>
              <div className="dim text-[12px] mt-0.5">{a.role}</div>
              <ul className="mt-2.5 flex flex-col gap-1.5">
                {a.channels.map((c) => (
                  <li key={c.label} className="flex flex-wrap items-center gap-2">
                    <span className="w-[78px] shrink-0 text-[12.5px] muted">{c.label}</span>
                    <span className="text-[13.5px] font-medium break-all">{c.value}</span>
                    <span className="flex items-center gap-1 ml-auto">
                      {c.href && (
                        <a href={c.href} target="_blank" rel="noreferrer" className="btn btn-sm">
                          Ouvrir ↗
                        </a>
                      )}
                      <CopyButton text={c.value} />
                    </span>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      </section>

      <section className="card p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="label-xs" style={{ letterSpacing: "0.12em" }}>
            02 / MESSAGE À ENVOYER AUX AGENTS (ANGLAIS)
          </div>
          <CopyButton text={AGENT_MESSAGE} label="Copier le message" />
        </div>
        <pre className="mt-3 rounded-[8px] px-3.5 py-3 text-[13px] leading-relaxed whitespace-pre-wrap" style={{ background: "var(--surface-2)", border: "1px solid var(--border)", fontFamily: "inherit" }}>
          {AGENT_MESSAGE}
        </pre>
        <p className="dim text-[12px] mt-2">Remplace [product link or photo] par le lien ou la photo de ton produit et [country] par ton marché (France, Belgique…).</p>
      </section>

      <section className="card p-5">
        <div className="label-xs" style={{ letterSpacing: "0.12em" }}>
          03 / AGENCES META (TELEGRAM)
        </div>
        <p className="text-[13.5px] mt-2 leading-relaxed max-w-[64ch]">Pour obtenir des comptes publicitaires d&apos;agence Meta. Contacte-les sur Telegram.</p>
        <ul className="mt-3 flex flex-col gap-1.5">
          {META_AGENCIES.map((h) => (
            <li key={h} className="flex flex-wrap items-center gap-2">
              <span className="text-[13.5px] font-medium">@{h}</span>
              <span className="flex items-center gap-1 ml-auto">
                <a href={`https://t.me/${h}`} target="_blank" rel="noreferrer" className="btn btn-sm">
                  Ouvrir ↗
                </a>
                <CopyButton text={`@${h}`} />
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
