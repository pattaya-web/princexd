import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

function platformOf(url: string) {
  const u = url.toLowerCase();
  if (u.includes("instagram.com")) return "instagram";
  if (u.includes("tiktok.com")) return "tiktok";
  if (u.includes("youtube.com") || u.includes("youtu.be")) return "youtube";
  if (u.includes("twitter.com") || u.includes("x.com")) return "x";
  return "web";
}

function meta(html: string, prop: string) {
  const patterns = [
    new RegExp(`<meta[^>]+property=["']${prop}["'][^>]+content=["']([^"']*)["']`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+property=["']${prop}["']`, "i"),
    new RegExp(`<meta[^>]+name=["']${prop}["'][^>]+content=["']([^"']*)["']`, "i"),
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m) return decode(m[1]);
  }
  return "";
}

function decode(s: string) {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ");
}

/** oEmbed public : marche bien pour TikTok et YouTube, pas pour Instagram. */
async function oembed(url: string, platform: string) {
  const endpoints: Record<string, string> = {
    tiktok: `https://www.tiktok.com/oembed?url=${encodeURIComponent(url)}`,
    youtube: `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`,
  };
  const endpoint = endpoints[platform];
  if (!endpoint) return null;
  try {
    const res = await fetch(endpoint, { headers: { "User-Agent": UA }, cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as { title?: string; author_name?: string; thumbnail_url?: string };
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  const { url } = (await req.json()) as { url: string };
  if (!url?.trim()) return NextResponse.json({ error: "URL manquante" }, { status: 400 });

  const platform = platformOf(url);
  const out = { platform, author: "", title: "", caption: "", thumbnail: "", warning: "" };

  const embed = await oembed(url, platform);
  if (embed) {
    out.title = embed.title ?? "";
    out.caption = embed.title ?? "";
    out.author = embed.author_name ?? "";
    out.thumbnail = embed.thumbnail_url ?? "";
  }

  // Complément par les balises Open Graph de la page.
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, "Accept-Language": "fr,en;q=0.8" },
      cache: "no-store",
      redirect: "follow",
    });
    if (res.ok) {
      const html = await res.text();
      out.title ||= meta(html, "og:title");
      out.caption ||= meta(html, "og:description") || meta(html, "description");
      out.thumbnail ||= meta(html, "og:image");
      if (!out.author) {
        const m = url.match(/(?:instagram\.com|tiktok\.com)\/@?([A-Za-z0-9._-]+)/);
        if (m) out.author = m[1];
      }
    }
  } catch {
    // La page peut refuser la requête serveur : ce n'est pas bloquant.
  }

  if (platform === "instagram") {
    out.warning =
      "Instagram bloque la lecture serveur : la légende récupérée est souvent partielle et il n'y a jamais de transcription. Colle le script à la main dans le champ ci-dessous (l'app Instagram propose « Transcription » sur les reels, ou utilise les sous-titres auto).";
  } else if (!out.title && !out.caption) {
    out.warning = "Impossible de lire cette page depuis le serveur. Colle la légende et le script à la main.";
  } else {
    out.warning =
      "Métadonnées récupérées. La transcription doit être collée à la main : aucune plateforme ne l'expose publiquement.";
  }

  return NextResponse.json(out);
}
