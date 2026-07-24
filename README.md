# 德语学习库 Vercel 简洁版

这是为 Vercel 重新写的干净版本：没有 vercel.json，没有 Supabase，没有云同步。上传 GitHub 后，Vercel 可直接导入部署。

## 文件结构

- `index.html`：网页入口
- `styles.css`：移动端样式
- `app.js`：前端逻辑，本地演示登录/打卡/资源管理
- `api/translate.js`：百度翻译环境变量中转
- `api/correct.js`：DeepSeek 批改环境变量中转
- `api/netdisk-list.js`：百度网盘目录读取
- `api/netdisk-file.js`：百度网盘 PDF/音频/视频代理预览

## Vercel 环境变量

必填/推荐：

```text
DEEPSEEK_API_KEY
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_MODEL=deepseek-chat
BAIDU_TRANSLATE_APP_ID
BAIDU_TRANSLATE_SECRET
BAIDU_NETDISK_ACCESS_TOKEN
```

注意：百度网盘 AppID/AppKey/Secret/SignKey 不能直接读取个人网盘文件。在线预览个人网盘里的 PDF/音频，需要 OAuth 得到的 `BAIDU_NETDISK_ACCESS_TOKEN`。

## 部署

1. 上传全部文件到 GitHub 仓库根目录。
2. Vercel → Add New → Project。
3. 选择仓库。
4. Framework Preset 选 Other。
5. Build Command / Output Directory 留空。
6. 填环境变量。
7. Deploy。

如果之前 Vercel 报 `Invalid vercel.json file provided`，请确认仓库根目录已经没有 `vercel.json`。
