"use client";

import { useEffect, useState } from "react";
import { Card, CopyButton, useToast } from "@/components/ui";
import { api } from "@/lib/client";
import { relative } from "@/lib/format";
import type { ReelStats } from "@/lib/reels";

/**
 * Installer et relier l'extension Chrome « Mvdy Reels » : le zip, les
 * etapes, le jeton a coller, et l'etat de la capture. Dit aussi clairement
 * ce que l'API Instagram ne permet pas (feed « Pour toi », like).
 */
export function ExtensionSetup({ stats }: { stats: ReelStats | null }) {
  const toast = useToast();
  const [token, setToken] = useState<string>("");
  const [show, setShow] = useState(false);
  useEffect(() => {
    api<{ token: string }>("/api/reels/token").then((r) => setToken(r.token)).catch((e: Error) => toast(e.message, "err"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const regenerate = async () => {
    if (!window.confirm("Nouveau jeton ? L'ancien ne marchera plus : il faudra recoller le nouveau dans l'extension.")) return;
    try {
      const r = await api<{ token: string }>("/api/reels/token", { method: "POST" });
      setToken(r.token);
      toast("Nouveau jeton créé. Colle-le dans l'extension.");
    } catch (e) {
      toast((e as Error).message, "err");
    }
  };
  const origin = typeof window !== "undefined" ? window.location.origin : "https://mvdyprince.fr";

  return (
    <div className="grid lg:grid-cols-[1.2fr_1fr] gap-4 items-start">
      <Card title="Installer l'extension Chrome (une fois)" subtitle="Déjà installée ? Retélécharge le zip, remplace les fichiers du dossier, puis chrome://extensions → bouton ↻ de Mvdy Reels (version 1.2.1 : pilote auto lancé depuis le tool, like). Le badge en bas à gauche d'Instagram affiche la version qui tourne..">
        <ol className="flex flex-col gap-2.5 text-[13.5px] leading-relaxed">
          <Step n={1}>
            <a className="btn btn-sm btn-primary" href="/extension/mvdy-reels.zip" download>
              Télécharger mvdy-reels.zip
            </a>{" "}
            puis dézippe-le dans un dossier que tu gardes (ex. Documents/mvdy-reels).
          </Step>
          <Step n={2}>
            Dans Chrome, ouvre <code className="px-1 rounded" style={{ background: "var(--surface-3)" }}>chrome://extensions</code>, active <b>Mode développeur</b> (en haut à droite), clique <b>Charger l&apos;extension non empaquetée</b> et choisis le dossier dézippé.
          </Step>
          <Step n={3}>
            Clique l&apos;icône de l&apos;extension (épingle-la), colle le <b>jeton</b> ci-contre, vérifie l&apos;adresse <code className="px-1 rounded" style={{ background: "var(--surface-3)" }}>{origin}</code>, puis <b>Tester la connexion</b>.
          </Step>
          <Step n={4}>
            Va sur <a className="underline" href="https://www.instagram.com/reels/" target="_blank" rel="noreferrer">instagram.com/reels</a> et scrolle comme d&apos;habitude. Un petit compteur bleu en bas à gauche confirme les envois. Reviens ici : onglet <b>Découvrir</b>.
          </Step>
          <Step n={5}>
            Pour ne jamais tomber à court : bouton <b>▶ Remplir ma file</b> (onglet Découvrir). Il ouvre instagram.com/reels dans un onglet et le pilote automatique de l&apos;extension se lance tout seul : elle scrolle à ta place (2 à 4 s par Reel, 150 par heure max) tant que l&apos;onglet reste ouvert, même en arrière-plan. Ferme l&apos;onglet pour arrêter. Coche aussi <b>Liker depuis le tool</b> pour que le bouton ♥ like le Reel sur Instagram en un clic.
          </Step>
        </ol>
        <div className="mt-4 rounded-lg px-3.5 py-3 text-[12.5px] leading-relaxed" style={{ background: "var(--surface-2)", border: "1px solid var(--border)" }}>
          <div className="font-semibold mb-1">Pourquoi une extension, et pas l&apos;API Instagram ?</div>
          L&apos;API officielle de Meta ne donne ni le feed personnalisé « Pour toi », ni la vidéo des Reels des autres comptes, ni le like d&apos;un Reel d&apos;autrui ; et Instagram bloque notre serveur. L&apos;extension lit simplement, dans <b>ton</b> Chrome connecté, les Reels que ton feed t&apos;affiche déjà, et les envoie ici (fiche + fichier vidéo). Elle ne publie rien à ta place et ne like que sur ton clic : le bouton <b>♥</b> du tool ouvre le Reel dans ton Instagram et clique « J&apos;aime » (option « Liker depuis le tool »). Un clic = un like, du vrai compte. Le pilote automatique scrolle ton feed à ta place, à un rythme humain : ça reste ton navigateur et ton compte, mais c&apos;est de l&apos;automatisation, Instagram peut ne pas aimer si on exagère, d&apos;où le plafond.
        </div>
      </Card>

      <div className="flex flex-col gap-4">
        <Card title="Jeton de l'extension">
          <div className="flex items-center gap-2">
            <input className="input flex-1 !text-[12.5px] font-mono" readOnly value={show ? token : token ? "•".repeat(24) : "…"} />
            <button type="button" className="btn btn-sm" onClick={() => setShow((v) => !v)}>
              {show ? "Masquer" : "Voir"}
            </button>
            {token && <CopyButton text={token} label="Copier" />}
          </div>
          <div className="flex items-center justify-between mt-2.5">
            <span className="dim text-[11.5px]">À coller une fois dans l&apos;extension. Ne le partage pas.</span>
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => void regenerate()}>
              Nouveau jeton
            </button>
          </div>
        </Card>
        <Card title="État de la capture">
          {stats ? (
            <div className="grid grid-cols-2 gap-2 text-[13px]">
              <Kv k="Dernier Reel reçu" v={stats.lastCaptureAt ? relative(stats.lastCaptureAt) : "jamais"} />
              <Kv k="À trier" v={String(stats.queue)} />
              <Kv k="Gardés" v={`${stats.kept} (${stats.keptToday} aujourd'hui)`} />
              <Kv k="Passés" v={String(stats.skipped)} />
              <Kv k="Vidéos sur le serveur" v={`${(stats.bytes / 1024 / 1024).toFixed(0)} Mo`} />
            </div>
          ) : (
            <div className="dim text-[13px]">…</div>
          )}
          <p className="dim text-[11.5px] mt-3 leading-relaxed">Les vidéos des Reels passés sont effacées après 2 jours, les Reels passés oubliés après 30 jours, les Reels jamais triés après 3 semaines. Les Reels gardés restent (leur vidéo sert à la Swipe file).</p>
        </Card>
      </div>
    </div>
  );
}

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="shrink-0 w-[24px] h-[24px] rounded-full flex items-center justify-center text-[11.5px] font-bold" style={{ background: "var(--accent)", color: "#fff" }}>
        {n}
      </span>
      <span>{children}</span>
    </li>
  );
}

function Kv({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <div className="label-xs">{k}</div>
      <div className="font-semibold num mt-0.5">{v}</div>
    </div>
  );
}
