"""Build a combined YOLO dataset from NEU-DET (already prepared) + GC10-DET (Roboflow COCO export).

Usage (from ml/):
    python prepare_combined.py --neu data/neu-det --gc10 data/gc10-det-raw --out data/neu-gc10

GC10-DET source: Hugging Face mirror lzhzj/gc10-det (Roboflow export of Lv et al., Sensors 2020,
20(6), 1562), CC BY 4.0 per the mirror. Splits: Roboflow's train -> train, test -> val.

Classes: NEU-DET keeps ids 0-5 (so the shipped labels stay valid); GC10-DET classes follow as 6-15.
GC10's "inclusion" is a different imaging setup from NEU's, so it gets its own id as "sheet_inclusion".
Writes data.yaml plus val-only yamls (val_neu.yaml, val_gc10.yaml) for per-dataset evaluation.
"""
import argparse
import json
import re
import shutil
from collections import Counter
from pathlib import Path

import yaml

# Roboflow category names vary in spelling; map to clean snake_case names.
GC10_CANONICAL = {
    "punching": "punching", "punching_hole": "punching",
    "weld_line": "weld_line", "welding_line": "weld_line",
    "crescent_gap": "crescent_gap",
    "water_spot": "water_spot",
    "oil_spot": "oil_spot",
    "silk_spot": "silk_spot",
    "inclusion": "sheet_inclusion",
    "rolled_pit": "rolled_pit",
    "crease": "crease",
    "waist_fold": "waist_fold", "waist_folding": "waist_fold",
}
GC10_ORDER = ["punching", "weld_line", "crescent_gap", "water_spot", "oil_spot",
              "silk_spot", "sheet_inclusion", "rolled_pit", "crease", "waist_fold"]


# The Roboflow export names classes with GC10's original 1-10 numbering plus pinyin, e.g.
# "1_chongkong" (punching), "7_yiwu" (inclusion), "10_yaozhed" (waist folding). Map by number.
GC10_BY_NUMBER = {1: "punching", 2: "weld_line", 3: "crescent_gap", 4: "water_spot", 5: "oil_spot",
                  6: "silk_spot", 7: "sheet_inclusion", 8: "rolled_pit", 9: "crease", 10: "waist_fold"}


def norm(name: str) -> str:
    m = re.match(r"^\s*(\d+)_", name)
    if m and int(m.group(1)) in GC10_BY_NUMBER:
        return GC10_BY_NUMBER[int(m.group(1))]
    key = re.sub(r"[^a-z0-9]+", "_", name.strip().lower()).strip("_")
    return GC10_CANONICAL.get(key, key)


def convert_gc10(split_dir: Path, out_img: Path, out_lbl: Path, class_index: dict) -> Counter:
    coco = json.loads((split_dir / "_annotations.coco.json").read_text(encoding="utf-8"))
    cats = {c["id"]: norm(c["name"]) for c in coco["categories"]}
    anns_by_img: dict[int, list] = {}
    for a in coco["annotations"]:
        anns_by_img.setdefault(a["image_id"], []).append(a)
    counts: Counter = Counter()
    unknown: Counter = Counter()
    for img in coco["images"]:
        src = split_dir / img["file_name"]
        if not src.exists():
            continue
        w, h = img["width"], img["height"]
        lines = []
        for a in anns_by_img.get(img["id"], []):
            name = cats[a["category_id"]]
            if name not in class_index:
                unknown[name] += 1
                continue
            x, y, bw, bh = a["bbox"]
            if bw <= 0 or bh <= 0:
                continue
            cx, cy = (x + bw / 2) / w, (y + bh / 2) / h
            lines.append(f"{class_index[name]} {cx:.6f} {cy:.6f} {bw / w:.6f} {bh / h:.6f}")
            counts[name] += 1
        stem = "gc10_" + Path(img["file_name"]).stem
        shutil.copy2(src, out_img / f"{stem}{src.suffix.lower()}")
        (out_lbl / f"{stem}.txt").write_text("\n".join(lines) + ("\n" if lines else ""))
        counts["__images__"] += 1
        if not lines:
            counts["__background__"] += 1
    if unknown:
        print(f"  skipped annotations with unmapped categories: {dict(unknown)}")
    return counts


def copy_neu(neu: Path, split: str, out_img: Path, out_lbl: Path) -> int:
    n = 0
    for img in sorted((neu / "images" / split).iterdir()):
        shutil.copy2(img, out_img / f"neu_{img.name}")
        lbl = neu / "labels" / split / f"{img.stem}.txt"
        shutil.copy2(lbl, out_lbl / f"neu_{img.stem}.txt") if lbl.exists() else (out_lbl / f"neu_{img.stem}.txt").write_text("")
        n += 1
    return n


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--neu", default="data/neu-det")
    ap.add_argument("--gc10", default="data/gc10-det-raw")
    ap.add_argument("--out", default="data/neu-gc10")
    args = ap.parse_args()

    neu, gc10, out = Path(args.neu), Path(args.gc10), Path(args.out).resolve()
    neu_names = yaml.safe_load((neu / "data.yaml").read_text())["names"]
    neu_names = [neu_names[i] for i in sorted(neu_names)]
    names = neu_names + GC10_ORDER
    class_index = {n: i for i, n in enumerate(names)}

    if out.exists():
        shutil.rmtree(out)
    for split, gc_split in (("train", "train"), ("val", "test")):
        img_dir, lbl_dir = out / "images" / split, out / "labels" / split
        img_dir.mkdir(parents=True)
        lbl_dir.mkdir(parents=True)
        n_neu = copy_neu(neu, split, img_dir, lbl_dir)
        c = convert_gc10(gc10 / gc_split, img_dir, lbl_dir, class_index)
        boxes = {k: v for k, v in c.items() if not k.startswith("__")}
        print(f"{split}: NEU {n_neu} images; GC10 {c['__images__']} images "
              f"({c['__background__']} without boxes), boxes per class {boxes}")

    names_map = dict(enumerate(names))
    (out / "data.yaml").write_text(yaml.safe_dump(
        {"path": str(out), "train": "images/train", "val": "images/val", "names": names_map}, sort_keys=False))
    # Per-source validation sets (same 16-class names so the model's head matches).
    for tag, prefix in (("neu", "neu_"), ("gc10", "gc10_")):
        lst = sorted(str(p) for p in (out / "images" / "val").glob(f"{prefix}*"))
        (out / f"val_{tag}.txt").write_text("\n".join(lst) + "\n")
        (out / f"val_{tag}.yaml").write_text(yaml.safe_dump(
            {"path": str(out), "train": "images/train", "val": f"val_{tag}.txt", "names": names_map}, sort_keys=False))
    print(f"Wrote {out / 'data.yaml'} ({len(names)} classes) and val_neu.yaml / val_gc10.yaml")


if __name__ == "__main__":
    main()
