/**
 * Lecture et réécriture du zip du thème template, sans passer par Shopify.
 *
 * Deux usages :
 *  - produire un « thème prêt » (recoloré, textes d'accueil réécrits) à
 *    importer à la main quand l'API refuse d'installer le thème ;
 *  - lister les médias que le template attend (images et vidéos référencées
 *    en `shopify://shop_images/…`) : après import dans une autre boutique,
 *    ces fichiers n'existent pas et les visuels sont vides tant qu'on ne
 *    les a pas déposés dans Contenu → Fichiers avec exactement le même nom.
 */
import fs from "fs/promises";
import path from "path";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { getSettings } from "../db";

export const THEME_DIR = path.join(process.cwd(), "data", "boutiques");

export type ThemeFiles = Record<string, Uint8Array>;

/** Décompresse et enlève le dossier racine éventuel (export Shopify : `theme-name/`). */
export function readThemeZip(buf: Uint8Array): ThemeFiles {
  const raw = unzipSync(buf);
  const names = Object.keys(raw).filter((n) => !n.endsWith("/"));
  const first = names[0]?.split("/")[0] ?? "";
  const rooted = Boolean(first) && names.every((n) => n.startsWith(`${first}/`)) && !names.includes("config/settings_schema.json");
  const out: ThemeFiles = {};
  for (const n of names) out[rooted ? n.slice(first.length + 1) : n] = raw[n];
  return out;
}

export function writeThemeZip(files: ThemeFiles): Uint8Array {
  return zipSync(files, { level: 6 });
}

/** JSON Shopify : BOM et commentaires `/* … *\/` en tête sont tolérés. */
export function parseThemeJson<T>(text: string): T {
  const clean = text.replace(/^﻿/, "").replace(/^\s*\/\*[\s\S]*?\*\/\s*/, "");
  return JSON.parse(clean) as T;
}

export function fileText(files: ThemeFiles, name: string): string | null {
  const f = files[name];
  return f ? strFromU8(f) : null;
}

/** Le zip template déposé dans l'outil, ou null. */
export async function loadTemplateZip(): Promise<{ files: ThemeFiles; name: string } | null> {
  const z = getSettings().shopThemeZip;
  if (!z?.file) return null;
  try {
    const buf = await fs.readFile(path.join(THEME_DIR, z.file));
    return { files: readThemeZip(new Uint8Array(buf)), name: z.name };
  } catch {
    return null;
  }
}

/** Écrit un zip « prêt » (fichiers remplacés) et renvoie son nom sur le disque. */
export async function saveReadyZip(files: ThemeFiles, replaced: { filename: string; content: string }[], buildId: string): Promise<string> {
  const next: ThemeFiles = { ...files };
  for (const r of replaced) next[r.filename] = strToU8(r.content);
  const name = `ready-${buildId}.zip`;
  await fs.mkdir(THEME_DIR, { recursive: true });
  await fs.writeFile(path.join(THEME_DIR, name), writeThemeZip(next));
  return name;
}

/* ------------------------------ Médias --------------------------------- */

export interface MediaSlot {
  /** « Accueil », « En-tête », « Pied de page », « Réglages du thème ». */
  page: string;
  sectionId: string;
  sectionName: string;
  blockName: string;
  label: string;
  kind: "image" | "video";
  /** Valeur actuelle dans le template (`shopify://shop_images/x.png`), vide si rien. */
  value: string;
  /** Nom de fichier attendu dans Contenu → Fichiers. */
  file: string;
}

interface SchemaSetting {
  type?: string;
  id?: string;
  label?: string;
}
interface SectionSchema {
  name?: string;
  settings?: SchemaSetting[];
  blocks?: { type?: string; name?: string; settings?: SchemaSetting[] }[];
}
interface SectionInstance {
  type?: string;
  settings?: Record<string, unknown>;
  blocks?: Record<string, { type?: string; settings?: Record<string, unknown> }>;
}
interface TemplateJson {
  sections?: Record<string, SectionInstance>;
  order?: string[];
}

const MEDIA_TYPES: Record<string, "image" | "video"> = { image_picker: "image", video: "video", video_url: "video" };

function sectionSchemas(files: ThemeFiles): Record<string, SectionSchema> {
  const out: Record<string, SectionSchema> = {};
  for (const name of Object.keys(files)) {
    const m = name.match(/^sections\/([^/]+)\.liquid$/);
    if (!m) continue;
    const src = strFromU8(files[name]);
    const sm = src.match(/{%-?\s*schema\s*-?%}([\s\S]*?){%-?\s*endschema\s*-?%}/);
    if (!sm) continue;
    try {
      out[m[1]] = JSON.parse(sm[1]) as SectionSchema;
    } catch {
      /* schéma illisible : section ignorée */
    }
  }
  return out;
}

function fileNameOf(value: unknown): string {
  if (typeof value !== "string" || !value) return "";
  const m = value.match(/^shopify:\/\/(?:shop_images|files\/[\w/-]+?)\/([^/?#]+)$/);
  if (m) return decodeURIComponent(m[1]);
  if (/^https?:\/\//.test(value)) return decodeURIComponent(value.split("/").pop()?.split("?")[0] ?? "");
  return "";
}

const PAGES: { file: string; page: string }[] = [
  { file: "templates/index.json", page: "Accueil" },
  { file: "sections/header-group.json", page: "En-tête" },
  { file: "sections/footer-group.json", page: "Pied de page" },
  { file: "templates/product.json", page: "Fiche produit" },
];

/** Tous les emplacements image / vidéo du template, avec le fichier attendu. */
export function mediaSlots(files: ThemeFiles): MediaSlot[] {
  const schemas = sectionSchemas(files);
  const slots: MediaSlot[] = [];
  const push = (page: string, sid: string, sectionName: string, blockName: string, def: SchemaSetting, value: unknown) => {
    const kind = MEDIA_TYPES[def.type ?? ""];
    if (!kind) return;
    const v = typeof value === "string" ? value : "";
    slots.push({ page, sectionId: sid, sectionName, blockName, label: def.label ?? def.id ?? "", kind, value: v, file: fileNameOf(v) });
  };

  for (const { file, page } of PAGES) {
    const text = fileText(files, file);
    if (!text) continue;
    let tpl: TemplateJson;
    try {
      tpl = parseThemeJson<TemplateJson>(text);
    } catch {
      continue;
    }
    const order = tpl.order?.length ? tpl.order : Object.keys(tpl.sections ?? {});
    for (const sid of order) {
      const inst = tpl.sections?.[sid];
      if (!inst?.type) continue;
      const schema = schemas[inst.type];
      if (!schema) continue;
      const sectionName = schema.name ?? inst.type;
      for (const def of schema.settings ?? []) push(page, sid, sectionName, "", def, inst.settings?.[def.id ?? ""]);
      for (const [, block] of Object.entries(inst.blocks ?? {})) {
        const bschema = schema.blocks?.find((b) => b.type === block.type);
        if (!bschema) continue;
        for (const def of bschema.settings ?? []) push(page, sid, sectionName, bschema.name ?? block.type ?? "", def, block.settings?.[def.id ?? ""]);
      }
    }
  }

  // Réglages globaux du thème (logos, favicon…).
  const schemaText = fileText(files, "config/settings_schema.json");
  const dataText = fileText(files, "config/settings_data.json");
  if (schemaText && dataText) {
    try {
      const schema = parseThemeJson<{ name?: string; settings?: SchemaSetting[] }[]>(schemaText);
      const data = parseThemeJson<{ current?: Record<string, unknown> | string; presets?: Record<string, Record<string, unknown>> }>(dataText);
      const current = typeof data.current === "string" ? data.presets?.[data.current] ?? {} : data.current ?? {};
      for (const group of schema) {
        for (const def of group.settings ?? []) {
          if (!MEDIA_TYPES[def.type ?? ""]) continue;
          push("Réglages du thème", "settings", group.name ?? "Réglages", "", def, current[def.id ?? ""]);
        }
      }
    } catch {
      /* réglages illisibles : ignorés */
    }
  }
  return slots;
}

/** Ratio conseillé pour un emplacement, déduit du nom de la section et du libellé. */
export function ratioFor(slot: MediaSlot): string {
  const t = `${slot.sectionName} ${slot.blockName} ${slot.label}`.toLowerCase();
  if (slot.kind === "video") return /16:9|hero|banner|landscape/.test(t) ? "16:9" : "9:16";
  if (/logo|favicon/.test(t)) return "logo (PNG transparent)";
  if (/9:16|story|stories|reel|vertical/.test(t)) return "9:16";
  if (/16:9|hero|banner|slideshow|slide|cover|wide/.test(t)) return "16:9";
  if (/before|after|avant|après|pair/.test(t)) return "4:5";
  if (/review|avis|testimon|bubble|product|produit|icon|thumb|avatar|portrait/.test(t)) return "1:1";
  return "4:5";
}

export interface MediaGroup {
  /** Ex. « Photos avis clients ». */
  title: string;
  page: string;
  ratio: string;
  kind: "image" | "video";
  files: string[];
}

/** Regroupe les emplacements par section + ratio, un fichier n'apparaît qu'une fois. */
export function mediaGroups(slots: MediaSlot[]): MediaGroup[] {
  const seen = new Set<string>();
  const groups = new Map<string, MediaGroup>();
  for (const s of slots) {
    if (!s.file || seen.has(s.file.toLowerCase())) continue;
    seen.add(s.file.toLowerCase());
    const ratio = ratioFor(s);
    const key = `${s.page}|${s.sectionName}|${s.blockName}|${ratio}`;
    const g = groups.get(key) ?? { title: [s.sectionName, s.blockName].filter(Boolean).join(" › "), page: s.page, ratio, kind: s.kind, files: [] };
    g.files.push(s.file);
    groups.set(key, g);
  }
  return Array.from(groups.values());
}

/**
 * Le message à envoyer à l'élève, prêt à coller : méthode (image de
 * référence → Higgsfield GPT Image 2 → prompts écrits par Claude → bons
 * ratios), liste des médias du template, et le prompt à donner à Claude.
 */
export function studentMessage(slots: MediaSlot[], brandName: string): string {
  const groups = mediaGroups(slots);
  const images = groups.filter((g) => g.kind === "image" && !/logo/.test(g.ratio));
  const logos = groups.filter((g) => g.kind === "image" && /logo/.test(g.ratio));
  const videos = groups.filter((g) => g.kind === "video");
  const nImg = images.reduce((n, g) => n + g.files.length, 0);
  const nVid = videos.reduce((n, g) => n + g.files.length, 0);
  const nLogo = logos.reduce((n, g) => n + g.files.length, 0);
  const brand = brandName || "[nom de la marque]";
  const L: string[] = [];
  L.push(`Salut [prénom], ta boutique ${brand} est générée : produits, collection, pages, thème. Il reste les médias, et c'est toi qui les fais et les places. Voilà la méthode, simple et carrée.`);
  L.push("");
  L.push("MÉTHODE");
  L.push("1. Récupère l'image de référence de ton produit (site concurrent ou AliExpress) : la plus nette possible, produit bien visible, fond simple.");
  L.push("2. Va sur Higgsfield → modèle GPT Image 2 → importe cette image en référence. Le produit doit rester strictement identique sur toutes les images (forme, couleur, logo).");
  L.push("3. AVANT d'écrire tes prompts : ouvre Claude et colle-lui le bloc « PROMPT POUR CLAUDE » en bas de ce message, crochets remplis. Il te rend un prompt propre par visuel.");
  L.push("4. Colle chaque prompt dans Higgsfield, avec le ratio indiqué dans la liste (c'est le ratio qui fait que ça rentre pile dans le thème). Génère, garde la meilleure.");
  L.push("5. Place chaque image dans le thème : admin Shopify → Boutique en ligne → Thèmes → Personnaliser → la section indiquée. Remplace aussi les photos produit sur chaque fiche produit (Produits → le produit → Médias).");
  L.push("6. Quand tout est en place, envoie-moi le lien de la boutique.");
  L.push("");
  if (groups.length) {
    L.push(`MÉDIAS À PRODUIRE : ${nImg} images${nVid ? `, ${nVid} vidéos` : ""}${nLogo ? ` (+ ${nLogo} logos presse, voir plus bas)` : ""}`);
    let page = "";
    for (const g of images) {
      if (g.page !== page) {
        page = g.page;
        L.push(`» ${page}`);
      }
      L.push(`- ${g.files.length} image${g.files.length > 1 ? "s" : ""} · ratio ${g.ratio} · section « ${g.title} »`);
    }
    if (videos.length) {
      L.push("» Vidéos");
      for (const g of videos) L.push(`- ${g.files.length} vidéo${g.files.length > 1 ? "s" : ""} · ${g.ratio} · section « ${g.title} » (${g.page}) : à faire dans le Studio IA (onglet Création) à partir d'une image générée, ou dis-moi et je les fais.`);
    }
    if (logos.length) {
      L.push(`» Logos presse (${nLogo}) : la section « ${logos[0].title} » affiche des logos de médias. Soit tu as de vraies parutions et tu mets leurs logos (PNG transparent, monochrome), soit tu retires la section dans Personnaliser. On n'invente pas de logos.`);
    }
  } else {
    L.push("MÉDIAS À PRODUIRE : dépose le zip du template dans l'outil pour avoir la liste exacte, ratio par ratio.");
  }
  L.push("");
  L.push("Formats : JPG ou PNG, 1600 px minimum sur le grand côté (2000 px pour le 16:9). Pas de texte dans l'image, pas de logo inventé, pas de filtre, peau réelle, lumière naturelle.");
  L.push("");
  L.push("PROMPT POUR CLAUDE (copie tout le bloc, remplis les crochets)");
  L.push("----");
  L.push(`Tu es directeur artistique e-commerce. Ma marque : ${brand}. Mon produit : [description précise : ce que c'est, matière, couleur, taille, ce qu'il fait]. Ma cible : [qui achète, âge, besoin]. Ton de marque : [ex. clean et premium / naturel et chaleureux / sportif]. Ma boutique est en [français / anglais].`);
  L.push("J'ai une image de référence du produit que je mets en référence dans Higgsfield (GPT Image 2) : le produit doit rester strictement identique sur chaque image (forme, couleurs, matière, logo), interdiction de le redessiner.");
  L.push("Écris-moi UN prompt par image de la liste ci-dessous, en anglais, prêt à coller dans GPT Image 2. Chaque prompt : photo-réaliste, style photo smartphone ou studio selon la section, personne crédible si besoin (pas de visage de célébrité), cadrage adapté au ratio, lumière naturelle, peau réelle, fond cohérent avec la marque, aucun texte dans l'image, aucun logo inventé. Termine chaque prompt par ce qu'il faut éviter.");
  L.push("Présente le résultat en liste : numéro, section, ratio, puis le prompt dans un bloc à copier. Pour les photos avis clients, varie les personnes, les lieux et les gestes. Pour les avant / après, même personne, même cadrage, même lumière, seule la différence promise change.");
  L.push("Liste des images :");
  if (groups.length) {
    for (const g of images) L.push(`- ${g.files.length} × ratio ${g.ratio} · ${g.title} (${g.page})`);
  } else {
    L.push("- [colle ici la liste des médias]");
  }
  L.push("----");
  return L.join("\n");
}

/** Brief texte pour les élèves : quels fichiers produire, avec quel nom. */
export function mediaBrief(slots: MediaSlot[], brandName: string): string {
  const used = slots.filter((s) => s.file);
  const lines: string[] = [];
  lines.push(`Médias à produire pour la boutique ${brandName || ""}`.trim());
  lines.push("");
  lines.push("Règle : chaque fichier doit porter EXACTEMENT le nom indiqué (même extension). Il sera déposé dans Shopify → Contenu → Fichiers, et le site l'affichera tout seul à la bonne place.");
  lines.push("Images : JPG, PNG ou WebP, 1600 px de large minimum pour les grandes images, 800 px pour les petites (logos, avis). Vidéos : MP4, moins de 20 Mo.");
  lines.push("");
  let page = "";
  for (const s of used) {
    if (s.page !== page) {
      page = s.page;
      lines.push(`## ${page}`);
    }
    const where = [s.sectionName, s.blockName].filter(Boolean).join(" › ");
    lines.push(`- ${s.file}  (${s.kind === "video" ? "vidéo" : "image"} · ${where} · ${s.label})`);
  }
  const empty = slots.filter((s) => !s.file);
  if (empty.length) {
    lines.push("");
    lines.push(`Emplacements vides dans le template (facultatifs) : ${empty.length}.`);
  }
  return lines.join("\n");
}
