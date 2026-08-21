import os
import sys
import json
import logging
import threading
from flask import Flask, send_from_directory, Response, request, jsonify

app = Flask(__name__, static_folder=None)

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_DIR = os.path.abspath(os.path.join(BASE_DIR, '..'))
WIDGET_DIR = os.path.join(BASE_DIR, 'widget')
ADMIN_DIR = os.path.join(BASE_DIR, 'admin')

# 窗口唤醒回调函数 (由 main.py 注册)
SHOW_WINDOW_CALLBACK = None

def set_show_window_callback(cb):
    global SHOW_WINDOW_CALLBACK
    SHOW_WINDOW_CALLBACK = cb

# 官方用户持久化配置目录
USER_CONFIG_DIR = os.path.expanduser('~/.config/recruitment_assistant')
USER_CONFIG_PATH = os.path.join(USER_CONFIG_DIR, 'config.json')

def get_config_candidates():
    return [
        USER_CONFIG_PATH,
        os.path.join(PROJECT_DIR, 'config.json'),
        os.path.join(BASE_DIR, 'config.json'),
        os.path.join(BASE_DIR, '..', 'config.json')
    ]

def load_client_config():
    """从优先链条中读取 Supabase 公开配置"""
    for path in get_config_candidates():
        if os.path.exists(path):
            try:
                with open(path, 'r', encoding='utf-8') as f:
                    cfg = json.load(f)
                    sb = cfg.get("supabase") or cfg.get("supabase_config", {})
                    url = sb.get("url", "").rstrip("/")
                    key = sb.get("publishable_key", "")
                    if url and key:
                        return {
                            "SUPABASE_URL": url,
                            "SUPABASE_ANON_KEY": key,
                            "ADMIN_URL": "http://127.0.0.1:5555/",
                            "CONFIG_SOURCE": path,
                            "IS_CONFIGURED": True
                        }
            except Exception as e:
                logging.error(f"❌ 读取配置文件失败 ({path}): {e}")

    return {
        "SUPABASE_URL": "",
        "SUPABASE_ANON_KEY": "",
        "ADMIN_URL": "http://127.0.0.1:5555/",
        "CONFIG_SOURCE": "none",
        "IS_CONFIGURED": False
    }

# --- 唤醒桌面挂件 API ---
@app.route('/api/show_widget', methods=['GET', 'POST'])
def show_widget_api():
    logging.info("🔔 收到挂件唤醒指令，正在重新显示桌面挂件...")
    if SHOW_WINDOW_CALLBACK:
        try:
            SHOW_WINDOW_CALLBACK()
            return jsonify({"success": True, "message": "桌面挂件已成功唤醒！"})
        except Exception as e:
            logging.error(f"❌ 唤醒挂件失败: {e}")
            return jsonify({"success": False, "message": str(e)}), 500
    return jsonify({"success": False, "message": "唤醒回调未注册"}), 503

# --- 动态前端配置注入 ---
@app.route('/config.js')
@app.route('/widget/config.js')
@app.route('/admin/config.js')
def serve_dynamic_config():
    cfg = load_client_config()
    js_content = f"// 动态由 server.py 注入\nwindow.APP_CONFIG = {json.dumps(cfg, indent=4)};\n"
    return Response(js_content, mimetype='application/javascript')

# --- 用户可视化配置保存 API ---
@app.route('/api/save_config', methods=['POST'])
def save_config_api():
    try:
        data = request.get_json() or {}
        url = str(data.get('url', '')).strip().rstrip('/')
        publishable_key = str(data.get('publishable_key', '')).strip()

        if not url or not publishable_key:
            return jsonify({"success": False, "message": "URL 和 Publishable Key 不能为空！"}), 400

        payload = {
            "supabase": {
                "url": url,
                "publishable_key": publishable_key
            }
        }

        os.makedirs(USER_CONFIG_DIR, exist_ok=True)
        with open(USER_CONFIG_PATH, 'w', encoding='utf-8') as f:
            json.dump(payload, f, indent=4, ensure_ascii=False)

        dev_config = os.path.join(PROJECT_DIR, 'config.json')
        if os.path.exists(PROJECT_DIR) and os.access(PROJECT_DIR, os.W_OK):
            try:
                with open(dev_config, 'w', encoding='utf-8') as f:
                    json.dump(payload, f, indent=4, ensure_ascii=False)
            except Exception:
                pass

        logging.info(f"✅ 用户配置已成功保存到: {USER_CONFIG_PATH}")
        return jsonify({
            "success": True, 
            "message": "配置已成功保存！",
            "config": {
                "SUPABASE_URL": url,
                "SUPABASE_ANON_KEY": publishable_key,
                "IS_CONFIGURED": True
            }
        })
    except Exception as e:
        logging.error(f"❌ 保存配置异常: {e}")
        return jsonify({"success": False, "message": f"保存配置失败: {str(e)}"}), 500

# --- 彻底停止所有服务 API ---
@app.route('/api/shutdown', methods=['POST'])
def shutdown_all_api():
    logging.info("🔴 接收到全量停服指令...")
    def delayed_kill():
        import time
        time.sleep(0.3)
        for lock in [os.path.join(PROJECT_DIR, 'app.lock'), os.path.join(BASE_DIR, 'app.lock')]:
            try:
                if os.path.exists(lock): os.remove(lock)
            except Exception: pass
        os._exit(0)
    threading.Thread(target=delayed_kill, daemon=True).start()
    return jsonify({"success": True, "message": "所有服务已停止"})

# --- 静态页面路由 ---
@app.route('/')
@app.route('/admin')
@app.route('/admin/')
def admin_index():
    return send_from_directory(ADMIN_DIR, 'index.html')

@app.route('/admin/<path:path>')
@app.route('/web_admin/<path:path>')
def admin_static(path):
    return send_from_directory(ADMIN_DIR, path)

@app.route('/widget')
@app.route('/widget/')
def widget_index():
    return send_from_directory(WIDGET_DIR, 'index.html')

@app.route('/widget/<path:path>')
def widget_static(path):
    return send_from_directory(WIDGET_DIR, path)

@app.route('/<path:path>')
def root_static(path):
    # 优先分发管理控制台资源，杜绝挂件样式污染主页面
    if os.path.exists(os.path.join(ADMIN_DIR, path)):
        return send_from_directory(ADMIN_DIR, path)
    if os.path.exists(os.path.join(WIDGET_DIR, path)):
        return send_from_directory(WIDGET_DIR, path)
    return "Not Found", 404

def start_server(port=5555):
    """启动轻量本地静态文件与配置服务器 (零后台开销)"""
    logging.getLogger('werkzeug').setLevel(logging.ERROR)
    app.run(host='127.0.0.1', port=port, debug=False, use_reloader=False)

if __name__ == '__main__':
    logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
    logging.info("🚀 启动 OfferPilot 独立 Web 服务: http://127.0.0.1:5555")
    start_server()
