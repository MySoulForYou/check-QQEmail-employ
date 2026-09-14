import { App } from '@capacitor/app';
import { Browser } from '@capacitor/browser';
import { Capacitor } from '@capacitor/core';

const RELEASE_API = 'https://api.github.com/repos/MySoulForYou/check-QQEmail-employ/releases/latest';
const UPDATE_MANIFEST_URL = 'https://github.com/MySoulForYou/check-QQEmail-employ/releases/latest/download/offerpilot-update.json';
const WEB_FALLBACK_VERSION = import.meta.env.VITE_APP_VERSION || '3.5.5';

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

  const manifestResponse = await fetch(UPDATE_MANIFEST_URL, { cache: 'no-store' });
  if (manifestResponse.ok) {
    const manifest = await manifestResponse.json();
    latestVersion = String(manifest.version || '').replace(/^v/i, '');
    releaseUrl = manifest.releaseUrl || '';
    apkUrl = manifest.apkUrl || '';
    publishedAt = manifest.publishedAt || '';
    title = manifest.title || '';
  } else {
    const response = await fetch(RELEASE_API, {
      headers: { Accept: 'application/vnd.github+json' },
      cache: 'no-store'
    });
    if (!response.ok) {
      const message = response.status === 403 ? 'GitHub 查询频率受限，请稍后重试' : `GitHub Release 查询失败（${response.status}）`;
      throw new Error(message);
    }
    const release = await response.json();
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
