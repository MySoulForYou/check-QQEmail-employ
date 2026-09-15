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
            "email_event_type": "new_stage",
            "proposed_stage_status": "scheduled",
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

        result = self.worker.parse_with_ai(
            "【腾讯】一面邀请",
            "请于9月5日参加面试",
            active_apps=active_apps,
            sender_name="Moka招聘助手",
            sender_address="notice@mokahr.com",
        )

        self.assertTrue(result["is_recruitment"])
        self.assertEqual(result["matched_application_id"], "app-uuid-1")
        self.assertEqual(result["company"], "腾讯")

        # 检查传入 AI 的 Prompt 是否包含活跃档案
        called_args = mock_ai_client.chat.completions.create.call_args[1]
        user_prompt = called_args["messages"][1]["content"]
        self.assertIn("app-uuid-1", user_prompt)
        self.assertIn("前端开发工程师", user_prompt)
        self.assertIn("email_event_type", user_prompt)
        self.assertIn("reminder", user_prompt)
        self.assertIn("Moka招聘助手", user_prompt)
        self.assertIn("notice@mokahr.com", user_prompt)
        self.assertIn("mokahr.com", user_prompt)
        self.assertIn("不得把这类平台或代发方自动当作应聘公司", user_prompt)
        self.assertIn("不能仅凭显示名、邮箱前缀或域名直接认定应聘公司", user_prompt)

    @patch("httpx.get")
    @patch("httpx.patch")
    @patch("httpx.post")
    def test_upsert_uses_ai_matched_application_id(self, mock_post, mock_patch, mock_get):
        # 1. Mock 检查新旧两张表中 raw_email_id 均不存在
        resp_chk_notification = Mock(status_code=200)
        resp_chk_notification.json.return_value = []
        resp_chk_email = Mock(status_code=200)
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

        # 3. Mock 查询同阶段待审邮件为空
        resp_pending = Mock(status_code=200)
        resp_pending.json.return_value = []

        # 4. Mock 更新主表与插入子表
        resp_update = Mock()
        resp_update.status_code = 200

        resp_stage = Mock()
        resp_stage.status_code = 201

        mock_get.side_effect = [resp_chk_notification, resp_chk_email, resp_chk_app, resp_pending]
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
            "email_event_type": "new_stage",
            "proposed_stage_status": "scheduled",
            "urgent": False
        }

        success = self.worker.upsert_recruitment_event(ai_data, "email-uid-888", "【美团】一面通知")
        self.assertTrue(success)

        # 审核前不得提前覆盖主表当前阶段
        mock_patch.assert_not_called()

        # 验证没有创建真实阶段，只写入邮件事件表
        mock_post.assert_called_once()
        self.assertIn("stage_notifications", mock_post.call_args[0][0])
        inserted_notification = mock_post.call_args[1]["json"]
        self.assertEqual(inserted_notification["application_id"], "app-uuid-99")
        self.assertEqual(inserted_notification["event_type"], "new_stage")
        self.assertEqual(inserted_notification["schedule_type"], "start")
        self.assertNotIn("seq", inserted_notification)

    @patch("httpx.get")
    @patch("httpx.post")
    def test_reminder_links_existing_stage_without_creating_round(self, mock_post, mock_get):
        empty = Mock(status_code=200)
        empty.json.return_value = []
        app_response = Mock(status_code=200)
        app_response.json.return_value = [{
            "id": "app-1", "company": "招商银行", "position": "技术岗", "current_stage_name": "技术一面"
        }]
        target_response = Mock(status_code=200)
        target_response.json.return_value = [{
            "id": "stage-2", "seq": 2, "stage_name": "技术一面", "stage_status": "scheduled", "schedule_time": "2026-09-11 14:50"
        }]
        mock_get.side_effect = [empty, empty, app_response, empty, target_response]
        mock_post.return_value = Mock(status_code=201)

        success = self.worker.upsert_recruitment_event({
            "matched_application_id": "app-1",
            "company": "招商银行",
            "position": "技术岗",
            "stage_name": "技术一面",
            "schedule_time": "2026-09-11 14:50",
            "schedule_type": "start",
            "email_event_type": "reminder",
            "proposed_stage_status": "scheduled",
        }, "uid-reminder", "技术一面提醒")

        self.assertTrue(success)
        payload = mock_post.call_args[1]["json"]
        self.assertEqual(payload["event_type"], "reminder")
        self.assertEqual(payload["stage_id"], "stage-2")
        self.assertNotIn("seq", payload)

    @patch("httpx.get")
    @patch("httpx.post")
    def test_second_pending_new_stage_is_downgraded_to_reminder(self, mock_post, mock_get):
        empty = Mock(status_code=200)
        empty.json.return_value = []
        app_response = Mock(status_code=200)
        app_response.json.return_value = [{
            "id": "app-1", "company": "招商银行", "position": "技术岗", "current_stage_name": "待审核"
        }]
        pending_response = Mock(status_code=200)
        pending_response.json.return_value = [{
            "id": "notice-1", "event_type": "new_stage", "stage_id": None, "schedule_time": "2026-09-11 14:50"
        }]
        target_response = Mock(status_code=200)
        target_response.json.return_value = []
        mock_get.side_effect = [empty, empty, app_response, pending_response, target_response]
        mock_post.return_value = Mock(status_code=201)

        success = self.worker.upsert_recruitment_event({
            "matched_application_id": "app-1",
            "company": "招商银行",
            "position": "技术岗",
            "stage_name": "技术一面",
            "schedule_time": "2026-09-11 14:50",
            "email_event_type": "new_stage",
        }, "uid-second", "技术一面再次提醒")

        self.assertTrue(success)
        self.assertEqual(mock_post.call_args[1]["json"]["event_type"], "reminder")


if __name__ == "__main__":
    unittest.main()
