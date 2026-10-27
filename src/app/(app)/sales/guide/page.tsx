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
                  { label: "Agenda", sub: "arrive tout seul, « par Noa »", color: COLOR.green },
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
            <Card title="Ma journée de setter" subtitle="Ce que je fais chaque jour, au cas où j'oublie. Dans l'ordre.">
              <div className="flex flex-col">
                <Step n={1} title="Je pointe" where="Accueil, bouton « ▶ Démarrer ma session »" href="/sales">
                  En arrivant je démarre ma session, en partant je clique « ■ Terminer ». Mes heures sont comptées.
                </Step>
                <Arrow />
                <Step n={2} title="Je réponds aux DM le plus vite possible, et je les traite tous" where="Instagram">
                  Aucun DM sans réponse. Je qualifie bien chaque personne : où elle en est, ce qu&apos;elle veut, si elle a le budget et
                  l&apos;envie de passer à l&apos;action maintenant. Un prospect chaud reçoit <strong>mon lien de calendrier signé</strong>,
                  pas un autre : il porte mon nom, le rendez-vous m&apos;est attribué quand il réserve.
                </Step>
                <Arrow />
                <Step n={3} title="Je vais chercher ceux qui ont liké les reels value" where="Instagram, les likes des reels où Mady parle technique">
                  Les gens qui likent les reels value (les plus techniques) sont déjà un cran plus avancés et plus chauds : j&apos;ouvre la
                  discussion avec eux en priorité.
                </Step>
                <Arrow />
                <Step n={4} title="Je confirme chaque call deux fois sur WhatsApp" where="Accueil, « Tes prochains rendez-vous », pastilles « WA 24 h » et « WA 1 h »" href="/sales">
                  <strong>24 h avant</strong> le call, j&apos;écris au prospect sur WhatsApp et je clique « WA 24 h ». <strong>1 h avant</strong>,
                  je lui réécris et je clique « WA 1 h ». Deux pastilles vertes = rendez-vous confirmé. Le bloc « Ce qui demande une action »
                  me dit lesquelles sont à envoyer maintenant.
                </Step>
                <Arrow />
                <Step n={5} title="Je coche ma task list" where="Accueil, bloc « Task list »" href="/sales">
                  Les trois gestes du jour, cochés au fur et à mesure. La liste se remet à zéro chaque matin.
                </Step>
                <Arrow />
                <Step n={6} title="Si j'ai envoyé mon lien à quelqu'un, je peux le noter" where="Accueil, bloc « Liens envoyés », bouton « + J'ai envoyé le lien »" href="/sales">
                  Pense-bête : à qui, comment, pourquoi. Quand la réservation arrive, la ligne passe « a réservé », puis suit le call.
                </Step>
                <Arrow />
                <Step n={7} title="Je garde mes scripts qui marchent" where="Onglet « Messages types »" href="/sales/messages">
                  Je crée mes propres scripts, un par contexte (première approche, relance, envoi du lien…), et je note ce qui a le mieux
                  posé des rendez-vous. Avec le temps, je sais quelle approche marche.
                </Step>
                <Arrow />
                <Step n={8} title="Je regarde mes performances" where="Accueil, tout en haut" href="/sales">
                  Rendez-vous posés, taux de présence, closés, pitchés pas closés, ma commission. Chaque tuile s&apos;ouvre sur les noms.
                  C&apos;est Mady (le closer) qui statue chaque call : le résultat remonte tout seul sur mes rendez-vous.
                </Step>
              </div>
            </Card>

            <Card title="Les règles qui comptent">
              <ul className="text-[13px] leading-relaxed flex flex-col gap-1.5 list-disc pl-5">
                <li>
                  <strong>Seules les réservations faites par mon lien signé</strong> (ou par un prospect à qui j&apos;ai déclaré l&apos;avoir envoyé)
                  sont à moi. Elles arrivent sur mon agenda et comptent dans mes chiffres et ma commission.
                </li>
                <li>Double confirmation WhatsApp sur chaque call : 24 h avant, 1 h avant. C&apos;est le geste anti no-show.</li>
                <li>Le résultat d&apos;un call (venu, no-show, closé, pas closé) est posé par le closer ; je le vois sur ma fiche et mes tuiles.</li>
              </ul>
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
              <Step n={6} title="Je fais mes relances" where="CRM → vue « À relancer »" href="/sales/rendez-vous?view=followup">
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
            <li>
              <strong>Règle de l&apos;heure.</strong> Si je ne réponds pas à un prospect pendant 1 heure (aucune action notée dans le tool sur
              sa fiche), n&apos;importe quel autre setter peut reprendre la conversation : il clique « Reprendre », le lead devient le sien,
              je reçois un message Telegram. Un rappel ou une relance programmés suspendent le compteur. Ce que je ne note pas n&apos;existe
              pas : après chaque échange, un statut et une note.
            </li>
            <li>
              <strong>Bonus et malus.</strong> Mady lit les conversations. Un setting propre (prospect réellement qualifié, notes claires,
              rendez-vous bien préparés) donne droit à un bonus sur mes commissions, en euros ou en pourcentage du mois. Un setting bâclé ou
              des conversations laissées dormir peuvent donner un malus. Tout est visible dans Commissions, avec le motif.
            </li>
            <li>
              <strong>Rappels Telegram.</strong> J&apos;active mes rappels depuis mon accueil (bouton « Activer mes rappels Telegram »). Je reçois
              un rappel toutes les heures pendant mes horaires, un avertissement quand une de mes conversations dort, et un message si un
              autre setter reprend un de mes leads.
            </li>
            <li>Si une page semble vide alors qu&apos;il devrait y avoir quelque chose : Ctrl+F5, ou le bandeau « Recharger » en haut.</li>
            <li>Mon identifiant et mon mot de passe me sont donnés par l&apos;admin. Je me connecte sur mvdyprince.fr/login.</li>
          </ul>
        </Card>
      </div>
    </>
  );
}
