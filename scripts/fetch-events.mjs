/**
 * fetch-events.mjs
 * 
 * Haalt evenementen op van dekruidenwijk.nl op twee manieren:
 * 1. Eerst probeert het de WordPress REST API (sneller & gestructureerder)
 * 2. Als fallback scraped het de /activiteiten/ pagina
 * 
 * Gebruik:
 *   node scripts/fetch-events.mjs
 * 
 * Output:
 *   src/content/external-events.json
 */

import { writeFileSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = join(__dirname, '..', 'src', 'content', 'external-events.json');

const SOURCE_URL = 'https://dekruidenwijk.nl';
const ACTIVITEITEN_URL = `${SOURCE_URL}/activiteiten/`;

// Nederlandse maanden voor het parsen van datums
const DUTCH_MONTHS = {
  'januari': 0, 'februari': 1, 'maart': 2, 'april': 3,
  'mei': 4, 'juni': 5, 'juli': 6, 'augustus': 7,
  'september': 8, 'oktober': 9, 'november': 10, 'december': 11
};

/**
 * Methode 1: Probeer de WordPress REST API
 * Veel WordPress evenement-plugins (The Events Calendar, EventON, etc.)
 * bieden een REST API endpoint aan.
 */
async function tryRestApi() {
  const endpoints = [
    // The Events Calendar plugin
    `${SOURCE_URL}/wp-json/tribe/events/v1/events?per_page=50&start_date=now`,
    // Standaard WordPress custom post type 'etn'
    `${SOURCE_URL}/wp-json/wp/v2/etn?per_page=50&orderby=date&order=asc`,
    // Eventin plugin
    `${SOURCE_URL}/wp-json/eventin/v2/events?per_page=50`,
    // Standaard WP events
    `${SOURCE_URL}/wp-json/wp/v2/events?per_page=50`,
  ];

  for (const endpoint of endpoints) {
    try {
      console.log(`  Probeer API: ${endpoint}`);
      const res = await fetch(endpoint, {
        headers: { 'User-Agent': 'KruidenwijkNijverdal-EventSync/1.0' },
        signal: AbortSignal.timeout(8000)
      });

      if (!res.ok) continue;

      const data = await res.json();
      const events = Array.isArray(data) ? data : data?.events || [];

      if (events.length === 0) continue;

      console.log(`  ✓ API geeft ${events.length} evenementen terug`);

      return events.map(event => ({
        title: event.title?.rendered || event.title || '',
        slug: event.slug || slugify(event.title?.rendered || event.title || ''),
        date: event.start_date || event.date || '',
        time: extractTime(event),
        location: event.venue?.venue || event.location || 'Kruidenwijk, Nijverdal',
        description: stripHtml(event.excerpt?.rendered || event.description || ''),
        url: event.url || event.link || '',
        source: 'dekruidenwijk.nl',
        source_api: true,
      }));
    } catch (err) {
      // Endpoint niet beschikbaar, probeer de volgende
      continue;
    }
  }

  return null; // Geen API gevonden
}

/**
 * Methode 2: Scrape de /activiteiten/ pagina
 * Parst de HTML om evenement-informatie te extraheren
 */
async function scrapeActiviteiten() {
  console.log(`  Scraping: ${ACTIVITEITEN_URL}`);

  const res = await fetch(ACTIVITEITEN_URL, {
    headers: {
      'User-Agent': 'KruidenwijkNijverdal-EventSync/1.0',
      'Accept': 'text/html',
    },
    signal: AbortSignal.timeout(15000)
  });

  if (!res.ok) {
    throw new Error(`HTTP ${res.status} bij ophalen ${ACTIVITEITEN_URL}`);
  }

  const html = await res.text();

  // Dynamisch cheerio laden
  const { load } = await import('cheerio');
  const $ = load(html);

  const events = [];

  // Patroon op dekruidenwijk.nl:
  // Elke event-sectie bevat een h3 met link, gevolgd door de datum
  // We zoeken naar alle h3 > a links die naar /etn/ verwijzen
  $('h3').each((_, el) => {
    const $h3 = $(el);
    const $link = $h3.find('a').first();

    if (!$link.length) return;

    const url = $link.attr('href') || '';
    const title = $link.text().trim();

    // Controleer of het een evenement-link is
    if (!url.includes('/etn/') && !url.includes('/evenement')) return;
    if (!title) return;

    // De datum staat vaak direct na de h3 als tekst
    let dateText = '';

    // Zoek de datum in de nabijgelegen elementen
    const $parent = $h3.parent();
    const parentText = $parent.text();

    // Probeer een Nederlands datumpatroon te vinden: "12 juni 2026"
    const dateMatch = parentText.match(/(\d{1,2})\s+(januari|februari|maart|april|mei|juni|juli|augustus|september|oktober|november|december)\s+(\d{4})/i);

    let date = '';
    if (dateMatch) {
      const day = parseInt(dateMatch[1]);
      const month = DUTCH_MONTHS[dateMatch[2].toLowerCase()];
      const year = parseInt(dateMatch[3]);
      if (month !== undefined) {
        date = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        dateText = dateMatch[0];
      }
    }

    // Genereer een slug van de URL
    const slug = url
      .replace(/^https?:\/\/[^/]+/, '')
      .replace(/^\/etn\//, '')
      .replace(/\/$/, '')
      || slugify(title);

    events.push({
      title,
      slug: `ext-${slug}`,
      date,
      dateText,
      time: '',
      location: 'Kulturhus Kruidenwijk',
      description: '',
      url,
      source: 'dekruidenwijk.nl',
      source_api: false,
    });
  });

  // Eventueel ook individuele pagina's ophalen voor meer details
  // (beperkt tot max 5 om de build niet te vertragen)
  const detailFetches = events.slice(0, 8).map(async (event) => {
    if (!event.url) return event;
    try {
      const detailRes = await fetch(event.url, {
        headers: { 'User-Agent': 'KruidenwijkNijverdal-EventSync/1.0' },
        signal: AbortSignal.timeout(8000)
      });
      if (!detailRes.ok) return event;

      const detailHtml = await detailRes.text();
      const $detail = load(detailHtml);

      // Probeer beschrijving te vinden
      const $content = $detail('.entry-content, .elementor-widget-theme-post-content, .etn-event-content, article .content');
      if ($content.length) {
        const rawText = $content.first().text().trim();
        // Eerste paar zinnen als beschrijving
        event.description = rawText
          .replace(/\s+/g, ' ')
          .substring(0, 300)
          .replace(/\s\S*$/, '…');
      }

      // Probeer tijd te vinden
      const pageText = $detail('body').text();
      const timeMatch = pageText.match(/(\d{1,2}[:.]\d{2})\s*(?:[-–]\s*(\d{1,2}[:.]\d{2}))?/);
      if (timeMatch) {
        event.time = timeMatch[2]
          ? `${timeMatch[1].replace('.', ':')} - ${timeMatch[2].replace('.', ':')}`
          : timeMatch[1].replace('.', ':');
      }

      // Probeer locatie te vinden
      const locMatch = pageText.match(/(?:Locatie|Waar|Plaats|Location)[:\s]+([^\n]+)/i);
      if (locMatch) {
        event.location = locMatch[1].trim().substring(0, 100);
      }

    } catch {
      // Detailpagina niet beschikbaar, geen probleem
    }
    return event;
  });

  const enrichedEvents = await Promise.all(detailFetches);
  return enrichedEvents;
}

/**
 * Hoofd-functie
 */
async function fetchEvents() {
  console.log('🌿 Evenementen ophalen van dekruidenwijk.nl...\n');

  let events = null;
  let method = '';

  // Stap 1: Probeer REST API
  try {
    events = await tryRestApi();
    if (events && events.length > 0) {
      method = 'WordPress REST API';
    }
  } catch (err) {
    console.log(`  ⚠ API fout: ${err.message}`);
  }

  // Stap 2: Fallback naar scraping
  if (!events || events.length === 0) {
    try {
      events = await scrapeActiviteiten();
      method = 'HTML scraping';
    } catch (err) {
      console.error(`  ✗ Scraping fout: ${err.message}`);
      events = [];
    }
  }

  // Stap 3: Filter en sorteer
  const now = new Date().toISOString().split('T')[0];
  const validEvents = events
    .filter(e => e.title && e.date)
    .sort((a, b) => a.date.localeCompare(b.date));

  // Stap 4: Schrijf output
  const output = {
    _meta: {
      source: SOURCE_URL,
      fetched_at: new Date().toISOString(),
      method,
      total: validEvents.length,
    },
    events: validEvents,
  };

  mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
  writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2), 'utf-8');

  console.log(`\n✓ ${validEvents.length} evenementen opgeslagen via ${method}`);
  console.log(`  → ${OUTPUT_PATH}\n`);

  // Toon een preview
  validEvents.forEach(e => {
    console.log(`  📅 ${e.date} — ${e.title}`);
  });
}

// Hulpfuncties
function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

function stripHtml(html) {
  return html.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
}

function extractTime(event) {
  if (event.start_date && event.end_date) {
    const start = event.start_date.split(' ')[1]?.substring(0, 5);
    const end = event.end_date.split(' ')[1]?.substring(0, 5);
    if (start && end) return `${start} - ${end}`;
    if (start) return start;
  }
  return '';
}

// Uitvoeren
fetchEvents().catch(err => {
  console.error('✗ Fatale fout:', err.message);
  // Bij een fout schrijven we een leeg bestand zodat de build niet breekt
  const emptyOutput = {
    _meta: {
      source: SOURCE_URL,
      fetched_at: new Date().toISOString(),
      method: 'error',
      error: err.message,
      total: 0,
    },
    events: [],
  };
  mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
  writeFileSync(OUTPUT_PATH, JSON.stringify(emptyOutput, null, 2), 'utf-8');
  process.exit(0); // Niet crashen, de build moet doorgaan
});
