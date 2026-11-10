"""Unit tests for the data pipeline (no network). Run: python3 -m unittest discover -s pipeline"""
import json
import os
import tempfile
import unittest

import build_data as bd


def load(path):
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)

HEADER = '"Item ID","Item Name","24h Average","24h Volume","7d Average","7d Volume","30d Average","30d Volume","Raw Item String","","Last Updated At:","{date}"\n'


def sheet(rows, day="2026-11-06", extra=600):
    """A price sheet CSV in the same layout as the public AH price sheet."""
    lines = [HEADER.format(date=day)]
    for r in rows:
        lines.append(",".join(f'"{c}"' for c in r) + "\n")
    # pad with filler items so the size check passes
    for i in range(extra):
        lines.append(f'"{900000 + i}","Filler {i}","","","","","1","1",""\n')
    return "".join(lines)


class ValidatorTests(unittest.TestCase):
    def test_text_strips_control_and_bidi_characters(self):
        self.assertEqual(bd.v_text("Iron‮Ingot\x00", "n"), "IronIngot")
        self.assertEqual(len(bd.v_text("x" * 500, "n")), bd.MAX_NAME_LEN)

    def test_text_keeps_html_as_plain_text(self):
        # Escaping happens in the browser (textContent); the pipeline must not mangle names.
        self.assertEqual(bd.v_text("<b>Sword</b>", "n"), "<b>Sword</b>")

    def test_rejects_wrong_types_and_ranges(self):
        for bad in (lambda: bd.v_int("12", "n"), lambda: bd.v_int(True, "n"), lambda: bd.v_num(float("nan"), "n"),
                    lambda: bd.v_copper(-5, "n"), lambda: bd.v_copper(bd.MAX_COPPER * 10, "n"),
                    lambda: bd.cell_number("12abc", "n"), lambda: bd.cell_number("-3", "n")):
            with self.assertRaises(bd.ValidationError):
                bad()

    def test_sheet_url_rejects_injection(self):
        with self.assertRaises(bd.ValidationError):
            bd.sheet_csv_url("../../evil?x=", None)
        with self.assertRaises(bd.ValidationError):
            bd.sheet_csv_url("TestSheetId0123456789abcdefABCDEF", "1;drop")
        url = bd.sheet_csv_url("TestSheetId0123456789abcdefABCDEF", "123")
        self.assertTrue(url.startswith("https://docs.google.com/spreadsheets/d/TestSheetId0123456789abcdefABCDEF/gviz/tq?"))


class SheetTests(unittest.TestCase):
    def test_parse_prices_in_copper(self):
        rows, day = bd.parse_price_sheet(sheet([
            ["8318", "Iron Ingot", "0.5488", "74695", "0.5363", "589857", "0.58", "2626911", "8318,Iron Ingot"],
            ["98", "Decorative Vase (DEPRECATED)", "", "", "", "", "", "", ""],
            ["99", "Never traded", "", "", "", "", "", "", ""],
        ]))
        self.assertEqual(day, "2026-11-06")
        iron = next(r for r in rows if r[0] == 8318)
        self.assertEqual(iron, [8318, "Iron Ingot", None, 5488, 5363, 5800, 74695, 589857, 2626911])
        self.assertFalse(any(r[0] in (98, 99) for r in rows))

    def test_gold_suffix(self):
        self.assertEqual(bd.cell_number("21.7443g", "n"), 21.7443)
        self.assertEqual(bd.cell_number("30000.0000g", "n"), 30000.0)
        with self.assertRaises(bd.ValidationError):
            bd.cell_number("21g 5s", "n")

    def test_decimal_comma_locale_is_refused(self):
        # "0,5488" from a European-locale sheet must never be read as 5488
        for text in ("0,5488", "1,234", "30,000.00g"):
            with self.assertRaises(bd.ValidationError) as ctx:
                bd.cell_number(text, "n")
            self.assertIn("locale", str(ctx.exception))

    def test_duplicate_ids_keep_the_traded_row(self):
        rows, _ = bd.parse_price_sheet(sheet([
            ["42096", "Shard", "", "", "", "", "", "", ""],
            ["42096", "Shard", "", "", "28", "333", "28.2", "2415", ""],
        ]))
        self.assertEqual(next(r for r in rows if r[0] == 42096)[5], 282000)

    def test_rejects_wrong_layout_and_missing_date(self):
        with self.assertRaises(bd.ValidationError):
            bd.parse_price_sheet('"ID","Name"\n"1","x"\n')
        with self.assertRaises(bd.ValidationError):
            bd.parse_price_sheet(sheet([], day="not a date"))

    def test_rejects_tiny_sheet(self):
        with self.assertRaises(bd.ValidationError):
            bd.parse_price_sheet(sheet([], extra=10))


class HistoryTests(unittest.TestCase):
    def market(self, day, price):
        return {"sheetDate": day, "bucketRows": [[8318, "Iron Ingot", None, price, None, None, 100, 0, 0]]}

    def test_appends_one_point_per_sheet_date(self):
        h = bd.merge_history(None, self.market("2026-11-05", 5000))
        h = bd.merge_history(h, self.market("2026-11-06", 5100))
        h = bd.merge_history(h, self.market("2026-11-06", 5200))  # same day again: replaced, not duplicated
        self.assertEqual(h["days"], ["2026-11-05", "2026-11-06"])
        self.assertEqual(h["items"]["8318"], [[0, 5000, 100], [1, 5200, 100]])
        bd.validate_history(h)

    def test_trims_old_days(self):
        h = None
        for d in range(1, 11):
            h = bd.merge_history(h, self.market(f"2026-10-{d:02d}", 1000 + d), keep_days=7)
        self.assertEqual(len(h["days"]), 7)
        self.assertEqual(h["days"][0], "2026-10-04")
        self.assertEqual(h["items"]["8318"][0], [0, 1004, 100])


class PackImportTests(unittest.TestCase):
    def test_lua_table_parser(self):
        import import_pack_export as ipe
        data = ipe.parse_lua_table('{ a = 1, b = "x\\"y\\\nz", c = { 1, 2.5, true }, d = { { name = "P" } }, [7] = false, }')
        self.assertEqual(data["a"], 1)
        self.assertEqual(data["b"], 'x"y\nz')
        self.assertEqual(data["c"], [1, 2.5, True])
        self.assertEqual(data["d"][0]["name"], "P")
        self.assertIs(data[7], False)
        with self.assertRaises(ipe.ParseError):
            ipe.parse_lua_table("{ a = os.execute('x') }")

    def test_zone_name(self):
        import import_pack_export as ipe
        self.assertEqual(ipe.zone_name("Haranya - Solis Headlands"), "Solis Headlands")


class LarderTests(unittest.TestCase):
    def test_aged_packs_get_the_larder_recipe(self):
        r = bd.larder_recipe("Marianople Aged Cheese", [])
        self.assertEqual([(m["name"], m["qty"]) for m in r["materials"]],
                         [("Multi-Purpose Aging Larder", 1), ("Milk", 50), ("Lemon", 30)])
        self.assertEqual(r["craftVocation"], "Husbandry")
        self.assertEqual(r["requires"], {"vocation": "Commerce", "points": 10000})
        self.assertIsNone(bd.larder_recipe("Solis Aged Salve", [])["requires"])
        self.assertIsNone(bd.larder_recipe("Perinoor Aged Spices", []))  # has its own recipe
        self.assertIsNone(bd.larder_recipe("Solis Aged Honey", [{"id": 1}]))

    def test_every_aged_pack_in_the_snapshot_is_covered(self):
        packs = bd.build_packs()["packs"]
        aged = [p for p in packs if any(p["name"].endswith(" " + s) for s in bd.LARDER_RECIPES)]
        self.assertGreaterEqual(len(aged), 80)
        self.assertTrue(all(p["materials"] and p["craftVocation"] == "Husbandry" for p in aged))
        self.assertTrue(all(p["craftVocation"] == "Commerce" for p in packs if p not in aged))


class LandTests(unittest.TestCase):
    def test_land_snapshot_validates(self):
        land = bd.build_land()
        sizes = {t["name"]: t["size"] for t in land["types"]}
        self.assertEqual([sizes[n] for n in ("Scarecrow Garden", "Scarecrow Farm", "Gazebo Farm", "Beanstalk House")], [8, 16, 24, 44])
        apple = next(p for p in land["plantables"] if p["name"] == "Apple Sapling")
        self.assertEqual(apple["vocations"], ["Logging", "Gathering"])
        by = {p["name"]: p for p in land["plantables"]}
        self.assertEqual((by["Cedar Sapling"]["source"], by["Cedar Sapling"]["npcPrice"]), ("merchant", 1000))
        self.assertEqual((by["Dairy Calf"]["source"], by["Dairy Calf"]["badges"]), ("vocation", 450))
        self.assertEqual((by["Red Coral Polyp"]["source"], by["Red Coral Polyp"]["npcPrice"]), ("merchant", 150))
        self.assertEqual(by["Bound Majestic Tree"]["badges"], 80000)
        self.assertEqual(by["Pansy Seed"]["source"], "community")
        self.assertEqual(by["Fir Sapling"]["source"], "special")  # not in the vocation shop
        self.assertEqual(by["Pine Woodlot"]["source"], "craft")
        self.assertTrue(by["Pine Woodlot"]["craft"]["materials"])
        self.assertFalse(any("TEST" in p["name"] for p in land["plantables"]))

    def test_description_parsing(self):
        import snapshot_land as sl
        self.assertEqual(sl.hours("1 d 2 h"), 26)
        self.assertEqual(sl.hours(sl.plain("|cFFFF9C2712 h|r")), 12)
        self.assertEqual(sl.building_type("Full Kit: Stone Spring Villa (Porch)"), "Stone Spring Villa")
        self.assertEqual(sl.building_type("Haranyan Private Sawmill Design"), "Private Sawmill")
        self.assertIsNone(sl.building_type("Nuian Defense Tower Design"))
        plant = sl.parse_plant({"id": 1, "name": "Apple Sapling", "description":
                                "Vocation: Logging; Gathering\nMatures in 14 h 18 m\nHarvest every 11 h 26 m\nClimate: Temperate"}, "Saplings")
        self.assertEqual(plant["vocations"], ["Logging", "Gathering"])
        self.assertEqual(plant["repeat"]["verb"], "Harvest")
        self.assertAlmostEqual(plant["matureH"], 14.3)
        self.assertIsNone(sl.parse_plant({"id": 2, "name": "Fish", "description": "Vocation: Fishing"}, "Livestock"))


class CraftTests(unittest.TestCase):
    def test_recipe_parsing(self):
        import snapshot_crafts as sc
        raw = {"id": 7, "primary_product_id": 10, "labor": 15, "products": [{"item_id": 10, "amount": 2, "rate": 100, "name": "Lumber"}],
               "materials": [{"item_id": 20, "amount": 10, "name": "Log"}, {"item_id": 500, "amount": 50, "name": "Coin"}]}
        r = sc.parse_recipe(raw, {10: "Lumber"})
        self.assertEqual((r["product"], r["amount"], r["labor"], r["category"]), (10, 2, 15, "Lumber"))
        self.assertEqual([m["name"] for m in r["materials"]], ["Log", "Coin"])
        self.assertIsNone(sc.parse_recipe({**raw, "materials": []}, {}))
        self.assertEqual(sc.chance(10000), 100)  # basis points
        self.assertEqual(sc.chance(50), 50)

    def test_crafts_snapshot_validates(self):
        crafts = bd.build_crafts()
        self.assertGreater(len(crafts["recipes"]), 500)
        self.assertTrue(all(r["materials"] for r in crafts["recipes"]))


class IconTests(unittest.TestCase):
    def test_local_names_are_flat_and_safe(self):
        import snapshot_icons as si
        self.assertEqual(si.local_name("costume_set\\nu_f_in_pants012.png"), "costume_set__nu_f_in_pants012.png")
        self.assertEqual(si.local_name("quest/Icon_Item_quest053.png"), "quest__icon_item_quest053.png")
        self.assertIsNone(si.local_name("../../etc/passwd.png"))
        self.assertIsNone(si.local_name("x.png?y=1"))

    def test_icons_snapshot_only_lists_shipped_files(self):
        icons = bd.build_icons()["icons"]
        self.assertGreater(len(icons), 1000)
        shipped = set(os.listdir(bd.ICON_DIR))
        self.assertTrue(all(name in shipped and bd.ICON_NAME.match(name) for name in icons.values()))


class StampTests(unittest.TestCase):
    def test_stamps_html_and_imports(self):
        import stamp_assets as sa
        html = '<link rel="stylesheet" href="assets/css/app.css">\n<script type="module" src="assets/js/main.js"></script><a href="https://aa-classic.com">x</a>'
        out = sa.stamp_html(html, "abc123def456")
        self.assertIn('href="assets/css/app.css?v=abc123def456"', out)
        self.assertIn('src="assets/js/main.js?v=abc123def456"', out)
        self.assertIn('href="https://aa-classic.com"', out)
        js = "import { h } from '../lib/dom.js';\nconst v = () => import('./views/packs.js');\nimport * as s from \"./lib/setup.js\";\nconst t = 'from ./not-a-module.js';"
        out = sa.stamp_js(js, "v1")
        self.assertIn("from '../lib/dom.js?v=v1'", out)
        self.assertIn("import('./views/packs.js?v=v1')", out)
        self.assertIn('from "./lib/setup.js?v=v1"', out)
        self.assertIn("'from ./not-a-module.js'", out)


class EndToEndTests(unittest.TestCase):
    def test_offline_build_writes_all_files(self):
        with tempfile.TemporaryDirectory() as tmp:
            csv_path = os.path.join(tmp, "prices.csv")
            with open(csv_path, "w", encoding="utf-8") as fh:
                fh.write(sheet([["8318", "Iron Ingot", "0.55", "10", "0.54", "70", "0.58", "300", ""]]))
            out = os.path.join(tmp, "data")
            self.assertEqual(bd.main(["--out", out, "--sheet-csv", csv_path, "--no-categories"]), 0)
            market = load(os.path.join(out, "market.json"))
            self.assertEqual(market["sheetDate"], "2026-11-06")
            regrade = load(os.path.join(out, "regrade.json"))
            self.assertGreater(len(regrade["items"]), 1000)
            hist = load(os.path.join(out, "history", f"{8318 % bd.HISTORY_BUCKETS}.json"))
            packs = load(os.path.join(out, "packs.json"))
            self.assertGreater(len(packs["packs"]), 100)
            self.assertEqual(packs["payoutDemand"], 130)
            self.assertEqual(hist["items"]["8318"], [[0, 5500, 10]])


if __name__ == "__main__":
    unittest.main()
