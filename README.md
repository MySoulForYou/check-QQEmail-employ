<div align="center">

# OfferPilot · 求职全景智能助手

**云原生 · 高颜值 · 多端实时同步的个人求职全流程自动化管理体系**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg?style=flat-square)](LICENSE)
[![Python Version](https://img.shields.io/badge/Python-3.9%2B-3776AB?style=flat-square&logo=python&logoColor=white)](https://www.python.org/)
[![Database](https://img.shields.io/badge/Database-Supabase%20PostgreSQL-3ECF8E?style=flat-square&logo=supabase&logoColor=white)](https://supabase.com/)
[![AI Engine](https://img.shields.io/badge/AI%20Engine-DeepSeek%20V3-4D6BFE?style=flat-square)](https://www.deepseek.com/)
[![Platform](https://img.shields.io/badge/Platform-macOS%20Desktop%20%7C%20Web-000000?style=flat-square&logo=apple&logoColor=white)]()
[![GitHub Actions](https://img.shields.io/badge/CI%2FCD-7x24h%20Cloud%20Sync-2088FF?style=flat-square&logo=github-actions&logoColor=white)](.github/workflows/sync.yml)

<br/>

![OfferPilot 全景产品演示图](docs/assets/offerpilot_product_showcase.jpg)

<br/>

[🌟 核心特性](#-核心特性) • [📐 系统架构全景](#-系统架构全景) • [🛠️ 新手部署全攻略 (必读)](#-从零到一新手极速部署指南-fork-零代码模式) • [🎮 客户端交互使用指引](#-客户端日常交互使用指引) • [🔄 状态生命周期与回退](#-任务状态全生命周期流转) • [📂 工程目录结构](#-工程目录结构) • [🔒 安全隔离](#-开源安全与机密隔离)

</div>

---

## 📖 项目简介

**OfferPilot (求职全景智能助手 V3.2)** 专为求职季打造，自动化聚合分散在各大邮件中的笔试与面试通知，实现 **“云端 7x24h 静默抓取 + Mac 桌面透明挂件 + Web 全景看板”** 的无缝协同闭环。

---

## 🌟 核心特性

<table width="100%">
  <tr>
    <td width="50%" valign="top">
      <h4>🗄️ 主子表求职架构</h4>
      <p>企业、部门与岗位物理隔离，笔试面试各轮次按时间线独立归档，多投不串线。</p>
    </td>
    <td width="50%" valign="top">
      <h4>🔝 最新进展置顶</h4>
      <p>抽屉首屏直击当前最新待办，会议凭据一键复制与倒计时提醒，历史环节按序沉淀。</p>
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <h4>🔄 状态闭环与无损回退</h4>
      <p>待办环节一键标为已参加；手误时支持一键撤销并安全回滚至上一轮进度。</p>
    </td>
    <td width="50%" valign="top">
      <h4>💻 零常驻云抓取 + 桌面挂件</h4>
      <p>GitHub Actions 云端静默提取，macOS 毛玻璃透明挂件毫秒级同步日程。</p>
    </td>
  </tr>
</table>

---

## 📐 系统架构全景

![OfferPilot 云原生架构全景流转图](docs/assets/recruitment-assistant-v3-flow.svg)

---

## 🛠️ 从零到一新手极速部署指南 (Fork 零代码模式)

> 💡 **无需本地配置复杂的 Python 开发环境，无需手动敲 Git 命令上传代码！**  
> 只要在网页上点击 **【Fork】一键派生**，即可立刻激活专属于您个人的 7x24h 云端抓取机器人！

![新手极速部署流转图](docs/assets/quickstart-deployment-flow.svg)

---

### 🌟 阶段一：准备三大免费云端平台密钥 (约 2 分钟)

#### 1. 📧 获取个人邮箱 IMAP 授权码 (以 QQ 邮箱为例)
* 登录网页版 QQ 邮箱 ➡️ 点击上方 **【设置】** ➡️ **【账户】**；
* 向下滚动找到 **POP3/IMAP/SMTP/Exchange/CardDAV/CalDAV服务**；
* 开启 **`POP3/SMTP服务`** 与 **`IMAP/SMTP服务`**；
* 点击 **【生成授权码】**，按提示发送短信即可获取一段 **16 位字母授权码**（保存好备用）。

#### 2. 🤖 获取 DeepSeek AI API Key
* 登录 [DeepSeek 开放平台](https://platform.deepseek.com/) ➡️ 进入 **【API Keys】**；
* 点击 **【创建 API key】**，复制生成的以 `sk-` 开头的密钥字符串（新用户赠送免费 Token，解析几千封邮件仅需几毛钱）。

#### 3. ⚡️ 创建免费 Supabase 云数据库 (1分钟搞定)
* 登录 [Supabase 官网](https://supabase.com/)，点击 **【New Project】** 创建一个免费数据库项目；
* 进入项目左侧导航栏的 **【SQL Editor】**，粘贴以下一键初始化建表代码并点击 **【Run】**：

```sql
-- 1. 清理旧表 (全新部署时执行)
DROP TABLE IF EXISTS tasks CASCADE;
DROP TABLE IF EXISTS application_stages CASCADE;
DROP TABLE IF EXISTS applications CASCADE;
DROP TABLE IF EXISTS sync_state CASCADE;

-- 2. 创建求职投递单主表 (Applications)
CREATE TABLE applications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company TEXT NOT NULL,
    department TEXT DEFAULT '',
    position TEXT NOT NULL,
    recruitment_season TEXT DEFAULT '2027届秋招',
    current_stage_name TEXT DEFAULT '网申提交',
    overall_status TEXT DEFAULT 'active', -- active(推进中) | offered(已录用) | failed(已结束) | archived(已归档)
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. 创建环节流转明细子表 (Application Stages)
CREATE TABLE application_stages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    application_id UUID NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
    seq INT NOT NULL DEFAULT 1, -- 环节时序序号 (1, 2, 3...)
    stage_name TEXT NOT NULL,
    stage_status TEXT DEFAULT 'pending', -- pending(待审) | scheduled(待办) | awaiting_result(待结果) | passed(通过) | failed(未通过) | ignored(忽略)
    schedule_time TEXT DEFAULT '待定',
    meeting_info TEXT DEFAULT '',
    next_expectation TEXT DEFAULT '',
    raw_email_id TEXT DEFAULT '', -- 邮件 UID 幂等防重
    raw_subject TEXT DEFAULT '',
    notes TEXT DEFAULT '',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. 创建增量同步书签表 (初始化从最近 10 天开始扫描)
CREATE TABLE sync_state (
    key TEXT PRIMARY KEY,
    last_uid BIGINT DEFAULT 0,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
INSERT INTO sync_state (key, last_uid) VALUES ('email_sync', 0);

-- 5. 创建高性能索引
CREATE INDEX idx_stages_app_seq ON application_stages(application_id, seq DESC);
CREATE INDEX idx_stages_status ON application_stages(stage_status);
CREATE INDEX idx_app_company ON applications(company, department, position);

-- 6. 开启 WebSocket Realtime 实时全端推流
ALTER PUBLICATION supabase_realtime ADD TABLE applications;
ALTER PUBLICATION supabase_realtime ADD TABLE application_stages;

-- 7. 开启 RLS 行级安全策略 (保障公网公开访问安全)
ALTER TABLE applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE application_stages ENABLE ROW LEVEL SECURITY;
ALTER TABLE sync_state ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow public all applications" ON applications FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow public all application_stages" ON application_stages FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow public read sync_state" ON sync_state FOR ALL USING (true) WITH CHECK (true);
```

* 进入项目 **Project Settings ➡️ API**，复制以下 3 个核心凭证：
  * **Project URL**（如 `https://xxxx.supabase.co`）
  * **`anon` `public` key**（客户端公开公钥，如 `sb_publishable_...`）
  * **`service_role` `secret` key**（云端超级写入私钥，如 `sb_secret_...`）

---

### ☁️ 阶段二：在 GitHub 网页一键 Fork 并激活云端机器人 (约 2 分钟)

```
[ 本项目 GitHub 主页 ]
         ⬇️ 点击右上角【Fork】按钮 (一键派生到个人账号)
[ 属于您自己的个人仓库: 你的用户名/OfferPilot ]
         ⬇️ 配置 5 个 Actions Secrets 密码
[ 🎉 您的专属云端大脑开始 7x24h 自动工作！]
```

1. **一键 Fork 仓库**：
   * 打开本项目 GitHub 页面，点击右上角的 **【Fork】** 按钮，按默认设置点击 **【Create fork】**；
2. **填入 5 个机密密钥 (Secrets)**：
   * 在您刚刚 Fork 出来的个人仓库中，点击顶部 **【Settings】** ➡️ 左侧菜单 **【Secrets and variables】** ➡️ **【Actions】**；
   * 点击绿色的 **【New repository secret】**，依次添加以下 5 个机密：

| 机密名称 (Secret Name) | 应该填入的值 (Secret Value) | 来源说明 |
| :--- | :--- | :--- |
| **`EMAIL_USER`** | 您的邮箱地址（如 `12345678@qq.com`） | 个人邮箱账号 |
| **`EMAIL_AUTH_CODE`** | 刚才生成的 16 位邮箱授权码 | 邮箱 IMAP 授权码 |
| **`DEEPSEEK_API_KEY`** | 以 `sk-` 开头的 DeepSeek Key | AI 大模型密钥 |
| **`SUPABASE_URL`** | Supabase 项目 Project URL | 数据库 HTTPS 地址 |
| **`SUPABASE_SERVICE_ROLE_KEY`** | Supabase 的 `service_role` secret key | 数据库超级写私钥 |

> [!TIP]
> **首次测试云端抓取**：配置完成后，点击仓库顶部的 **【Actions】** 标签 ➡️ 点击左侧的 **Recruitment Email Sync** ➡️ 点击右侧 **【Run workflow】** 即可手动立即触发一次云端抓取。通常 8 秒内即可在 Supabase 看到新邮件入库！

---

### 💻 阶段三：下载 Mac 客户端一键开箱即用 (约 1 分钟)

#### 1. 下载并安装 Mac App
* 在本项目的 **[Releases 发行版页面](../../releases)** 下载最新的 **`OfferPilot-v3.2.0-macOS.dmg`** 安装包；
* 双击打开 DMG，将 **`OfferPilot.app`** 拖拽到“应用程序 (Applications)”文件夹。

#### 2. 可视化配置向导 (仅需一次)
* 首次打开软件，界面会自动浮现优雅的 **毛玻璃设置向导**（也可随时在挂件右上角点击 ⚙️ 设置，或在网页端 **[http://127.0.0.1:5555/](http://127.0.0.1:5555/)** 配置）；
* 直接粘贴您的 **Supabase Project URL** 与 **`anon` 公开公钥**，点击【⚡️ 保存并立即连接】即可！
* 配置自动持久化保存到 `~/.config/recruitment_assistant/config.json`，软件升级覆盖亦不丢配置。

---

## 🎮 客户端日常交互使用指引

OfferPilot 针对 macOS 系统深度调优，带来了极其自然与丝滑的日常操作体验：

### 🔄 1. 双击开关机制（极简 Toggle 控制）
* **双击打开**：未运行时，双击 `OfferPilot.app`（或双击开关应用），桌面右上角即刻浮现毛玻璃挂件，本地 Web 管理服务同步拉起，并发送系统通知：`🟢 OfferPilot：已在桌面启动`；
* **再双击关闭**：在运行状态下，再次双击 `OfferPilot.app`（或开关应用），系统将**毫秒级彻底退出全部后台 Python 进程与 Web 服务**，并发送通知：`🔴 OfferPilot：已完全关闭`。

### 🖥️ 2. 挂件操作与分层常驻
* **⚙️ 设置数据库**：点击挂件右上角齿轮，可随时呼出配置窗口修改 Supabase 凭据；
* **📊 全景看板**：点击右上角看板图标，直接在浏览器中打开全景控制台（[http://127.0.0.1:5555/](http://127.0.0.1:5555/)）；
* **✕ 仅收起挂件**：点击挂件右上角 `✕`，仅收起/隐藏桌面挂件，**后台 Web 管理大厅保持常驻可用**；
* **✓ 标记完成**：点击待办卡片右侧的勾选按钮，环节状态流转为等待结果并折叠。

---

## 🔄 任务状态全生命周期流转

![任务状态生命周期流转图](docs/assets/task-lifecycle-flow.svg)

---

## 📂 工程目录结构

```text
拉取招聘信息/
├── ☁️ cloud/                      # 【云端抓取服务】
│   └── worker.py                 # 云端邮件提取与 DeepSeek AI 解析引擎 (由 GitHub Actions 调用)
│
├── 💻 client/                     # 【客户端与本地服务】
│   ├── main.py                   # Mac 原生透明桌面挂件宿主 (PyWebView + Cocoa 层级调优)
│   ├── server.py                 # 本地轻量静态 Web 服务 (统一动态读取/注入用户配置)
│   ├── widget/                   # 桌面透明挂件前端 (直连云端 + Realtime 监听 + 首次启动向导)
│   │   ├── index.html
│   │   ├── style.css
│   │   ├── app.js
│   │   └── supabase.js           # 零依赖自研轻量 Supabase 通信 SDK
│   └── admin/                    # 全景管理控制台与审核大厅前端 (http://127.0.0.1:5555/)
│       ├── index.html
│       ├── style.css
│       ├── app.js
│       └── supabase.js
│
├── 🛠️ scripts/                    # 【自动化与运维脚本】
│   ├── toggle.sh                 # 桌面挂件一键启动 / 关闭脚本
│   ├── start_web.sh              # 纯 Web 独立控制台启动脚本
│   └── build_mac_app.sh          # 独立 OfferPilot.app 与 .dmg 安装镜像自动化构建打包脚本
│
├── 📖 docs/                       # 【设计文档与设计切图】
│   ├── architecture_plan.md      # 跨端云原生架构设计实施方案
│   └── assets/                   # 高清产品演示图 (JPG)、矢量架构图 (SVG) 与 Apple AppIcon.icns
│
├── .github/workflows/
│   └── sync.yml                  # ☁️ GitHub Actions 自动化定时工作流
├── ⚡️ 招聘助手开关.app             # 💻 macOS 桌面快捷双击开关程序
├── ⚙️ config.example.json         # 📄 公开配置样例模板
├── 📦 requirements.txt           # 📦 客户端极简 Python 依赖 (仅 pywebview, flask, pyobjc)
├── 🙈 .gitignore                 # 🔒 Git 忽略规则 (严格隔离私密 config.json)
└── 📄 README.md                  # 📖 项目总览与使用说明
```

---

## 🔒 开源安全与机密隔离

本项目严格遵循开源社区最高安全规范：

1. **凭证物理隔离**：
   * 邮箱授权码与 DeepSeek API Key **仅保存在 GitHub Secrets** 中，绝对不落盘、不提交 Git。
2. **本地配置受忽略保护**：
   * 本地真实的 `config.json` 已写入 [`.gitignore`](.gitignore)，开源上传时永远不会包含个人数据库与连接信息。
3. **数据库行级安全 (RLS)**：
   * 客户端公开公钥仅允许安全地读取任务和更新状态，彻底杜绝物理删库、删表或篡改越权。

---

## 🛠️ 技术栈清单

* **云端抓取与 AI**：GitHub Actions, Python 3.11, IMAPlib, BeautifulSoup4, DeepSeek API (OpenAI SDK)
* **数据库与实时中枢**：Supabase (PostgreSQL), PostgREST Gateway, Phoenix Channel WebSocket
* **桌面端宿主**：Python 3, PyWebView, PyObjC (Cocoa / AppKit / Quartz)
* **前端交互界面**：Vanilla HTML5, Modern CSS3 (Glassmorphism), ES6+ JavaScript

---

## 📜 开源许可证

本项目采用 [MIT License](LICENSE) 许可证，欢迎自由修改、分发与二次开发。
