import json
import tempfile
import unittest
from pathlib import Path

from tools import terms_archive


def rows():
    return {
        "extra health": {"name": "Extra Health", "wp": 0.0, "fire": 0.0, "dps": 0.0,
                         "cost": 800, "tier": 1, "slot": "vitality", "upgrades_to": [],
                         "souls_per_wp": None, "avg_buy_s": 600.0, "item_id": 1},
        "glass cannon": {"name": "Glass Cannon", "wp": 85.0, "fire": 0.0, "dps": 85.0,
                         "cost": 6400, "tier": 4, "slot": "weapon", "upgrades_to": [],
                         "souls_per_wp": 75.3, "avg_buy_s": 1800.0, "item_id": 2},
    }


class TermsArchiveTests(unittest.TestCase):
    def test_snapshot_binds_its_contents_with_a_digest(self):
        with tempfile.TemporaryDirectory() as temporary:
            archive = Path(temporary) / "builds"
            snapshot = terms_archive.write_snapshot("6864", "Nov 18 2026", rows(), archive=archive)
            covered = {key: snapshot[key] for key in ("schema", "build", "version_date", "items")}
            self.assertEqual(snapshot["digest"], terms_archive.digest(covered))
            written = json.loads((archive / "6864.json").read_text())
            self.assertEqual(written["build"], "6864")
            self.assertEqual(set(written["items"]), {"extra health", "glass cannon"})
            self.assertEqual(written["items"]["glass cannon"]["wp"], 85.0)
            # Behavioural measurements are not build contents and do not ship here.
            self.assertNotIn("avg_buy_s", written["items"]["glass cannon"])
            self.assertNotIn("souls_per_wp", written["items"]["glass cannon"])

    def test_a_second_identical_bake_is_a_no_op(self):
        with tempfile.TemporaryDirectory() as temporary:
            archive = Path(temporary) / "builds"
            first = terms_archive.write_snapshot("6864", "Nov 18 2026", rows(), archive=archive,
                                                 captured_at="2026-11-22T00:00:00+00:00")
            again = terms_archive.write_snapshot("6864", "Nov 18 2026", rows(), archive=archive,
                                                 captured_at="2026-11-23T00:00:00+00:00")
            self.assertEqual(first["digest"], again["digest"])
            self.assertEqual(first["captured_at"], again["captured_at"])

    def test_changed_terms_for_one_build_are_refused_and_kept(self):
        with tempfile.TemporaryDirectory() as temporary:
            archive = Path(temporary) / "builds"
            terms_archive.write_snapshot("6864", "Nov 18 2026", rows(), archive=archive)
            changed = rows()
            changed["glass cannon"]["wp"] = 90.0
            with self.assertRaises(terms_archive.TermsConflict):
                terms_archive.write_snapshot("6864", "Nov 18 2026", changed, archive=archive)
            kept = terms_archive.load(archive)["6864"]["items"]["glass cannon"]["wp"]
            self.assertEqual(kept, 85.0, "the first snapshot must survive the refusal")

    def test_the_index_lists_every_build(self):
        with tempfile.TemporaryDirectory() as temporary:
            archive = Path(temporary) / "builds"
            terms_archive.write_snapshot("6863", "Nov 9 2026", rows(), archive=archive)
            terms_archive.write_snapshot("6864", "Nov 18 2026", rows(), archive=archive)
            index = json.loads((archive / "index.json").read_text())
            self.assertEqual([row["build"] for row in index["builds"]], ["6863", "6864"])
            self.assertTrue(all(row["digest"].startswith("blake2b:") for row in index["builds"]))

    def test_a_missing_build_is_reported_not_defaulted(self):
        with tempfile.TemporaryDirectory() as temporary:
            archive = Path(temporary) / "builds"
            terms_archive.write_snapshot("6864", "Nov 18 2026", rows(), archive=archive)
            self.assertEqual(terms_archive.status("6864", archive)["state"], "read")
            missing = terms_archive.status("9999", archive)
            self.assertEqual(missing["state"], "missing")
            self.assertIn("withhold", missing["reason"])

    def test_a_bake_without_a_build_number_is_refused(self):
        with tempfile.TemporaryDirectory() as temporary:
            with self.assertRaises(terms_archive.TermsConflict):
                terms_archive.write_snapshot("unknown", "", rows(), archive=Path(temporary))


if __name__ == "__main__":
    unittest.main()
