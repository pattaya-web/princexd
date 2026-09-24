"use client";

import { AdsDrive } from "@/components/AdsDrive";
import { PageHeader } from "@/components/ui";

export default function AdsCreasPage() {
  return (
    <>
      <PageHeader
        title="Ads & Scripts"
        subtitle="Tes dossiers de créas : les pubs qui t'inspirent en mp4, leur transcription, et les scripts à tourner qui en sortent."
      />
      <AdsDrive />
    </>
  );
}
