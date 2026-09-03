import unittest
from unittest.mock import Mock, patch
import json
import sys
import types

try:
    import bs4  # noqa: F401
except ModuleNotFoundError:
    bs4_stub = types.ModuleType("bs4")
    bs4_stub.BeautifulSoup = object
    sys.modules["bs4"] = bs4_stub

from cloud.worker import CloudSyncWorker


class WorkerAIMatcherTests(unittest.TestCase):
    def setUp(self):
        self.worker = CloudSyncWorker.__new__(CloudSyncWorker)
        self.worker.supabase_url = "https://mock.supabase.co"
        self.worker.sb_headers = {"Authorization": "Bearer mock"}
        self.worker.model_name = "deepseek-chat"

    def test_parse_with_ai_injects_active_apps_context(self):
        mock_ai_client = Mock()
        mock_response = Mock()
        mock_choice = Mock()
        mock_message = Mock()
        mock_message.content = json.dumps({
            "is_recruitment": True,
            "matched_application_id": "app-uuid-1",
            "match_reason": "同一企业同岗位一面推进",
            "company": "腾讯",
            "department": "WXG",
            "position": "前端开发工程师",
            "stage_name": "技术一面",
            "schedule_time": "2026-09-05 14:00",
            "meeting_info": "https://join.qq.com",
            "next_expectation": "等待一面结果",
            "notes": "自备简历",
            "urgent": False
        })
        mock_choice.message = mock_message
        mock_response.choices = [mock_choice]
        mock_ai_client.chat.completions.create.return_value = mock_response
        self.worker.ai_client = mock_ai_client

        active_apps = [
            {
                "id": "app-uuid-1",
                "company": "腾讯",
                "department": "WXG",
                "position": "前端开发工程师",
                "current_stage_name": "综合测评"
            }
        ]

        result = self.worker.parse_with_ai("【腾讯】一面邀请", "请于9月5日参加面试", active_apps=active_apps)

        self.assertTrue(result["is_recruitment"])
        self.assertEqual(result["matched_application_id"], "app-uuid-1")
        self.assertEqual(result["company"], "腾讯")

        # 检查传入 AI 的 Prompt 是否包含活跃档案
        called_args = mock_ai_client.chat.completions.create.call_args[1]
        user_prompt = called_args["messages"][1]["content"]
        self.assertIn("app-uuid-1", user_prompt)
        self.assertIn("前端开发工程师", user_prompt)

    @patch("httpx.get")
    @patch("httpx.patch")
    @patch("httpx.post")
    def test_upsert_uses_ai_matched_application_id(self, mock_post, mock_patch, mock_get):
        # 1. Mock 检查 raw_email_id 不存在
        resp_chk_email = Mock()
        resp_chk_email.status_code = 200
        resp_chk_email.json.return_value = []

        # 2. Mock 检查 matched_app_id 存在
        resp_chk_app = Mock()
        resp_chk_app.status_code = 200
        resp_chk_app.json.return_value = [{
            "id": "app-uuid-99",
            "company": "美团",
            "position": "后台开发工程师",
            "current_stage_name": "在线笔试"
        }]

        # 3. Mock 查询当前 seq
        resp_seq = Mock()
        resp_seq.status_code = 200
        resp_seq.json.return_value = [{"seq": 1}]

        # 4. Mock 更新主表与插入子表
        resp_update = Mock()
        resp_update.status_code = 200

        resp_stage = Mock()
        resp_stage.status_code = 201

        mock_get.side_effect = [resp_chk_email, resp_chk_app, resp_seq]
        mock_patch.return_value = resp_update
        mock_post.return_value = resp_stage

        ai_data = {
            "is_recruitment": True,
            "matched_application_id": "app-uuid-99",
            "match_reason": "匹配已有美团后台投递单",
            "company": "美团",
            "department": "到家事业群",
            "position": "后台开发",
            "stage_name": "技术一面",
            "schedule_time": "2026-09-06 10:00",
            "meeting_info": "https://zhaopin.meituan.com",
            "next_expectation": "等待一面结果",
            "notes": "",
            "urgent": False
        }

        success = self.worker.upsert_recruitment_event(ai_data, "email-uid-888", "【美团】一面通知")
        self.assertTrue(success)

        # 验证主表被更新
        mock_patch.assert_called_once()
        patch_payload = mock_patch.call_args[1]["json"]
        self.assertEqual(patch_payload["current_stage_name"], "技术一面")

        # 验证没有调用创建新主表 post，而是直接插入了子表
        mock_post.assert_called_once()
        inserted_stage = mock_post.call_args[1]["json"]
        self.assertEqual(inserted_stage["application_id"], "app-uuid-99")
        self.assertEqual(inserted_stage["seq"], 2)
        self.assertEqual(inserted_stage["schedule_type"], "start")


if __name__ == "__main__":
    unittest.main()
