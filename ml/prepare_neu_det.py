"""Convert NEU-DET (Pascal VOC XML) into YOLO format.

By default the dataset's own train/validation split is kept (240/60 images per class in the
Kaggle release), so results are comparable with published NEU-DET numbers. Pass --resplit to
build a new split instead, stratified by class.

Usage:
    python prepare_neu_det.py --src /path/to/NEU-DET --out data/neu-det
    python prepare_neu_det.py --src /path/to/NEU-DET --out data/neu-det --resplit --val-ratio 0.2
"""
import argparse
import collections
import random
import shutil
import xml.etree.ElementTree as ET
from pathlib import Path

CLASSES = ["crazing", "inclusion", "patches", "pitted_surface", "rolled-in_scale", "scratches"]
IMG_EXTS = {".jpg", ".jpeg", ".png", ".bmp"}
VAL_DIR_NAMES = {"val", "valid", "validation", "test"}


def xml_to_yolo(xml_path: Path, skipped: collections.Counter) -> list[str]:
    root = ET.parse(xml_path).getroot()
    size = root.find("size")
    w, h = float(size.find("width").text), float(size.find("height").text)
    lines = []
    for obj in root.iter("object"):
        name = obj.find("name").text.strip().lower().replace(" ", "_")
        if name not in CLASSES:
            skipped[name] += 1
            continue
        box = obj.find("bndbox")
        x1, y1, x2, y2 = (float(box.find(k).text) for k in ("xmin", "ymin", "xmax", "ymax"))
        x1, y1, x2, y2 = max(0, x1), max(0, y1), min(w, x2), min(h, y2)
        if x2 <= x1 or y2 <= y1:
            skipped["<degenerate box>"] += 1
            continue
        cx, cy = (x1 + x2) / 2 / w, (y1 + y2) / 2 / h
        bw, bh = (x2 - x1) / w, (y2 - y1) / h
        lines.append(f"{CLASSES.index(name)} {cx:.6f} {cy:.6f} {bw:.6f} {bh:.6f}")
    return lines


def image_class(img: Path) -> str:
    """Class from the file name (e.g. 'rolled-in_scale_12.jpg') or the parent folder."""
    for c in sorted(CLASSES, key=len, reverse=True):
        if img.stem.lower().startswith(c) or img.parent.name.lower() == c:
            return c
    return "unknown"


def original_split(img: Path) -> str | None:
    parts = {p.lower() for p in img.parts}
    if parts & VAL_DIR_NAMES:
        return "val"
    if "train" in parts:
        return "train"
    return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", required=True, help="NEU-DET root folder (contains images + XML annotations)")
    ap.add_argument("--out", default="data/neu-det")
    ap.add_argument("--resplit", action="store_true", help="ignore the dataset's split; make a stratified one")
    ap.add_argument("--val-ratio", type=float, default=0.2, help="only used with --resplit")
    ap.add_argument("--seed", type=int, default=42)
    args = ap.parse_args()

    src, out = Path(args.src), Path(args.out).resolve()
    images = {p.stem: p for p in src.rglob("*") if p.suffix.lower() in IMG_EXTS}
    # Pair by file stem, not folder: some releases have an XML in the wrong split folder.
    pairs = [(images[x.stem], x) for x in src.rglob("*.xml") if x.stem in images]
    if not pairs:
        raise SystemExit("No image/XML pairs found. Check --src.")
    missing = len(images) - len(pairs)
    if missing:
        print(f"warning: {missing} images have no XML and were skipped")

    splits = {"train": [], "val": []}
    if not args.resplit and all(original_split(img) for img, _ in pairs):
        mode = "original"
        for img, xml_path in pairs:
            splits[original_split(img)].append((img, xml_path))
    else:
        mode = f"stratified {1 - args.val_ratio:.0%}/{args.val_ratio:.0%} (seed {args.seed})"
        by_class = collections.defaultdict(list)
        for pair in sorted(pairs, key=lambda p: p[0].name):
            by_class[image_class(pair[0])].append(pair)
        rng = random.Random(args.seed)
        for items in by_class.values():
            rng.shuffle(items)
            n_val = round(len(items) * args.val_ratio)
            splits["val"] += items[:n_val]
            splits["train"] += items[n_val:]

    if out.exists():
        for sub in ("images", "labels"):
            shutil.rmtree(out / sub, ignore_errors=True)  # avoid stale files from a previous split

    skipped = collections.Counter()
    report = {s: {"images": collections.Counter(), "boxes": collections.Counter()} for s in splits}
    for split, items in splits.items():
        (out / "images" / split).mkdir(parents=True, exist_ok=True)
        (out / "labels" / split).mkdir(parents=True, exist_ok=True)
        for img, xml_path in items:
            lines = xml_to_yolo(xml_path, skipped)
            shutil.copy(img, out / "images" / split / img.name)
            (out / "labels" / split / f"{img.stem}.txt").write_text("\n".join(lines))
            report[split]["images"][image_class(img)] += 1
            for ln in lines:
                report[split]["boxes"][CLASSES[int(ln.split()[0])]] += 1

    names = "\n".join(f"  {i}: {c}" for i, c in enumerate(CLASSES))
    (out / "data.yaml").write_text(
        f"path: {out.as_posix()}\ntrain: images/train\nval: images/val\nnames:\n{names}\n"
    )

    print(f"split: {mode}")
    print(f"{'class':<17}{'train img':>10}{'val img':>9}{'train box':>11}{'val box':>9}")
    for c in CLASSES:
        r = report
        print(f"{c:<17}{r['train']['images'][c]:>10}{r['val']['images'][c]:>9}"
              f"{r['train']['boxes'][c]:>11}{r['val']['boxes'][c]:>9}")
    if skipped:
        print(f"skipped objects: {dict(skipped)}")
    print(f"Done: {len(splits['train'])} train / {len(splits['val'])} val -> {out}")


if __name__ == "__main__":
    main()
