#!/usr/bin/env python3
"""Repair duplicate tool-call ids in DSH session archives.

Why this exists
---------------
A provider can hand out one tool-call id for two different calls (the Antigravity
backend does: two unrelated calls hours apart came back as `call_593681`). The
client stores every call it has seen — as `<call_id>|<item_id>` — and replays
its whole history on the next turn, so once a conversation holds the same id
twice, a strict Responses upstream refuses the replay with

    400 Duplicate 'call_id': call_593681

and the session cannot continue on that model. The provider-side fix stops NEW
duplicates; it cannot rewrite history that is already stored. This tool does.

What it changes
---------------
Per archive, per tool call, the id lives in the records that describe the call
and its result — assistant message content, the streamed chunks, the tool/call
record, and the tool/result pairing. `assistant/attempt` and
`deliverables/presented` reference it too. A call whose id the conversation has
already spent is renamed to a fresh `call_repaired_<millis>_<n>`, and every
record belonging to that call instance is rewritten with it, so pairing stays
intact. Text, arguments, and tool output are never touched — only values under
id-bearing keys (`id`, `callId`, `toolCallId`, ...) whose call part matches.

Deliberately NOT touched: tool calls embedded in user/agent messages (a
subagent's closing message quoted into the transcript) — those describe another
context and renaming them would be wrong.

Safety
------
* Dry run by default; `--apply` writes.
* Refuses to write while a `dsh` process runs (that process owns the session in
  memory and would overwrite the file); `--force` overrides.
* Every archive is backed up to `<name>.bak-<utc>` before it is replaced, and
  the replacement is written to a temp file and renamed into place.
* After writing, the archive is re-read and verified: record count unchanged,
  no id spent twice, and no difference from the original outside the planned
  id renames. A failed verification restores the backup.

Usage
-----
    # what would be repaired, everything under ~/.dsh/sessions
    python3 tools/dsh_session_callid_repair.py --all

    # one session, by id or directory
    python3 tools/dsh_session_callid_repair.py --session 6cfa1f08
    python3 tools/dsh_session_callid_repair.py ~/.dsh/sessions/--home-ai_bot-CodeSpace-ai-proxy--/session-6cfa1f08-...

    # write the repair (stop DSH first)
    python3 tools/dsh_session_callid_repair.py --session 6cfa1f08 --apply

Exit codes: 0 nothing to do / repaired; 1 error; 2 repairs needed (dry run) or a
duplicate this tool refuses to repair automatically.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
from dataclasses import dataclass, field
from pathlib import Path

DEFAULT_ROOT = Path("~/.dsh/sessions").expanduser()

# Values under these keys are ids. Anything else is content and stays verbatim.
ID_KEYS = {
    "id",
    "callId",
    "call_id",
    "toolCallId",
    "tool_call_id",
    "toolUseId",
    "tool_use_id",
}

# A record that describes a call, its streamed form, its result, or references
# it. Inside an assistant step, CALL_ITEM_TYPES tells the model-issued calls
# apart from the containers around them. user/message and agent/* are excluded
# on purpose: a tool call quoted inside a message belongs to another context.
REPAIRABLE_TYPES = {
    "assistant/message",
    "assistant/chunk",
    "assistant/attempt",
    "tool-call-chunks",
    "tool/call",
    "tool/result",
    "deliverables/presented",
}

CALL_ITEM_TYPES = {"tool-call", "tool_use", "function_call"}

ARCHIVE_GLOB = "session*.jsonl.zstd"


def call_part(value: str) -> str:
    """The `call_id` half of the client's `<call_id>|<item_id>` storage form."""
    return value.split("|", 1)[0]


def rewrite_value(value: str, new_part: str) -> str:
    """Keep the storage shape: a piped id stays piped, a bare one stays bare."""
    return f"{new_part}|{new_part}" if "|" in value else new_part


def iter_id_values(node, out):
    """Collect (container, key, value) for every id-bearing string in a record."""
    if isinstance(node, dict):
        for key, value in node.items():
            if isinstance(value, str) and key in ID_KEYS and value.strip():
                out.append((node, key, value))
            else:
                iter_id_values(value, out)
    elif isinstance(node, list):
        for item in node:
            iter_id_values(item, out)
    return out


@dataclass
class Instance:
    """One tool call: its (turn, step, call part) and the records carrying it."""

    turn: object
    step: object
    part: str
    records: list = field(default_factory=list)
    defining: int = 0
    executions: int = 0
    new_part: str | None = None

    @property
    def key(self):
        return (self.turn, self.step, self.part)

    @property
    def owns_a_call(self):
        """True when this group IS a call, not just a reference to one.

        A reference — deliverables/presented, or a stream snapshot carried on a
        record without a step — must never claim an id nor be renamed on its
        own: if it were, it would point at an id no call has.
        """
        return self.defining > 0 or self.executions > 0


def count_call_items(rec, part):
    """How many model-issued call items in this record carry `part`.

    Two in one (turn, step) means two real calls share an id inside one step:
    their results cannot be told apart, so the repair refuses to guess.
    """
    if rec.get("type") != "assistant/message":
        return 0
    message = (rec.get("data") or {}).get("message")
    if not isinstance(message, dict):
        return 0
    count = 0
    for item in message.get("content") or []:
        if not isinstance(item, dict) or item.get("type") not in CALL_ITEM_TYPES:
            continue
        value = item.get("id")
        if isinstance(value, str) and call_part(value) == part:
            count += 1
    return count


def analyze(records):
    """Return instances in first-appearance order, plus per-record id values."""
    values = [iter_id_values(rec, []) for rec in records]
    instances: dict[tuple, Instance] = {}
    order: list[tuple] = []
    for index, rec in enumerate(records):
        kind = rec.get("type")
        if kind not in REPAIRABLE_TYPES:
            continue
        data = rec.get("data")
        turn = data.get("turn") if isinstance(data, dict) else None
        step = data.get("step") if isinstance(data, dict) else None
        # One record carries a call's id in several places (the item, the
        # streamed chunks, the block). The call-item count belongs to the
        # record, so it is taken once per part, not once per id occurrence.
        counted: dict[str, int] = {}
        for _, _, value in values[index]:
            part = call_part(value)
            key = (turn, step, part)
            inst = instances.get(key)
            if inst is None:
                inst = Instance(turn=turn, step=step, part=part)
                instances[key] = inst
                order.append(key)
            if index not in inst.records:
                inst.records.append(index)
            if part not in counted:
                counted[part] = count_call_items(rec, part)
                inst.defining += counted[part]
                if kind == "tool/call":
                    inst.executions += 1
    return [instances[key] for key in order], values


def fresh_part(turn, step, part, taken: set):
    """A stable replacement id for one call.

    Derived from the call's own (turn, step, part) instead of a counter so the
    v3 and v4 snapshots of one session — and two runs of this tool — agree on
    what a repaired call is called. A collision with an id the session already
    holds falls back to a suffix; `verify` refuses the write either way if any
    id ends up spent twice.
    """
    digest = hashlib.sha256(f"{turn}|{step}|{part}".encode("utf-8")).hexdigest()[:12]
    candidate = f"call_repaired_{digest}"
    suffix = 0
    while candidate in taken:
        suffix += 1
        candidate = f"call_repaired_{digest}_{suffix}"
    return candidate


def plan_renames(instances):
    """Later instances sharing a spent part get a fresh id.

    Returns (renames, unrepairable): `renames` maps an instance key to its new
    call part; `unrepairable` collects keys whose own step already holds the
    part twice (two real calls one step cannot be told apart, so this tool will
    not guess).
    """
    spent: dict[str, tuple] = {}
    renames: dict[tuple, str] = {}
    unrepairable: list[Instance] = []
    taken: set[str] = {inst.part for inst in instances}
    for inst in instances:
        if not inst.owns_a_call:
            # A reference follows whatever its call does; it never claims and
            # never renames on its own.
            continue
        if inst.defining > 1:
            # Two real calls share this id inside one step. Their results cannot
            # be told apart by id, so this group is left exactly as it is — and
            # the part counts as spent, so anything after it still gets a fresh
            # id instead of inheriting the ambiguity.
            unrepairable.append(inst)
            spent.setdefault(inst.part, inst.key)
            continue
        if inst.part in spent:
            inst.new_part = fresh_part(inst.turn, inst.step, inst.part, taken)
            taken.add(inst.new_part)
            renames[inst.key] = inst.new_part
        else:
            spent[inst.part] = inst.key
    return renames, unrepairable


def apply_renames(records, values, instances, renames):
    """Rewrite every record that carries a renamed instance's id.

    A record is matched by its own (turn, step); a reference record (one with a
    turn but no step, e.g. deliverables/presented) is matched when the turn
    holds exactly one renamed instance with that part — ambiguous turns are left
    alone and reported.
    """
    by_key = {inst.key: inst for inst in instances}
    renamed_parts = {(inst.turn, inst.part): inst.new_part for inst in instances if inst.new_part}
    ambiguous = set()
    turn_count: dict[tuple, int] = {}
    for inst in instances:
        if inst.new_part:
            turn_count[(inst.turn, inst.part)] = turn_count.get((inst.turn, inst.part), 0) + 1
    for key, count in turn_count.items():
        if count > 1:
            ambiguous.add(key)

    changed = 0
    skipped = []
    for index, rec in enumerate(records):
        kind = rec.get("type")
        if kind not in REPAIRABLE_TYPES:
            continue
        data = rec.get("data")
        turn = data.get("turn") if isinstance(data, dict) else None
        step = data.get("step") if isinstance(data, dict) else None
        for container, key, value in values[index]:
            part = call_part(value)
            inst = by_key.get((turn, step, part))
            new_part = inst.new_part if inst else None
            if new_part is None and step is None:
                candidate = (turn, part)
                if candidate in ambiguous:
                    skipped.append((kind, value))
                    continue
                new_part = renamed_parts.get(candidate)
            if new_part is None or new_part == part:
                continue
            container[key] = rewrite_value(value, new_part)
            changed += 1
    return changed, skipped


def verify(old_records, new_records, renames):
    """Prove the rewrite changed nothing but the planned ids."""
    if len(old_records) != len(new_records):
        return f"record count changed: {len(old_records)} -> {len(new_records)}"
    expected = {}
    for inst_key, new_part in renames.items():
        expected.setdefault(inst_key[2], set()).add(new_part)
    for index, (before, after) in enumerate(zip(old_records, new_records)):
        problems = []

        def walk(a, b, path=""):
            if type(a) is not type(b):
                problems.append(f"{path}: type {type(a).__name__} -> {type(b).__name__}")
                return
            if isinstance(a, dict):
                if set(a) != set(b):
                    problems.append(f"{path}: keys changed")
                    return
                for key in a:
                    if key in ID_KEYS and isinstance(a[key], str) and isinstance(b[key], str):
                        if a[key] != b[key]:
                            part, new_part = call_part(a[key]), call_part(b[key])
                            if new_part not in expected.get(part, set()):
                                problems.append(f"{path}.{key}: {a[key]} -> {b[key]} not planned")
                        continue
                    walk(a[key], b[key], f"{path}.{key}")
            elif isinstance(a, list):
                if len(a) != len(b):
                    problems.append(f"{path}: list length changed")
                    return
                for i, (x, y) in enumerate(zip(a, b)):
                    walk(x, y, f"{path}[{i}]")
            elif a != b and not (isinstance(a, str) and isinstance(b, str) and path.endswith(tuple(ID_KEYS))):
                problems.append(f"{path}: {a!r} -> {b!r}")

        walk(before, after, f"record {index}")
        if problems:
            return "; ".join(problems[:3])
    # No id may be spent twice once the plan is applied.
    instances, _ = analyze(new_records)
    seen: dict[str, tuple] = {}
    for inst in instances:
        if inst.part in seen:
            return f"{inst.part} is still spent twice ({seen[inst.part]} and {inst.key})"
        seen[inst.part] = inst.key
    return None


def read_archive(path: Path):
    """Return (lines, records, unparsed) with records aligned to line indexes.

    Lines are handled as BYTES: an archive can carry a truncated tail or binary
    residue from an earlier partial write, and a decode/re-encode round trip
    would silently destroy it. Only lines this tool parses are ever re-encoded.
    """
    raw = subprocess.run(["zstdcat", str(path)], capture_output=True, check=True).stdout
    lines = raw.split(b"\n")
    if lines and lines[-1] == b"":
        lines.pop()
    records, unparsed = [], []
    for i, line in enumerate(lines):
        if not line.strip():
            unparsed.append(i)
            continue
        try:
            records.append((i, json.loads(line.decode("utf-8"))))
        except (json.JSONDecodeError, UnicodeDecodeError):
            unparsed.append(i)
    return lines, records, unparsed


def write_archive(path: Path, lines: list[bytes], backup_suffix: str):
    backup = path.with_name(path.name + backup_suffix)
    shutil.copy2(path, backup)
    payload = b"\n".join(lines) + b"\n"
    # Compress to stdout: zstd refuses to overwrite an existing file, and the
    # temp file has to exist for the atomic rename below.
    compressed = subprocess.run(
        ["zstd", "-q", "-3", "-c", "-"], input=payload, capture_output=True, check=True
    ).stdout
    fd, tmp_name = tempfile.mkstemp(dir=str(path.parent), prefix=path.name + ".tmp-")
    tmp = Path(tmp_name)
    try:
        with os.fdopen(fd, "wb") as handle:
            handle.write(compressed)
        os.chmod(tmp, path.stat().st_mode & 0o7777)
        os.replace(tmp, path)
    finally:
        if tmp.exists():
            tmp.unlink()
    return backup


def repair_archive(path: Path, apply: bool, report: dict):
    lines, records, unparsed = read_archive(path)
    payloads = [rec for _, rec in records]
    instances, values = analyze(payloads)
    renames, unrepairable = plan_renames(instances)
    entry = {
        "archive": str(path),
        "records": len(payloads),
        "duplicates": sorted({inst.part for inst in instances if inst.new_part}),
        "renamed": len(renames),
        "unparsed_lines": len(unparsed),
        "unrepairable": [
            {"part": inst.part, "turn": inst.turn, "step": inst.step, "calls": inst.defining}
            for inst in unrepairable
        ],
    }
    if not renames and not unrepairable:
        entry["status"] = "clean"
        report["archives"].append(entry)
        return "clean"
    if unparsed:
        entry["status"] = "skipped-unparsed-lines"
        entry["note"] = "refusing to rewrite an archive with lines this tool cannot parse"
        report["archives"].append(entry)
        return "error"
    if not apply:
        entry["status"] = "needs-repair"
        report["archives"].append(entry)
        return "needs-repair"

    changed, skipped = apply_renames(payloads, values, instances, renames)
    entry["id_values_rewritten"] = changed
    if skipped:
        entry["skipped_references"] = skipped[:5]
    new_lines = list(lines)
    for (line_index, _), rec in zip(records, payloads):
        new_lines[line_index] = json.dumps(rec, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    new_records = [json.loads(new_lines[i].decode("utf-8")) for i, _ in records]
    problem = verify(payloads, new_records, renames)
    if problem:
        entry["status"] = "verify-failed"
        entry["error"] = problem
        report["archives"].append(entry)
        return "error"
    backup = write_archive(path, new_lines, report["backup_suffix"])
    entry["status"] = "repaired"
    entry["backup"] = str(backup)
    report["archives"].append(entry)
    return "repaired"


def find_archives(target: Path):
    if target.is_file():
        return [target]
    if target.is_dir():
        return sorted(target.glob(ARCHIVE_GLOB))
    return []


def session_dirs(root: Path, session_id: str | None):
    """Session directories under the root.

    The layout is `sessions/<workspace>/<session>/`, but a session directory
    can also sit directly under the root, so both depths are offered.
    """
    if not root.is_dir():
        return []
    candidates = []
    for entry in sorted(root.iterdir()):
        if not entry.is_dir():
            continue
        candidates.append(entry)
        candidates.extend(child for child in sorted(entry.iterdir()) if child.is_dir())
    dirs = [p for p in candidates if any(p.glob(ARCHIVE_GLOB))]
    if session_id:
        dirs = [p for p in dirs if session_id in p.name]
    return dirs


def dsh_running():
    try:
        out = subprocess.run(["pgrep", "-af", "dsh"], capture_output=True).stdout.decode()
    except FileNotFoundError:
        return None
    for line in out.splitlines():
        if re.search(r"dsh(\.js)?\s|/dsh\s|bin/dsh", line) and "pgrep" not in line:
            return line.strip()
    return None


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("targets", nargs="*", type=Path,
                        help="session directories or session*.jsonl.zstd archives")
    parser.add_argument("--session", help="session id (or unique prefix) under --root")
    parser.add_argument("--all", action="store_true", help="every session under --root")
    parser.add_argument("--root", type=Path, default=DEFAULT_ROOT,
                        help=f"sessions root (default: {DEFAULT_ROOT})")
    parser.add_argument("--apply", action="store_true", help="write the repair (default: dry run)")
    parser.add_argument("--force", action="store_true", help="apply even while a dsh process runs")
    parser.add_argument("--json", action="store_true", help="machine-readable report")
    args = parser.parse_args(argv)

    targets: list[Path] = list(args.targets)
    if args.all or args.session:
        for directory in session_dirs(args.root, args.session):
            targets.extend(find_archives(directory))
    archives = []
    for target in targets:
        archives.extend(find_archives(target))
    seen = set()
    archives = [a for a in archives if not (str(a) in seen or seen.add(str(a)))]
    if not archives:
        print("no session archives matched", file=sys.stderr)
        return 1

    if args.apply:
        running = dsh_running()
        if running and not args.force:
            print(
                "refusing to write while dsh runs (it holds the session in memory and "
                "would overwrite the file):\n  " + running + "\n"
                "stop dsh, or pass --force if you are certain",
                file=sys.stderr,
            )
            return 1

    report = {
        "applied": bool(args.apply),
        "backup_suffix": ".bak-" + time.strftime("%Y%m%dT%H%M%SZ", time.gmtime()),
        "archives": [],
    }
    outcomes = []
    for path in archives:
        try:
            outcomes.append(repair_archive(path, args.apply, report))
        except Exception as error:  # one bad archive must not end the run
            report["archives"].append({
                "archive": str(path),
                "status": "error",
                "error": f"{type(error).__name__}: {error}",
            })
            outcomes.append("error")

    if args.json:
        print(json.dumps(report, ensure_ascii=False, indent=2))
    else:
        for entry in report["archives"]:
            status = entry["status"]
            if status == "clean":
                continue
            print(f"{entry['archive']}")
            if status == "error":
                print(f"    error: {entry.get('error')}")
                continue
            print(f"    records={entry['records']} renamed-calls={entry['renamed']} "
                  f"duplicates={entry['duplicates']}")
            for item in entry["unrepairable"]:
                print(f"    ! cannot repair: {item['part']} is held by {item['calls']} calls "
                      f"in turn {item['turn']} step {item['step']}")
            if entry.get("id_values_rewritten") is not None:
                print(f"    id values rewritten: {entry['id_values_rewritten']}")
            if entry.get("backup"):
                print(f"    backup: {entry['backup']}")
            if entry.get("error"):
                print(f"    error: {entry['error']}")
            if entry.get("note"):
                print(f"    note: {entry['note']}")
        repaired = sum(1 for e in report["archives"] if e["status"] == "repaired")
        needs = sum(1 for e in report["archives"] if e["status"] == "needs-repair")
        clean = sum(1 for e in report["archives"] if e["status"] == "clean")
        failed = sum(1 for e in report["archives"] if e["status"] in {"error", "verify-failed", "skipped-unparsed-lines"})
        unrepairable = sum(len(e.get("unrepairable", [])) for e in report["archives"])
        print(f"\n{len(archives)} archive(s): {clean} clean, {needs} need repair, "
              f"{repaired} repaired, {failed} refused/failed, "
              f"{unrepairable} call(s) not automatically repairable")
        if not args.apply and needs:
            print("re-run with --apply (stop dsh first) to write the repair")

    if any(e["status"] in {"verify-failed", "error"} for e in report["archives"]):
        return 1
    if any(e.get("unrepairable") for e in report["archives"]):
        return 2
    if any(e["status"] in {"skipped-unparsed-lines", "needs-repair"} for e in report["archives"]):
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
