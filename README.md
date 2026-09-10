# qwen-api

将 **千问办公（QwenWorkCN）** 的积分/额度转换为本地 **OpenAI / Anthropic 兼容 API**，供 Claude Code、Cursor、Cline、Continue 等任意 agent 客户端调用。

> ⚠️ 本项目只消耗**你自己账号里已有的积分**，不提供任何账号或额度。使用前请先安装并登录[千问办公桌面端](https://qwenwork.cn)。请遵守千问办公用户协议，勿共享代理端口或转售额度。

```
Claude Code / Cursor / Cline / 任意 OpenAI 兼容客户端
        │  http://127.0.0.1:9221/v1  (API Key 鉴权)
        ▼
      qwen-api（本地代理，wasm 请求签名）
        │  COSY 签名（Bearer COSY.… + 加密请求体）
        ▼
  gateway.qwenwork.cn ──► pro / flash / qwen3.8-max-preview
```

## 可用模型

| model id | 实际后端 | 价格系数 | 说明 |
|---|---|---|---|
| `pro` | GLM-5.2 | 1.0 | 默认模型，1M 上下文 |
| `flash` | Qwen3.8-Flash | **0.1** | 最便宜，日常任务首选 |
| `qwen3.8-max-preview` | 通义千问 Max | 1.1 | 千问旗舰，支持视觉 |

> **工具调用（tool use）完整支持**：OpenAI `tools`/`tool_calls`/`tool` 角色与 Anthropic `tools`/`tool_use`/`tool_result` 双向透传，agent 客户端（Claude Code、Cursor、Cline 等）可以连续多轮调用工具完成任务，不会"答一句就停"。

## 快速开始

### 前置要求

- **Windows**（账号凭据解密依赖系统 DPAPI）
- **Node.js ≥ 18**（[nodejs.org](https://nodejs.org) 下载 LTS 安装即可）
- **你的账号 uid**（获取方式见下）

> **千问办公桌面端不是运行时依赖** —— 它只用来「领取」你的 uid：装上、登录一次、跑 `npm run setup` 看到 uid 即可卸载。之后代理独立运行，桌面端在不在线都不影响推理（签名只依赖 uid + wasm，已实测随机 machine-id 也可用）。

**uid 获取方式（二选一）**：

1. **装一次桌面端**：安装 → 登录 → `npm run setup`（自动解密出 uid 并显示）→ 之后可卸载
2. **已知 uid 直接用**：`.env` 里设置 `QW_UID=你的uid`，配合 `QW_MACHINE_ID`（随便一个 UUID 也行）即可完全脱离桌面端运行

> 注意：完全脱离桌面端时 `/health` 的积分余额显示可能失效（token 无法自动刷新），但**推理完全不受影响**。

### 三步启动

```bash
git clone https://github.com/Wang-JQ77/qwen-api.git
cd qwen-api
npm install
npm start
```

或者 Windows 直接双击 `start.bat`。

启动后控制台会打印自动生成的 API Key（`sk-qw-` 开头）：

```
----------------------------------------------------------------
  qwen-api · 千问办公积分 → OpenAI / Anthropic 兼容 API
----------------------------------------------------------------
  Base URL : http://127.0.0.1:9221/v1
  API Key  : sk-qw-a3f8c92e17b4d6f0
             已保存: C:\Users\you\.qwen-api\api-key.json（删除该文件可重新生成）
  Models   : pro | flash | qwen3.8-max-preview
  Health   : http://127.0.0.1:9221/health
----------------------------------------------------------------
```

> 首次运行可先执行 `npm run setup` 做环境自检；`node setup.js --test` 会额外跑一次真实推理冒烟测试（消耗约 0.01 积分）。

### 让它一直运行（很重要）

`npm start` 是**前台进程**，关掉窗口或终端就停了 —— 客户端会立刻报连接失败。三种常驻方式：

| 方式 | 怎么做 | 特点 |
|---|---|---|
| 前台 | 双击 `start.bat` / `npm start` | 调试用，能看到实时日志，关窗即停 |
| **后台常驻（推荐）** | 双击 `start-background.vbs` | 隐藏窗口，**崩溃自动重启**，日志写 `logs\server.log` |
| **开机自启** | 双击 `install-autostart.bat` | 免管理员（写入用户启动文件夹），登录即拉起；`uninstall-autostart.bat` 移除 |

随时查看状态或停止：

```bash
status.bat    # 是否运行 / Base URL / 当前 API Key / 账号 / 余额
stop.bat      # 停止服务并阻止自动重启
selftest.bat  # 协议自检：SSE 帧格式、流式状态机、finish_reason、多轮上下文
```

> 客户端突然报「连接失败 / fetch failed / ECONNREFUSED」基本都是服务没在跑，先执行 `status.bat` 确认。

### 修改 API Key

三种方式任选：

1. **自动生成**（默认）：删除 `%USERPROFILE%\.qwen-api\api-key.json` 后重启，生成新 Key
2. **固定 Key**：项目根目录复制 `.env.example` 为 `.env`，设置 `API_KEY=你的key`
3. **关闭鉴权**：`.env` 中设置 `QW_ALLOW_NO_KEY=1`（仅建议完全可信的本机环境）

## 客户端接入

### Claude Code（Anthropic 端点）

```bash
export ANTHROPIC_BASE_URL=http://127.0.0.1:9221
export ANTHROPIC_AUTH_TOKEN=sk-qw-你的key
claude
```

模型选 `pro` / `flash` / `qwen3.8-max-preview`。

### Cursor

`Settings → Models → OpenAI API Key`：

- **Base URL**: `http://127.0.0.1:9221/v1`
- **API Key**: `sk-qw-你的key`
- 手动添加模型：`pro`、`flash`、`qwen3.8-max-preview`（先点 Verify 验证通过）

### Cline / Continue / 其他 OpenAI 兼容客户端

- **Provider**: OpenAI Compatible
- **Base URL**: `http://127.0.0.1:9221/v1`
- **API Key**: `sk-qw-你的key`
- **Model**: `pro` / `flash` / `qwen3.8-max-preview`

### curl

```bash
curl http://127.0.0.1:9221/v1/chat/completions ^
  -H "Authorization: Bearer sk-qw-你的key" ^
  -H "Content-Type: application/json" ^
  -d "{\"model\":\"flash\",\"messages\":[{\"role\":\"user\",\"content\":\"你好\"}]}"
```

### Python (OpenAI SDK)

```python
from openai import OpenAI

client = OpenAI(base_url="http://127.0.0.1:9221/v1", api_key="sk-qw-你的key")
r = client.chat.completions.create(model="pro", messages=[{"role": "user", "content": "你好"}])
print(r.choices[0].message.content)
```

## 接口一览

| 路由 | 说明 |
|---|---|
| `GET /health` | 服务状态 + 当前积分余额（无需推理消耗） |
| `GET /v1/models` | OpenAI 格式模型列表 |
| `POST /v1/chat/completions` | OpenAI Chat，支持 `stream: true/false` |
| `POST /v1/messages` | Anthropic Messages，支持 `stream: true/false` |

流式响应中的思维链放在 `delta.reasoning_content`（DeepSeek 风格）；Anthropic 端点映射为 `thinking` content block，Claude Code 可直接显示思考过程。

所有请求需携带 `Authorization: Bearer <API Key>`（Anthropic 客户端也可用 `x-api-key` 头）。服务默认只绑定 `127.0.0.1`，外部机器无法访问。

## 配置项（.env）

| 变量 | 默认值 | 说明 |
|---|---|---|
| `PORT` | `9221` | 监听端口 |
| `HOST` | `127.0.0.1` | 监听地址（`0.0.0.0` 开放局域网，务必保持 API_KEY） |
| `API_KEY` | 自动生成 | 客户端调用凭据 |
| `QW_ALLOW_NO_KEY` | `0` | `1` = 关闭鉴权 |
| `QW_GATEWAY` | `https://gateway.qwenwork.cn` | 上游网关 |
| `QW_APPDATA` | `%APPDATA%\QwenWorkCN` | 桌面端数据目录（读账号身份） |
| `QW_CLI_HOME` | `~/.qwenworkcn` | CLI 目录（读 machine-id / 模型目录） |
| `QW_UID` / `QW_MACHINE_ID` | 自动 | 手动覆盖账号 uid / 机器码 |
| `QW_TOKEN` / `QW_REFRESH_TOKEN` | 自动 | 手动 Bearer token（仅积分查询用） |
| `QW_DEFAULT_MODEL` | `pro` | 默认模型 |
| `QW_DATA_DIR` | `~/.qwen-api` | API Key 与 token 缓存目录 |

## DSH 用户：作为插件安装

```bash
dsh plugin --profile <name> add qwen-api
```

启动日志会打印 API Key。自定义配置：

```yaml
- insert:
    - id: qwen-api
      name: 'qwen-api'
      config:
        port: 9221
        apiKey: my-secret-key
```

## 工作原理

1. 启动时从千问办公桌面端本地凭据（`%APPDATA%\QwenWorkCN\auth-v2.dat`，Chromium OSCrypt v10 = DPAPI + AES-256-GCM）解密账号身份
2. 使用千问办公自带的 `qoder-auth-wasm` 签名模块（仓库内置副本）为每个推理请求生成 COSY 签名
3. 调用官方推理端点（SSE 流式），转换并转发给本地客户端
4. 推理签名只依赖账号 uid + 机器码，**不依赖短期 token**——桌面端刷新登录态不影响使用；token 仅用于 `/health` 里的积分查询

## 常见问题

| 问题 | 处理 |
|---|---|
| 客户端报连接失败 / ECONNREFUSED | 服务没在跑：`status.bat` 查看，`start-background.vbs` 拉起 |
| 启动报"账号身份不可用" | 先在千问办公桌面端登录一次；或在 `.env` 设置 `QW_UID` 与 `QW_MACHINE_ID` |
| 不装千问办公能用吗 | 能。`.env` 设置 `QW_UID`（从曾登录过的机器获取）即可；machine-id 随机值亦可，已实测 |
| `node setup.js` 提示解密失败 | 确认桌面端已登录且为本机当前用户运行；RDP/其他用户会话下 DPAPI 解不开属正常 |
| 客户端 401 | 检查 Key 是否与控制台打印一致；`~/.qwen-api/api-key.json` 删除后重启会换新 Key |
| 上游 403 Model is not available | 该模型无权限，换 `pro` 或 `flash` |
| 端口被占用 | `.env` 改 `PORT` |
| 积分查询失败 | 不影响推理，可忽略；多为 token 轮换竞态，重启即恢复 |

## 已知限制

- 仅支持 Windows（凭据解密依赖 DPAPI）
- function calling（tools）暂未透传，tool 消息以文本形式并入对话
- 图片输入支持 OpenAI `image_url` / Anthropic `image` 基本格式，VL 能力以上游为准

## License

[MIT](LICENSE)
