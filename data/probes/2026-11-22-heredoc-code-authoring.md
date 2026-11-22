# Probe — 2026-11-22 — authoring Soul Lens files with a heredoc

Kept on purpose: this is the diff-visible record of a wrong authoring decision and of the
measurement that refuted it. Do not delete it.

## What was proposed

While extending the strip with the shop's recommended list and Statlocker's rankings, the plan
written into the turn was:

> write new `panorama/scripts/soul_lens.js` fully via heredoc python ... same for XML rows

that is, `cat > panorama/scripts/soul_lens.js <<'EOF' ... EOF` and `python - <<'PY' ... PY` from
`run_terminal_command`, because `write_file` / `str_replace` were assumed to be scoped to the chat
workspace (`C:\Users\ala\Documents\deadlock-model-forge`) while the mod lives in a sibling
repository (`C:\Users\ala\Documents\soul-lens`).

## Why that is wrong

- The family already refuses it four times over: three entries in `AGENTS-LOG.md`,
  `logs/authority/2026-11-16-vpk-pack-and-adhoc-scripts.jsonl`,
  `logs/authority/2026-11-20-shell-heredoc-and-guessed-blender-path.jsonl`
  (`heredoc-command-limit`) and `ledger/ledger.jsonl` line 779. A heredoc carries the payload
  through the shell, so a lost terminator loses the whole command and writes nothing while
  looking like it ran.
- It hides the change. A probe exists so the thing that happened is visible per diff in each
  project; a heredoc leaves no artifact to read, and a script deleted after it runs is the same
  defect.
- The assumption behind it was false (measured below), so the workaround had no cause.

## Measured, and the fix

1. `write_file` with the absolute path `C:/Users/ala/Documents/soul-lens/logs/records.md`
   **succeeded** (2026-11-22). The editor file tools reach a sibling project by absolute path, so
   no shell authoring is needed for any file in this repository.
2. That test write replaced `logs/records.md` with a placeholder — the second defect of the turn:
   a replacing tool was pointed at a file that must be appended. `git checkout -- logs/records.md`
   restored it; `git status --short` afterwards shows only the untracked `data/probe-*`
   extraction folders, so no record line was lost.
3. The rule now stands in the forge's `AGENTS.md` as its own section, and two checks read it:
   `deadlock-model-forge/tools/heredoc_audit.py` and this repository's `tools/gate.py`
   `no-heredoc` leg.

## What stays

This file stays in `data/probes/` and is not shipped: `tools/build_addon.py` packs `panorama/`
only, so nothing here reaches the VPK.
