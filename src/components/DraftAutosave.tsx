"use client";

import { useEffect, useRef } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { useToast } from "@/components/ui";

/**
 * Sauvegarde automatique de tout ce qui est tape ou colle dans l'app.
 *
 * Chaque champ de texte (textarea, input texte) est ecoute au niveau du
 * document : a chaque frappe, sa valeur part vers /api/drafts (cote serveur,
 * dans la base), avec un debounce court. Quand on quitte la page (autre
 * onglet de l'app, fermeture, coupure), ce qui reste en attente part par
 * `sendBeacon`. Au retour sur la page, les champs vides (ou encore a leur
 * valeur d'origine) recuperent le brouillon, et un toast le signale.
 *
 * Identite d'un champ : la page (pathname + search) et une signature du
 * champ (id, name, aria-label ou placeholder) suivie de son rang parmi les
 * champs de meme signature. Les mots de passe, recherches, nombres, dates,
 * et tout ce qui est marque `data-nodraft` sont ignores.
 */

type Field = HTMLTextAreaElement | HTMLInputElement;

const SKIP_TYPES = new Set(["password", "search", "email", "number", "date", "time", "datetime-local", "month", "week", "file", "checkbox", "radio", "range", "color", "hidden", "submit", "button", "reset", "url", "tel"]);
/** Un input d'une ligne n'est garde qu'a partir de cette longueur (les textarea, toujours). */
const MIN_INPUT = 6;
const DEBOUNCE_MS = 600;
/** Apres l'arrivee sur une page, on reessaie la restauration pendant ce temps (donnees qui chargent). */
const RESTORE_WINDOW_MS = 8_000;

interface DraftRow {
  id: string;
  page: string;
  field: string;
  label: string;
  value: string;
  base: string;
  updatedAt: string;
}

const pageKey = () => location.pathname + location.search;

function isCandidate(el: Element | null): el is Field {
  if (!el) return false;
  if (el.closest("[data-nodraft]")) return false;
  if (el instanceof HTMLTextAreaElement) return !el.readOnly && !el.disabled;
  if (el instanceof HTMLInputElement) return !SKIP_TYPES.has(el.type) && !el.readOnly && !el.disabled;
  return false;
}

function signature(el: Field): string {
  const raw = el.id || el.name || el.getAttribute("aria-label") || el.placeholder || el.tagName.toLowerCase();
  return raw.trim().slice(0, 80);
}

function labelOf(el: Field): string {
  const byFor = el.id ? document.querySelector(`label[for="${CSS.escape(el.id)}"]`)?.textContent : "";
  const wrapped = el.closest("label")?.textContent;
  const raw = (el.getAttribute("aria-label") || byFor || wrapped || el.placeholder || el.name || el.id || "Texte").trim();
  // Premiere ligne seulement : un placeholder multi-lignes ferait un titre illisible.
  return raw.split(/\r?\n/)[0].replace(/\s+/g, " ").slice(0, 120);
}

/** Cle du champ dans la page : signature + rang parmi les champs de meme signature. */
function fieldKey(el: Field): string {
  const sig = signature(el);
  let n = 0;
  for (const other of document.querySelectorAll<Field>("textarea, input")) {
    if (other === el) break;
    if (isCandidate(other) && signature(other) === sig) n++;
  }
  return `${sig}#${n}`;
}

/** Ecrit dans un champ controle par React : setter natif + evenement input. */
function setNativeValue(el: Field, value: string) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  if (setter) setter.call(el, value);
  else el.value = value;
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

export function DraftAutosave() {
  const pathname = usePathname();
  const search = useSearchParams()?.toString() ?? "";
  const toast = useToast();
  const pending = useRef(new Map<string, { page: string; field: string; label: string; value: string; base: string }>());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Valeur d'un champ au moment ou l'utilisateur y entre (avant de taper). */
  const bases = useRef(new WeakMap<Field, string>());
  /** Champs dont on a deja restaure (ou choisi de ne pas restaurer) le brouillon. */
  const handled = useRef(new WeakSet<Field>());
  /** Champs qui portent un brouillon non vide, pour detecter un vidage par l'app apres envoi. */
  const tracked = useRef(new Map<string, { el: Field; value: string }>());

  useEffect(() => {
    const flush = (beacon = false) => {
      if (!pending.current.size) return;
      const items = [...pending.current.values()];
      pending.current.clear();
      const body = JSON.stringify({ items });
      if (beacon && "sendBeacon" in navigator) {
        navigator.sendBeacon("/api/drafts", new Blob([body], { type: "application/json" }));
        return;
      }
      void fetch("/api/drafts", { method: "POST", headers: { "Content-Type": "application/json" }, body, keepalive: true }).catch(() => undefined);
    };
    const schedule = () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => flush(false), DEBOUNCE_MS);
    };
    const queue = (el: Field, value: string) => {
      const page = pageKey();
      const field = fieldKey(el);
      const key = `${page}::${field}`;
      pending.current.set(key, { page, field, label: labelOf(el), value, base: bases.current.get(el) ?? "" });
      if (value.trim()) tracked.current.set(key, { el, value });
      else tracked.current.delete(key);
      schedule();
    };

    const onFocus = (e: FocusEvent) => {
      const el = e.target as Element;
      if (isCandidate(el) && !bases.current.has(el)) bases.current.set(el, el.value);
    };
    const onInput = (e: Event) => {
      const el = e.target as Element;
      if (!isCandidate(el)) return;
      if (!e.isTrusted) return; // nos propres restaurations ne se re-sauvegardent pas
      if (!bases.current.has(el)) bases.current.set(el, "");
      handled.current.add(el);
      const value = el.value;
      if (el instanceof HTMLInputElement && value.length > 0 && value.length < MIN_INPUT) return;
      queue(el, value);
    };
    const onHide = () => {
      if (document.visibilityState === "hidden") flush(true);
    };
    const onPageHide = () => flush(true);

    document.addEventListener("focusin", onFocus, true);
    document.addEventListener("input", onInput, true);
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", onPageHide);

    /*
     * Un champ vide par l'app (message envoye, formulaire reinitialise) alors
     * qu'on lui connait un brouillon : le brouillon n'a plus lieu d'etre.
     */
    const sweep = setInterval(() => {
      for (const [key, t] of tracked.current) {
        if (!t.el.isConnected) continue;
        if (t.el.value === "" && t.value.trim()) {
          const [page, field] = [key.slice(0, key.indexOf("::")), key.slice(key.indexOf("::") + 2)];
          pending.current.set(key, { page, field, label: "", value: "", base: "" });
          tracked.current.delete(key);
          schedule();
        }
      }
    }, 2_000);

    return () => {
      flush(true);
      document.removeEventListener("focusin", onFocus, true);
      document.removeEventListener("input", onInput, true);
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", onPageHide);
      clearInterval(sweep);
      if (timer.current) clearTimeout(timer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Restauration a chaque page.
  useEffect(() => {
    let alive = true;
    tracked.current.clear();
    const page = pageKey();
    let drafts: Map<string, DraftRow> | null = null;
    let restoredCount = 0;
    let announced = false;

    const tryRestore = () => {
      if (!drafts || !drafts.size) return;
      for (const el of document.querySelectorAll<Field>("textarea, input")) {
        if (!isCandidate(el) || handled.current.has(el)) continue;
        const d = drafts.get(fieldKey(el));
        if (!d) continue;
        const current = el.value;
        if (current !== "" && current !== d.base) continue; // deja autre chose dedans : on ne touche pas
        if (current === d.value) {
          handled.current.add(el);
          continue;
        }
        handled.current.add(el);
        bases.current.set(el, current);
        setNativeValue(el, d.value);
        tracked.current.set(`${page}::${d.field}`, { el, value: d.value });
        restoredCount++;
      }
      if (restoredCount && !announced) {
        announced = true;
        toast(restoredCount > 1 ? `${restoredCount} brouillons restaurés.` : "Brouillon restauré.");
      }
    };

    fetch(`/api/drafts?page=${encodeURIComponent(page)}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((j: { drafts?: DraftRow[] }) => {
        if (!alive) return;
        drafts = new Map((j.drafts ?? []).map((d) => [d.field, d]));
        tryRestore();
      })
      .catch(() => undefined);

    const observer = new MutationObserver(() => tryRestore());
    observer.observe(document.body, { childList: true, subtree: true });
    const started = Date.now();
    const retry = setInterval(() => {
      if (Date.now() - started > RESTORE_WINDOW_MS) clearInterval(retry);
      else tryRestore();
    }, 500);

    return () => {
      alive = false;
      observer.disconnect();
      clearInterval(retry);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, search]);

  return null;
}
