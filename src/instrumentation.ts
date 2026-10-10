/**
 * Point d'entree Next au demarrage du serveur : lance les synchronisations
 * automatiques (Systeme.io, iClosed). Runtime Node uniquement.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.PRINCEXD_NO_SCHEDULER === "1") return;
  const { startScheduler } = await import("./lib/scheduler");
  startScheduler();
}
