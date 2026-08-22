import type { Outbreak, OutbreakSource, SourceHealth } from '../../src/lib/types.js';
import { groupFor } from '../../src/lib/ifsac.js';
import type { IfsacCategory } from '../../src/lib/ifsac.js';

/** Closed outbreaks stay visible for a while, then drop off. */
export const RETAIN_CLOSED_DAYS = 180;

export interface OverrideEntry {
  id: string;
  /** Force a status regardless of what the scrape said. */
  status?: 'active' | 'closed';
  pathogen?: string;
  foodRaw?: string;
  foodCategory?: IfsacCategory;
  illnesses?: number;
  hospitalizations?: number;
  deaths?: number;
  stateCount?: number;
  states?: string[];
  title?: string;
  sourceUrl?: string;
  advice?: string;
  notes?: string;
  /** Present only on hand-written outbreaks the scrapers cannot see. */
  manual?: boolean;
  firstSeen?: string;
}

export interface MergeInput {
  previous: Outbreak[];
  scraped: Outbreak[];
  /** Which sources were read successfully this run. */
  health: Record<string, SourceHealth>;
  /** Maps a source name in `health` to the outbreak source it feeds. */
  sourceOwners: Record<string, OutbreakSource>;
  overrides: OverrideEntry[];
  now: string;
}

/**
 * Lifecycle rules:
 *  - seen in this run              -> upsert, refresh lastSeen, mark active
 *  - absent from a SUCCESSFUL scrape -> close it, stamp closedAt
 *  - absent from a FAILED scrape     -> leave exactly as it was
 *
 * That last rule is the whole point of the health tracking. "CDC didn't answer" and
 * "the outbreak is over" look identical in the data and mean opposite things to a reader.
 */
export function mergeOutbreaks(input: MergeInput): Outbreak[] {
  const { previous, scraped, health, sourceOwners, overrides, now } = input;

  const succeededSources = new Set<OutbreakSource>();
  for (const [name, h] of Object.entries(health)) {
    const owner = sourceOwners[name];
    if (owner && h.ok) succeededSources.add(owner);
  }

  const byId = new Map<string, Outbreak>();
  for (const record of previous) byId.set(record.id, { ...record });

  for (const incoming of scraped) {
    const existing = byId.get(incoming.id);
    if (!existing) {
      byId.set(incoming.id, incoming);
      continue;
    }
    byId.set(incoming.id, {
      ...existing,
      ...incoming,
      // Keep the earliest sighting and don't let a null overwrite a known count.
      firstSeen: existing.firstSeen,
      illnesses: incoming.illnesses ?? existing.illnesses,
      hospitalizations: incoming.hospitalizations ?? existing.hospitalizations,
      deaths: incoming.deaths ?? existing.deaths,
      stateCount: incoming.stateCount ?? existing.stateCount,
      states: incoming.states.length ? incoming.states : existing.states,
      advice: incoming.advice ?? existing.advice,
      lastSeen: now,
      closedAt: incoming.status === 'closed' ? (existing.closedAt ?? now) : null,
    });
  }

  const scrapedIds = new Set(scraped.map((o) => o.id));
  for (const record of byId.values()) {
    if (record.source === 'manual') continue;
    if (scrapedIds.has(record.id)) continue;
    if (!succeededSources.has(record.source)) continue; // failed scrape: say nothing
    if (record.status === 'closed') continue;
    record.status = 'closed';
    record.closedAt = now;
  }

  applyOverrides(byId, overrides, now);

  return dedupeAcrossAgencies([...byId.values()].filter((o) => keepRecord(o, now)))
    .sort(sortBySeverity);
}

const ACCENTS = /[\u0300-\u036f]/g;
const STOPWORDS = new Set(['fresh', 'frozen', 'whole', 'raw', 'organic', 'brand', 'products', 'product']);

/** Significant words in a food description, accent- and plural-insensitive. */
export function foodTokens(food: string | null): Set<string> {
  if (!food) return new Set();
  return new Set(
    food
      .normalize('NFD')
      .replace(ACCENTS, '')
      .toLowerCase()
      .split(/[^a-z]+/)
      // Length is checked before singularizing, or 4-letter plurals ("eggs") stem to 3
      // characters and get dropped, so "Shell Eggs" and "Eggs" would never match.
      .filter((w) => w.length >= 4 && !STOPWORDS.has(w))
      .map((w) => w.replace(/(es|s)$/, '')),
  );
}

/** CDC carries the richer record (hospitalizations, deaths, advice), so it wins a tie. */
const SOURCE_RANK: Record<OutbreakSource, number> = { manual: 0, cdc: 1, fda: 2 };

/**
 * CDC and FDA both publish the same multistate outbreaks. Showing one outbreak twice makes
 * the page look like there is more going on than there is, so fold them together — but only
 * on strong evidence (same germ, same food category, a shared food word), because wrongly
 * merging two outbreaks hides one entirely.
 */
export function dedupeAcrossAgencies(records: Outbreak[]): Outbreak[] {
  const ordered = [...records].sort((a, b) => SOURCE_RANK[a.source] - SOURCE_RANK[b.source]);
  const kept: Outbreak[] = [];

  for (const record of ordered) {
    const twin = kept.find((k) => isSameOutbreak(k, record));
    if (!twin) {
      kept.push(record);
      continue;
    }
    twin.crossReferences = [
      ...(twin.crossReferences ?? []),
      { source: record.source, url: record.sourceUrl, id: record.id },
    ];
    // Keep whichever numbers exist; agencies count on different schedules.
    twin.illnesses = twin.illnesses ?? record.illnesses;
    twin.hospitalizations = twin.hospitalizations ?? record.hospitalizations;
    twin.deaths = twin.deaths ?? record.deaths;
    twin.stateCount = twin.stateCount ?? record.stateCount;
    twin.advice = twin.advice ?? record.advice;
    if (record.status === 'active') {
      twin.status = 'active';
      twin.closedAt = null;
    }
  }

  return kept;
}

function isSameOutbreak(a: Outbreak, b: Outbreak): boolean {
  if (a.id === b.id) return true;
  if (a.source === b.source) return false;
  if (!a.foodCategory || !b.foodCategory || a.foodCategory !== b.foodCategory) return false;
  if (a.pathogen !== b.pathogen) return false;
  const tokensA = foodTokens(a.foodRaw);
  const tokensB = foodTokens(b.foodRaw);
  return [...tokensA].some((t) => tokensB.has(t));
}

function applyOverrides(byId: Map<string, Outbreak>, overrides: OverrideEntry[], now: string): void {
  for (const entry of overrides) {
    const existing = byId.get(entry.id);
    if (existing) {
      Object.assign(existing, stripUndefined(entry));
      if (entry.foodCategory) existing.foodGroup = groupFor(entry.foodCategory);
      if (entry.status === 'closed' && !existing.closedAt) existing.closedAt = now;
      if (entry.status === 'active') existing.closedAt = null;
      existing.lastSeen = now;
      continue;
    }
    if (!entry.manual) continue; // an override for a record we no longer have: ignore
    byId.set(entry.id, {
      id: entry.id,
      source: 'manual',
      pathogen: entry.pathogen ?? 'Unknown',
      status: entry.status ?? 'active',
      foodRaw: entry.foodRaw ?? null,
      foodCategory: entry.foodCategory ?? null,
      foodGroup: groupFor(entry.foodCategory ?? null),
      illnesses: entry.illnesses ?? null,
      hospitalizations: entry.hospitalizations ?? null,
      deaths: entry.deaths ?? null,
      stateCount: entry.stateCount ?? null,
      states: entry.states ?? [],
      firstSeen: entry.firstSeen ?? now,
      lastSeen: now,
      closedAt: entry.status === 'closed' ? now : null,
      sourceUrl: entry.sourceUrl ?? null,
      advice: entry.advice ?? null,
      notes: entry.notes ?? null,
      title: entry.title ?? null,
      updatedAt: now,
    });
  }
}

function stripUndefined<T extends object>(obj: T): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined && k !== 'manual' && k !== 'id') out[k] = v;
  }
  return out as Partial<T>;
}

function keepRecord(o: Outbreak, now: string): boolean {
  if (o.status === 'active' || !o.closedAt) return true;
  const age = (Date.parse(now) - Date.parse(o.closedAt)) / 86_400_000;
  return age <= RETAIN_CLOSED_DAYS;
}

/** Active first, then by human cost: deaths, hospitalizations, illnesses. */
export function sortBySeverity(a: Outbreak, b: Outbreak): number {
  if (a.status !== b.status) return a.status === 'active' ? -1 : 1;
  return (
    (b.deaths ?? 0) - (a.deaths ?? 0) ||
    (b.hospitalizations ?? 0) - (a.hospitalizations ?? 0) ||
    (b.illnesses ?? 0) - (a.illnesses ?? 0) ||
    b.lastSeen.localeCompare(a.lastSeen)
  );
}
