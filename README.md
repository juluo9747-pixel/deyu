# 德语个人学习库

一个给个人使用的独立德语学习网页端：本地演示登录 + 分级词库 + 语法题库 + PDF/听力预览 + 百度网盘课程导入 + 德中翻译 + AI 德语作文批改。

## 当前定位

- **不开发 Supabase 登录/云端同步**：只保留本项目内置的本地演示登录页。
- **不硬编码任何密钥**：DeepSeek、百度翻译、百度网盘 token 全部从 Vercel Environment Variables / 本地环境变量读取。
- **可直接部署到 Vercel**：项目已提供 `api/index.js` 和 `vercel.json`，Vercel 会把所有请求转发给 `server.js`。
- **百度网盘在线预览**：网盘导入后，PDF/音频/视频资源会在「课件/听力」里通过后端代理预览；前端不暴露网盘凭证。

## 核心模块

- 本地演示登录：邮箱 + 密码注册/登录，数据按本地 userId 隔离。
- 分级德语词库 A1-B2：冠词、复数、释义、例句、语法说明。
- 语法题库：选择、简答、写作、口语、听力、造句。
- 百度网盘一键导入：读取目录、AI/规则自动分类、建课、绑定 materialId、生成习题、去重、异常修正。
- 课件 PDF / 听力专区：PDF iframe 预览，音频倍速播放，视频播放。
- 德中实时翻译：百度翻译/DeepL 后端中转，失败时本地规则兜底。
- AI 德语作文批改：DeepSeek 优先，失败时本地规则兜底。
- TTS 德语朗读：Azure/Microsoft TTS 可选；未配置时浏览器 de-DE 朗读兜底。

## 本地运行

```bash
cd deutsch-study-app
npm start
```

浏览器打开：<http://localhost:8787>

如果 8787 被占用：

```powershell
$env:PORT=8791
node server.js
```

## Vercel 必填环境变量

> 只在 Vercel Project Settings → Environment Variables 填，不能写进代码、README、前端 JS 或 GitHub。

```bash
DEEPSEEK_API_KEY=你的 DeepSeek Key
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_MODEL=deepseek-chat

BAIDU_TRANSLATE_APP_ID=你的百度翻译 APP ID
BAIDU_TRANSLATE_SECRET=你的百度翻译密钥

BAIDU_NETDISK_ACCESS_TOKEN=你的百度网盘 OAuth access_token
```

可选：

```bash
DEEPL_API_KEY=你的 DeepL Key
AZURE_TTS_KEY=你的 Azure Speech Key
AZURE_TTS_REGION=eastus
```

百度网盘的 AppID/AppKey/SecretKey/SignKey 只是申请 OAuth/token 时会用到；**真正读取个人网盘文件目录和预览文件，需要 `BAIDU_NETDISK_ACCESS_TOKEN`**。

## 百度网盘导入与预览

页面入口：顶部导航 → **网盘一键导入**。

支持两种方式：

1. Vercel 环境变量配置 `BAIDU_NETDISK_ACCESS_TOKEN` 后，页面只填目录，例如 `/Deutsch`。
2. 未拿到 token 时，粘贴离线目录 JSON 测试完整分类/建课流程。

离线 JSON 示例：

```json
[
  { "name": "A1 Goethe 听力 Modelltest 01.mp3", "path": "/Deutsch/A1/Goethe/audio01.mp3", "size": 12345, "md5": "a1" },
  { "name": "A1 Menschen Kursbuch.pdf", "path": "/Deutsch/A1/Menschen.pdf", "size": 45678, "md5": "b1" },
  { "name": "B1 语法网课 Lektion 03.mp4", "path": "/Deutsch/B1/video03.mp4", "size": 99999, "md5": "c1" }
]
```

导入后进入 **课件/听力**：

- 本地上传文件直接预览 `/uploads/...`。
- 网盘文件通过 `/api/netdisk/file?materialId=...` 后端代理预览。
- PDF 用 iframe，音频用 audio，视频用 video。

## API 说明

- `POST /api/auth/register`：本地注册演示账号。
- `POST /api/auth/login`：本地登录。
- `POST /api/translate`：翻译，读取环境变量中的翻译密钥。
- `POST /api/writing-correct`：AI 批改，读取 `DEEPSEEK_API_KEY`。
- `POST /api/netdisk/preview`：读取/预览网盘目录分类结果。
- `POST /api/netdisk/import`：导入网盘目录、建课、生成练习。
- `GET /api/netdisk/file?materialId=...`：后端代理网盘文件用于 PDF/音频/视频预览。
- `GET /api/resources`：资源列表，返回可预览 `viewUrl`。

## Vercel 部署

完整步骤见 [`DEPLOY.md`](./DEPLOY.md)。

重点：

1. GitHub 上传本项目。
2. Vercel 导入仓库。
3. Framework Preset 选 **Other**。
4. Root Directory 按仓库结构选择；如果仓库根目录就是本项目，留空即可。
5. Environment Variables 填上方变量。
6. Deploy / Redeploy。
7. 打开 Vercel 域名测试登录、翻译、AI 批改、网盘导入、PDF/音频预览。

## 安全提醒

如果密钥曾经出现在聊天、截图、群聊或日志里，正式部署前建议去对应控制台重置/轮换。仓库里不能出现真实 key；本项目也不会把 key 返回给前端。
