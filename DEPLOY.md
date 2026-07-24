# Vercel 部署完整步骤

这份教程按“小白步骤”写，目标是：打开一个 Vercel 网址，就能使用德语学习网页端。

## 0. 先确认一件事

本项目不再接 Supabase，不做云端账号同步。登录页只是本网站内置的本地演示登录，用来进入学习库和隔离数据。

## 1. GitHub 仓库

仓库地址：

```text
https://github.com/juluo9747-pixel/deyu
```

代码上传完成后，Vercel 就从这个仓库读取代码。

## 2. 打开 Vercel 导入项目

1. 打开 <https://vercel.com>
2. 登录你的 Vercel 账号。
3. 点击右上角 **Add New**。
4. 选择 **Project**。
5. 找到 GitHub 仓库 `deyu`。
6. 点击 **Import**。

## 3. Vercel 项目配置

在导入页面：

- **Framework Preset**：选 `Other`。
- **Build Command**：留空。
- **Output Directory**：留空。
- **Install Command**：可留空或使用 `npm install`。
- **Root Directory**：
  - 如果仓库根目录就是 `package.json / server.js / public`，这里留空。
  - 如果仓库里外面还有一层 `deutsch-study-app` 文件夹，就点 Root Directory 选择 `deutsch-study-app`。

## 4. 添加 Environment Variables

进入导入页的 **Environment Variables**，逐项添加。不要把真实密钥写进代码。

必填：

```text
DEEPSEEK_API_KEY
DEEPSEEK_BASE_URL
DEEPSEEK_MODEL
BAIDU_TRANSLATE_APP_ID
BAIDU_TRANSLATE_SECRET
BAIDU_NETDISK_ACCESS_TOKEN
```

推荐值：

```text
DEEPSEEK_BASE_URL = https://api.deepseek.com
DEEPSEEK_MODEL = deepseek-chat
```

其余值填你控制台里对应的真实值。

> 注意：百度网盘 AppID/AppKey/SecretKey/SignKey 不能直接替代 `BAIDU_NETDISK_ACCESS_TOKEN`。要在线读取个人网盘目录和预览文件，必须有 OAuth 得到的 access_token。

可选：

```text
DEEPL_API_KEY
AZURE_TTS_KEY
AZURE_TTS_REGION
```

## 5. Deploy

1. 环境变量填完后，点击 **Deploy**。
2. 等待 Vercel 构建完成。
3. 看到 `Congratulations!` 后，点击 Vercel 给你的网址。

如果你是先 Deploy 后才填环境变量：

1. 进入 Vercel 项目。
2. 点 **Deployments**。
3. 找到最新部署右侧三个点。
4. 点 **Redeploy**。
5. 勾选使用最新环境变量后重新部署。

## 6. 部署后测试

打开 Vercel 网址后按顺序测试：

### A. 登录

1. 页面出现「登录德语学习库」。
2. 输入任意邮箱和密码。
3. 第一次点「注册并登录」。
4. 后续用同一邮箱密码点「登录」。

### B. 翻译

1. 进入「实时翻译」。
2. 输入：

```text
Ich lerne Deutsch.
```

3. 点「翻译」。
4. 正常应返回中文翻译；如果密钥不可用，会显示本地兜底结果。

### C. AI 批改

1. 进入「工具集」。
2. 在 AI 德语作文批改里输入：

```text
Ich habe ein Termin und ich gehe zu der Arzt.
```

3. 点「AI批改作文/句子」。
4. 正常会返回 DeepSeek 批改；如果 DeepSeek 不可用，会返回本地规则兜底。

### D. 百度网盘导入

1. 进入「网盘一键导入」。
2. 如果已经配置 `BAIDU_NETDISK_ACCESS_TOKEN`：
   - Access Token 输入框可以留空。
   - 网盘目录填你的课程目录，例如 `/Deutsch`。
   - 点「预览AI分类」。
3. 如果还没有 token：
   - 粘贴 README 里的离线目录 JSON。
   - 点「预览AI分类」。
   - 再点「一键导入并建课」。

### E. PDF/听力预览

1. 导入网盘资源后进入「课件/听力」。
2. 点「刷新资源」。
3. PDF 会以内嵌窗口打开。
4. 音频会出现播放器，可切换 0.75x / 1x / 1.25x / 1.5x。

## 7. 常见问题

### 翻译没走真实 API

检查 Vercel 环境变量：

- `BAIDU_TRANSLATE_APP_ID`
- `BAIDU_TRANSLATE_SECRET`

填完后必须 Redeploy。

### DeepSeek 批改失败

检查：

- `DEEPSEEK_API_KEY`
- `DEEPSEEK_BASE_URL=https://api.deepseek.com`
- `DEEPSEEK_MODEL=deepseek-chat`

失败时页面仍会用本地规则兜底，不会不可用。

### 百度网盘列表为空

常见原因：

1. 没有配置 `BAIDU_NETDISK_ACCESS_TOKEN`。
2. token 过期。
3. token 没有网盘文件读取权限。
4. 目录路径写错，例如 `/Deutsch` 实际不存在。

### PDF/音频无法预览

常见原因：

1. 百度网盘 token 过期。
2. 对应 material 没有 `fsId`。
3. 百度 dlink 临时链接失效，刷新资源或重新导入即可。
4. 大文件在 Serverless 代理下加载慢，正式长期使用建议把常用 PDF/MP3 放到对象存储/CDN。

## 8. 安全建议

你在任何聊天、截图、日志里发过的密钥，都建议正式部署前去控制台轮换一次。Vercel 环境变量是正确放置位置；GitHub 仓库里不能出现真实密钥。
