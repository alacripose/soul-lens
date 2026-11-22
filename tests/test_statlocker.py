import json
import pathlib
import sys
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from tools import statlocker  # noqa: E402

# A response captured from `https://statlocker.gg/api/info/eternus-item-analysis/13?minRank=-2`
# on 2026-11-22 (Haze, 9,975 analyzed matches). It is the site's own per-hero endpoint, the one
# its hero page calls, and it needs no key. The fixture is stored whole so the parse path is
# exercised against the real shape rather than a hand-written one.
FIXTURE = ROOT / "tests" / "fixtures" / "statlocker-eternus-haze.json"


def catalogue(payload, drop=()):
    return {
        statlocker.normalize(row["name"]): statlocker.normalize(row["name"])
        for row in payload["items"]
        if isinstance(row, dict) and row.get("name") and row["name"] not in drop
    }


class ParseAnalysis(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.payload = json.loads(FIXTURE.read_text(encoding="utf-8"))

    def test_a_hero_ranking_is_read_with_its_own_total(self):
        rows, source = statlocker.parse_analysis(self.payload, catalogue(self.payload), hero_id=13)
        self.assertEqual(source["state"], "read")
        self.assertEqual(source["hero"], "Haze")
        self.assertEqual(source["items"], 168)
        self.assertEqual(source["rows"], len(rows))
        self.assertEqual(rows["swift striker"]["of"], 168)

    def test_the_first_row_is_the_most_bought_item(self):
        rows, _ = statlocker.parse_analysis(self.payload, catalogue(self.payload), hero_id=13)
        top = self.payload["items"][0]
        row = rows[statlocker.normalize(top["name"])]
        self.assertEqual(row["rank"], 1)
        self.assertAlmostEqual(row["pick"], round(top["purchaseRate"] * 100, 2), places=2)
        self.assertEqual(row["matches"], top["purchaseCount"])
        self.assertIsNotNone(row["buy_s"])

    def test_rank_order_follows_purchase_rate(self):
        rows, _ = statlocker.parse_analysis(self.payload, catalogue(self.payload), hero_id=13)
        ordered = sorted(rows.values(), key=lambda row: row["rank"])
        self.assertEqual([row["rank"] for row in ordered], list(range(1, len(ordered) + 1)))
        for earlier, later in zip(ordered, ordered[1:]):
            self.assertGreaterEqual(earlier["pick"], later["pick"])

    def test_an_item_outside_the_catalogue_is_counted_not_invented(self):
        keys = catalogue(self.payload, drop=("Swift Striker",))
        rows, source = statlocker.parse_analysis(self.payload, keys, hero_id=13)
        self.assertNotIn("swift striker", rows)
        self.assertGreaterEqual(source["skipped"], 1)
        # The rank of the remaining rows is the site's place, not a renumbering.
        self.assertNotIn("swift striker", rows)
        self.assertTrue(all(row["rank"] >= 2 for row in rows.values()))

    def test_no_payload_is_absent_with_a_reason(self):
        rows, source = statlocker.parse_analysis(None, {}, hero_id=13)
        self.assertEqual(rows, {})
        self.assertEqual(source["state"], "absent")
        self.assertTrue(source["reason"])

    def test_a_changed_shape_is_refused_by_name(self):
        for payload in ([], {}, {"items": "not a list"}):
            rows, source = statlocker.parse_analysis(payload, {}, hero_id=13)
            self.assertEqual(rows, {})
            self.assertEqual(source["state"], "refused", payload)
            self.assertTrue(source["reason"])

    def test_an_empty_catalogue_refuses_rather_than_reads(self):
        rows, source = statlocker.parse_analysis(self.payload, {}, hero_id=13)
        self.assertEqual(rows, {})
        self.assertEqual(source["state"], "refused")

    def test_a_percentage_sent_as_percent_is_not_scaled_twice(self):
        payload = {"items": [{"name": "An Item", "purchaseRate": 42.5, "purchaseCount": 10}]}
        rows, source = statlocker.parse_analysis(payload, {"an item": "an item"}, hero_id=1)
        self.assertEqual(source["items"], 1)
        self.assertAlmostEqual(rows["an item"]["pick"], 42.5, places=2)

    def test_the_url_is_the_endpoint_the_hero_page_calls(self):
        self.assertEqual(
            statlocker.analysis_url(13),
            "https://statlocker.gg/api/info/eternus-item-analysis/13?minRank=-2",
        )


if __name__ == "__main__":
    unittest.main()
