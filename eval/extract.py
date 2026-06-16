#!/usr/bin/env python3
"""
Insurance document extraction harness (eval pass 1).

Reads the lease + COI + homeowners documents listed in the labels/ CSVs, extracts
the agreed field schema from each, and writes — per document — a grounded JSON
file where EVERY field carries:

    value        - the extracted value, verbatim, as a string (or null)
    page         - 1-based page number the value was found on
    snippet      - the exact text span the value came from
    confidence   - high | medium | low | not_found
    snippet_verified - (text mode only) True if the snippet is actually present
                       on the cited page; flags hallucinated citations for free

Scanned / image-only PDFs are rendered to page images and read visually; clean
digital PDFs use their text layer (cheaper and more accurate on crisp text).
The routing is automatic and recorded per document.

Outputs (all OUTSIDE the git repo, next to the source PDFs):
    <docs>/extractions/<stem>.json     one per document
    <docs>/extractions/*_extracted.csv same columns as labels/*.csv (value-only)
    <docs>/extractions/summary.md      skim-able side-by-side + a "needs review" list

Usage:
    python eval/extract.py --type home,coi --limit 1   # cheap smoke test
    python eval/extract.py                              # full batch (resumes)
    python eval/extract.py --files "Certificate.pdf"    # one named doc
    python eval/extract.py --overwrite --model claude-sonnet-4-6
"""
from __future__ import annotations

import argparse
import base64
import csv
import json
import re
import sys
import time
from datetime import datetime
from pathlib import Path

import fitz  # PyMuPDF
import anthropic

# ── Paths ────────────────────────────────────────────────────────────────────
DOCS_DIR = Path(r"C:\Users\maber\Cloud-Drive\Covrabl\Insurance test documents")
OUT_DIR = DOCS_DIR / "extractions"
LABELS_DIR = DOCS_DIR / "labels"
ENV_PATH = Path(__file__).resolve().parents[1] / "apps" / "api" / ".env"

# ── Model / rendering knobs ──────────────────────────────────────────────────
# Production runs on OpenAI (LLM_PROVIDER=openai, gpt-4o), so that's the default
# baseline — measures what actually ships. Swap provider/model via CLI for a
# Claude head-to-head once an Anthropic key exists.
DEFAULT_MODELS = {"openai": "gpt-4o", "anthropic": "claude-sonnet-4-6"}
MAX_TOKENS = 4096
MAX_IMAGE_PAGES = 50          # cap pages sent in image mode (logged when it bites)
IMG_LONG_SIDE = 1500          # px; Anthropic downscales above ~1568 anyway
TEXT_PAGE_MIN_CHARS = 100     # a page with >= this many chars counts as "text-rich"
DIGITAL_DOC_RATIO = 0.6       # >= this fraction text-rich -> use text mode
TEXT_CHAR_CAP = 400_000       # ceiling on text sent in text mode
KEYWORDS = ("insur", "indemnif", "waiver", "subrogat", "certificate",
            "additional insured", "liability", "coverage")

# ── Field schemas — column order MUST match labels/*.csv ──────────────────────
# (field_name, guidance shown to the model)
COI_FIELDS = [
    ("certificate_holder_name", "entity the certificate is issued to (usually bottom-left of ACORD 25)"),
    ("insured_name", "the named insured shown on the certificate"),
    ("carrier", "insurer / insurance company name (if several, the GL carrier)"),
    ("policy_number_gl", "the General Liability policy number"),
    ("coverage_types_present", "comma-separated coverage lines present, e.g. 'GL, Auto, Umbrella, Workers Comp, Property'"),
    ("gl_each_occurrence", "General Liability Each Occurrence limit, digits only e.g. 1000000"),
    ("gl_aggregate", "General Liability General Aggregate limit, digits only"),
    ("auto_csl", "Automobile Combined Single Limit, digits only"),
    ("umbrella_aggregate", "Umbrella / Excess aggregate limit, digits only"),
    ("workers_comp_each_accident", "Workers Comp Each Accident (E.L.) limit, digits only"),
    ("additional_insured", "'true' or 'false' — is the holder an additional insured?"),
    ("waiver_of_subrogation", "'true' or 'false' — does a waiver of subrogation apply?"),
    ("effective_date_earliest", "earliest policy effective date, YYYY-MM-DD"),
    ("expiration_date_latest", "latest policy expiration date, YYYY-MM-DD"),
    ("producer_name", "insurance agency / broker (producer) name"),
]
LEASE_FIELDS = [
    ("property_address", "the leased premises address"),
    ("landlord_name", "landlord / lessor name"),
    ("tenant_name", "tenant / lessee name"),
    ("required_gl_each_occurrence", "required GL Each Occurrence limit, digits only"),
    ("required_gl_aggregate", "required GL Aggregate limit, digits only"),
    ("required_auto_csl", "required Auto Combined Single Limit, digits only"),
    ("required_umbrella_aggregate", "required Umbrella / Excess limit, digits only"),
    ("required_workers_comp", "required Workers Comp — 'statutory' or a limit"),
    ("additional_insured_required", "'true' or 'false'"),
    ("waiver_of_subrogation_required", "'true' or 'false'"),
    ("primary_noncontributory_required", "'true' or 'false'"),
    ("certificate_holder_text", "exact certificate-holder name + address the tenant must name"),
    ("notice_of_cancellation_days", "days of advance cancellation notice required, digits only"),
    ("insurer_rating_required", "required AM Best / insurer rating, e.g. 'A-VII'"),
    ("deadline_to_provide", "deadline by which the tenant must provide the certificate"),
]
HOME_FIELDS = [
    ("carrier", "insurance company name"),
    ("policy_number", "policy number"),
    ("named_insured", "named insured(s)"),
    ("property_address", "insured property location"),
    ("effective_date", "policy effective date, YYYY-MM-DD"),
    ("expiration_date", "policy expiration date, YYYY-MM-DD"),
    ("coverage_A_dwelling", "Coverage A — Dwelling limit, digits only"),
    ("coverage_B_other_structures", "Coverage B — Other Structures limit, digits only"),
    ("coverage_C_personal_property", "Coverage C — Personal Property limit, digits only"),
    ("coverage_D_loss_of_use", "Coverage D — Loss of Use limit, digits only"),
    ("coverage_E_personal_liability", "Coverage E — Personal Liability each-occurrence limit, digits only"),
    ("coverage_F_medical_payments", "Coverage F — Medical Payments each-person limit, digits only"),
    ("all_other_perils_deductible", "Section I 'All Other Perils' deductible, digits only"),
    ("endorsements_present", "comma-separated forms/endorsements listed (form numbers ok)"),
    ("notable_exclusions", "notable exclusions called out, e.g. 'earthquake'"),
    ("mortgagee", "first mortgagee name"),
    ("total_premium", "total policy premium, digits only"),
]

SCHEMAS = {
    "coi": ("cois.csv", COI_FIELDS, "Certificate of Insurance (ACORD 25 / 28 / evidence form)"),
    "lease": ("leases.csv", LEASE_FIELDS, "commercial or residential lease — insurance REQUIREMENTS the tenant must carry"),
    "home": (None, HOME_FIELDS, "homeowners insurance declarations page"),
}

# Homeowners docs are not in a label CSV — list them explicitly (approved scope).
HOME_FILES = ["24-25 PHOM DEC - updated homeowners policy.pdf"]

FIELD_SHAPE = {
    "type": "object",
    "properties": {
        "value": {"type": ["string", "null"],
                  "description": "extracted value, verbatim, as a string; null if absent"},
        "page": {"type": ["integer", "null"],
                 "description": "1-based page number the value was found on"},
        "snippet": {"type": ["string", "null"],
                    "description": "the exact text span (copied verbatim) the value came from"},
        "confidence": {"type": "string", "enum": ["high", "medium", "low", "not_found"]},
    },
    "required": ["value", "page", "snippet", "confidence"],
}


def _env_value(name: str) -> str:
    import os
    if os.environ.get(name):
        return os.environ[name]
    if ENV_PATH.exists():
        for line in ENV_PATH.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line.startswith(name) and "=" in line:
                return line.split("=", 1)[1].strip().strip('"').strip("'")
    return ""


def load_api_key(provider: str) -> str:
    name = "OPENAI_API_KEY" if provider == "openai" else "ANTHROPIC_API_KEY"
    key = _env_value(name)
    if not key:
        sys.exit(f"No {name} in env or {ENV_PATH}")
    return key


def build_tool(doc_type: str) -> dict:
    _, fields, desc = SCHEMAS[doc_type]
    props = {name: dict(FIELD_SHAPE, description=guide) for name, guide in fields}
    props["overall_notes"] = {"type": "string",
                              "description": "1-2 sentences: anything ambiguous, conflicting, or worth a human's eye"}
    return {
        "name": "record_extraction",
        "description": f"Record the structured fields extracted from a {desc}.",
        "input_schema": {
            "type": "object",
            "properties": props,
            "required": [name for name, _ in fields],
        },
    }


SYSTEM = (
    "You are a meticulous insurance-document extraction engine. Extract ONLY what the "
    "document actually states — never infer, average, or fill from typical values. For "
    "every field you MUST return the value, the 1-based page it appears on, and an exact "
    "verbatim snippet copied from that page. If a field is genuinely absent, set value and "
    "snippet to null, page to null, and confidence to 'not_found'. Use 'low' confidence "
    "when the document is ambiguous or hard to read. Money values: digits only, no '$' or "
    "commas (e.g. 1000000). Booleans: the string 'true' or 'false'. Dates: YYYY-MM-DD."
)


def _norm(s: str) -> str:
    return re.sub(r"\s+", " ", s or "").strip().lower()


def render_pages(doc) -> tuple[list[str], list[bytes]]:
    """Return (per-page text, per-page PNG bytes-or-None placeholder lazily)."""
    texts = [page.get_text("text") for page in doc]
    return texts


def page_png(page) -> bytes:
    rect = page.rect
    longest = max(rect.width, rect.height) or 1
    zoom = min(IMG_LONG_SIDE / longest, 3.0)
    pix = page.get_pixmap(matrix=fitz.Matrix(zoom, zoom))
    return pix.tobytes("png")


def select_image_pages(texts: list[str], cap: int) -> list[int]:
    n = len(texts)
    if n <= cap:
        return list(range(n))
    keep = {i for i, t in enumerate(texts) if any(k in t.lower() for k in KEYWORDS)}
    keep.update([0, 1, n - 1])  # always include front matter + last page
    # Fully-scanned docs have no text layer to keyword-match, so `keep` collapses
    # to ~3 pages and the buried insurance clause is never sent. Fill up to the
    # cap with evenly-spaced pages so coverage is broad regardless.
    if len(keep) < cap:
        step = max(1, n // cap)
        for i in range(0, n, step):
            keep.add(i)
            if len(keep) >= cap:
                break
    return sorted(keep)[:cap]


def decide_mode(texts: list[str], force: str | None) -> str:
    if force:
        return force
    rich = sum(1 for t in texts if len(t.strip()) >= TEXT_PAGE_MIN_CHARS)
    return "text" if texts and rich / len(texts) >= DIGITAL_DOC_RATIO else "image"


def extract_one(client, provider: str, model: str, path: Path, doc_type: str,
                force_mode: str | None) -> dict:
    doc = fitz.open(path)
    texts = render_pages(doc)
    n_pages = len(texts)
    mode = decide_mode(texts, force_mode)
    tool = build_tool(doc_type)

    # Neutral parts: ("text", str) or ("image", png_bytes). Each provider serializes.
    truncated = False
    parts: list[tuple] = []
    if mode == "text":
        marked, total = [], 0
        for i, t in enumerate(texts, 1):
            chunk = f"\n===== PAGE {i} =====\n{t}"
            if total + len(chunk) > TEXT_CHAR_CAP:
                truncated = True
                break
            marked.append(chunk)
            total += len(chunk)
        parts.append(("text",
                      "Extract the schema fields from this document. Page markers "
                      "(===== PAGE n =====) tell you which page each line is on; cite that "
                      "page number and copy snippets verbatim.\n" + "".join(marked)))
        pages_sent = list(range(1, len(marked) + 1))
    else:
        picked = select_image_pages(texts, MAX_IMAGE_PAGES)
        truncated = len(picked) < n_pages
        parts.append(("text",
                      "Extract the schema fields from these page images. The page number "
                      "is shown before each image; cite it and copy snippets verbatim."))
        for idx in picked:
            parts.append(("text", f"----- PAGE {idx + 1} -----"))
            parts.append(("image", page_png(doc[idx])))
        pages_sent = [i + 1 for i in picked]

    if provider == "openai":
        raw, in_tok, out_tok = _call_openai(client, model, parts, tool)
    else:
        raw, in_tok, out_tok = _call_anthropic(client, model, parts, tool)

    fields = {}
    _, schema_fields, _ = SCHEMAS[doc_type]
    for name, _ in schema_fields:
        f = raw.get(name) or {}
        if isinstance(f, str):  # model returned a bare value instead of the field object
            f = {"value": f, "page": None, "snippet": None, "confidence": "medium"}
        rec = {
            "value": f.get("value"),
            "page": f.get("page"),
            "snippet": f.get("snippet"),
            "confidence": f.get("confidence", "not_found"),
        }
        # Free grounding check: in text mode, is the snippet really on the cited page?
        if mode == "text" and rec["snippet"] and rec["page"] and 1 <= rec["page"] <= n_pages:
            rec["snippet_verified"] = _norm(rec["snippet"]) in _norm(texts[rec["page"] - 1])
        else:
            rec["snippet_verified"] = None
        fields[name] = rec

    return {
        "filename": path.name,
        "doc_type": doc_type,
        "mode": mode,
        "model": model,
        "num_pages": n_pages,
        "pages_sent": pages_sent,
        "truncated": truncated,
        "overall_notes": raw.get("overall_notes"),
        "usage": {"input_tokens": in_tok, "output_tokens": out_tok},
        "fields": fields,
    }


def _retry(fn, tries=3):
    import openai
    transient = (anthropic.APIStatusError, anthropic.APIConnectionError,
                 openai.APIError, openai.APIConnectionError)
    for attempt in range(tries):
        try:
            return fn()
        except transient as e:
            if attempt == tries - 1:
                raise
            wait = 4 * (attempt + 1)
            print(f"    ! API error ({e.__class__.__name__}); retry in {wait}s")
            time.sleep(wait)


def _call_anthropic(client, model, parts, tool):
    content = []
    for kind, payload in parts:
        if kind == "text":
            content.append({"type": "text", "text": payload})
        else:
            content.append({"type": "image", "source": {
                "type": "base64", "media_type": "image/png",
                "data": base64.b64encode(payload).decode()}})
    resp = _retry(lambda: client.messages.create(
        model=model, max_tokens=MAX_TOKENS, system=SYSTEM,
        messages=[{"role": "user", "content": content}],
        tools=[tool], tool_choice={"type": "tool", "name": "record_extraction"}))
    block = next((b for b in resp.content if b.type == "tool_use"), None)
    if block is None:
        raise RuntimeError("model did not call the extraction tool")
    return block.input, resp.usage.input_tokens, resp.usage.output_tokens


def _call_openai(client, model, parts, tool):
    content = []
    for kind, payload in parts:
        if kind == "text":
            content.append({"type": "text", "text": payload})
        else:
            b64 = base64.b64encode(payload).decode()
            content.append({"type": "image_url",
                            "image_url": {"url": f"data:image/png;base64,{b64}"}})
    fn_tool = {"type": "function", "function": {
        "name": tool["name"], "description": tool["description"],
        "parameters": tool["input_schema"]}}
    resp = _retry(lambda: client.chat.completions.create(
        model=model, max_tokens=MAX_TOKENS,
        messages=[{"role": "system", "content": SYSTEM},
                  {"role": "user", "content": content}],
        tools=[fn_tool],
        tool_choice={"type": "function", "function": {"name": tool["name"]}}))
    msg = resp.choices[0].message
    if not msg.tool_calls:
        raise RuntimeError("model did not call the extraction tool")
    raw = json.loads(msg.tool_calls[0].function.arguments)
    return raw, resp.usage.prompt_tokens, resp.usage.completion_tokens


# ── manifest ─────────────────────────────────────────────────────────────────
def csv_filenames(csv_name: str) -> list[str]:
    path = LABELS_DIR / csv_name
    with path.open(newline="", encoding="utf-8") as fh:
        return [row["filename"] for row in csv.DictReader(fh) if row.get("filename")]


def build_manifest(types: list[str]) -> list[tuple[str, str]]:
    items = []
    for t in types:
        csv_name = SCHEMAS[t][0]
        names = csv_filenames(csv_name) if csv_name else HOME_FILES
        items += [(name, t) for name in names]
    return items


# ── outputs ──────────────────────────────────────────────────────────────────
CONF_MARK = {"high": "", "medium": "~", "low": " ⚠", "not_found": " ∅"}


def cell(rec: dict) -> str:
    v = rec.get("value")
    v = "—" if v in (None, "") else str(v).replace("|", "\\|")
    if len(v) > 40:
        v = v[:37] + "…"
    mark = CONF_MARK.get(rec.get("confidence"), "")
    if rec.get("snippet_verified") is False:
        mark += " ⛌"
    return v + mark


SUMMARY_COLS = {
    "coi": ["insured_name", "carrier", "coverage_types_present", "gl_each_occurrence",
            "gl_aggregate", "additional_insured", "waiver_of_subrogation", "expiration_date_latest"],
    "lease": ["tenant_name", "property_address", "required_gl_each_occurrence",
              "required_gl_aggregate", "additional_insured_required",
              "waiver_of_subrogation_required", "notice_of_cancellation_days"],
    "home": ["carrier", "coverage_A_dwelling", "coverage_E_personal_liability",
             "all_other_perils_deductible", "total_premium"],
}


def write_csv(doc_type: str, results: list[dict]):
    _, fields, _ = SCHEMAS[doc_type]
    cols = ["filename"] + [n for n, _ in fields]
    out = OUT_DIR / f"{doc_type}_extracted.csv"
    with out.open("w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh)
        w.writerow(cols)
        for r in results:
            w.writerow([r["filename"]] + [(r["fields"][n].get("value") or "") for n, _ in fields])


def write_summary(all_results: dict[str, list[dict]], model: str):
    lines = [f"# Extraction summary",
             f"_Run {datetime.now():%Y-%m-%d %H:%M} · model `{model}`_", ""]
    total = sum(len(v) for v in all_results.values())
    modes = {}
    for rs in all_results.values():
        for r in rs:
            modes[r["mode"]] = modes.get(r["mode"], 0) + 1
    lines.append(f"**{total} documents** · modes: " +
                 ", ".join(f"{k} {v}" for k, v in modes.items()))
    lines.append("\nLegend: `~` medium · `⚠` low confidence · `∅` not found · "
                 "`⛌` snippet NOT found on cited page (possible hallucination)\n")

    needs_review = []
    for doc_type, results in all_results.items():
        if not results:
            continue
        lines.append(f"\n## {doc_type.upper()}  ({len(results)})\n")
        cols = SUMMARY_COLS[doc_type]
        lines.append("| document | " + " | ".join(cols) + " | flags |")
        lines.append("|" + "---|" * (len(cols) + 2))
        for r in results:
            flags = sum(1 for f in r["fields"].values()
                        if f.get("confidence") in ("low", "not_found")
                        or f.get("snippet_verified") is False)
            row = [r["filename"][:34]] + [cell(r["fields"][c]) for c in cols] + [str(flags) if flags else ""]
            lines.append("| " + " | ".join(row) + " |")
            if flags:
                weak = [n for n, f in r["fields"].items()
                        if f.get("confidence") in ("low", "not_found")
                        or f.get("snippet_verified") is False]
                needs_review.append((r["filename"], doc_type, weak, r.get("overall_notes")))

    if needs_review:
        lines.append("\n## ⚠ Needs review\n")
        for fn, dt, weak, notes in needs_review:
            lines.append(f"- **{fn}** ({dt}) — weak/missing: {', '.join(weak)}")
            if notes:
                lines.append(f"    - _note:_ {notes}")
    (OUT_DIR / "summary.md").write_text("\n".join(lines) + "\n", encoding="utf-8")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--type", default="coi,lease,home", help="comma list: coi,lease,home")
    ap.add_argument("--limit", type=int, default=0, help="max docs per type (0 = all)")
    ap.add_argument("--files", default="", help="comma list of exact filenames to run")
    ap.add_argument("--overwrite", action="store_true", help="re-run docs that already have JSON")
    ap.add_argument("--force-mode", choices=["text", "image"], default=None)
    ap.add_argument("--provider", choices=["openai", "anthropic"],
                    default=(_env_value("LLM_PROVIDER") or "openai").lower())
    ap.add_argument("--model", default=None, help="defaults per provider")
    args = ap.parse_args()
    provider = args.provider
    model = args.model or DEFAULT_MODELS[provider]

    global OUT_DIR  # provider-separated outputs so runs don't overwrite each other
    OUT_DIR = OUT_DIR / provider
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    key = load_api_key(provider)
    if provider == "openai":
        import openai
        client = openai.OpenAI(api_key=key, timeout=300.0)
    else:
        client = anthropic.Anthropic(api_key=key, timeout=300.0)
    print(f"provider={provider} model={model}")

    types = [t.strip() for t in args.type.split(",") if t.strip()]
    only = {f.strip() for f in args.files.split(",") if f.strip()}
    manifest = build_manifest(types)
    if only:
        manifest = [(n, t) for n, t in manifest if n in only]
    if args.limit:
        per = {}
        capped = []
        for n, t in manifest:
            if per.get(t, 0) < args.limit:
                capped.append((n, t)); per[t] = per.get(t, 0) + 1
        manifest = capped

    all_results: dict[str, list[dict]] = {t: [] for t in types}
    spent = {"in": 0, "out": 0}
    for i, (name, doc_type) in enumerate(manifest, 1):
        path = DOCS_DIR / name
        out_json = OUT_DIR / f"{Path(name).stem}.json"
        if not path.exists():
            print(f"[{i}/{len(manifest)}] MISSING {name}"); continue
        if out_json.exists() and not args.overwrite:
            print(f"[{i}/{len(manifest)}] skip (done) {name}")
            all_results.setdefault(doc_type, []).append(json.loads(out_json.read_text(encoding="utf-8")))
            continue
        print(f"[{i}/{len(manifest)}] {doc_type:5} {name}", flush=True)
        try:
            res = extract_one(client, provider, model, path, doc_type, args.force_mode)
        except Exception as e:
            print(f"    ! FAILED: {e.__class__.__name__}: {e}")
            continue
        out_json.write_text(json.dumps(res, indent=2, ensure_ascii=False), encoding="utf-8")
        all_results.setdefault(doc_type, []).append(res)
        spent["in"] += res["usage"]["input_tokens"]
        spent["out"] += res["usage"]["output_tokens"]
        wk = sum(1 for f in res["fields"].values()
                 if f.get("confidence") in ("low", "not_found") or f.get("snippet_verified") is False)
        print(f"    {res['mode']} · {res['num_pages']}p · "
              f"{res['usage']['input_tokens']}+{res['usage']['output_tokens']} tok · {wk} flagged")

    for t in types:
        if all_results.get(t):
            write_csv(t, all_results[t])
    write_summary({t: all_results.get(t, []) for t in types}, f"{provider}/{model}")
    print(f"\nDone. in={spent['in']} out={spent['out']} tokens. "
          f"Outputs in {OUT_DIR}")


if __name__ == "__main__":
    main()
