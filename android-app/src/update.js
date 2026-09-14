import { App } from '@capacitor/app';
import { Browser } from '@capacitor/browser';
import { Capacitor, CapacitorHttp } from '@capacitor/core';

const RELEASE_API = 'https://api.github.com/repos/MySoulForYou/check-QQEmail-employ/releases/latest';
const UPDATE_MANIFEST_URL = 'https://github.com/MySoulForYou/check-QQEmail-employ/releases/latest/download/offerpilot-update.json';
const WEB_FALLBACK_VERSION = import.meta.env.VITE_APP_VERSION || '3.5.6';

async function requestJson(url, headers = {}) {
  if (Capacitor.isNativePlatform()) {
    const response = await CapacitorHttp.get({
      url,
      headers,
      connectTimeout: 10000,
      readTimeout: 10000
    });
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`HTTP ${response.status}`);
    }
    return typeof response.data === 'string' ? JSON.parse(response.data) : response.data;
  }

  const response = await fetch(url, { headers, cache: 'no-store' });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

export function normalizeVersion(value) {
  return String(value || '')
    .trim()
    .replace(/^v/i, '')
    .split('-')[0]
    .split('.')
    .map(part => Number.parseInt(part, 10) || 0);
}

export function compareVersions(left, right) {
  const a = normalizeVersion(left);
  const b = normalizeVersion(right);
  const length = Math.max(a.length, b.length, 3);
  for (let index = 0; index < length; index += 1) {
    const delta = (a[index] || 0) - (b[index] || 0);
    if (delta !== 0) return delta > 0 ? 1 : -1;
  }
  return 0;
}

async function getCurrentVersion() {
  if (!Capacitor.isNativePlatform()) return WEB_FALLBACK_VERSION;
  try {
    const info = await App.getInfo();
    return info.version || WEB_FALLBACK_VERSION;
  } catch (_error) {
    return WEB_FALLBACK_VERSION;
  }
}

async function check() {
  const currentVersion = await getCurrentVersion();
  let latestVersion = '';
  let releaseUrl = '';
  let apkUrl = '';
  let publishedAt = '';
  let title = '';

  try {
    const manifest = await requestJson(UPDATE_MANIFEST_URL);
    latestVersion = String(manifest.version || '').replace(/^v/i, '');
    releaseUrl = manifest.releaseUrl || '';
    apkUrl = manifest.apkUrl || '';
    publishedAt = manifest.publishedAt || '';
    title = manifest.title || '';
  } catch (_manifestError) {
    let release;
    try {
      release = await requestJson(RELEASE_API, { Accept: 'application/vnd.github+json' });
    } catch (error) {
      const message = /HTTP 403/.test(error.message)
        ? 'GitHub 查询频率受限，请稍后重试'
        : '无法连接 GitHub，请检查手机网络后重试';
      throw new Error(message);
    }
    latestVersion = String(release.tag_name || '').replace(/^v/i, '');
    const assets = Array.isArray(release.assets) ? release.assets : [];
    const apkAsset = assets.find(asset => /OfferPilot.*android.*\.apk$/i.test(asset.name || ''))
      || assets.find(asset => /\.apk$/i.test(asset.name || ''));
    releaseUrl = release.html_url || '';
    apkUrl = apkAsset?.browser_download_url || '';
    publishedAt = release.published_at || '';
    title = release.name || '';
  }

  if (!latestVersion) throw new Error('最新 Release 缺少版本标签');

  return {
    currentVersion,
    latestVersion,
    hasUpdate: compareVersions(latestVersion, currentVersion) > 0,
    releaseUrl,
    apkUrl,
    publishedAt,
    title: title || `OfferPilot v${latestVersion}`
  };
}

async function openDownload(update) {
  const targetUrl = update?.apkUrl || update?.releaseUrl;
  if (!targetUrl) throw new Error('Release 中暂未找到 Android 安装包');
  if (Capacitor.isNativePlatform()) {
    await Browser.open({ url: targetUrl, presentationStyle: 'popover' });
    return;
  }
  window.open(targetUrl, '_blank', 'noopener,noreferrer');
}

export const updateService = {
  getCurrentVersion,
  check,
  openDownload
};
