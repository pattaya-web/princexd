/**
 * Catalogue des modeles KIE utilisables depuis le Studio.
 * Les identifiants suivent le marketplace KIE (docs.kie.ai/market/...).
 * `fields` decrit le formulaire ; tout est envoye tel quel dans `input`.
 */

export type FieldType = "text" | "textarea" | "select" | "number" | "url" | "urls";

export interface ModelField {
  key: string;
  label: string;
  type: FieldType;
  options?: string[];
  placeholder?: string;
  default?: string | number;
  required?: boolean;
  help?: string;
}

export interface ModelDef {
  id: string;
  name: string;
  kind: "image" | "video";
  vendor: string;
  blurb: string;
  /** Cout indicatif en credits, pour estimer avant de lancer. */
  approxCredits: number;
  fields: ModelField[];
}

const ASPECTS_IMG = ["1:1", "9:16", "16:9", "3:4", "4:3", "2:3", "3:2", "4:5", "auto"];

const promptField = (placeholder: string): ModelField => ({
  key: "prompt",
  label: "Prompt",
  type: "textarea",
  required: true,
  placeholder,
});

export const MODELS: ModelDef[] = [
  {
    id: "google/nano-banana",
    name: "Nano Banana",
    kind: "image",
    vendor: "Google",
    blurb: "Rapide et peu cher. Le cheval de bataille pour les visuels de post et les fonds de carrousel.",
    approxCredits: 4,
    fields: [
      promptField("Un bureau minimaliste avec deux ecrans affichant un dashboard Shopify, lumiere naturelle, photo realiste"),
      { key: "aspect_ratio", label: "Format", type: "select", options: ASPECTS_IMG, default: "4:5" },
      { key: "output_format", label: "Fichier", type: "select", options: ["png", "jpeg"], default: "png" },
    ],
  },
  {
    id: "google/nano-banana-edit",
    name: "Nano Banana - Edit",
    kind: "image",
    vendor: "Google",
    blurb: "Retouche une image existante depuis un prompt : change le decor, le texte, la tenue.",
    approxCredits: 4,
    fields: [
      promptField("Remplace le fond par une terrasse a Dubai au coucher du soleil, garde le sujet identique"),
      { key: "image_urls", label: "Images source (une URL par ligne)", type: "urls", required: true },
      { key: "output_format", label: "Fichier", type: "select", options: ["png", "jpeg"], default: "png" },
    ],
  },
  {
    id: "google/nano-banana-pro",
    name: "Nano Banana Pro",
    kind: "image",
    vendor: "Google",
    blurb: "Qualite superieure et meilleur rendu du texte incruste. Pour les covers de reel.",
    approxCredits: 24,
    fields: [
      promptField("Cover de reel : fond noir, gros texte blanc, style editorial, tres contraste"),
      { key: "aspect_ratio", label: "Format", type: "select", options: ASPECTS_IMG, default: "9:16" },
      { key: "output_format", label: "Fichier", type: "select", options: ["png", "jpeg"], default: "png" },
    ],
  },
  {
    id: "bytedance/seedream-v4-text-to-image",
    name: "Seedream v4",
    kind: "image",
    vendor: "ByteDance",
    blurb: "Tres bon en photo lifestyle et en personnages. L'alternative quand Nano Banana rend trop lisse.",
    approxCredits: 6,
    fields: [
      promptField("Homme 25 ans en hoodie noir devant un laptop dans un cafe, photo iPhone, grain leger"),
      { key: "image_size", label: "Format", type: "select", options: ASPECTS_IMG, default: "4:5" },
    ],
  },
  {
    id: "google/veo3-fast",
    name: "Veo 3.1 Fast",
    kind: "video",
    vendor: "Google",
    blurb: "Video 8s avec le son. Meilleur rapport qualite/prix pour du B-roll.",
    approxCredits: 60,
    fields: [
      promptField("Plan serre sur des mains qui scrollent un dashboard Shopify, lumiere chaude, camera fixe"),
      { key: "aspect_ratio", label: "Format", type: "select", options: ["9:16", "16:9"], default: "9:16" },
      { key: "enableTranslation", label: "Traduire le prompt en anglais", type: "select", options: ["true", "false"], default: "true" },
    ],
  },
  {
    id: "google/veo3",
    name: "Veo 3.1 Quality",
    kind: "video",
    vendor: "Google",
    blurb: "La version haut de gamme de Veo. A garder pour les plans heros.",
    approxCredits: 300,
    fields: [
      promptField("Travelling avant dans un loft moderne au lever du soleil, ambiance cinema"),
      { key: "aspect_ratio", label: "Format", type: "select", options: ["9:16", "16:9"], default: "9:16" },
    ],
  },
  {
    id: "sora-2-text-to-video",
    name: "Sora 2",
    kind: "video",
    vendor: "OpenAI",
    blurb: "Excellent en scenes realistes et en mouvement de camera naturel.",
    approxCredits: 30,
    fields: [
      promptField("POV : quelqu'un ouvre son telephone et voit 47 notifications de commandes Shopify"),
      { key: "aspect_ratio", label: "Format", type: "select", options: ["portrait", "landscape"], default: "portrait" },
    ],
  },
  {
    id: "sora-2-image-to-video",
    name: "Sora 2 - Image to Video",
    kind: "video",
    vendor: "OpenAI",
    blurb: "Anime une image fixe. Parfait pour transformer un visuel genere en plan de B-roll.",
    approxCredits: 30,
    fields: [
      promptField("La camera recule lentement, la personne se retourne vers l'objectif"),
      { key: "image_urls", label: "Image de depart (URL)", type: "urls", required: true },
      { key: "aspect_ratio", label: "Format", type: "select", options: ["portrait", "landscape"], default: "portrait" },
    ],
  },
  {
    id: "kling/v2-1-master-text-to-video",
    name: "Kling 2.1 Master",
    kind: "video",
    vendor: "Kuaishou",
    blurb: "Mouvement tres fluide, bon pour les plans produit et les transitions.",
    approxCredits: 100,
    fields: [
      promptField("Rotation lente autour d'un colis e-commerce sur fond blanc, lumiere studio"),
      { key: "aspect_ratio", label: "Format", type: "select", options: ["9:16", "16:9", "1:1"], default: "9:16" },
      { key: "duration", label: "Duree (s)", type: "select", options: ["5", "10"], default: "5" },
    ],
  },
];

export function getModel(id: string) {
  return MODELS.find((m) => m.id === id);
}
