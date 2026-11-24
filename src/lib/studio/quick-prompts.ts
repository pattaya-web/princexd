/**
 * Prompts prêts à copier (onglet « Prompts » du Studio, admin seulement).
 * Pour en ajouter un : une entrée de plus dans QUICK_PROMPTS, rien d'autre à toucher.
 */

export interface QuickPrompt {
  id: string;
  title: string;
  /** Contexte affiché au-dessus (quand l'utiliser). */
  intro?: string;
  /** Partie du Studio + réglages (en gras « Partie Image : … »). */
  part: { label: string; text: string };
  /** Ce qu'on met dans chaque case du Studio. */
  slots?: { slot: string; value: string }[];
  prompt: string;
}

export interface QuickPromptGroup {
  id: string;
  label: string;
  prompts: QuickPrompt[];
  /** Rappel affiché sous le groupe. */
  footer?: string;
}

export const QUICK_PROMPTS: QuickPromptGroup[] = [
  {
    id: "avatar-swap",
    label: "Avatar + swap reel",
    footer: "Pour toutes les vidéos, tu remets le son du reel d'origine au montage.",
    prompts: [
      {
        id: "image-1",
        title: "Image 1 : créer la planche d'un nouvel avatar",
        intro: "À faire une seule fois par avatar. Ava a déjà la sienne.",
        part: {
          label: "Partie Image",
          text: "GPT Image 2.5, ratio 16:9, aucune photo à uploader. Remplace le texte entre crochets par la description de ta fille.",
        },
        prompt: `Create a character reference sheet of ONE woman, 3 vertical panels side by side, separated by thin white gaps.

THE WOMAN: [DESCRIBE HER: age, ethnicity, skin tone, face shape, eye color, eyebrows, nose, lips, hair color, length and style, body type, e.g. 25 years old, light olive skin, oval face, hazel eyes, thick brows, straight nose, full lips, long straight caramel-brown hair, slim petite body].

OUTFIT (same on all panels): black ribbed tank top, light blue straight jeans, barefoot.

Panel 1 (left): front-facing close-up headshot, looking at camera, slight smile showing teeth.
Panel 2 (center): head and shoulders, three-quarter view, head turned 45 degrees to her left, neutral expression.
Panel 3 (right): full body, front view, standing straight, arms relaxed, visible head to feet.

STYLE: plain white wall, soft natural daylight, identical lighting on every panel. Shot on iPhone, raw unretouched photo, realistic skin texture with visible pores, natural no-makeup look.

AVOID: different face between panels, beautified or plastic skin, heavy makeup, tattoos, cartoon, 3D render, AI look, cropped head or feet, distorted hands, text, labels, watermark, extra people.`,
      },
      {
        id: "image-2",
        title: "Image 2 : la même planche avec le nouvel outfit",
        part: {
          label: "Partie Image",
          text: "GPT Image 2.5, ratio 16:9. Uploade d'abord la planche de l'avatar, puis la photo de l'outfit. Pour Ava, prends sa planche actuelle. Télécharge le résultat, c'est lui qui part dans la vidéo.",
        },
        prompt: `Edit the first image. Keep this exact character sheet and change ONLY the outfit.

KEEP UNCHANGED: her face on all 3 panels (face shape, eyes, eyebrows, nose, lips, skin, hair, earrings), her body shape, the 3-panel layout, each pose and angle, the framing, the white background, the lighting and the photo style. Do not redraw, beautify or modify her face.

NEW OUTFIT: the second image is a reference for the CLOTHING ONLY. Ignore the person, her face, the phone and the background in it. Dress her in that exact outfit: [DESCRIBE THE OUTFIT: color, fabric, cut, pattern]. Same cut, fit, length, neckline, color, pattern, fabric texture, logo and shoes if visible. Realistic folds, same outfit on all 3 panels, full outfit visible on panel 3.

STYLE: shot on iPhone, raw unretouched photo, realistic skin and fabric texture.

AVOID: any change to her face or hair, the face of the person in the second image, different face between panels, changed pose, changed background, wrong outfit color, simplified pattern, invented or distorted logo, leftover black tank top or jeans, plastic fabric, cartoon, 3D render, AI look, text, watermark, extra people.`,
      },
      {
        id: "video-a",
        title: "Vidéo A : visage, morphologie et outfit",
        part: { label: "Partie Vidéo", text: "Seedance 2.5, audio désactivé." },
        slots: [
          { slot: "Vidéo", value: "Le reel à swapper" },
          { slot: "Personnage", value: "La planche avec le nouvel outfit, issue d'Image 2" },
          { slot: "Décor", value: "Rien" },
          { slot: "Produit", value: "Rien" },
        ],
        prompt: `Replace the woman in the source video with the woman from the character sheet: her face, hair, body shape and outfit. Keep everything else exactly as in the source video.

IDENTITY (TOP PRIORITY): the character sheet shows her from 3 angles. Reproduce her exact face in every frame: face shape, jawline, cheekbones, eyes, eyebrows, nose, lips, skin tone, hair color, length and style, earrings. Use the angled panel for head turns and profile views, and the smiling panel for her teeth. Her face must stay identical in every frame.

BODY AND OUTFIT: give her the exact body shape from the full-body panel, wearing the exact outfit from the character sheet: same color, cut, length, pattern, fabric and details. The outfit moves naturally with her body, same in every frame.

KEEP FROM THE SOURCE VIDEO UNCHANGED: every movement, pose, gesture and timing, mouth movements and lip sync, facial expressions, phone in hand, camera movement, framing, lighting, background, colors. REAL-TIME SPEED, same pace as the source, NO slow motion.

Match face, skin and fabric to the scene lighting so everything blends naturally. Realistic iPhone footage, real skin and fabric texture.

AVOID: the original woman's face, body or outfit, face or outfit changing between frames, flickering, morphing, blurry face, plastic or smoothed skin, beautified face, heavy makeup, distorted mouth, simplified pattern, wrong outfit color, invented logo, outfit clipping through the body, changed background, slow motion, text, watermark, cartoon, CGI, AI look.`,
      },
      {
        id: "video-b",
        title: "Vidéo B : visage seul",
        part: { label: "Partie Vidéo", text: "Seedance 2.5, audio désactivé." },
        slots: [
          { slot: "Vidéo", value: "Le reel à swapper" },
          { slot: "Personnage", value: "La planche de l'avatar, issue d'Image 1" },
          { slot: "Décor", value: "Rien" },
          { slot: "Produit", value: "Rien" },
        ],
        prompt: `Replace ONLY the face and hair of the woman in the source video with the woman from the character sheet. Keep her body, her outfit and everything else exactly as in the source video.

IDENTITY (TOP PRIORITY): reproduce the exact face from the character sheet in every frame: face shape, jawline, cheekbones, eyes, eyebrows, nose, lips, skin tone, hair color, length and style. Use the angled panel for head turns and profile views, and the smiling panel for her teeth. Ignore the body and the outfit of the character sheet.

KEEP FROM THE SOURCE VIDEO UNCHANGED: body shape, outfit, accessories, every movement, pose, gesture and timing, mouth movements and lip sync, facial expressions, phone in hand, camera movement, framing, lighting, background, colors. REAL-TIME SPEED, same pace as the source, NO slow motion.

Match her face to the scene lighting, and match her face skin tone to the neck and body so it blends naturally. Realistic iPhone footage, real skin texture.

AVOID: the original woman's face, face changing between frames, flickering, morphing, blurry face, plastic or smoothed skin, beautified face, heavy makeup, skin tone mismatch between face and neck, distorted mouth, changed body, changed outfit, changed background, slow motion, text, watermark, cartoon, CGI, AI look.`,
      },
    ],
  },
];
