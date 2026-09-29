import { redirect } from "next/navigation";

/**
 * L'ancienne page « Calls » (liste brute des appels iClosed) est remplacee
 * par l'agenda du module commercial : memes calls, avec le closer qui les
 * prend et le lien de visio. Les donnees historiques restent en base.
 */
export default function CallsPage() {
  redirect("/sales/agenda");
}
