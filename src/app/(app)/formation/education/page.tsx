import { redirect } from "next/navigation";

/**
 * Education a fusionné avec Ressources (octobre 2026) : les guides PDF du
 * cours y sont, sous les vidéos. Les anciens liens arrivent ici et repartent.
 */
export default function EducationPage() {
  redirect("/formation/sops");
}
