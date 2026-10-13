import { redirect } from "next/navigation";

/** Les relances vivent dans le CRM (vue « À relancer ») : l'ancienne adresse y mène. */
export default function FollowUpsPage() {
  redirect("/sales/rendez-vous?view=followup");
}
