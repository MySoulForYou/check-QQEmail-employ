import re
import unicodedata
from urllib.parse import urlparse


def _normalize_text(value):
    """统一 AI 返回文本中的全半角字符与多余空白。"""
    text = unicodedata.normalize("NFKC", str(value or ""))
    return re.sub(r"\s+", " ", text).strip()


def normalize_extracted_position(value):
    """阻止招聘专业、招聘项目或整段描述被误写为岗位名称。"""
    position = _normalize_text(value)
    if not position:
        return "未指定岗位"

    major_markers = ("相关专业", "招聘专业", "专业不限", "专业类别", "专业要求")
    major_names = (
        "微电子", "集成电路", "计算机", "电子信息", "电气工程",
        "自动化", "仪器科学", "机械工程", "机电", "通信工程",
    )
    looks_like_major_scope = any(marker in position for marker in major_markers)
    enumerates_many_majors = sum(name in position for name in major_names) >= 3

    if looks_like_major_scope or enumerates_many_majors:
        return "未指定岗位"
    return position


def normalize_extracted_stage_name(value):
    """将 AI 合并输出的多个环节收敛为当前单一客观环节。"""
    stage_name = _normalize_text(value) or "求职通知"
    if "笔试" in stage_name:
        return "在线笔试"
    if "宣讲" in stage_name:
        return "宣讲会"
    return stage_name


def normalize_extracted_schedule_type(value, stage_name="", schedule_time=""):
    """收敛时间语义：截止、开始或待定。旧模型未返回时按环节做保守推断。"""
    raw_type = (_normalize_text(value) or "").lower()
    raw_time = _normalize_text(schedule_time) or ""
    name = _normalize_text(stage_name) or ""
    if not raw_time or raw_time in {"待定", "未知", "无"}:
        return "unknown"
    if raw_type in {"start", "deadline", "unknown"}:
        return raw_type
    if any(keyword in raw_type for keyword in ("截止", "之前", "前完成", "有效期")):
        return "deadline"
    if any(keyword in raw_type for keyword in ("开始", "开考", "面试时间", "宣讲时间")):
        return "start"
    if any(keyword in name for keyword in ("面试", "一面", "二面", "终面", "HR面", "宣讲")):
        return "start"
    if any(keyword in name for keyword in ("测评", "材料", "提交", "网申", "笔试")):
        return "deadline"
    return "unknown"


def normalize_company_website(value):
    """仅允许保存 HTTP(S) 公司官网，过滤会议号、密码等非网址内容。"""
    website = _normalize_text(value)
    if not website:
        return ""
    if not re.match(r"^https?://", website, flags=re.IGNORECASE):
        website = f"https://{website}"
    parsed = urlparse(website)
    if parsed.scheme not in ("http", "https") or not parsed.netloc or "." not in parsed.netloc:
        return ""
    return website
