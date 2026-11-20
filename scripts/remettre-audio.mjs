/**
 * Remet l'audio d'origine d'un reel sur une vidéo générée (Seedance, Kling…),
 * sans réencoder l'image, puis la passe en 60 i/s si on le demande.
 *
 *   node scripts/remettre-audio.mjs <reel-origine.mp4> <video-generee.mp4> [--fps 60] [--sortie fichier.mp4] [--forcer]
 *
 * Étapes :
 *  1. Mesure les durées : si la vidéo générée et l'audio d'origine diffèrent
 *     de plus de 0,1 s, on s'arrête et on affiche les chiffres. Rien n'est
 *     coupé sans --forcer (et même alors, rien n'est coupé : l'audio garde
 *     sa longueur, c'est au lecteur de finir).
 *  2. Extrait la piste audio du reel telle quelle (copie, pas de réencodage).
 *  3. Remplace l'audio de la vidéo générée : image copiée, audio copié.
 *  4. Vérifie que la vidéo et l'audio démarrent à 0 et compare les durées.
 *  5. Avec --fps 30 ou 60 : interpolation de mouvement (ffmpeg minterpolate),
 *     audio recopié tel quel, donc toujours synchrone.
 *
 * Il faut ffmpeg et ffprobe dans le PATH (winget install Gyan.FFmpeg).
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const files = args.filter((a, i) => !a.startsWith("--") && !(i > 0 && ["--fps", "--sortie"].includes(args[i - 1])));
const [reel, generee] = files;
if (!reel || !generee) {
  console.error("Usage : node scripts/remettre-audio.mjs <reel-origine.mp4> <video-generee.mp4> [--fps 60] [--sortie fichier.mp4] [--forcer]");
  process.exit(1);
}
for (const f of [reel, generee]) if (!fs.existsSync(f)) {
  console.error(`Fichier introuvable : ${f}`);
  process.exit(1);
}
const fps = opt("--fps") ? Number(opt("--fps")) : 0;
if (fps && ![30, 60].includes(fps)) {
  console.error("--fps accepte 30 ou 60.");
  process.exit(1);
}
const base = path.join(path.dirname(generee), path.basename(generee, path.extname(generee)));
const sortie = opt("--sortie") ?? `${base}-audio-origine.mp4`;

function run(bin, a) {
  console.log(`$ ${bin} ${a.map((x) => (/[\s"]/.test(x) ? `"${x}"` : x)).join(" ")}`);
  return execFileSync(bin, a, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024 });
}

/** Durée et départ de chaque piste. */
function pistes(file) {
  const j = JSON.parse(execFileSync("ffprobe", ["-v", "error", "-show_entries", "stream=codec_type,start_time,duration,r_frame_rate:format=duration", "-of", "json", file], { encoding: "utf8" }));
  const v = j.streams.find((s) => s.codec_type === "video");
  const a = j.streams.find((s) => s.codec_type === "audio");
  return {
    video: v ? { debut: Number(v.start_time ?? 0), duree: Number(v.duration ?? j.format.duration), fps: v.r_frame_rate } : null,
    audio: a ? { debut: Number(a.start_time ?? 0), duree: Number(a.duration ?? j.format.duration) } : null,
  };
}
const s = (n) => `${n.toFixed(3)} s`;

const pReel = pistes(reel);
const pGen = pistes(generee);
if (!pReel.audio) {
  console.error("Le reel d'origine n'a pas de piste audio.");
  process.exit(1);
}
if (!pGen.video) {
  console.error("La vidéo générée n'a pas de piste vidéo.");
  process.exit(1);
}
console.log(`Audio d'origine : ${s(pReel.audio.duree)} · vidéo générée : ${s(pGen.video.duree)} (${pGen.video.fps} i/s)`);
const ecart = pGen.video.duree - pReel.audio.duree;
if (Math.abs(ecart) > 0.1 && !args.includes("--forcer")) {
  console.error(
    `Les durées diffèrent de ${s(Math.abs(ecart))} : la vidéo générée est plus ${ecart > 0 ? "longue" : "courte"} que l'audio d'origine.\n` +
      "Rien n'a été fait. Recale la vidéo, ou relance avec --forcer pour poser l'audio tel quel (sans rien couper).",
  );
  process.exit(2);
}

// 1. Extraction de l'audio d'origine, sans réencodage.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "remettre-audio-"));
const audio = path.join(tmp, "audio-origine.m4a");
try {
  run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-i", reel, "-map", "0:a:0", "-vn", "-c:a", "copy", audio]);

  // 2. Remplacement de l'audio : image et son copiés, aucun réencodage.
  run("ffmpeg", [
    "-hide_banner", "-loglevel", "error", "-y",
    "-i", generee, "-i", audio,
    "-map", "0:v:0", "-map", "1:a:0",
    "-c", "copy", "-movflags", "+faststart",
    sortie,
  ]);
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

// 3. Vérification.
function verifier(file) {
  const p = pistes(file);
  console.log(`${path.basename(file)} : vidéo départ ${s(p.video.debut)}, durée ${s(p.video.duree)} (${p.video.fps} i/s) · audio départ ${s(p.audio.debut)}, durée ${s(p.audio.duree)}`);
  if (p.video.debut !== 0 || p.audio.debut !== 0) console.warn("Attention : une piste ne démarre pas à 0.");
  return p;
}
verifier(sortie);
console.log(`✓ ${sortie}`);

// 4. Interpolation en 30 ou 60 i/s, audio recopié tel quel.
if (fps) {
  const sortieFps = sortie.replace(/\.mp4$/i, `-${fps}fps.mp4`);
  const t0 = Date.now();
  run("ffmpeg", [
    "-hide_banner", "-loglevel", "error", "-y",
    "-i", sortie,
    "-map", "0:v:0", "-map", "0:a:0",
    // tpad + trim : minterpolate perd la dernière fraction de seconde ; on prolonge
    // la dernière image puis on recoupe à la durée exacte de la vidéo.
    "-filter:v", `tpad=stop_mode=clone:stop_duration=0.5,minterpolate=fps=${fps}:mi_mode=mci:mc_mode=aobmc:me_mode=bidir:vsbmc=1,trim=duration=${pistes(sortie).video.duree.toFixed(3)},setpts=PTS-STARTPTS`,
    "-c:v", "libx264", "-preset", "slow", "-crf", "17", "-pix_fmt", "yuv420p",
    "-c:a", "copy", "-movflags", "+faststart",
    sortieFps,
  ]);
  console.log(`Interpolation : ${Math.round((Date.now() - t0) / 1000)} s`);
  verifier(sortieFps);
  console.log(`✓ ${sortieFps}`);
}
