# Native charts

BurnGuard renders eight original chart designs from a versioned JSON contract. There is no chart-library dependency, remote runtime, canvas screenshot or image-generation step. The same renderer supplies the chart editor, live artifact preview and saved HTML.

## Choose a chart

| Type | Suitable data | Important constraint |
|---|---|---|
| `area` | Magnitude over time | Zero baseline; null leaves a gap |
| `line` | Trends across ordered categories | Null leaves a gap |
| `bar` | Category comparisons | Grouped bars; zero baseline including negatives |
| `composed` | Compatible measures on one scale | Set each series `kind` to `bar`, `line` or `area` |
| `radar` | Comparable measures across a profile | At least 3 axes, nonnegative values, one common scale |
| `pie` | Parts of one meaningful whole | One nonnegative series, at most 12 categories |
| `radial` | Progress against a target | One series, at most 8 categories, values at most `radial_max` |
| `sankey` | Measured flows between stages | Positive flows and a directed acyclic graph |

Every built-in starter is labeled **illustrative data**. Replace it and name the real source before presenting numbers as facts. No chart renderer can verify a user's underlying dataset. Dense axis labels are sampled to avoid overlap; all original labels and values remain in the data table and hover titles. Series color and legend labels identify data; radar axes must use comparable units. Pie charts show an explicit empty state when the total is zero. Radial tracks share a fixed target. Sankey uses one shared flow scale and reports incoming/outgoing values without fabricating balancing links.

## In the workspace

1. Open an HTML file and click **차트** next to the zoom and 3D controls.
2. Choose a starter. This creates a new draft chart; it does not overwrite a saved chart.
3. Paste a tab-separated table from a spreadsheet. The first row contains category/series names. Sankey requires source, target and value columns.
4. Set the title, source, units and theme. Use Advanced for dimensions, description and palette. Composed series have individual mark selectors.
5. Save to append the chart to the current document, or select an existing chart to update it. Use **Save and ask AI** to request a specific placement or revision.

Saving preserves other charts and the edited figure's layout attributes. Revision, artifact digest and file hash must still match; an intervening edit returns a conflict instead of overwriting it. Reload the saved version before retrying. The existing artifact undo action restores the previous file bytes.

The panel's primary data editor accepts tabs, not CSV or raw JSON. A blank numeric cell is a missing value for line/area/bar/composed. It is not zero. Tabs and newlines cannot appear in category, series or node labels. Shift+Tab leaves the editor. Pressing a starter button begins a fresh illustrative draft; save the current draft first if needed.

## Authoring contract

Put a figure where it belongs in the page or slide. The figure ID and JSON ID must match and be unique within that HTML file:

```html
<figure data-bg-chart="quarterly">
  <script type="application/json" data-bg-chart-config>
  {
    "schema_version": 1,
    "id": "quarterly",
    "type": "composed",
    "title": "Quarterly activity",
    "description": "Illustrative comparison on one common scale.",
    "source": "Illustrative data, not actual results",
    "unit": "items",
    "theme": "brand",
    "width": 960,
    "height": 540,
    "categories": ["Q1", "Q2", "Q3"],
    "series": [
      { "name": "Created", "values": [20, 35, 28], "kind": "bar" },
      { "name": "Reviewed", "values": [18, 30, 26], "kind": "line" }
    ]
  }
  </script>
</figure>
```

Required common fields: `schema_version: 1`, `id`, `type`, `title`.

| Field | Limit / default |
|---|---|
| `id` | ASCII letter first, then letters/digits/underscore/hyphen; max 40 characters |
| `title`, `description`, `source`, `unit` | Max 120, 300, 160, 20 characters respectively; optional fields default to empty strings |
| `width`, `height` | 320–2400 and 300–1600; SVG viewBox defaults to 960 × 540 |
| `theme` | `brand`, `paper`, `midnight`, `mono`; default `brand` |
| `colors` | Up to 6 six-digit HEX colors; empty means theme colors |
| `categories` | 1–36 strings, at most 60 characters each; tighter limits for radar/pie/radial above |
| `series` | 1–6 objects with `name`, `values`, optional `kind`; one series for pie/radial |
| `values` | Same length as categories, finite numbers within ±1e12; null only where documented |
| `radial_max` | Positive target from 1e-9 to 1e12; default 100 |

`brand` exposes `--bg-chart-1` through `--bg-chart-6`; the figure uses `--font-body` with a system-font fallback. The SVG scales with the figure width. Allow space for its title, legend and data/source details in addition to the SVG aspect ratio. For decks, allocate enough slide space for labels and verify artboard fit.

Sankey uses `nodes` and `links` instead of `categories`, `series` and `radial_max`:

```json
{
  "schema_version": 1,
  "id": "flow",
  "type": "sankey",
  "title": "Illustrative visitor flow",
  "source": "Illustrative data",
  "nodes": [
    { "id": "visit", "label": "Visits" },
    { "id": "order", "label": "Orders" },
    { "id": "leave", "label": "Other visits" }
  ],
  "links": [
    { "source": "visit", "target": "order", "value": 35 },
    { "source": "visit", "target": "leave", "value": 65 }
  ]
}
```

Sankey accepts 2–16 unique nodes and 1–32 links, with values from 1e-9 to 1e12. It rejects unknown endpoints, isolated nodes, duplicate links, self-links and cycles. Node labels have a 60-character limit. No executable fields or extra keys are accepted. An HTML file can contain at most 32 managed charts. JSON strings embedded in HTML must encode `<` as `\u003c` so text cannot close the script element.

## Persistence and export

During generation, a complete valid JSON placeholder is immediately rendered in the sandboxed preview. After the provider turn, the backend validates chart structure and materializes inline SVG before committing the artifact. Malformed chart contracts fail the artifact operation; this prevents publishing corrupt generated state and is separate from advisory design-quality findings. Existing committed files remain available for export.

Saved HTML contains its config, SVG, native hover titles and an accessible data table. It works without JavaScript or a chart CDN. PNG/PDF render the saved SVG. PPTX captures the complete slide design at high resolution and retains source text in speaker notes; these are not native editable PowerPoint chart objects.

Change managed chart data through its JSON or the chart editor. Direct edits to generated SVG marks can be replaced by the next render. The chart panel appends new charts to the document; ask AI to position them within a specific section or slide. Charts do not add an export-quality gate.

## Verification

```powershell
bun test packages/backend/tests/charts.test.ts
node scripts/qa/e2e-smoke.mjs --only creation-canvas-charts
```

The unit checks cover all eight types, numeric/identity validation, injection, gaps, zero totals, materialization, multiple charts, stale writes and undo. The isolated browser fixture creates all eight through the real UI/API, edits/reloads data, checks a narrow viewport, and opens the persisted HTML with JavaScript disabled and all network requests blocked. These checks do not submit a live model request or prove statistical validity, screen-reader conformance or every export format.
