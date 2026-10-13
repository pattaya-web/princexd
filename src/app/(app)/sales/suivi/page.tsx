import { redirect } from "next/navigation";

/** Le suivi (no-shows, relances, paiements) vit dans le CRM : l'ancienne adresse y mène. */
export default function SuiviPage() {
  redirect("/sales/rendez-vous?view=todo");
}
