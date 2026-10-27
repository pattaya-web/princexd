import type { MetadataRoute } from "next";

/**
 * Manifest d'application : permet d'« installer » le site comme un logiciel
 * (fenêtre autonome sans barre d'adresse, icône dans la barre des tâches).
 * Sur le PC de Mady, un raccourci Edge `--app=https://mvdyprince.fr` dans
 * le dossier Démarrage l'ouvre à chaque allumage.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Mvdy Prince",
    short_name: "Mvdy Prince",
    description: "Le cockpit de mon écosystème : contenu, Studio IA, CRM, élèves.",
    start_url: "/",
    display: "standalone",
    background_color: "#f9fbfb",
    theme_color: "#5b5ce6",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
    ],
  };
}
