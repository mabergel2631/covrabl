#!/usr/bin/env python3
"""
Score each provider's extraction against the hand-verified labels/*.csv.

Run this AFTER you've corrected the pre-filled label files. Reports, per provider:
  - exact-match accuracy over all labeled cells (empty==empty counts as correct)
  - accuracy on PRESENT fields only (where the verified label is non-empty) — the
    number that actually reflects extraction quality
  - a per-field breakdown so you see which fields are weak
Writes a scorecard to extractions/scorecard.md and prints a summary.

Usage:
  python eval/score.py                       # scores openai + anthropic
  python eval/score.py --providers anthropic
"""
import argparse
import csv
import re
from pathlib import Path
import importlib.util

_spec = importlib.util.spec_from_file_location("ex", str(Path(__file__).with_name("extract.py")))
ex = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(ex)

BASE = ex.DOCS_DIR / "extractions"
LAB = ex.LABELS_DIR


def norm(v) -> str:
    if v in (None, ""):
        return ""
    s = str(v).strip().lower()
    if re.fullmatch(r"[\$,0-9. ]+", s):
        s = re.sub(r"[^0-9.]", "", s)
    return s


def read_csv(path: Path) -> dict:
    if not path.exists():
        return {}
    with path.open(newline="", encoding="utf-8") as fh:
        return {r["filename"]: r for r in csv.DictReader(fh) if r.get("filename")}


def score(provider: str) -> dict:
    out = {"provider": provider, "per_field": {}, "mismatches": []}
    cells = present = cells_ok = present_ok = 0
    for dt in ("coi", "lease", "home"):
        csv_name, fields, _ = ex.SCHEMAS[dt]
        csv_name = csv_name or f"{dt}.csv"
        truth = read_csv(LAB / csv_name)
        pred = read_csv(BASE / provider / f"{dt}_extracted.csv")
        for fn, trow in truth.items():
            prow = pred.get(fn)
            for name, _ in fields:
                t, p = norm(trow.get(name)), norm(prow.get(name) if prow else "")
                pf = out["per_field"].setdefault(name, [0, 0, 0, 0])  # ok, total, present_ok, present_total
                ok = (t == p)
                cells += 1; pf[1] += 1
                if ok:
                    cells_ok += 1; pf[0] += 1
                if t:  # field is present in ground truth
                    present += 1; pf[3] += 1
                    if ok:
                        present_ok += 1; pf[2] += 1
                    else:
                        out["mismatches"].append((fn, name, trow.get(name), prow.get(name) if prow else ""))
    out["all"] = (cells_ok, cells)
    out["present"] = (present_ok, present)
    return out


def pct(a, b):
    return f"{100*a/b:.1f}%" if b else "—"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--providers", default="openai,anthropic")
    args = ap.parse_args()
    provs = [p.strip() for p in args.providers.split(",") if p.strip()]
    results = [score(p) for p in provs]

    lines = ["# Extraction scorecard", ""]
    lines.append("| provider | present-field accuracy | all-cell accuracy |")
    lines.append("|---|---|---|")
    for r in results:
        lines.append(f"| {r['provider']} | {pct(*r['present'])} ({r['present'][0]}/{r['present'][1]}) "
                     f"| {pct(*r['all'])} ({r['all'][0]}/{r['all'][1]}) |")

    all_fields = sorted({f for r in results for f in r["per_field"]})
    lines.append("\n## Per-field accuracy (present fields only)\n")
    lines.append("| field | " + " | ".join(r["provider"] for r in results) + " |")
    lines.append("|" + "---|" * (len(results) + 1))
    for f in all_fields:
        cellv = []
        for r in results:
            ok, tot = r["per_field"].get(f, [0, 0, 0, 0])[2:]
            cellv.append(pct(ok, tot))
        lines.append(f"| {f} | " + " | ".join(cellv) + " |")

    for r in results:
        lines.append(f"\n## {r['provider']} — mismatches on present fields ({len(r['mismatches'])})\n")
        lines.append("| document | field | label (truth) | extracted |")
        lines.append("|---|---|---|---|")
        for fn, fld, t, p in r["mismatches"][:60]:
            lines.append(f"| {fn[:34]} | {fld} | {str(t)[:30]} | {str(p)[:30]} |")

    (BASE / "scorecard.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    print("\n".join(lines[:4 + len(results)]))
    print(f"\nFull scorecard -> {BASE/'scorecard.md'}")


if __name__ == "__main__":
    main()
