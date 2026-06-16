#!/usr/bin/env python3
"""
Pre-fill labels/*.csv from a provider's extraction so hand-labeling becomes
verify-and-correct instead of typing from scratch.

The `notes` column flags the cells worth scrutinizing:
  DISAGREE:<fields>  the two providers gave different answers — at least one is wrong
  LOWCONF:<fields>   the primary model self-flagged low/not_found/unverified
  NOT EXTRACTED      the primary provider has no result for this doc

Empty templates are backed up to labels/_templates/ before overwriting.

Usage:
  python eval/bootstrap_labels.py                 # primary=anthropic, compare vs openai
  python eval/bootstrap_labels.py --primary openai --compare anthropic
"""
import argparse
import csv
import json
import re
import shutil
from pathlib import Path
import importlib.util

_spec = importlib.util.spec_from_file_location("ex", str(Path(__file__).with_name("extract.py")))
ex = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(ex)

BASE = ex.DOCS_DIR / "extractions"
LAB = ex.LABELS_DIR


def load(provider: str) -> dict:
    d = {}
    pdir = BASE / provider
    if pdir.exists():
        for f in pdir.glob("*.json"):
            d[f.stem] = json.loads(f.read_text(encoding="utf-8"))
    return d


def norm(v) -> str:
    if v in (None, ""):
        return ""
    s = str(v).strip().lower()
    if re.fullmatch(r"[\$,0-9. ]+", s):
        s = re.sub(r"[^0-9.]", "", s)
    return s


def prefill(doc_type: str, primary: dict, compare: dict):
    csv_name, fields, _ = ex.SCHEMAS[doc_type]
    csv_name = csv_name or f"{doc_type}.csv"
    cols = ["filename"] + [n for n, _ in fields] + ["notes"]
    src = LAB / csv_name

    if src.exists():
        with src.open(newline="", encoding="utf-8") as fh:
            names = [r["filename"] for r in csv.DictReader(fh) if r.get("filename")]
        (LAB / "_templates").mkdir(exist_ok=True)
        shutil.copy(src, LAB / "_templates" / csv_name)
    else:
        names = sorted(f"{k}.pdf" for k, v in primary.items() if v.get("doc_type") == doc_type)

    filled = 0
    with src.open("w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh)
        w.writerow(cols)
        for name in names:
            stem = Path(name).stem
            rec = primary.get(stem)
            if not rec:
                w.writerow([name] + [""] * len(fields) + ["NOT EXTRACTED"])
                continue
            filled += 1
            vals, disagree, lowconf = [], [], []
            other = compare.get(stem)
            for n, _ in fields:
                pf = rec["fields"].get(n, {})
                vals.append(pf.get("value") or "")
                if pf.get("confidence") in ("low", "not_found") or pf.get("snippet_verified") is False:
                    lowconf.append(n)
                if other:
                    of = other["fields"].get(n, {})
                    if norm(pf.get("value")) != norm(of.get("value")):
                        disagree.append(n)
            note = []
            if disagree:
                note.append("DISAGREE:" + ",".join(disagree))
            if lowconf:
                note.append("LOWCONF:" + ",".join(lowconf))
            w.writerow([name] + vals + [" | ".join(note)])
    print(f"  {csv_name}: {filled}/{len(names)} rows pre-filled  ->  {src}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--primary", default="anthropic")
    ap.add_argument("--compare", default="openai")
    args = ap.parse_args()
    primary, compare = load(args.primary), load(args.compare)
    print(f"primary={args.primary} ({len(primary)} docs)  compare={args.compare} ({len(compare)} docs)")
    for dt in ("coi", "lease", "home"):
        prefill(dt, primary, compare)
    print("\nTemplates backed up under labels/_templates/. "
          "Verify each row (notes flag the cells to check), then score against the *_extracted.csv files.")


if __name__ == "__main__":
    main()
