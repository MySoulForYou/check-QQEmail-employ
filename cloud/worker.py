import os
import sys
import json
import imaplib
import email
from email.header import decode_header
from bs4 import BeautifulSoup
from datetime import datetime
import logging
import httpx
from openai import OpenAI

# 配置日志输出格式
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - [%(levelname)s] - %(message)s',
    handlers=[logging.StreamHandler(sys.stdout)]
)

class CloudSyncWorker:
    def __init__(self):
        # 1. 尝试从本地 config.json 读取 (支持本地手动调试测试)
        current_dir = os.path.dirname(os.path.abspath(__file__))
        config_path = os.path.join(current_dir, '..', 'config.json')
        if not os.path.exists(config_path):
            config_path = os.path.join(current_dir, 'config.json')
        config = {}
        if os.path.exists(config_path):
            try:
                with open(config_path, 'r', encoding='utf-8') as f:
                    config = json.load(f)
            except Exception as e:
                logging.warning(f"读取本地 config.json 失败: {e}")

        # 2. 显式读取环境变量 (优先读取环境变量，支持 GitHub Actions)
        ai_conf = config.get("ai_config", {})
        sb_conf = config.get("supabase_config", {})

        self.email_addr = (os.getenv("EMAIL_USER") or config.get("email") or "").strip()
        self.auth_code = (os.getenv("EMAIL_AUTH_CODE") or config.get("auth_code") or "").strip()
        self.imap_server = (os.getenv("IMAP_SERVER") or config.get("imap_server") or "imap.qq.com").strip()

        self.api_key = (os.getenv("DEEPSEEK_API_KEY") or ai_conf.get("api_key") or "").strip()
        self.api_base = (os.getenv("DEEPSEEK_API_BASE") or ai_conf.get("api_base") or "https://api.deepseek.com").strip().rstrip("/")
        self.model_name = (os.getenv("DEEPSEEK_MODEL") or ai_conf.get("model") or "deepseek-chat").strip()

        self.supabase_url = (os.getenv("SUPABASE_URL") or sb_conf.get("url") or "").strip().rstrip("/")
        self.supabase_key = (os.getenv("SUPABASE_SERVICE_ROLE_KEY") or sb_conf.get("secret_key") or "").strip()

        # 3. 严格校验所有必需参数，杜绝未定义
        missing = []
        if not self.email_addr: missing.append("EMAIL_USER")
        if not self.auth_code: missing.append("EMAIL_AUTH_CODE")
        if not self.imap_server: missing.append("IMAP_SERVER")
        if not self.api_key: missing.append("DEEPSEEK_API_KEY")
        if not self.api_base: missing.append("DEEPSEEK_API_BASE")
        if not self.model_name: missing.append("DEEPSEEK_MODEL")
        if not self.supabase_url: missing.append("SUPABASE_URL")
        if not self.supabase_key: missing.append("SUPABASE_SERVICE_ROLE_KEY")

        if missing:
            raise ValueError(f"❌ 启动失败: 缺少必需配置项 [{', '.join(missing)}]，请在环境变量或 GitHub Secrets 中显式配置！")

        # 打印显式配置概览 (安全脱敏)
        masked_email = self.email_addr[:3] + "***@" + self.email_addr.split("@")[-1] if "@" in self.email_addr else "***"
        logging.info("========================================")
        logging.info("⚙️  云端 Worker 配置已显式加载成功:")
        logging.info(f"   ├─ 邮箱账号: {masked_email} (IMAP: {self.imap_server})")
        logging.info(f"   ├─ AI 接口地址: {self.api_base}")
        logging.info(f"   ├─ AI 选用模型: {self.model_name}")
        logging.info(f"   └─ 云端数据库: {self.supabase_url}")
        logging.info("========================================")

        # 初始化 OpenAI/DeepSeek 客户端
        self.ai_client = OpenAI(
            api_key=self.api_key,
            base_url=self.api_base
        )

        # 初始化 Supabase HTTP 请求头 (使用最高权限 Secret Key 写入)
        self.sb_headers = {
            "apikey": self.supabase_key,
            "Authorization": f"Bearer {self.supabase_key}",
            "Content-Type": "application/json",
            "Prefer": "resolution=merge-duplicates"
        }

    def decode_str(self, s):
        if not s:
            return ""
        try:
            value, charset = decode_header(s)[0]
            if charset:
                if isinstance(value, bytes):
                    return value.decode(charset, errors='ignore')
                return value
            if isinstance(value, bytes):
                return value.decode('utf-8', errors='ignore')
            return str(value)
        except Exception:
            return str(s)

    def parse_email_content(self, msg):
        content = ""
        if msg.is_multipart():
            for part in msg.walk():
                content_type = part.get_content_type()
                if content_type in ['text/plain', 'text/html']:
                    payload = part.get_payload(decode=True)
                    if payload:
                        charset = part.get_content_charset() or 'utf-8'
                        content += payload.decode(charset, errors='ignore')
        else:
            payload = msg.get_payload(decode=True)
            if payload:
                charset = msg.get_content_charset() or 'utf-8'
                content = payload.decode(charset, errors='ignore')
        
        soup = BeautifulSoup(content, 'html.parser')
        return soup.get_text(separator=' ')

    def get_sync_state(self):
        """从 Supabase 查询上次抓取的 last_uid"""
        try:
            resp = httpx.get(
                f"{self.supabase_url}/rest/v1/sync_state?key=eq.email_sync&select=last_uid",
                headers=self.sb_headers,
                timeout=10.0
            )
            if resp.status_code == 200:
                data = resp.json()
                if data and len(data) > 0:
                    return int(data[0].get("last_uid", 0))
            logging.warning(f"⚠️ 未查询到 sync_state，将默认使用 last_uid = 0. 响应: {resp.text}")
            return 0
        except Exception as e:
            logging.error(f"❌ 读取云端 sync_state 异常: {e}")
            return 0

    def update_sync_state(self, new_uid):
        """更新 Supabase 中的 last_uid"""
        try:
            payload = {
                "key": "email_sync",
                "last_uid": new_uid,
                "updated_at": datetime.now().isoformat()
            }
            resp = httpx.post(
                f"{self.supabase_url}/rest/v1/sync_state",
                headers=self.sb_headers,
                json=payload,
                timeout=10.0
            )
            if resp.status_code in [200, 201]:
                logging.info(f"✅ 云端书签已成功更新为: last_uid = {new_uid}")
            else:
                logging.error(f"❌ 更新 sync_state 失败: {resp.status_code}, {resp.text}")
        except Exception as e:
            logging.error(f"❌ 更新 sync_state 异常: {e}")

    def parse_with_ai(self, subject, body):
        """使用 DeepSeek AI 提取邮件结构化信息 (标准 ATS 投递与环节模型)"""
        prompt = f"""
你是一个招聘信息与求职进度提取专家。请阅读下面的邮件主题和内容。

任务：
1. 判断该邮件是否与“招聘、面试、笔试、测评、Offer、录取、入职、简历投递、资料补充、感谢信/流程结束”等求职全流程相关。
2. 如果相关，提取以下关键要素：
   - company: 企业标准名称（统一提炼为规范全称或通用简称，如：腾讯、阿里巴巴、网易、字节跳动、小红书、美团、中科芯等）
   - department: 所属部门/事业群/业务线（如：微信事业群 WXG、淘天集团、多媒体技术部、雷火工作室、飞书；若邮件无明确部门则留空字符 ""）
   - position: 投递岗位名称（如：Product Engineer-产品工程师、后台开发工程师、2027届算法实习生、前端开发）
   - stage_name: 精炼环节名称（严格控制在2~6个字，如：网申提交、综合测评、在线笔试、AI面试、技术一面、业务二面、总监终面、HR沟通、正式Offer等）
   - schedule_time: 面试/笔试约定时间（格式如：2026-08-25 14:00 或 待定）
   - meeting_info: 腾讯会议号/Zoom链接/考试平台账号密码/地点（无则留空）
   - next_expectation: 客观严谨的本轮流转与等待预期（如：等待笔试结果、等待测评结果、等待一面结果、等待二面结果、等待正式Offer邮件、流程结束等）
   - notes: 关键备注与注意事项（如双机位要求、自备简历等，无则留空）
   - urgent: 布尔值（如果是48小时内的面试/笔试，则为 true，否则为 false）

邮件主题: {subject}
邮件内容摘要: {body[:3000]}

请严格按以下 JSON 格式返回，不要输出任何其他说明文字：
{{
    "is_recruitment": true,
    "company": "企业名称",
    "department": "部门/事业群",
    "position": "岗位全称",
    "stage_name": "环节名称",
    "schedule_time": "时间",
    "meeting_info": "会议号/链接/凭据",
    "next_expectation": "本轮等待预期",
    "notes": "备注/注意事项",
    "urgent": false
}}
"""
        try:
            logging.info(f"🔍 正在使用 AI 解析邮件: 【{subject}】")
            response = self.ai_client.chat.completions.create(
                model=self.model_name,
                messages=[
                    {"role": "system", "content": "你是一个招聘助手，只负责精准提取和识别招聘类邮件及其流转状态。"},
                    {"role": "user", "content": prompt}
                ],
                response_format={"type": "json_object"}
            )
            text = response.choices[0].message.content.strip()
            
            # 清理 markdown 标签
            if text.startswith("```json"):
                text = text.split("```json")[1].split("```")[0].strip()
            elif text.startswith("```"):
                text = text.split("```")[1].split("```")[0].strip()

            result = json.loads(text)
            logging.info(f"✅ AI 解析结果: 公司={result.get('company')}, 部门={result.get('department')}, 岗位={result.get('position')}, 环节={result.get('stage_name')}, 时间={result.get('schedule_time')}")
            return result
        except Exception as e:
            logging.error(f"❌ AI 解析异常: {e}")
            raise e

    def upsert_recruitment_event(self, ai_data, raw_email_id, raw_subject):
        """将 AI 解析结果写入 applications 主表与 application_stages 子表"""
        try:
            company = (ai_data.get("company") or "其他/未识别公司").strip()
            department = (ai_data.get("department") or "").strip()
            position = (ai_data.get("position") or raw_subject or "校招应聘岗位").strip()
            stage_name = (ai_data.get("stage_name") or "求职通知").strip()
            schedule_time = (ai_data.get("schedule_time") or "待定").strip()
            meeting_info = (ai_data.get("meeting_info") or "").strip()
            next_exp = (ai_data.get("next_expectation") or "").strip()
            notes = (ai_data.get("notes") or "").strip()

            # 1. 幂等检查：检查该 raw_email_id 是否已经入库过
            if raw_email_id:
                check_url = f"{self.supabase_url}/rest/v1/application_stages?raw_email_id=eq.{raw_email_id}&select=id"
                resp_chk = httpx.get(check_url, headers=self.sb_headers, timeout=10.0)
                if resp_chk.status_code == 200 and resp_chk.json():
                    logging.info(f"⏭️ 邮件 UID {raw_email_id} 已存在，跳过重复写入")
                    return True

            # 2. 查询是否已存在对应的投递单 (Applications)
            # 匹配规则: company + position + overall_status='active' (若有 department 也一并精准匹配)
            query_url = f"{self.supabase_url}/rest/v1/applications?company=eq.{company}&position=eq.{position}&overall_status=eq.active&select=id,current_stage_name"
            if department:
                query_url += f"&department=eq.{department}"

            resp_app = httpx.get(query_url, headers=self.sb_headers, timeout=10.0)
            app_id = None

            if resp_app.status_code == 200 and resp_app.json():
                # 复用已有投递单
                app_data = resp_app.json()[0]
                app_id = app_data["id"]
                logging.info(f"📂 匹配到已有投递单: [{company}] {position} (ID: {app_id})")

                # 更新主表最新环节快照与更新时间
                update_url = f"{self.supabase_url}/rest/v1/applications?id=eq.{app_id}"
                httpx.patch(
                    update_url,
                    headers=self.sb_headers,
                    json={
                        "current_stage_name": stage_name,
                        "updated_at": datetime.now().isoformat()
                    },
                    timeout=10.0
                )
            else:
                # 新建投递单
                headers_return = dict(self.sb_headers)
                headers_return["Prefer"] = "return=representation"

                new_app_payload = {
                    "company": company,
                    "department": department,
                    "position": position,
                    "recruitment_season": "2027届秋招",
                    "current_stage_name": stage_name,
                    "overall_status": "active",
                    "created_at": datetime.now().isoformat(),
                    "updated_at": datetime.now().isoformat()
                }

                resp_create = httpx.post(
                    f"{self.supabase_url}/rest/v1/applications",
                    headers=headers_return,
                    json=new_app_payload,
                    timeout=10.0
                )

                if resp_create.status_code in [200, 201] and resp_create.json():
                    app_id = resp_create.json()[0]["id"]
                    logging.info(f"✨ 成功新建投递单: [{company}] {position} (ID: {app_id})")
                else:
                    logging.error(f"❌ 创建投递单失败: {resp_create.status_code}, {resp_create.text}")
                    return False

            # 3. 计算下一轮 seq 序号
            seq_url = f"{self.supabase_url}/rest/v1/application_stages?application_id=eq.{app_id}&select=seq&order=seq.desc&limit=1"
            resp_seq = httpx.get(seq_url, headers=self.sb_headers, timeout=10.0)
            next_seq = 1
            if resp_seq.status_code == 200 and resp_seq.json():
                next_seq = int(resp_seq.json()[0].get("seq", 0)) + 1

            # 4. 插入 application_stages 子表
            stage_payload = {
                "application_id": app_id,
                "seq": next_seq,
                "stage_name": stage_name,
                "stage_status": "pending", # 新邮件默认进入待审大厅
                "schedule_time": schedule_time,
                "meeting_info": meeting_info,
                "next_expectation": next_exp,
                "raw_email_id": str(raw_email_id),
                "raw_subject": raw_subject,
                "notes": notes,
                "created_at": datetime.now().isoformat(),
                "updated_at": datetime.now().isoformat()
            }

            resp_stage = httpx.post(
                f"{self.supabase_url}/rest/v1/application_stages",
                headers=self.sb_headers,
                json=stage_payload,
                timeout=10.0
            )

            if resp_stage.status_code in [200, 201]:
                logging.info(f"💾 环节已存入云端子表: 第{next_seq}轮 [{stage_name}] 投递单={app_id}")
                return True
            else:
                logging.error(f"❌ 环节子表入库失败: {resp_stage.status_code}, {resp_stage.text}")
                return False

        except Exception as e:
            logging.error(f"❌ 写入主子表异常: {e}")
            return False

    def run(self):
        logging.info("🚀 ========================================")
        logging.info("🚀 启动云端招聘邮件同步 Worker (主子表全新架构)")
        logging.info("🚀 ========================================")

        # 1. 获取上次同步的 UID
        last_uid = self.get_sync_state()
        logging.info(f"📖 云端当前进度书签: last_uid = {last_uid}")

        # 2. 连接 IMAP 邮箱
        try:
            mail = imaplib.IMAP4_SSL(self.imap_server)
            mail.login(self.email_addr, self.auth_code)
            mail.select("INBOX")
        except Exception as e:
            logging.error(f"❌ 邮箱登录连接失败: {e}")
            logging.error(f"💡 排查建议: 当前连接服务器为 [{self.imap_server}]")
            logging.error("   1. 若使用腾讯企业邮/企业微信邮箱，请确保 IMAP_SERVER 为 imap.exmail.qq.com (信创版为 xcimap.exmail.qq.com) 并使用「客户端专用密码」；")
            logging.error("   2. 网页端请确认已开启 POP3/IMAP 客户端服务协议；")
            logging.error("   3. 若为个人 QQ 邮箱，请使用账户设置中生成的 16 位授权码而非 QQ 密码。")
            return

        # 3. 检索新邮件 (增量模式 / 首次 10 天保护窗口)
        if last_uid > 0:
            logging.info(f"📥 正在检索新邮件 (UID > {last_uid})...")
            status, messages = mail.uid('search', None, f'UID {last_uid + 1}:*')
        else:
            import datetime as dt
            ten_days_ago = (dt.datetime.now() - dt.timedelta(days=10)).strftime("%d-%b-%Y")
            logging.info(f"📥 初次同步或书签重置为0，扫描最近 10 天所有邮件 (SINCE {ten_days_ago})...")
            status, messages = mail.uid('search', None, 'SINCE', ten_days_ago)

        if status == 'OK' and messages[0]:
            all_mail_ids = messages[0].split()
        else:
            all_mail_ids = []

        logging.info(f"📬 扫描到待处理邮件数量: {len(all_mail_ids)} 封")
        if not all_mail_ids:
            logging.info("✨ 没有发现新邮件，本次同步结束。")
            mail.logout()
            return

        new_tasks_count = 0
        max_uid_in_batch = last_uid

        for m_id in all_mail_ids:
            m_id_str = m_id.decode()
            
            # 过滤小于等于 last_uid 的冗余邮件
            try:
                current_uid_int = int(m_id_str)
                if current_uid_int <= last_uid:
                    continue
            except ValueError:
                continue

            # 获取邮件主题
            status, header_data = mail.uid('fetch', m_id, '(BODY[HEADER.FIELDS (SUBJECT FROM)])')
            subject = "无主题"
            if status == 'OK' and header_data[0]:
                header_msg = email.message_from_bytes(header_data[0][1])
                subject = self.decode_str(header_msg.get("Subject", "无主题"))

            logging.info(f"----------------------------------------")
            logging.info(f"📨 正在处理邮件 [UID: {m_id_str}]: {subject}")

            # 获取正文
            status, data = mail.uid('fetch', m_id, '(RFC822)')
            if status != 'OK' or not data[0]:
                continue

            msg = email.message_from_bytes(data[0][1])
            body = self.parse_email_content(msg)

            # 调用 AI 进行分析
            try:
                ai_result = self.parse_with_ai(subject, body)
                if ai_result and ai_result.get("is_recruitment"):
                    if self.upsert_recruitment_event(ai_result, m_id_str, subject):
                        new_tasks_count += 1
                else:
                    logging.info(f"⏭️ 忽略非招聘邮件: {subject[:30]}...")

                if current_uid_int > max_uid_in_batch:
                    max_uid_in_batch = current_uid_int

            except Exception as e:
                logging.error(f"⚠️ 解析处理中断 (网络/API错误)，停止推进，下次将重试该邮件。错误: {e}")
                break

        # 4. 如果有新进度，更新云端书签
        if max_uid_in_batch > last_uid:
            self.update_sync_state(max_uid_in_batch)

        logging.info("========================================")
        logging.info(f"🎉 同步完成！本次新增 {new_tasks_count} 轮求职进展，最新 UID: {max_uid_in_batch}")
        logging.info("========================================")
        mail.logout()

if __name__ == "__main__":
    worker = CloudSyncWorker()
    worker.run()
