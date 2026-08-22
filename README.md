# Are We Healthy Yet?

A plain-language dashboard of the foodborne illness outbreaks US health officials are
investigating right now, plus recent food recalls and how this year's case counts compare
with last year.

Live site: `https://att14.github.io/arewehealthyyet` (once Pages is enabled).

## Does CDC publish this data programmatically?

Partly — and the useful part isn't where you'd expect it.

| Source | Machine readable? | Freshness | Used here |
|---|---|---|---|
| **CDC content syndication** — `tools.cdc.gov/api/v2/resources/media/285676.json` | **Yes**, JSON | Live — one child item per current outbreak notice | ✅ primary outbreak source |
| CDC per-notice content — `…/media/{id}/content.html` | **Yes**, HTML | Live | ✅ status, case counts, advice |
| CDC NORS — `data.cdc.gov/resource/5xkq-dg7x` | Yes, Socrata/OData | **Annual, ends 2023** | ❌ far too old for "ongoing" |
| CDC NNDSS weekly — `data.cdc.gov/resource/x9gk-5huc` | **Yes**, Socrata | Weekly | ✅ trend charts |
| `cdc.gov/foodborne-outbreaks/outbreaks/` | No — HTML, no RSS/JSON | Live | ❌ table is rendered client-side, and the site blocks automated fetches |
| FDA CORE investigation table | No — HTML only | Weekly | ✅ scraped (header-keyed) |
| openFDA food enforcement — `api.fda.gov/food/enforcement.json` | **Yes**, no key needed | ~weekly | ✅ recalls |
| USDA FSIS — `fsis.usda.gov/fsis/api/recall/v/1` | **Yes**, JSON | Live | ✅ recalls |

**The short version:** CDC has no "outbreaks API" in the documented sense, and its official
outbreak dataset (NORS) is an annual retrospective that currently stops at 2023. But CDC's
Public Health Media Library syndicates the *current* outbreak notices as JSON, and each
notice's content carries the investigation status, case counts, implicated food and public
advice. That feed is what this project reads, so no HTML scraping of `www.cdc.gov` is
needed and outbreaks open and close on CDC's own say-so rather than by inference.

FDA still has to be scraped — its CORE table is HTML only — and it is the source for
investigations where the food hasn't been identified yet.

## How outbreaks are added and concluded

`scripts/ingest/merge.ts` holds the lifecycle:

- **Seen in this run** → upsert, refresh `lastSeen`, keep the earliest `firstSeen`. A missing
  value never overwrites a count we already had.
- **Status stated by the agency** → used directly. CDC says `Investigation status: Open`;
  FDA has both an investigation and an outbreak status column.
- **Absent from a _successful_ read** → closed, with `closedAt` stamped.
- **Absent from a _failed_ read** → left exactly as it was.

That last rule is the important one. "We couldn't reach CDC" and "the outbreak ended" look
identical in the data and mean opposite things to a reader, so every source records its own
health (`ok`, `fetchedAt`, `lastSuccessAt`, `error`) and the site says on the page when
something is stale. Nothing is ever closed on a failed read.

CDC and FDA both publish the same multistate outbreaks, so records are deduplicated across
agencies on a strict rule — same germ, same IFSAC category, and a shared significant word in
the food description — with the other agency kept as a cross-reference.

### Adding or correcting an outbreak by hand

`data/overrides.yaml` is applied last and wins over anything the ingest produced. Use it to
force a status, patch a field, or add an outbreak the automated sources don't carry:

```yaml
outbreaks:
  - id: manual-listeria-deli-meat-2026
    manual: true
    pathogen: Listeria
    foodRaw: Sliced deli meat
    foodCategory: Other Meat
    illnesses: 61
    deaths: 10
    sourceUrl: https://www.cdc.gov/listeria/outbreaks/index.html
    advice: Do not eat sliced deli meat unless it is heated to steaming hot.
```

## Food categories

Foods are classified with **IFSAC** — the tri-agency scheme CDC uses in NORS — so the
categories line up with official historical data instead of being invented. The exact leaf
values come from the dataset itself:

```
data.cdc.gov/resource/5xkq-dg7x.json?$select=distinct ifsac_category
```

`src/lib/classify.ts` maps free-text food descriptions onto those categories with an ordered,
word-boundary keyword table, keeping the agency's original wording in `foodRaw`. Anything it
can't match is left `null` and logged rather than guessed at.

Classification is exact for outbreaks, where the food string is clean ("Iceberg Lettuce").
Recall product descriptions are messier marketing text and a few will land in the wrong
category — a burrito sold under the brand "Sprig & Sprout" classifies as Sprouts, for
instance. The product name is always shown, so the reader sees the real thing either way.

## Running it

```bash
npm install
npm run ingest     # refresh src/data/*.json (exits non-zero if a source failed)
npm run test       # unit tests, including parsers against a captured FDA fixture
npm run build      # static site into dist/
npm run preview
```

Two notes on `npm run ingest`:

- It **exits non-zero when any source fails**, after writing the data files. The failure is
  visible without any data being lost.
- Some networks are blocked by the agencies' bot protection. In the sandbox this was built
  in, `tools.cdc.gov`, `api.fda.gov` and `data.cdc.gov` worked, while `www.fda.gov` answered
  intermittently and `www.fsis.usda.gov` refused outright. If a source is blocked from your
  GitHub runner too, use `data/overrides.yaml` — the site will keep showing the last good
  data with a banner saying so.

## Automation

| Workflow | Trigger | What it does |
|---|---|---|
| `.github/workflows/ingest.yml` | every 6h + manual | runs the ingest, runs tests, commits `src/data/*.json` only when something changed |
| `.github/workflows/deploy.yml` | push to `main` + manual | tests, builds, publishes to GitHub Pages |
| `.github/workflows/ci.yml` | PRs and branches | tests and build |

Data lives in git, so every refresh is a reviewable diff and the history is a record of what
was being investigated when.

## Layout

```
src/pages/index.astro       dashboard
src/components/             cards, filter chips, recall table, trend charts, source status
src/lib/                    types, IFSAC taxonomy, classifier, pathogen catalog, view helpers
src/data/*.json             generated, committed
data/overrides.yaml         hand-edited corrections (wins over everything)
scripts/ingest/             fetch, cdc, fda-core, recalls, trends, merge, run
tests/                      lifecycle, classifier and parser tests + captured HTML fixture
```

## Caveats worth knowing

- Case counts are what an agency has **confirmed**. Real totals are always higher — most
  people who get food poisoning are never tested.
- CDC publishes a **count** of affected states on a notice, not a list, so the state filter
  applies to recalls (which do list states) while outbreak cards show "reported in N states".
- Recalls cover the last 120 days. A recall is not an outbreak: most are precautionary.
- This is a summary of public information, not medical advice.
