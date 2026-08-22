import type { FoodGroup, IfsacCategory } from './ifsac.js';

export type OutbreakSource = 'cdc' | 'fda' | 'manual';
export type OutbreakStatus = 'active' | 'closed';

export interface Outbreak {
  /** Stable slug: source-pathogen-food-firstSeenYear. Survives count updates. */
  id: string;
  source: OutbreakSource;
  pathogen: string;
  status: OutbreakStatus;
  /** Implicated food exactly as the agency wrote it. */
  foodRaw: string | null;
  foodCategory: IfsacCategory | null;
  foodGroup: FoodGroup | null;
  illnesses: number | null;
  hospitalizations: number | null;
  deaths: number | null;
  /** CDC publishes a count of affected states on the notice, not a list of them. */
  stateCount: number | null;
  /** Named states, where the source gives them (FDA, recalls, hand-entered records). */
  states: string[];
  /** ISO dates. firstSeen is when we first saw it, not when the outbreak began. */
  firstSeen: string;
  lastSeen: string;
  closedAt: string | null;
  sourceUrl: string | null;
  /** Plain-language "what should I do" line, when the agency gives one. */
  advice: string | null;
  notes: string | null;
  /** The notice headline, e.g. "Salmonella Outbreak Linked to Jalapenos". */
  title: string | null;
  /** When the agency last updated the notice (distinct from when we last read it). */
  updatedAt: string | null;
  /** Other agencies tracking the same outbreak, folded in so it appears once on the page. */
  crossReferences?: Array<{ source: OutbreakSource; url: string | null; id: string }>;
}

export interface Recall {
  id: string;
  source: 'openfda' | 'fsis';
  firm: string;
  product: string;
  reason: string;
  /** FDA Class I/II/III; FSIS uses the same class language. */
  classification: string | null;
  foodRaw: string | null;
  foodCategory: IfsacCategory | null;
  foodGroup: FoodGroup | null;
  states: string[];
  date: string | null;
  sourceUrl: string | null;
}

export interface TrendPoint {
  year: number;
  week: number;
  cases: number;
}

export interface Trend {
  /** Condition label as NNDSS writes it. */
  label: string;
  /** How we name it on the page. */
  displayName: string;
  currentYear: TrendPoint[];
  previousYear: TrendPoint[];
  currentYearTotal: number;
  previousYearTotalToDate: number;
}

/** Per-source health. A failed source must never be read as "nothing is happening". */
export interface SourceHealth {
  ok: boolean;
  fetchedAt: string | null;
  /** Last time this source was successfully read, carried across failed runs. */
  lastSuccessAt: string | null;
  error: string | null;
}

export interface OutbreakFile {
  generatedAt: string;
  sources: Record<string, SourceHealth>;
  outbreaks: Outbreak[];
}

export interface RecallFile {
  generatedAt: string;
  sources: Record<string, SourceHealth>;
  recalls: Recall[];
}

export interface TrendFile {
  generatedAt: string;
  sources: Record<string, SourceHealth>;
  trends: Trend[];
}
