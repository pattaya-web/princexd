"use client";

import { useState } from "react";

/** Lien affilié Shopify (1 € le premier mois) à copier-coller aux clients et élèves. */
export const SHOPIFY_AFFILIATE_URL = "https://shopify.pxf.io/MAVeZN";

export function ShopifyAffiliate({ compact = false }: { compact?: boolean }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(SHOPIFY_AFFILIATE_URL);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      window.prompt("Copie ce lien :", SHOPIFY_AFFILIATE_URL);
    }
  }

  return (
    <div
      className={`rounded-xl flex items-center gap-3 flex-wrap ${compact ? "px-3 py-2" : "p-4"}`}
      style={{ border: "1px solid var(--border)", background: "var(--surface-2)" }}
    >
      <div className="min-w-0 flex-1">
        <div className="font-semibold text-[13.5px]">Lien affilié Shopify · 1 € le premier mois</div>
        <div className="mono dim text-[12px] truncate">{SHOPIFY_AFFILIATE_URL}</div>
      </div>
      <div className="flex items-center gap-1.5">
        <button className={`btn btn-sm ${copied ? "btn-primary" : ""}`} onClick={copy}>
          {copied ? "Copié ✓" : "Copier"}
        </button>
        <a className="btn btn-sm" href={SHOPIFY_AFFILIATE_URL} target="_blank" rel="noreferrer">
          Ouvrir
        </a>
      </div>
    </div>
  );
}
