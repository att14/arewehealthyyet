import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';

import { runSource } from './fetch.js';
import { ingestCdc } from './cdc.js';
import { ingestFda } from './fda-core.js';
import { ingestOpenFda, ingestFsis, sortRecalls } from './recalls.js';
import { ingestTrends } from './trends.js';
import { mergeOutbreaks, type OverrideEntry } from './merge.js';
import type {
  Outbreak, OutbreakFile, OutbreakSource, RecallFile, SourceHealth, TrendFile,
} from '../../src/lib/types.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const dataDir = resolve(root, 'src/data');
const overridesPath = resolve(root, 'data/overrides.yaml');

/** Which health key feeds which outbreak source, so a failure only freezes its own records. */
const SOURCE_OWNERS: Record<string, OutbreakSource> = { cdc: 'cdc', fda: 'fda' };

function readJson<T>(name: string, fallback: T): T {
  const path = resolve(dataDir, name);
  if (!existsSync(path)) return fallback;
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T;
  } catch (err) {
    console.warn(`[run] could not read ${name}, starting fresh: ${String(err)}`);
    return fallback;
  }
}

function writeJson(name: string, value: unknown): void {
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(resolve(dataDir, name), `${JSON.stringify(value, null, 2)}\n`);
  console.log(`[run] wrote src/data/${name}`);
}

function readOverrides(): OverrideEntry[] {
  if (!existsSync(overridesPath)) return [];
  const parsed = parseYaml(readFileSync(overridesPath, 'utf8')) as
    | { outbreaks?: OverrideEntry[] }
    | null;
  return parsed?.outbreaks ?? [];
}

async function main(): Promise<void> {
  const now = new Date();
  const nowIso = now.toISOString();
  const misses = new Set<string>();

  const previousOutbreaks = readJson<OutbreakFile>('outbreaks.json', {
    generatedAt: nowIso, sources: {}, outbreaks: [],
  });
  const previousRecalls = readJson<RecallFile>('recalls.json', {
    generatedAt: nowIso, sources: {}, recalls: [],
  });
  const previousTrends = readJson<TrendFile>('trends.json', {
    generatedAt: nowIso, sources: {}, trends: [],
  });

  const [cdc, fda, openfda, fsis, trends] = await Promise.all([
    runSource('cdc', previousOutbreaks.sources.cdc, () => ingestCdc(misses, nowIso)),
    runSource('fda', previousOutbreaks.sources.fda, () => ingestFda(misses, nowIso)),
    runSource('openfda', previousRecalls.sources.openfda, () => ingestOpenFda(misses, now)),
    runSource('fsis', previousRecalls.sources.fsis, () => ingestFsis(misses, now)),
    runSource('nndss', previousTrends.sources.nndss, () => ingestTrends(now)),
  ]);

  // --- outbreaks -----------------------------------------------------------
  const outbreakHealth: Record<string, SourceHealth> = { cdc: cdc.health, fda: fda.health };
  const scraped: Outbreak[] = [...(cdc.data?.outbreaks ?? []), ...(fda.data ?? [])];

  const merged = mergeOutbreaks({
    previous: previousOutbreaks.outbreaks,
    scraped,
    health: outbreakHealth,
    sourceOwners: SOURCE_OWNERS,
    overrides: readOverrides(),
    now: nowIso,
  });

  writeJson('outbreaks.json', {
    generatedAt: nowIso,
    sources: outbreakHealth,
    outbreaks: merged,
  });
  const skipped = cdc.data?.skipped ?? [];
  if (skipped.length > 0) {
    console.log(`[run] CDC feed items skipped as not foodborne: ${skipped.join('; ')}`);
  }

  // --- recalls -------------------------------------------------------------
  // Recalls are a full replacement per source; keep the old list for a source that failed.
  const recalls = [
    ...(openfda.data ?? previousRecalls.recalls.filter((r) => r.source === 'openfda')),
    ...(fsis.data ?? previousRecalls.recalls.filter((r) => r.source === 'fsis')),
  ];
  writeJson('recalls.json', {
    generatedAt: nowIso,
    sources: { openfda: openfda.health, fsis: fsis.health },
    recalls: sortRecalls(recalls),
  });

  // --- trends --------------------------------------------------------------
  writeJson('trends.json', {
    generatedAt: nowIso,
    sources: { nndss: trends.health },
    trends: trends.data ?? previousTrends.trends,
  });

  if (misses.size > 0) {
    console.log(
      `[run] ${misses.size} food descriptions did not match the IFSAC keyword table:\n  ` +
        [...misses].slice(0, 25).join('\n  '),
    );
  }

  const failed = [cdc, fda, openfda, fsis, trends].filter((s) => !s.health.ok);
  console.log(`[run] ${merged.length} outbreaks, ${recalls.length} recalls, ${(trends.data ?? []).length} trends`);
  if (failed.length > 0) {
    // Data is already written; exit non-zero so the run is visibly red without wiping anything.
    console.error(`[run] ${failed.length} source(s) failed: ${failed.map((f) => f.name).join(', ')}`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error('[run] fatal:', err);
  process.exit(2);
});
