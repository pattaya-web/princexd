"use client";

import { useEffect } from "react";

/** Toutes les 3 h tant que l'onglet est ouvert. */
const EVERY_MS = 3 * 60 * 60 * 1000;

/**
 * Prolonge la session tant que l'app est utilisee (voir
 * /api/sales/session/refresh). Sans lui, la session tombait 30 jours apres la
 * connexion, en pleine utilisation, et chaque action renvoyait « Accès refusé. ».
 */
export default function SessionKeepAlive() {
  useEffect(() => {
    const ping = () => {
      if (window.location.pathname.startsWith("/login")) return;
      void fetch("/api/sales/session/refresh", { method: "POST", cache: "no-store" }).catch(() => undefined);
    };
    ping();
    const timer = window.setInterval(ping, EVERY_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") ping();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);
  return null;
}
