/**
 * Traduction de l'interface à l'affichage (membre Studio en anglais).
 *
 * Le Studio est écrit en français, dans une quinzaine de composants. Plutôt
 * que d'y glisser des clés de traduction partout (et de risquer la version de
 * Mady), on traduit ce qui est affiché : chaque texte visible, plus les
 * attributs placeholder / title / aria-label, passe par un dictionnaire
 * français → anglais. Les nombres sont remplacés par {0}, {1}… pour qu'un
 * « 3 générations » et un « 12 générations » partagent la même entrée.
 *
 * Un texte inconnu part à /api/i18n (traduit une fois par l'IA, puis gardé
 * côté serveur et dans le navigateur) ; d'ici là il reste en français.
 *
 * Seule la valeur des nœuds texte change, jamais la structure : React met à
 * jour ces mêmes nœuds ensuite, et l'observateur retraduit au passage.
 * `translate="no"`, la classe `mono`, les champs de saisie et le code ne
 * sont jamais touchés.
 */

const STORE = "princexd.i18n.en.v1";
const NUM = /\d+(?:[.,   ]\d{3})*(?:[.,]\d+)?/g;
const LETTER = /[A-Za-zÀ-ÿ]/;
const ATTRS = ["placeholder", "title", "aria-label"] as const;
/** Jamais traduits. Le contenu d'un textarea est sa valeur (ce que tape le membre) ; ses attributs, eux, se traduisent. */
const SKIP_ATTRS = "script,style,code,[translate='no'],.mono,[contenteditable='true']";
const SKIP = `${SKIP_ATTRS},textarea`;

export function startDomTranslation(): () => void {
  const dict = new Map<string, string>();
  try {
    const cached = JSON.parse(localStorage.getItem(STORE) ?? "{}") as Record<string, string>;
    for (const [k, v] of Object.entries(cached)) dict.set(k, v);
  } catch {
    // Cache illisible : on repart du serveur.
  }

  /** Textes posés par nous : l'observateur les ignore, sinon il boucle. */
  const mine = new WeakMap<Node, string>();
  const mineAttr = new WeakMap<Element, Record<string, string>>();
  const pending = new Set<string>();
  const failed = new Set<string>();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;
  /** Le dictionnaire du serveur est arrivé : avant, un texte « inconnu » l'est peut-être seulement du cache local. */
  let ready = false;

  const keyOf = (core: string) => {
    const nums: string[] = [];
    const key = core.replace(NUM, (m) => {
      nums.push(m);
      return `{${nums.length - 1}}`;
    });
    return { key, nums };
  };

  /** Le texte traduit, ou null s'il n'y a rien à faire (ou pas encore de traduction). */
  const tr = (raw: string): string | null => {
    const core = raw.trim();
    if (!core || core.length > 600 || !LETTER.test(core)) return null;
    const { key, nums } = keyOf(core.replace(/\s+/g, " "));
    const t = dict.get(key);
    if (t === undefined) {
      if (!failed.has(key)) {
        pending.add(key);
        schedule();
      }
      return null;
    }
    if (t === key) return null;
    const out = t.replace(/\{(\d+)\}/g, (_, i: string) => nums[Number(i)] ?? "");
    const lead = raw.match(/^\s*/)?.[0] ?? "";
    const tail = raw.match(/\s*$/)?.[0] ?? "";
    return lead + out + tail;
  };

  const skipped = (el: Element | null, rule = SKIP) => !el || Boolean(el.closest(rule));

  const visitText = (n: Text) => {
    const v = n.nodeValue ?? "";
    if (mine.get(n) === v || skipped(n.parentElement)) return;
    const t = tr(v);
    if (t !== null && t !== v) {
      mine.set(n, t);
      n.nodeValue = t;
    }
  };

  const visitAttrs = (el: Element) => {
    if (skipped(el, SKIP_ATTRS)) return;
    for (const a of ATTRS) {
      const v = el.getAttribute(a);
      if (!v) continue;
      const set = mineAttr.get(el) ?? {};
      if (set[a] === v) continue;
      const t = tr(v);
      if (t !== null && t !== v) {
        set[a] = t;
        mineAttr.set(el, set);
        el.setAttribute(a, t);
      }
    }
  };

  const walk = (root: Node) => {
    if (root.nodeType === Node.TEXT_NODE) return visitText(root as Text);
    if (root.nodeType !== Node.ELEMENT_NODE) return;
    const el = root as Element;
    visitAttrs(el);
    if (skipped(el)) return;
    const it = document.createTreeWalker(el, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
    for (let n = it.nextNode(); n; n = it.nextNode()) {
      if (n.nodeType === Node.TEXT_NODE) visitText(n as Text);
      else visitAttrs(n as Element);
    }
  };

  const save = () => {
    try {
      localStorage.setItem(STORE, JSON.stringify(Object.fromEntries(dict)));
    } catch {
      // Stockage plein : le serveur garde tout de toute façon.
    }
  };

  /** Les textes inconnus partent par lots ; à l'arrivée, on repasse sur toute la page. */
  function schedule() {
    if (timer || stopped || !ready) return;
    timer = setTimeout(async () => {
      timer = null;
      const batch = [...pending].slice(0, 60);
      batch.forEach((k) => pending.delete(k));
      if (!batch.length) return;
      try {
        const r = await fetch("/api/i18n", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ texts: batch }) });
        const body = (await r.json().catch(() => ({}))) as { translations?: Record<string, string> };
        const got = body.translations ?? {};
        for (const k of batch) {
          if (got[k] !== undefined) dict.set(k, got[k]);
          else failed.add(k);
        }
        save();
      } catch {
        batch.forEach((k) => failed.add(k));
      }
      if (!stopped) walk(document.body);
      if (pending.size) schedule();
    }, 350);
  }

  const observer = new MutationObserver((list) => {
    for (const m of list) {
      if (m.type === "characterData") visitText(m.target as Text);
      else if (m.type === "attributes") visitAttrs(m.target as Element);
      else m.addedNodes.forEach(walk);
    }
  });

  // Boîtes natives (confirmation de suppression…) : traduites si le texte est connu.
  const nativeConfirm = window.confirm.bind(window);
  const nativeAlert = window.alert.bind(window);
  window.confirm = (msg?: string) => nativeConfirm(msg ? (tr(msg) ?? msg) : msg);
  window.alert = (msg?: string) => nativeAlert(msg ? (tr(msg) ?? msg) : msg);

  document.documentElement.lang = "en";
  // Premier passage sur le cache local, puis le dictionnaire complet du serveur.
  walk(document.body);
  observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: [...ATTRS] });
  void fetch("/api/i18n")
    .then((r) => r.json() as Promise<{ translations?: Record<string, string> }>)
    .then((b) => {
      if (stopped) return;
      for (const [k, v] of Object.entries(b.translations ?? {})) {
        dict.set(k, v);
        pending.delete(k);
      }
      save();
    })
    .catch(() => {})
    .finally(() => {
      if (stopped) return;
      ready = true;
      walk(document.body);
      schedule();
    });

  return () => {
    stopped = true;
    observer.disconnect();
    if (timer) clearTimeout(timer);
    window.confirm = nativeConfirm;
    window.alert = nativeAlert;
    document.documentElement.lang = "fr";
  };
}
