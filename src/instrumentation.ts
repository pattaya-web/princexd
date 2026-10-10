/**
 * Point d'entree Next au demarrage du serveur : lance les synchronisations
 * automatiques (Systeme.io, iClosed).
 *
 * La condition sur NEXT_RUNTIME doit rester exactement sous cette forme :
 * elle est remplacee a la compilation et fait disparaitre l'import pour le
 * runtime Edge, ou `fs` et `crypto` n'existent pas.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    if (process.env.PRINCEXD_NO_SCHEDULER === "1") return;
    const { startScheduler } = await import("./lib/scheduler");
    startScheduler();
  }
}
