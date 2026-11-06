"""Unit tests for the data validators (no network). Run: python3 -m unittest discover -s pipeline"""
import unittest

import build_data as bd


class ValidatorTests(unittest.TestCase):
    def test_text_strips_control_and_bidi_characters(self):
        self.assertEqual(bd.v_text("Iron‮Ingot\x00", "n"), "IronIngot")
        self.assertEqual(len(bd.v_text("x" * 500, "n")), bd.MAX_NAME_LEN)

    def test_text_keeps_html_as_plain_text(self):
        # Escaping happens in the browser (textContent); the pipeline must not mangle names.
        self.assertEqual(bd.v_text("<b>Sword</b>", "n"), "<b>Sword</b>")

    def test_rejects_wrong_types_and_ranges(self):
        with self.assertRaises(bd.ValidationError):
            bd.v_int("12", "n")
        with self.assertRaises(bd.ValidationError):
            bd.v_int(True, "n")
        with self.assertRaises(bd.ValidationError):
            bd.v_num(float("nan"), "n")
        with self.assertRaises(bd.ValidationError):
            bd.v_copper(-5, "n")
        with self.assertRaises(bd.ValidationError):
            bd.v_copper(bd.MAX_COPPER * 10, "n")

    def test_copper_rounds_and_allows_missing(self):
        self.assertEqual(bd.v_copper(12.6, "n"), 13)
        self.assertIsNone(bd.v_copper(None, "n"))

    def test_market_row(self):
        row = bd.clean_market_row({
            "item_id": 8318, "item_name": "Iron Ingot", "category_id": 2, "subcategory_id": 7, "category_label": "Raw Materials",
            "latest_copper": 5489.0, "avg_7d_copper": 5500, "avg_30d_copper": 5600.4,
            "volume_7d": 1000, "volume_30d": 4000, "all_time_copper": 9000})
        self.assertEqual(row, [8318, "Iron Ingot", 7, 5489, 5500, 5600, 1000, 4000, 9000])

    def test_rules_reject_out_of_range_probability(self):
        raw = {
            "fee": {"base_copper": 1, "exponent": 2.5, "grade_coef": 0.25, "level_coef": 0.37, "slot_coef": 0.2},
            "grades": [{"id": i, "name": f"G{i}"} for i in range(13)],
            "groups": {"1": {"name": "Normal", "rows": {"0": {"success": 20000, "great": 0, "break": 0,
                                                              "downgrade": 0, "dmin": -1, "dmax": -1, "cost": 1}}}},
            "scrolls": [], "supports": [], "prices": {}}
        with self.assertRaises(bd.ValidationError):
            bd.clean_rules(raw)


if __name__ == "__main__":
    unittest.main()
