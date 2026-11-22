import json
import pathlib
import sys
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from tools import ingest  # noqa: E402

FIXTURE = ROOT / "tests" / "fixtures" / "haze-wpa.json"


class Formula(unittest.TestCase):
    def test_item_rate_minus_hero_rate(self):
        baseline = {"winrate": 50.0}
        self.assertEqual(ingest.wpa(60, 40, baseline)["wpa"], 10.0)
        self.assertEqual(ingest.wpa(50, 50, baseline)["wpa"], 0.0)
        self.assertEqual(ingest.wpa(40, 60, baseline)["wpa"], -10.0)

    def test_matches_are_the_sum_of_wins_and_losses(self):
        self.assertEqual(ingest.wpa(120, 80, {"winrate": 50.0})["matches"], 200)

    def test_no_rows_is_no_reading(self):
        self.assertIsNone(ingest.wpa(0, 0, {"winrate": 50.0}))
        self.assertIsNone(ingest.wpa(10, 10, None))

    def test_baseline_is_the_heroes_own_win_rate(self):
        baselines = ingest.hero_baselines([{"hero_id": 7, "wins": 3, "losses": 1}])
        self.assertEqual(baselines[7]["winrate"], 75.0)
        self.assertEqual(ingest.hero_baselines([{"hero_id": 7, "wins": 0, "losses": 0}]), {})


class FixtureRecompute(unittest.TestCase):
    """The baked WPA must equal the figure recomputed from the recorded response."""

    @classmethod
    def setUpClass(cls):
        cls.fixture = json.loads(FIXTURE.read_text(encoding="utf-8"))
        cls.data = json.loads((ROOT / "data" / "items.json").read_text(encoding="utf-8"))

    def test_fixture_carries_its_source(self):
        self.assertEqual(self.fixture["schema"], "soul-lens.fixture/1")
        self.assertIn("hero_id=", self.fixture["endpoints"]["hero_item_stats"])
        self.assertIn("analytics/hero-stats", self.fixture["endpoints"]["hero_stats"])
        self.assertEqual(len(self.fixture["cache"]["sha256"]), 64)
        self.assertGreater(len(self.fixture["items"]), 100)

    def test_every_baked_haze_row_is_recomputable(self):
        hero_key = ingest.normalize(self.fixture["hero"]["name"])
        baked = self.data["heroes"].get(hero_key, {}).get("wpa", {})
        baseline = self.fixture["hero"]["baseline"]
        checked = 0
        for row in self.fixture["items"]:
            key = ingest.normalize(row["name"])
            measured = ingest.wpa(row["wins"], row["losses"], baseline)
            if measured is None:
                continue
            self.assertIn(key, baked, f"{row['name']} missing from the bake")
            self.assertEqual(baked[key]["matches"], measured["matches"], key)
            self.assertAlmostEqual(baked[key]["wpa"], measured["wpa"], places=3, msg=key)
            checked += 1
        self.assertGreater(checked, 100)

    def test_the_worked_example_is_positive_and_has_a_ratio(self):
        row = next(item for item in self.fixture["items"] if item["name"] == "Extended Magazine")
        measured = ingest.wpa(row["wins"], row["losses"], self.fixture["hero"]["baseline"])
        self.assertGreater(measured["matches"], 2000)
        ratio = ingest.souls_per(row["cost"], measured["wpa"])
        self.assertIsNotNone(ratio)
        self.assertGreater(ratio, 0)


class ShippedHeroes(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        path = ROOT / "data" / "items.json"
        if not path.exists():
            raise unittest.SkipTest("data/items.json has not been ingested")
        cls.data = json.loads(path.read_text(encoding="utf-8"))

    def test_the_hero_leg_is_read_and_named(self):
        source = self.data["sources"]["deadlock-api-heroes"]
        self.assertEqual(source["state"], "read")
        self.assertGreater(source["heroes"], 30)
        self.assertGreater(source["wpa_rows"], 1000)
        self.assertIn("hero_id=", source["hero_item_url"])
        self.assertGreater(source["baselines"], 30)

    def test_every_hero_row_is_a_reading(self):
        for hero_key, hero in self.data["heroes"].items():
            for item_key, measured in hero["wpa"].items():
                self.assertIn(item_key, self.data["items"], hero_key)
                self.assertEqual(measured["matches"] > 0, True, f"{hero_key}/{item_key}")
                self.assertIsInstance(measured["wpa"], float)

    def test_small_samples_are_recorded_with_their_count(self):
        minimum = self.data["model"]["min_matches"]
        small = [(hero, item, row["matches"])
                 for hero, value in self.data["heroes"].items()
                 for item, row in value["wpa"].items() if row["matches"] < minimum]
        self.assertGreater(len(small), 0, "the catalogue has no under-threshold row to show the refusal")

    def test_provenance_names_every_source(self):
        path = ROOT / "data" / "provenance.json"
        if not path.exists():
            self.skipTest("data/provenance.json has not been ingested")
        provenance = json.loads(path.read_text(encoding="utf-8"))
        for name in ("items", "item_stats", "heroes", "hero_stats", "hero_item_stats", "statlocker"):
            self.assertIn(name, provenance["endpoints"])
        self.assertGreater(len(provenance["heroes"]), 30)
        for hero, row in provenance["heroes"].items():
            self.assertIn("hero_id=", row["url"], hero)
            self.assertRegex(row["sha256_16"], r"^[0-9a-f]{16}$", hero)
        self.assertNotIn(":\\", json.dumps(provenance))


if __name__ == "__main__":
    unittest.main()
