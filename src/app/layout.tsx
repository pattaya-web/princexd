import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { ToastHost } from "@/components/ui";
import "./globals.css";

/*
 * Polices de repli.
 *
 * Le design cible PP Neue Montreal et F37 Zagma Mono (commerciales), déclarées
 * en @font-face dans globals.css depuis public/fonts/. Quand les fichiers ne
 * sont pas là, Inter et DM Mono prennent le relais : mêmes proportions, même
 * neutralité, chargées et auto-hébergées par next/font.
 */
/*
 * Polices embarquees dans le depot (Inter variable et DM Mono, licence OFL).
 * next/font/google les telechargeait a chaque build : quand Google Fonts ne
 * repond pas depuis le serveur, tout le deploiement echoue. En local, plus
 * aucune dependance reseau a la compilation.
 */
const inter = localFont({
  src: "./fonts/Inter-latin.woff2",
  weight: "100 900",
  variable: "--font-inter",
  display: "swap",
});

const dmMono = localFont({
  src: [
    { path: "./fonts/DMMono-400-latin.woff2", weight: "400", style: "normal" },
    { path: "./fonts/DMMono-500-latin.woff2", weight: "500", style: "normal" },
  ],
  variable: "--font-dm-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "MPGate",
  description: "Le cockpit de mon écosystème : contenu Instagram, génération IA, CRM coaching.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f9fbfb" },
    { media: "(prefers-color-scheme: dark)", color: "#0f1416" },
  ],
};

/**
 * Applique le thème enregistré avant le premier rendu, pour éviter
 * le flash de thème clair au chargement d'une page en mode sombre.
 */
const NO_FLASH = `
try {
  var t = JSON.parse(localStorage.getItem('mvp-theme') || '"system"');
  if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
} catch (e) {}
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr" suppressHydrationWarning className={`${inter.variable} ${dmMono.variable}`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: NO_FLASH }} />
      </head>
      <body>
        <ToastHost>{children}</ToastHost>
      </body>
    </html>
  );
}
