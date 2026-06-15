# Extraction eval harness

Measures structured-extraction accuracy on real insurance documents (leases, COIs,
homeowners DECs) so we have a defensible per-field accuracy number before any
"we read the actual document" claim ships (Liberty diligence, positioning).

## What it does

`extract.py` reads the documents listed in the `labels/*.csv` ground-truth files
(plus the homeowners DECs in `HOME_FILES`) and, per document, emits a JSON record
where **every field carries**: `value`, `page`, `snippet`, `confidence`
(high/medium/low/not_found), and — for text-mode docs — `snippet_verified` (is the
cited snippet actually on that page? catches hallucinated citations for free).

- Clean digital PDFs → **text mode** (uses the text layer; cheaper, exact).
- Scanned / image-only PDFs → **image mode** (renders pages to PNG, reads visually).
- Routing is automatic (`decide_mode`) and recorded per doc; override with `--force-mode`.

## Provider

Production runs on **OpenAI gpt-4o** (`LLM_PROVIDER=openai` in `apps/api/.env`), so
that's the default baseline — it measures what actually ships. To run a Claude
head-to-head once an Anthropic key exists:

    python eval/extract.py --provider anthropic   # needs ANTHROPIC_API_KEY

Keys are read from `apps/api/.env` (gitignored) or the environment.

## Privacy

The source PDFs and all outputs live OUTSIDE this repo (in the Cloud-Drive docs
folder) and are gitignored as a second line of defence. The documents in this
corpus are the owner's own (own home, own entities/properties). Before running any
**third-party** prospect/client documents, use a zero-data-retention (ZDR) key.

## Usage

    python eval/extract.py --type home,coi --limit 1   # cheap smoke test
    python eval/extract.py                              # full batch (resumes; skips done docs)
    python eval/extract.py --files "Certificate.pdf"    # one named doc
    python eval/extract.py --overwrite                  # re-run everything

## Outputs (in `<docs>/extractions/`)

- `<stem>.json`        — one grounded record per document
- `<type>_extracted.csv` — same columns as `labels/<type>.csv` (paste/diff vs ground truth)
- `summary.md`         — side-by-side skim + a "needs review" list (low-confidence / unverified)
