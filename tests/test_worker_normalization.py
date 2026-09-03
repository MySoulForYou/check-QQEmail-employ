import unittest

from cloud.normalization import normalize_company_website, normalize_extracted_position, normalize_extracted_schedule_type, normalize_extracted_stage_name


class WorkerNormalizationTests(unittest.TestCase):
    def test_major_scope_is_not_stored_as_position(self):
        value = "校园招聘（微电子、集成电路相关、机电、电气工程及其自动化、仪器科学与工程、电子信息、计算机等相关专业）"
        self.assertEqual(normalize_extracted_position(value), "未指定岗位")

    def test_real_position_is_preserved(self):
        self.assertEqual(
            normalize_extracted_position(" Product Engineer－产品工程师 "),
            "Product Engineer-产品工程师",
        )

    def test_missing_position_has_explicit_fallback(self):
        self.assertEqual(normalize_extracted_position(""), "未指定岗位")

    def test_combined_stage_uses_current_action(self):
        self.assertEqual(normalize_extracted_stage_name("宣讲会及在线笔试"), "在线笔试")
        self.assertEqual(normalize_extracted_stage_name("校园宣讲会"), "宣讲会")

    def test_schedule_type_normalization_and_legacy_fallback(self):
        self.assertEqual(normalize_extracted_schedule_type("start", "在线笔试", "2026-09-05 19:00"), "start")
        self.assertEqual(normalize_extracted_schedule_type("截止前完成", "综合测评", "2026-09-05 18:00"), "deadline")
        self.assertEqual(normalize_extracted_schedule_type(None, "技术一面", "2026-09-05 14:00"), "start")
        self.assertEqual(normalize_extracted_schedule_type(None, "综合测评", "待定"), "unknown")

    def test_company_website_only_accepts_web_urls(self):
        self.assertEqual(normalize_company_website("www.example.com"), "https://www.example.com")
        self.assertEqual(normalize_company_website("腾讯会议 123-456-789"), "")


if __name__ == "__main__":
    unittest.main()
