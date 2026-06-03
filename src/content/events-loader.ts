/**
 * Combineert lokale evenementen met extern opgehaalde evenementen
 * van dekruidenwijk.nl
 */
import { events as localEvents } from './data';
import externalData from './external-events.json';

export interface Event {
  title: string;
  slug: string;
  date: string;
  time: string;
  location: string;
  description: string;
  content?: string;
  category?: string;
  url?: string;
  source?: string;
  isExternal?: boolean;
}

function mergeEvents(): Event[] {
  // Lokale events met isExternal = false
  const local: Event[] = localEvents.map(e => ({
    ...e,
    isExternal: false,
  }));

  // Externe events van dekruidenwijk.nl
  const external: Event[] = (externalData.events || []).map((e: any) => ({
    title: e.title,
    slug: e.slug,
    date: e.date,
    time: e.time || '',
    location: e.location || 'Kulturhus Kruidenwijk',
    description: e.description || '',
    content: e.description || '',
    category: 'Wijkvereniging',
    url: e.url || '',
    source: 'dekruidenwijk.nl',
    isExternal: true,
  }));

  // Samenvoegen, verwijder duplicaten op basis van titel-gelijkenis
  const allEvents = [...local, ...external];

  // Eenvoudige deduplicatie op basis van genormaliseerde titel
  const seen = new Set<string>();
  const deduped = allEvents.filter(event => {
    const key = event.title.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Sorteer op datum
  return deduped.sort((a, b) => a.date.localeCompare(b.date));
}

export const allEvents = mergeEvents();
export const upcomingEvents = allEvents.filter(e => new Date(e.date) >= new Date());
export const pastEvents = allEvents.filter(e => new Date(e.date) < new Date());

// Meta-informatie over de laatste sync
export const syncMeta = externalData._meta || { fetched_at: '', method: '', total: 0 };
