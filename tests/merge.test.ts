import { describe, expect, it } from 'vitest';
import { mergeOutbreaks, dedupeAcrossAgencies, foodTokens } from '../scripts/ingest/merge.js';
import type { Outbreak, SourceHealth } from '../src/lib/types.js';

const NOW = '2026-08-22T00:00:00.000Z';

const ok: SourceHealth = { ok: true, fetchedAt: NOW, lastSuccessAt: NOW, error: null };
const failed: SourceHealth = { ok: false, fetchedAt: NOW, lastSuccessAt: null, error: 'HTTP 403' };

function outbreak(over: Partial<Outbreak> = {}): Outbreak {
  return {
    id: 'cdc-1', source: 'cdc', pathogen: 'Salmonella', status: 'active',
    foodRaw: 'Shell Eggs', foodCategory: 'Eggs', foodGroup: 'Land Animals',
    illnesses: 10, hospitalizations: 2, deaths: 0, stateCount: 4, states: [],
    firstSeen: '2026-08-01T00:00:00.000Z', lastSeen: '2026-08-01T00:00:00.000Z',
    closedAt: null, sourceUrl: 'https://cdc.gov/x', advice: null, notes: null,
    title: 'Salmonella linked to Shell Eggs', updatedAt: null,
    ...over,
  };
}

const base = {
  health: { cdc: ok, fda: ok },
  sourceOwners: { cdc: 'cdc', fda: 'fda' } as const,
  overrides: [],
  now: NOW,
};

describe('outbreak lifecycle', () => {
  it('opens a record the first time it is seen', () => {
    const merged = mergeOutbreaks({ ...base, previous: [], scraped: [outbreak()] });
    expect(merged).toHaveLength(1);
    expect(merged[0].status).toBe('active');
  });

  it('refreshes counts without losing the original first-seen date', () => {
    const merged = mergeOutbreaks({
      ...base,
      previous: [outbreak()],
      scraped: [outbreak({ illnesses: 55, lastSeen: NOW })],
    });
    expect(merged[0].illnesses).toBe(55);
    expect(merged[0].firstSeen).toBe('2026-08-01T00:00:00.000Z');
    expect(merged[0].lastSeen).toBe(NOW);
  });

  it('does not let a missing value erase a count we already had', () => {
    const merged = mergeOutbreaks({
      ...base,
      previous: [outbreak({ hospitalizations: 7 })],
      scraped: [outbreak({ hospitalizations: null })],
    });
    expect(merged[0].hospitalizations).toBe(7);
  });

  it('closes a record that disappears from a successful scrape', () => {
    const merged = mergeOutbreaks({ ...base, previous: [outbreak()], scraped: [] });
    expect(merged[0].status).toBe('closed');
    expect(merged[0].closedAt).toBe(NOW);
  });

  it('leaves a record untouched when its source failed', () => {
    const merged = mergeOutbreaks({
      ...base,
      previous: [outbreak()],
      scraped: [],
      health: { cdc: failed, fda: ok },
    });
    // The whole point: "we could not read CDC" must never be published as "it ended".
    expect(merged[0].status).toBe('active');
    expect(merged[0].closedAt).toBeNull();
  });

  it('only closes records belonging to the source that succeeded', () => {
    const merged = mergeOutbreaks({
      ...base,
      // Different foods, or dedupe would (correctly) fold these into one record.
      previous: [
        outbreak({ id: 'cdc-1' }),
        outbreak({ id: 'fda-9', source: 'fda', foodRaw: 'Cucumbers', foodCategory: 'Seeded Vegetables' }),
      ],
      scraped: [],
      health: { cdc: failed, fda: ok },
    });
    expect(merged.find((o) => o.id === 'cdc-1')?.status).toBe('active');
    expect(merged.find((o) => o.id === 'fda-9')?.status).toBe('closed');
  });

  it('drops closed records once they are older than the retention window', () => {
    const longAgo = '2025-01-01T00:00:00.000Z';
    const merged = mergeOutbreaks({
      ...base,
      previous: [outbreak({ status: 'closed', closedAt: longAgo })],
      scraped: [],
    });
    expect(merged).toHaveLength(0);
  });
});

describe('manual overrides', () => {
  it('forces a status the scrape disagrees with', () => {
    const merged = mergeOutbreaks({
      ...base,
      previous: [],
      scraped: [outbreak()],
      overrides: [{ id: 'cdc-1', status: 'closed' }],
    });
    expect(merged[0].status).toBe('closed');
    expect(merged[0].closedAt).toBe(NOW);
  });

  it('adds an outbreak the scrapers cannot see', () => {
    const merged = mergeOutbreaks({
      ...base,
      previous: [],
      scraped: [],
      overrides: [{ id: 'manual-1', manual: true, pathogen: 'Listeria', foodCategory: 'Dairy', deaths: 3 }],
    });
    expect(merged).toHaveLength(1);
    expect(merged[0].source).toBe('manual');
    expect(merged[0].foodGroup).toBe('Land Animals');
    expect(merged[0].deaths).toBe(3);
  });

  it('ignores an override for a record that no longer exists', () => {
    const merged = mergeOutbreaks({
      ...base, previous: [], scraped: [], overrides: [{ id: 'gone', status: 'closed' }],
    });
    expect(merged).toHaveLength(0);
  });

  it('never closes a manual record just because a scrape did not mention it', () => {
    const manual = outbreak({ id: 'manual-1', source: 'manual' });
    const merged = mergeOutbreaks({ ...base, previous: [manual], scraped: [] });
    expect(merged[0].status).toBe('active');
  });
});

describe('cross-agency dedupe', () => {
  const cdc = outbreak({ id: 'cdc-1', foodRaw: 'Shell Eggs' });
  const fda = outbreak({ id: 'fda-2', source: 'fda', foodRaw: 'Eggs', illnesses: null, hospitalizations: null });

  it('folds the same outbreak from two agencies into one record', () => {
    const result = dedupeAcrossAgencies([cdc, fda]);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('cdc-1');
    expect(result[0].crossReferences?.[0].source).toBe('fda');
  });

  it('keeps outbreaks apart when the food differs', () => {
    const other = outbreak({ id: 'fda-3', source: 'fda', foodRaw: 'Cucumbers', foodCategory: 'Seeded Vegetables' });
    expect(dedupeAcrossAgencies([cdc, other])).toHaveLength(2);
  });

  it('keeps outbreaks apart when the germ differs', () => {
    const other = outbreak({ id: 'fda-4', source: 'fda', pathogen: 'Listeria' });
    expect(dedupeAcrossAgencies([cdc, other])).toHaveLength(2);
  });

  it('never merges two records from the same agency', () => {
    const twin = outbreak({ id: 'cdc-2' });
    expect(dedupeAcrossAgencies([cdc, twin])).toHaveLength(2);
  });

  it('treats an unidentified food as unmatchable', () => {
    const a = outbreak({ id: 'fda-5', source: 'fda', foodRaw: 'Not Yet Identified', foodCategory: null });
    const b = outbreak({ id: 'cdc-9', foodRaw: 'Not Yet Identified', foodCategory: null });
    expect(dedupeAcrossAgencies([a, b])).toHaveLength(2);
  });

  it('an active record from either agency keeps the merged one active', () => {
    const closed = outbreak({ id: 'cdc-1', status: 'closed', closedAt: NOW });
    const active = outbreak({ id: 'fda-2', source: 'fda', status: 'active' });
    expect(dedupeAcrossAgencies([closed, active])[0].status).toBe('active');
  });
});

describe('foodTokens', () => {
  it('keeps four-letter plurals that stem to three characters', () => {
    // Regression: stemming before the length filter dropped "eggs" entirely.
    expect([...foodTokens('Shell Eggs')]).toContain('egg');
    expect([...foodTokens('Eggs')]).toContain('egg');
  });

  it('ignores accents so "Jalapeños" matches "Jalapeno Peppers"', () => {
    const a = foodTokens('Jalapeños');
    const b = foodTokens('Jalapeno Peppers');
    expect([...a].some((t) => b.has(t))).toBe(true);
  });

  it('drops filler words that would match anything', () => {
    expect([...foodTokens('Fresh Organic Product')]).toHaveLength(0);
  });
});
