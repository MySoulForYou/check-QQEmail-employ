import unittest
from unittest.mock import Mock
import sys
import types

try:
    import bs4  # noqa: F401
except ModuleNotFoundError:
    bs4_stub = types.ModuleType("bs4")
    bs4_stub.BeautifulSoup = object
    sys.modules["bs4"] = bs4_stub

from cloud.worker import CloudSyncWorker


class WorkerSyncSafetyTests(unittest.TestCase):
    def setUp(self):
        self.worker = CloudSyncWorker.__new__(CloudSyncWorker)
        self.worker.upsert_recruitment_event = Mock()

    def test_non_recruitment_email_allows_cursor_to_advance(self):
        processed = self.worker.process_ai_result(
            {"is_recruitment": False}, "101", "普通通知"
        )

        self.assertTrue(processed)
        self.worker.upsert_recruitment_event.assert_not_called()

    def test_successful_recruitment_write_allows_cursor_to_advance(self):
        self.worker.upsert_recruitment_event.return_value = True

        processed = self.worker.process_ai_result(
            {"is_recruitment": True}, "102", "面试通知"
        )

        self.assertTrue(processed)
        self.worker.upsert_recruitment_event.assert_called_once()

    def test_failed_recruitment_write_blocks_cursor_advance(self):
        self.worker.upsert_recruitment_event.return_value = False

        processed = self.worker.process_ai_result(
            {"is_recruitment": True}, "103", "笔试通知"
        )

        self.assertFalse(processed)


if __name__ == "__main__":
    unittest.main()
