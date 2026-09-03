/**
 * OfferPilot Android - 本地临期提醒通知模块 (Local Notifications)
 * 基于 @capacitor/local-notifications，离线安全调度，不依赖外部三方推送服务
 */
import { LocalNotifications } from '@capacitor/local-notifications';

const CHANNEL_ID = 'offerpilot_stages_channel';

// 简易稳定字符串 Hash 转 31 位正整数 (作为 Android Notification ID)
function hashStringToId(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

export class NotificationService {
  constructor() {
    this.isNative = false;
    this.hasPermission = false;
  }

  // 初始化通知系统与渠道
  async init() {
    try {
      this.isNative = !!(window.Capacitor && window.Capacitor.isNativePlatform());
      if (!this.isNative) return false;

      // 检查权限
      const perm = await LocalNotifications.checkPermissions();
      this.hasPermission = perm.display === 'granted';

      // Android 8.0+ 创建高优先级提醒渠道
      await LocalNotifications.createChannel({
        id: CHANNEL_ID,
        name: '求职日程重要提醒',
        description: '测评、笔试、面试开始与截止时间的临期推送通知',
        importance: 4, // HIGH
        visibility: 1, // PUBLIC
        vibration: true,
        sound: 'beep.wav',
        lights: true,
        lightColor: '#6366F1'
      });

      return this.hasPermission;
    } catch (err) {
      console.warn('[NotificationService] Init error:', err);
      return false;
    }
  }

  // 请求通知权限
  async requestPermission() {
    try {
      if (!this.isNative) return false;
      const result = await LocalNotifications.requestPermissions();
      this.hasPermission = result.display === 'granted';
      return this.hasPermission;
    } catch (err) {
      console.warn('[NotificationService] Request permission error:', err);
      return false;
    }
  }

  // 检查是否开启本地通知设置
  isEnabled() {
    return localStorage.getItem('offerpilot_notifications_enabled') !== 'false';
  }

  // 切换通知开关
  async setEnabled(enabled, stages = [], applications = [], parseDateFn, getScheduleTypeFn) {
    localStorage.setItem('offerpilot_notifications_enabled', enabled ? 'true' : 'false');
    if (enabled) {
      if (!this.hasPermission) {
        await this.requestPermission();
      }
      if (stages.length > 0 && parseDateFn) {
        await this.syncScheduledStages(stages, applications, parseDateFn, getScheduleTypeFn);
      }
    } else {
      await this.cancelAllNotifications();
    }
  }

  // 取消所有待触发通知
  async cancelAllNotifications() {
    try {
      if (!this.isNative) return;
      const pending = await LocalNotifications.getPending();
      if (pending && pending.notifications && pending.notifications.length > 0) {
        await LocalNotifications.cancel({ notifications: pending.notifications });
      }
    } catch (err) {
      console.warn('[NotificationService] Cancel notifications error:', err);
    }
  }

  /**
   * 同步未来待办环节通知调度
   * 为未来 7 天内即将开始/截止的环节注册提前 1 小时与提前 15 分钟的本地提醒
   */
  async syncScheduledStages(stages, applications, parseDateFn, getScheduleTypeFn) {
    if (!this.isNative || !this.isEnabled()) return;

    try {
      // 1. 确保有权限
      if (!this.hasPermission) {
        const perm = await LocalNotifications.checkPermissions();
        this.hasPermission = perm.display === 'granted';
        if (!this.hasPermission) return;
      }

      // 2. 清除之前已注册但未触发的通知
      await this.cancelAllNotifications();

      const now = new Date();
      const horizon = new Date(now.getTime() + 7 * 86400000);
      const notificationsToSchedule = [];

      // 3. 筛选 scheduled 环节
      const scheduledStages = stages.filter(s => s.stage_status === 'scheduled');

      for (const stage of scheduledStages) {
        const targetDate = parseDateFn ? parseDateFn(stage.schedule_time) : null;
        if (!targetDate) continue;

        // 仅调度当前时间之后、7天之内的任务
        if (targetDate.getTime() <= now.getTime() || targetDate.getTime() > horizon.getTime()) {
          continue;
        }

        const app = applications.find(a => a.id === stage.application_id);
        const company = app ? app.company : '企业';
        const position = app ? app.position : '';
        const stageName = stage.stage_name || '求职环节';
        const scheduleType = getScheduleTypeFn ? getScheduleTypeFn(stage) : 'deadline';
        const typeVerb = scheduleType === 'deadline' ? '截止' : '开始';

        const timeStr = `${targetDate.getHours().toString().padStart(2, '0')}:${targetDate.getMinutes().toString().padStart(2, '0')}`;

        // 提醒 1：提前 1 小时提醒 (若距离现在大于 1 小时)
        const time1h = new Date(targetDate.getTime() - 60 * 60 * 1000);
        if (time1h.getTime() > now.getTime()) {
          notificationsToSchedule.push({
            id: hashStringToId(`${stage.id}_1h`),
            title: `⏰ 1小时后${typeVerb}提醒 · ${company}`,
            body: `${company} ${position ? `(${position}) ` : ''}的【${stageName}】将于 ${timeStr} ${typeVerb}，请尽快做好准备！`,
            channelId: CHANNEL_ID,
            schedule: { at: time1h },
            smallIcon: 'ic_stat_icon_config_sample',
            extra: { stageId: stage.id, appId: stage.application_id }
          });
        }

        // 提醒 2：提前 15 分钟紧要提醒 (若距离现在大于 15 分钟)
        const time15m = new Date(targetDate.getTime() - 15 * 60 * 1000);
        if (time15m.getTime() > now.getTime()) {
          notificationsToSchedule.push({
            id: hashStringToId(`${stage.id}_15m`),
            title: `🔥 15分钟后${typeVerb} · ${company}`,
            body: `【${stageName}】即将于 ${timeStr} ${typeVerb}！请检查网络、设备及会议凭据。`,
            channelId: CHANNEL_ID,
            schedule: { at: time15m },
            smallIcon: 'ic_stat_icon_config_sample',
            extra: { stageId: stage.id, appId: stage.application_id }
          });
        }
      }

      // 4. 批量调度
      if (notificationsToSchedule.length > 0) {
        // LocalNotifications 每次限制适量调度
        await LocalNotifications.schedule({
          notifications: notificationsToSchedule.slice(0, 30)
        });
      }
    } catch (err) {
      console.warn('[NotificationService] Schedule stages error:', err);
    }
  }
}

export const notificationService = new NotificationService();
