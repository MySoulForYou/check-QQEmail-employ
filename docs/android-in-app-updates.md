# Android 应用内更新与正式签名

OfferPilot 从 `v3.5.5` 起使用固定 Release 签名和递增版本号。只有签名一致且新包的 `versionCode` 更高，Android 才允许在保留应用数据的情况下覆盖安装。

## 首次配置签名

在安全的本地环境创建一次密钥。密钥和密码不要提交到 Git：

```bash
keytool -genkeypair -v \
  -keystore offerpilot-release.jks \
  -alias offerpilot \
  -keyalg RSA \
  -keysize 4096 \
  -validity 10000
```

将密钥转换为单行 Base64 文本：

```bash
base64 < offerpilot-release.jks | tr -d '\n'
```

在 GitHub 仓库的 `Settings → Secrets and variables → Actions` 中创建以下 Repository secrets：

- `ANDROID_KEYSTORE_BASE64`：上一步得到的 Base64 文本
- `ANDROID_KEYSTORE_PASSWORD`：密钥库密码
- `ANDROID_KEY_ALIAS`：默认填写 `offerpilot`
- `ANDROID_KEY_PASSWORD`：别名对应的密钥密码

必须离线备份 `offerpilot-release.jks` 和全部密码。密钥丢失后，已安装用户无法再覆盖升级到用新密钥签名的 APK。

## 发布流程

1. 将准备发布的功能分支合并到 `main`。
2. 创建符合 `v主版本.次版本.修订号` 格式的 Release，例如 `v3.5.5`。
3. Target 选择 `main` 并发布。
4. GitHub Actions 从标签计算 `versionName` 和递增的 `versionCode`。
5. 工作流构建并上传 `OfferPilot-v3.5.5-android.apk` 和应用读取的 `offerpilot-update.json`。
6. 用户在“我的 → 检查更新”中下载新版本，并在 Android 系统安装页确认更新。

## 从旧 Debug 包迁移

`v3.5.4` 及更早 APK 由临时 Debug 密钥签名，无法保证与新的正式签名一致。首次迁移到 `v3.5.5` 正式签名版时，需要卸载旧 APK 后重新安装。此后只要继续使用同一签名密钥并提高版本号，就能直接覆盖升级。
