import json
import pathlib
import sys
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from tools import ingest  # noqa: E402


class WeaponTerms(unittest.TestCase):
    def test_damage_and_fire_rate_compose(self):
        terms = ingest.weapon_terms({
            "BaseAttackDamagePercent": {"value": "8"},
            "BonusFireRate": {"value": "10"},
        })
        self.assertEqual(terms["wp"], 8.0)
        self.assertEqual(terms["fire"], 10.0)
        self.assertAlmostEqual(terms["dps"], 18.8, places=3)

    def test_weapon_power_is_part_of_the_power_term(self):
        terms = ingest.weapon_terms({
            "BaseAttackDamagePercent": {"value": "5"},
            "WeaponPower": {"value": "7"},
        })
        self.assertEqual(terms["wp"], 12.0)

    def test_no_weapon_terms_is_zero_not_negative(self):
        self.assertEqual(ingest.weapon_terms({}), {"wp": 0.0, "fire": 0.0, "dps": 0.0})
        self.assertEqual(ingest.weapon_terms({"Bogus": {"value": "9"}})["wp"], 0.0)

    def test_a_percent_cell_is_read_as_a_number(self):
        self.assertEqual(ingest.prop_number({"X": {"value": "12%"}}, "X"), 12.0)
        self.assertEqual(ingest.prop_number({"X": {"value": "n/a"}}, "X"), 0.0)
        self.assertEqual(ingest.prop_number({}, "X"), 0.0)


class SoulsPer(unittest.TestCase):
    def test_ratio(self):
        self.assertEqual(ingest.souls_per(800, 8), 100.0)
        self.assertEqual(ingest.souls_per(1600, 8), 200.0)

    def test_no_gain_has_no_ratio(self):
        self.assertIsNone(ingest.souls_per(800, 0))
        self.assertIsNone(ingest.souls_per(800, None))
        self.assertIsNone(ingest.souls_per(None, 8))
        self.assertIsNone(ingest.souls_per(0, 8))


class Rows(unittest.TestCase):
    assets = [
        {"type": "upgrade", "shopable": True, "id": 1, "name": "Extended Magazine",
         "class_name": "upgrade_clip_size", "cost": 800, "item_tier": 1, "item_slot_type": "weapon",
         "properties": {"BaseAttackDamagePercent": {"value": "8"}}},
        {"type": "upgrade", "shopable": False, "id": 2, "name": "Hidden",
         "cost": 500, "properties": {"BaseAttackDamagePercent": {"value": "9"}}},
        {"type": "ability", "shopable": True, "id": 3, "name": "An Ability", "cost": 100,
         "properties": {}},
        {"type": "upgrade", "shopable": True, "id": 4, "name": "Spirit Thing",
         "cost": 1600, "properties": {"TechPower": {"value": "18"}}},
    ]
    stats = [
        {"item_id": 1, "avg_buy_time_s": 450.2},
        {"item_id": 1, "avg_buy_time_s": 430.0},
        {"item_id": 4, "avg_buy_time_s": 0},
    ]

    def test_only_shopable_upgrades_are_rows(self):
        rows = ingest.item_rows(self.assets, self.stats)
        self.assertIn("extended magazine", rows)
        self.assertIn("spirit thing", rows)
        self.assertNotIn("hidden", rows)
        self.assertNotIn("an ability", rows)

    def test_buy_time_keeps_the_earliest_measurement(self):
        rows = ingest.item_rows(self.assets, self.stats)
        self.assertEqual(rows["extended magazine"]["avg_buy_s"], 430.0)
        self.assertIsNone(rows["spirit thing"]["avg_buy_s"])

    def test_an_item_without_weapon_terms_has_no_ratio(self):
        rows = ingest.item_rows(self.assets, self.stats)
        row = rows["spirit thing"]
        self.assertEqual(row["wp"], 0.0)
        self.assertIsNone(row["souls_per_wp"])
        self.assertIsNone(row["souls_per_dps"])


class Statlocker(unittest.TestCase):
    rows = {"extended magazine": {}, "hollow point": {}}

    def test_no_payload_is_an_absent_source_with_a_reason(self):
        out, source = ingest.statlocker_rows(None, self.rows)
        self.assertEqual(out, {})
        self.assertEqual(source["state"], "absent")
        self.assertIn("STATLOCKER_API_KEY", source["reason"])

    def test_a_list_of_named_rows_is_read(self):
        payload = {"data": [
            {"name": "Extended Magazine", "wpa": 0.42},
            {"item_name": "Hollow Point", "win_probability_added": 0.11},
            {"name": "Not In Catalog", "wpa": 1.0},
            {"wpa": 0.9},
        ]}
        out, source = ingest.statlocker_rows(payload, self.rows)
        self.assertEqual(out["extended magazine"]["wpa"], 0.42)
        self.assertEqual(out["hollow point"]["wpa"], 0.11)
        self.assertEqual(source["state"], "read")
        self.assertEqual(source["rows"], 2)
        self.assertEqual(source["skipped"], 2)

    def test_a_changed_shape_is_refused_not_zero_filled(self):
        out, source = ingest.statlocker_rows({"unexpected": True}, self.rows)
        self.assertEqual(out, {})
        self.assertEqual(source["state"], "refused")
        self.assertIn("unrecognised", source["reason"])

    def test_rows_that_name_nothing_are_refused(self):
        out, source = ingest.statlocker_rows([{"wpa": 0.5}], self.rows)
        self.assertEqual(out, {})
        self.assertEqual(source["state"], "refused")


class ShippedData(unittest.TestCase):
    def setUp(self):
        path = ROOT / "data" / "items.json"
        if not path.exists():
            self.skipTest("data/items.json has not been ingested")
        self.document = json.loads(path.read_text(encoding="utf-8"))
        self.items = self.document["items"]

    def test_schema_and_sources(self):
        self.assertEqual(self.document["schema"], "soul-lens.data/1")
        self.assertEqual(self.document["sources"]["deadlock-api"]["state"], "read")
        self.assertIn("statlocker", self.document["sources"])
        self.assertIn("live-game", self.document["sources"])

    def test_every_ratio_agrees_with_its_terms(self):
        for key, row in self.items.items():
            if row["wp"] > 0:
                self.assertAlmostEqual(row["souls_per_wp"], round(row["cost"] / row["wp"], 1))
            else:
                self.assertIsNone(row["souls_per_wp"], key)

    def test_no_machine_path_is_shipped(self):
        text = json.dumps(self.document)
        self.assertNotIn(":\\", text)
        self.assertNotIn(":\\", (ROOT / "panorama" / "scripts" / "soul_lens_data.js").read_text(encoding="utf-8"))


class Normalize(unittest.TestCase):
    def test_names_meet_in_the_middle(self):
        self.assertEqual(ingest.normalize("High-Velocity Rounds"), "high velocity rounds")
        self.assertEqual(ingest.normalize("  high velocity   rounds "), "high velocity rounds")
        self.assertEqual(ingest.normalize(""), "")


if __name__ == "__main__":
    unittest.main()
