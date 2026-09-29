"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { Card, PageHeader } from "@/components/ui";
import { useSales } from "@/components/sales/context";
import { sessionHas } from "@/lib/sales/roles";

/**
 * Guide d'utilisation du CRM, pour l'equipe commerciale.
 *
 * Un parcours par metier, en etapes reliees par des fleches, avec les mots
 * exacts des boutons du tool. Ecrit pour etre lu en deux minutes par
 * quelqu'un qui n'a jamais ouvert l'outil.
 */

const COLOR = {
  new: "#94a3b8",
  yellow: "#eab308",
  blue: "#3b82f6",
  violet: "#a855f7",
  green: "#22c55e",
  red: "#ef4444",
};

function Dot({ color }: { color: string }) {
  return <span className="inline-block w-[10px] h-[10px] rounded-full shrink-0" style={{ background: color }} />;
}

/** Une etape du parcours : numero, titre, explication, ou cliquer. */
function Step({ n, title, children, where, href }: { n: number; title: string; children: ReactNode; where?: string; href?: string }) {
  return (
    <div className="flex gap-3 items-start">
      <span
        className="num shrink-0 grid place-items-center rounded-full text-[13px] font-semibold"
        style={{ width: 30, height: 30, background: "var(--accent)", color: "#fff" }}
      >
        {n}
      </span>
      <div className="min-w-0 flex-1 pb-1">
        <div className="text-[14px] font-semibold">{title}</div>
        <div className="text-[13px] leading-relaxed mt-0.5">{children}</div>
        {where && (
          <div className="mt-1.5 text-[12px]">
            <span className="dim">Où : </span>
            {href ? (
              <Link href={href} className="link">
                {where}
              </Link>
            ) : (
              <span>{where}</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function Arrow() {
  return (
    <div className="pl-[10px] py-0.5" aria-hidden>
      <div style={{ width: 2, height: 18, background: "var(--border-strong)", marginLeft: 4 }} />
      <div style={{ marginLeft: -1, color: "var(--border-strong)", lineHeight: 0.6, fontSize: 14 }}>▼</div>
    </div>
  );
}

/** Schema horizontal : boites reliees par des fleches. */
function Flow({ boxes }: { boxes: { label: string; sub?: string; color?: string }[] }) {
  return (
    <div className="flex flex-wrap items-center gap-2 py-1">
      {boxes.map((b, i) => (
        <div key={b.label} className="flex items-center gap-2">
          <div
            className="rounded-[10px] px-3 py-2 text-[12.5px] leading-snug"
            style={{
              background: b.color ? `color-mix(in srgb, ${b.color} 18%, var(--surface))` : "var(--surface-2)",
              border: `1px solid ${b.color ?? "var(--border)"}`,
              minWidth: 120,
            }}
          >
            <div className="font-semibold">{b.label}</div>
            {b.sub && <div className="dim text-[11px]">{b.sub}</div>}
          </div>
          {i < boxes.length - 1 && <span style={{ color: "var(--text-3)", fontSize: 18 }}>→</span>}
        </div>
      ))}
    </div>
  );
}

export default function GuidePage() {
  const { session } = useSales();
  const isSetter = session.isAdmin || sessionHas(session, "setter");
  const isCloser = session.isAdmin || sessionHas(session, "closer");
  const [tab, setTab] = useState<"setter" | "closer">(isSetter ? "setter" : "closer");

  return (
    <>
      <PageHeader
        title="Guide d'utilisation"
        subtitle="Comment le CRM fonctionne, pas à pas, avec les mots exacts des boutons. Deux minutes à lire."
        actions={
          isSetter && isCloser ? (
            <div className="flex gap-0.5 p-0.5 rounded-[8px]" style={{ background: "var(--surface-3)" }}>
              {(["setter", "closer"] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className="px-3 h-[28px] rounded-[6px] text-[12px] font-medium"
                  style={{ background: tab === t ? "var(--surface)" : "transparent", color: tab === t ? "var(--text)" : "var(--text-2)" }}
                >
                  {t === "setter" ? "Parcours setter" : "Parcours closer"}
                </button>
              ))}
            </div>
          ) : undefined
        }
      />

      <div className="flex flex-col gap-4">
        {/* ------------------------------ Vue d'ensemble ------------------------------ */}
        <Card title="D'où viennent les prospects" subtitle="Deux portes d'entrée, deux endroits dans le tool.">
          <div className="flex flex-col gap-3">
            <div>
              <div className="label-xs mb-1">Porte 1 · La landing page</div>
              <Flow
                boxes={[
                  { label: "Instagram", sub: "bio, story, reel" },
                  { label: "Landing page", sub: "il laisse son numéro" },
                  { label: "« À appeler »", sub: "lead froid, à appeler vite", color: COLOR.new },
                  { label: "Rendez-vous posé", sub: "par le setter", color: COLOR.green },
                  { label: "Agenda", sub: "le closer prend le call" },
                ]}
              />
            </div>
            <div>
              <div className="label-xs mb-1">Porte 2 · Les DM Instagram</div>
              <Flow
                boxes={[
                  { label: "Le setter discute", sub: "en DM" },
                  { label: "Il envoie SON lien", sub: "calendrier signé à son nom" },
                  { label: "Le prospect réserve", sub: "sur iClosed" },
                  { label: "Agenda", sub: "arrive tout seul, « par Salim »", color: COLOR.green },
                  { label: "Le closer prend le call" },
                ]}
              />
            </div>
            <p className="dim text-[12.5px]">
              « À appeler » ne contient que les inscrits de la landing page. Les calls de closing, eux, vivent dans
              Rendez-vous et l&apos;Agenda.
            </p>
          </div>
        </Card>

        {/* -------------------------------- Setter -------------------------------- */}
        {tab === "setter" && (
          <>
            <Card title="Ma journée de setter" subtitle="Dans l'ordre, tous les jours.">
              <div className="flex flex-col">
                <Step n={1} title="Je pointe" where="Accueil, bouton « ▶ Démarrer ma session »" href="/sales">
                  En arrivant je démarre ma session, en partant je clique « ■ Terminer ». Mes heures sont comptées.
                </Step>
                <Arrow />
                <Step n={2} title="Je coche ma liste du jour" where="Accueil, bloc « Ma journée »" href="/sales">
                  Les tâches à faire chaque jour : appeler les nouveaux leads, relancer, DM les gens qui ont liké… Je coche au fur
                  et à mesure. La liste se remet à zéro chaque matin.
                </Step>
                <Arrow />
                <Step n={3} title="J'appelle les leads froids" where="Onglet « À appeler »" href="/sales/leads">
                  Ce sont les gens qui viennent de laisser leur numéro sur la landing page. Les plus récents en haut : j&apos;appelle
                  dans les 5 minutes, c&apos;est là que ça décroche. Le numéro est cliquable.
                </Step>
                <Arrow />
                <Step n={4} title="Je statue chaque appel" where="Le menu sur la ligne du contact">
                  Après chaque appel je choisis dans le menu : <strong>Ne répond pas</strong>, <strong>Message envoyé</strong>,{" "}
                  <strong>À rappeler plus tard</strong> (je mets la date et l&apos;heure), <strong>Joint</strong>,{" "}
                  <strong>Pas intéressé</strong>. La ligne prend la couleur de l&apos;état, et la liste se réordonne toute seule.
                </Step>
                <Arrow />
                <Step n={5} title="Je pose le rendez-vous" where="Bouton « ✓ RDV » sur la ligne, ou « Rendez-vous posé… » dans le menu">
                  Le prospect est chaud : je choisis la date et l&apos;heure du call de vente, en heure de Paris. Le contact quitte
                  « À appeler » et apparaît dans Rendez-vous et sur l&apos;Agenda, où le closer le prend.
                </Step>
                <Arrow />
                <Step n={6} title="Sur Instagram, j'envoie MON lien" where="Le lien que l'admin m'a donné (Comptes → Lien de réservation par setter)">
                  Quand je discute en DM et que la personne veut un call, je lui envoie mon lien de calendrier, pas un autre. Il porte
                  mon nom : quand elle réserve, le rendez-vous m&apos;est attribué automatiquement.
                </Step>
                <Arrow />
                <Step n={7} title="Si j'ai envoyé un autre lien, je déclare" where="Accueil, bloc « Prospects à qui j'ai envoyé le calendrier », bouton « + J'ai envoyé le lien »" href="/sales">
                  Je note le pseudo Instagram, le nom, et si je les ai, le téléphone ou l&apos;email. Quand la réservation arrive, le tool
                  la reconnaît et me l&apos;attribue.
                </Step>
                <Arrow />
                <Step n={8} title="J'écris ce que je sais" where="Clic sur le nom d'un contact → sa fiche">
                  Ce qu&apos;il cherche, son budget, son objection. Le closer lira ça avant de décrocher. Je peux aussi y voir son
                  historique et ses rendez-vous.
                </Step>
              </div>
            </Card>

            <Card title="Le code couleur de « À appeler »">
              <div className="grid sm:grid-cols-2 gap-2 text-[13px]">
                {[
                  [COLOR.new, "Gris", "nouveau, jamais appelé. À appeler maintenant."],
                  [COLOR.yellow, "Jaune", "ne répond pas ou message laissé. À relancer."],
                  [COLOR.blue, "Bleu", "veut être rappelé à une heure précise. Remonte en haut quand l'heure est passée."],
                  [COLOR.violet, "Violet", "joint au téléphone, il manque la date du rendez-vous."],
                  [COLOR.green, "Vert", "rendez-vous posé. Il part dans Rendez-vous et l'Agenda."],
                  [COLOR.red, "Rouge", "pas intéressé, pas d'argent. Reste 30 jours en bas, remettable si il revient."],
                ].map(([c, name, text]) => (
                  <div key={name} className="flex items-start gap-2">
                    <span className="mt-1">
                      <Dot color={c} />
                    </span>
                    <span>
                      <strong>{name}</strong> : {text}
                    </span>
                  </div>
                ))}
              </div>
            </Card>
          </>
        )}

        {/* -------------------------------- Closer -------------------------------- */}
        {tab === "closer" && (
          <Card title="Ma journée de closer" subtitle="Dans l'ordre, tous les jours.">
            <div className="flex flex-col">
              <Step n={1} title="Je pointe" where="Accueil, bouton « ▶ Démarrer ma session »" href="/sales">
                En arrivant je démarre ma session, en partant je clique « ■ Terminer ».
              </Step>
              <Arrow />
              <Step n={2} title="Je regarde mes calls du jour" where="Accueil, « Tes prochains calls » et le calendrier de la semaine" href="/sales">
                Mes calls attribués, avec l&apos;heure en France et à Dubaï, le nom du prospect et le setter qui l&apos;a amené. Le
                calendrier se met à jour tout seul.
              </Step>
              <Arrow />
              <Step n={3} title="Je lis la fiche avant d'appeler" where="Clic sur le call">
                Le contexte laissé par le setter : ce que le prospect cherche, son budget, son objection, ses coordonnées.
              </Step>
              <Arrow />
              <Step n={4} title="Je rejoins la visio" where="Bouton « Rejoindre ↗ » sur le call">
                Le lien iClosed est directement sur la carte, pas besoin d&apos;ouvrir la fiche.
              </Step>
              <Arrow />
              <Step n={5} title="Je note le résultat" where="Fiche du call, bouton « Enregistrer le résultat »">
                <strong>Vendu</strong> avec le montant, <strong>Pas vendu</strong> avec la raison, <strong>No-show</strong>,{" "}
                <strong>À relancer</strong> avec la date, ou <strong>Reporté</strong> avec la nouvelle date. Ma commission et mes
                chiffres se calculent seuls.
              </Step>
              <Arrow />
              <Step n={6} title="Je fais mes relances" where="Onglet « Relances »" href="/sales/relances">
                Les prospects à rappeler, dans l&apos;ordre des dates. En retard = en haut.
              </Step>
              <Arrow />
              <Step n={7} title="Je vois où j'en suis" where="Onglet « Closers » et « Commissions »" href="/sales/closers">
                Calls honorés, taux de closing, cash encaissé, ce qu&apos;il me reste à toucher.
              </Step>
            </div>
          </Card>
        )}

        {isSetter && isCloser && (
          <Card title="J'ai les deux casquettes">
            <p className="text-[13px] leading-relaxed">
              En haut de mon accueil, deux boutons : <strong>Vue setter</strong> et <strong>Vue closer</strong>. Je clique sur la
              casquette du moment, l&apos;écran change. Le tool se souvient du dernier choix. Quand je pose un rendez-vous en tant que
              setter, je suis proposé comme closer : le call arrive dans ma vue closer.
            </p>
          </Card>
        )}

        <Card title="Les règles simples">
          <ul className="text-[13px] leading-relaxed flex flex-col gap-1.5 list-disc pl-5">
            <li>Toutes les heures du tool sont en heure de Paris, avec l&apos;heure de Dubaï à côté sur les calls.</li>
            <li>Un lead que je n&apos;ai pas encore statué est gris. Mon objectif : zéro gris en fin de journée.</li>
            <li>Je ne vois que mes leads et mes calls. Un lead sans setter est visible de tous : le premier qui l&apos;appelle le garde.</li>
            <li>Si une page semble vide alors qu&apos;il devrait y avoir quelque chose : Ctrl+F5, ou le bandeau « Recharger » en haut.</li>
            <li>Mon identifiant et mon mot de passe me sont donnés par l&apos;admin. Je me connecte sur mvdyprince.fr/login.</li>
          </ul>
        </Card>
      </div>
    </>
  );
}
