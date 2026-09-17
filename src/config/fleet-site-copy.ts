/**
 * Editorial copy for the public fleet footer, keyed by CANONICAL slug.
 *
 * The LIST of sites is not kept here — it is derived from apps.conf by
 * scripts/generate-fleet-sites.ts, because a hand-kept list drifted (it named a
 * host that had been renamed and missed twelve that were live). What apps.conf
 * cannot say is how a site describes itself; that is this file's only job.
 *
 * `name` and `blurb` are each site's OWN words, condensed from its title and
 * meta description. Nothing here describes a site in terms it does not use.
 * A site missing from this map is still listed — by its register name, with no
 * blurb — so adding copy is an improvement, never a precondition.
 */
export const FLEET_SITE_COPY: Readonly<Record<string, { name: string; blurb: string }>> = {
  orangecat: { name: "OrangeCat", blurb: "Fund, lend, invest, and coordinate with any identity." },
  "aoz-begleitung": {
    name: "AOZ Begleitung",
    blurb: "Gemeinsam wohnen — kompatibilitätsbasierte Wohnplatzierung.",
  },
  botsmann: { name: "Botsmann", blurb: "Private AI that works with your own documents." },
  datacat: { name: "datacat", blurb: "KI-gestützter Formular-Editor für jede Branche." },
  evig: { name: "evig", blurb: "Refurbished IT kaufen und Reparaturwerkstätten finden." },
  kivvi: { name: "kivvi", blurb: "Open-Source-ERP für Kreislaufbetriebe." },
  petvity: { name: "Petvity", blurb: "Track your pet's health, vets, sitters and essentials." },
  printcraft: { name: "Printcraft", blurb: "Turn photos into artwork printed on real surfaces." },
  "reparaturbonus-zh": {
    name: "Reparaturbonus",
    blurb: "Werkstatt finden und den Reparaturbonus der Stadt nutzen.",
  },
  "revamp-info": {
    name: "revamp.info",
    blurb: "Transparentes Fundraising: Finanzen, Wirkung, Strategie.",
  },
  "sbb-fundbuero": { name: "SBB Fundbüro", blurb: "Verlorene Gegenstände melden — Konzeptdemo." },
  solon: { name: "Solon", blurb: "Bitcoin-native governance for the digital age." },
  "surf-your-life": { name: "Surf Your Life", blurb: "Psychiatry-led burnout recovery in Zürich." },
  vitareba: {
    name: "Vita",
    blurb: "Metabolische Psychiatrie und systemische Longevity, Zürich.",
  },
  heidi: { name: "Heidi", blurb: "Züritüütsch verstehen, dann wie ein Local texten. Im Aufbau." },
  substrata: {
    name: "Substrata",
    blurb: "Open research on the physical chokepoints between here and a singularity.",
  },
  "s-ink": { name: "S-Ink Tattoo", blurb: "Tattoo studio in Zürich." },
};
