# 🌿 Kruidenwijk Nijverdal — Website

Informatiewebsite voor de Kruidenwijk in Nijverdal, gebouwd met [Astro](https://astro.build).

## Features

- **Blog & Nieuws** — Berichten over de wijk, bewoners, duurzaamheid
- **Evenementenagenda** — Lokale events + automatische sync met [dekruidenwijk.nl](https://dekruidenwijk.nl)
- **Over Ons** — Informatie over de wijk, wijkraad en het Kulturhus
- **Responsive design** — Desktop, tablet en mobiel

## Installatie

```bash
npm install
npm run dev
```

## 🔄 Evenementen-synchronisatie

De site haalt automatisch evenementen op van dekruidenwijk.nl/activiteiten en toont deze naast lokale events.

### Hoe werkt het?

1. Bij elke build wordt `scripts/fetch-events.mjs` uitgevoerd
2. Probeert eerst de WordPress REST API van dekruidenwijk.nl
3. Als fallback scraped het de activiteitenpagina (HTML)
4. Resultaat → `src/content/external-events.json`
5. Astro combineert lokale + externe events automatisch

### Handmatig events ophalen

```bash
npm run fetch-events
```

### Automatische dagelijkse sync (GitHub Actions)

`.github/workflows/sync-events.yml` — elke dag om 08:00 NL-tijd:
- Events ophalen van dekruidenwijk.nl
- Site herbouwen en deployen
- external-events.json committen

## Content beheren

Bewerk `src/content/data.ts` om blogposts en lokale events toe te voegen/wijzigen.

## Deployen

Netlify/Vercel: Build command `npm run build`, publish dir `dist`.
De prebuild haalt automatisch events op.
