import { Fragment, type ReactNode } from "react";

/**
 * Annexe d'un module : texte libre tape par l'admin, rendu avec une mise en
 * forme legere et previsible, sans dependance.
 *
 *  - `# Titre` et `## Sous-titre` ;
 *  - `- element` ou `* element` : liste a puces ; `1. element` : liste numerotee ;
 *  - une ligne vide separe les paragraphes ;
 *  - `**gras**` et les liens http(s) cliquables, ouverts dans un nouvel onglet.
 *
 * Tout le reste est affiche tel quel : l'admin ne peut rien casser.
 */
export function Annex({ text, className = "" }: { text: string; className?: string }) {
  const blocks = parse(text);
  if (!blocks.length) return null;
  return (
    <div className={`annex text-[14px] leading-relaxed ${className}`}>
      {blocks.map((b, i) => {
        if (b.kind === "h1") return <h3 key={i} className="text-[17px] font-semibold mt-5 mb-2 first:mt-0">{inline(b.text)}</h3>;
        if (b.kind === "h2") return <h4 key={i} className="text-[15px] font-semibold mt-4 mb-1.5 first:mt-0">{inline(b.text)}</h4>;
        if (b.kind === "ul" || b.kind === "ol") {
          const Tag = b.kind;
          return (
            <Tag key={i} className={`${b.kind === "ul" ? "list-disc" : "list-decimal"} pl-5 my-2 flex flex-col gap-1`}>
              {b.items.map((it, j) => (
                <li key={j}>{inline(it)}</li>
              ))}
            </Tag>
          );
        }
        if (b.kind !== "p") return null;
        return (
          <p key={i} className="my-2 first:mt-0 whitespace-pre-line">
            {inline(b.text)}
          </p>
        );
      })}
    </div>
  );
}

type Block =
  | { kind: "h1" | "h2" | "p"; text: string }
  | { kind: "ul" | "ol"; items: string[] };

function parse(text: string): Block[] {
  const blocks: Block[] = [];
  let para: string[] = [];
  let list: { kind: "ul" | "ol"; items: string[] } | null = null;
  const flushPara = () => {
    if (para.length) blocks.push({ kind: "p", text: para.join("\n") });
    para = [];
  };
  const flushList = () => {
    if (list) blocks.push(list);
    list = null;
  };
  for (const raw of (text ?? "").replace(/\r\n/g, "\n").split("\n")) {
    const line = raw.trimEnd();
    if (!line.trim()) {
      flushPara();
      flushList();
      continue;
    }
    const h = line.match(/^(#{1,2})\s+(.*)$/);
    if (h) {
      flushPara();
      flushList();
      blocks.push({ kind: h[1].length === 1 ? "h1" : "h2", text: h[2] });
      continue;
    }
    const ul = line.match(/^\s*[-*•]\s+(.*)$/);
    const ol = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (ul || ol) {
      flushPara();
      const kind = ul ? "ul" : "ol";
      if (!list || list.kind !== kind) {
        flushList();
        list = { kind, items: [] };
      }
      list.items.push((ul ?? ol)![1]);
      continue;
    }
    flushList();
    para.push(line);
  }
  flushPara();
  flushList();
  return blocks;
}

/** Gras et liens dans une ligne. */
function inline(text: string): ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*|https?:\/\/[^\s<>()]+)/g);
  return parts.map((p, i) => {
    if (!p) return null;
    if (p.startsWith("**") && p.endsWith("**")) return <strong key={i}>{p.slice(2, -2)}</strong>;
    if (/^https?:\/\//.test(p)) {
      const trimmed = p.replace(/[.,;:!?]+$/, "");
      const tail = p.slice(trimmed.length);
      return (
        <Fragment key={i}>
          <a href={trimmed} target="_blank" rel="noopener noreferrer" className="underline break-all" style={{ color: "var(--accent)" }}>
            {trimmed}
          </a>
          {tail}
        </Fragment>
      );
    }
    return <Fragment key={i}>{p}</Fragment>;
  });
}
