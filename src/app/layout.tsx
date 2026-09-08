import type { Metadata, Viewport } from "next";
import { ToastHost } from "@/components/ui";
import "./globals.css";

export const metadata: Metadata = {
  title: "mvdyprince — Content & Coaching OS",
  description: "Le cockpit de mon écosystème : contenu Instagram, génération IA, CRM coaching.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f6f6f4" },
    { media: "(prefers-color-scheme: dark)", color: "#0c0c0b" },
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
    <html lang="fr" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: NO_FLASH }} />
      </head>
      <body>
        <ToastHost>{children}</ToastHost>
      </body>
    </html>
  );
}
