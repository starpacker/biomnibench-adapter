#!/usr/bin/env python3
"""
BioMniBench DA — Automatic data hydrator.

This script populates each task's ``envs/data/`` directory with the raw
biomedical files referenced by ``data_files.tsv``. It supports three sources,
in order of convenience:

  1. ``--hydrate-from-hf``  Download from the upstream HuggingFace dataset
                            ``phylobio/BiomniBench-DA`` (recommended).
                            Requires ``pip install huggingface_hub``.
  2. ``--hydrate --upstream PATH``  Copy from an existing local mirror.
  3. ``(no flag)``          Report-only: scan and print what is missing.

Typical end-to-end usage after ``git clone``::

    pip install -r requirements.txt
    python download_data.py --hydrate-from-hf
    bun src/cli.ts run --task da-1-3        # or your harness of choice

By default the script writes into ``tasks/<task_id>/envs/data/`` *and* mirrors
the same files into ``tasks/<task_id>/data/`` and ``tasks/<task_id>/visible_data/``
(using hardlinks where possible) so every layout BioMniBench's runners expect
is satisfied.
"""
from __future__ import annotations

import argparse
import os
import shutil
import sys
from pathlib import Path


UPSTREAM_HF_REPO = "phylobio/BiomniBench-DA"
HF_FILE_TEMPLATE = "{task_id}/environment/data/{rel}"  # path inside the HF repo


# --------------------------------------------------------------------------- args


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    p.add_argument(
        "--dataset-root",
        type=Path,
        default=Path(__file__).resolve().parent,
        help="Root of this dataset checkout (default: directory of this script).",
    )
    p.add_argument(
        "--tasks",
        nargs="*",
        default=None,
        help="Restrict to specific task ids (default: all tasks).",
    )
    # Source 1: HuggingFace
    p.add_argument(
        "--hydrate-from-hf",
        action="store_true",
        help=f"Download missing files from the upstream HF dataset "
             f"({UPSTREAM_HF_REPO}).",
    )
    p.add_argument(
        "--hf-repo",
        default=UPSTREAM_HF_REPO,
        help="Override upstream HF dataset id (default: %(default)s).",
    )
    p.add_argument(
        "--hf-endpoint",
        default=os.environ.get("HF_ENDPOINT") or "https://huggingface.co",
        help="HF hub endpoint. Set to https://hf-mirror.com if huggingface.co "
             "is blocked (default: %(default)s, or $HF_ENDPOINT).",
    )
    p.add_argument(
        "--hf-token",
        default=os.environ.get("HF_TOKEN") or os.environ.get("HUGGING_FACE_HUB_TOKEN"),
        help="HuggingFace access token (default: $HF_TOKEN). Required because "
             "the upstream dataset is gated.",
    )
    # Source 2: local upstream mirror
    p.add_argument(
        "--upstream",
        type=Path,
        default=None,
        help="Path to a local BioMniBench DA mirror. Files are expected at "
             "<upstream>/<task_id>/environment/data/.",
    )
    p.add_argument(
        "--hydrate",
        action="store_true",
        help="Copy missing files from --upstream into the local checkout.",
    )
    # General options
    p.add_argument(
        "--mirror-layouts",
        action="store_true",
        default=True,
        help="After hydrating envs/data/, also populate data/ and visible_data/ "
             "via hardlinks (default: on).",
    )
    p.add_argument(
        "--no-mirror-layouts",
        action="store_false",
        dest="mirror_layouts",
        help="Skip the data/ + visible_data/ mirror step.",
    )
    return p.parse_args()


# --------------------------------------------------------------------------- helpers


def load_manifest(tsv: Path) -> list[tuple[str, int]]:
    rows: list[tuple[str, int]] = []
    if not tsv.exists():
        return rows
    with tsv.open() as fh:
        for line in fh:
            line = line.rstrip("\n")
            if not line:
                continue
            parts = line.split("\t")
            if len(parts) < 2:
                continue
            try:
                rows.append((parts[0], int(parts[1])))
            except ValueError:
                continue
    return rows


def fmt_size(n: float) -> str:
    units = ("B", "KB", "MB", "GB", "TB")
    for unit in units:
        if n < 1024 or unit == units[-1]:
            return f"{n:.1f} {unit}"
        n /= 1024
    return f"{n:.1f} PB"


def hardlink_or_copy(src: Path, dst: Path) -> None:
    """Create *dst* as a hardlink of *src*; fall back to copy across devices."""
    if dst.exists():
        return
    dst.parent.mkdir(parents=True, exist_ok=True)
    try:
        os.link(src, dst)
    except OSError:
        shutil.copy2(src, dst)


def mirror_layouts(task_dir: Path) -> int:
    """Mirror envs/data/* into data/ and visible_data/. Returns # files mirrored."""
    src = task_dir / "envs" / "data"
    n = 0
    if not src.is_dir():
        return 0
    for mirror in ("data", "visible_data"):
        mdir = task_dir / mirror
        mdir.mkdir(parents=True, exist_ok=True)
        for f in src.rglob("*"):
            if f.is_file():
                rel = f.relative_to(src)
                hardlink_or_copy(f, mdir / rel)
                n += 1
    return n


# --------------------------------------------------------------------------- sources


def hydrate_from_hf(
    task_id: str,
    missing: list[tuple[str, int]],
    target_dir: Path,
    repo: str,
    endpoint: str,
    token: str | None,
) -> int:
    try:
        from huggingface_hub import hf_hub_download
        from huggingface_hub.errors import EntryNotFoundError, GatedRepoError
    except ImportError as e:
        raise SystemExit(
            f"--hydrate-from-hf requires huggingface_hub. "
            f"Install with: pip install huggingface_hub\n  ({e})"
        )

    n = 0
    for rel, _size in missing:
        target = target_dir / rel
        if target.exists():
            continue
        repo_path = HF_FILE_TEMPLATE.format(task_id=task_id, rel=rel)
        try:
            local = hf_hub_download(
                repo_id=repo,
                repo_type="dataset",
                filename=repo_path,
                endpoint=endpoint,
                token=token,
            )
        except GatedRepoError:
            sys.stderr.write(
                f"[{task_id}] gated repo {repo}: visit "
                f"https://huggingface.co/datasets/{repo} and accept the licence, "
                f"then pass --hf-token <YOUR_TOKEN>.\n"
            )
            raise SystemExit(2)
        except EntryNotFoundError:
            sys.stderr.write(f"[{task_id}] not found upstream: {repo_path}\n")
            continue
        except Exception as e:  # noqa: BLE001
            sys.stderr.write(f"[{task_id}] HF download failed for {rel}: {e}\n")
            continue
        target.parent.mkdir(parents=True, exist_ok=True)
        # link from HF cache → target (zero-copy on same FS, else copy)
        try:
            if target.exists():
                target.unlink()
            os.link(local, target)
        except OSError:
            shutil.copy2(local, target)
        n += 1
    return n


def hydrate_from_local(
    task_id: str,
    missing: list[tuple[str, int]],
    target_dir: Path,
    upstream: Path,
) -> int:
    n = 0
    for rel, _size in missing:
        src = upstream / task_id / "environment" / "data" / rel
        if not src.exists():
            sys.stderr.write(f"[{task_id}] missing in upstream: {src}\n")
            continue
        target = target_dir / rel
        target.parent.mkdir(parents=True, exist_ok=True)
        hardlink_or_copy(src, target)
        n += 1
    return n


# --------------------------------------------------------------------------- main


def main() -> int:
    args = parse_args()
    tasks_dir = args.dataset_root / "tasks"
    if not tasks_dir.is_dir():
        print(f"error: {tasks_dir} does not exist (is --dataset-root correct?)", file=sys.stderr)
        return 2

    task_ids = sorted(d.name for d in tasks_dir.iterdir() if d.is_dir())
    if args.tasks:
        wanted = set(args.tasks)
        task_ids = [t for t in task_ids if t in wanted]
        missing_ids = wanted - set(task_ids)
        if missing_ids:
            print(f"warning: requested but not present: {sorted(missing_ids)}", file=sys.stderr)

    total_files = 0
    total_missing = 0
    total_bytes_missing = 0
    hydrated = 0
    mirrored = 0

    for tid in task_ids:
        td = tasks_dir / tid
        tsv = td / "data_files.tsv"
        manifest = load_manifest(tsv)
        if not manifest:
            print(f"[{tid}] no data_files.tsv — skipping")
            continue

        envs_data = td / "envs" / "data"
        envs_data.mkdir(parents=True, exist_ok=True)

        missing: list[tuple[str, int]] = []
        for rel, size in manifest:
            target = envs_data / rel
            total_files += 1
            if target.exists() and (target.stat().st_size == size or size <= 0):
                continue
            missing.append((rel, size))
            total_missing += 1
            total_bytes_missing += size

        if missing:
            if args.hydrate_from_hf:
                got = hydrate_from_hf(
                    tid, missing, envs_data,
                    repo=args.hf_repo,
                    endpoint=args.hf_endpoint,
                    token=args.hf_token,
                )
                hydrated += got
            elif args.hydrate and args.upstream:
                got = hydrate_from_local(tid, missing, envs_data, args.upstream)
                hydrated += got

        # Mirror envs/data → data + visible_data so any runner layout works.
        if args.mirror_layouts:
            mirrored += mirror_layouts(td)

        if missing:
            print(f"[{tid}] missing {len(missing)}/{len(manifest)} files "
                  f"({fmt_size(sum(s for _, s in missing))})")
            for rel, size in missing[:5]:
                print(f"    - {rel}  ({fmt_size(size)})")
            if len(missing) > 5:
                print(f"    … and {len(missing) - 5} more")
        else:
            print(f"[{tid}] OK ({len(manifest)} files)")

    print()
    print(f"Scanned:  {len(task_ids)} tasks, {total_files} files")
    print(f"Missing:  {total_missing} files ({fmt_size(total_bytes_missing)})")
    if args.hydrate_from_hf or args.hydrate:
        print(f"Hydrated: {hydrated} files")
    if args.mirror_layouts:
        print(f"Mirrored: {mirrored} hardlinks/copies into data/+visible_data/")

    if total_missing and not (args.hydrate_from_hf or args.hydrate):
        print()
        print("Re-run with --hydrate-from-hf to download from "
              f"{UPSTREAM_HF_REPO} (recommended),")
        print("or with --upstream <path> --hydrate to copy from a local mirror.")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
