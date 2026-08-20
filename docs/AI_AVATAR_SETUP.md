# AI 创建角色：架构、演示与上线清单

## 已在项目中完成

- 开始页增加“创建自己的角色”，进入独立的 `AvatarWorkshop.scene`。
- 场景内的背景、标题、角色卡片、上传按钮、生成按钮、状态区都由 Cocos Creator 场景静态搭建，位置和样式可在编辑器中调整。
- 三个默认角色可选择并保存。
- 微信端支持相机/相册，网页预览支持本地文件选择。
- 客户端按异步任务模式上传并轮询，不在小游戏包内保存任何 AI 密钥。
- 角色清单支持下、上、左、右四个方向，每个方向包含待机、8 帧行走和 8 帧奔跑。
- 所有游戏场景中的 `DirectionalWalkAnimator` 会读取保存的角色；远程资源损坏时自动退回项目默认角色。
- `server/avatar-service` 提供可运行的 mock 服务和真实上游供应商适配接口。

## 汇报演示（现在即可使用，无需购买 API）

1. 用 Cocos Creator 3.8.8 打开项目并运行 `Start.scene`。
2. 点击“创建自己的角色”。
3. 点击“拍摄 / 选择照片”并选择一张全身照。
4. 点击“开始生成我的角色”。
5. 界面会依次显示分析照片、生成造型、整理动画，最后保存演示角色。
6. 返回并进入游戏，角色加载器会使用已保存的清单。

这是明确标注的“演示模式”，用于展示完整产品流程和交互，不冒充真实 AI 请求。把 `AvatarWorkshop.scene` 中 Canvas 节点的 `Demo Mode` 取消勾选，可禁止此降级路径。

也可以运行本地 mock 后端，演示真实的“上传—服务端任务—轮询—返回清单”网络流程：

```powershell
cd "D:\Desktop\三下乡\cocos_MingZhongDu\server\avatar-service"
Copy-Item .env.example .env
npm install
npm start
```

然后在 Cocos Creator 中选中 `AvatarWorkshop/Canvas`，把 `AvatarWorkshopController` 的 `Api Base Url` 改成 `http://127.0.0.1:8787`。

## 正式生成流水线

推荐把“图像模型”和“游戏资源整理”拆开：

1. 服务端校验照片格式、大小与用户授权。
2. 人像分割并提取身份/服装参考。
3. 图像生成模型按明中都视觉规范生成统一角色设定。
4. 用姿态控制工作流生成四方向待机、行走、奔跑；通用文生图单独生成几十帧很容易发生脸、服装和体型漂移。
5. 后处理统一为透明 384×512 PNG，脚底位置固定在 y=480。
6. 上传到对象存储/CDN，返回 v2 manifest。
7. 删除服务器上的原始照片；生成资源按用户账号管理。

OpenAI 的 GPT Image 可接收图片并进行编辑，适合制作角色概念图或设定图；正式动画建议在它之后增加姿态约束与一致性流水线，或者直接购买能够输出一致精灵动画的供应商。项目的 `http-manifest` 适配层不绑定具体厂商。

## 客户端与服务端协议

创建任务：

```http
POST /v1/avatar/jobs
Content-Type: multipart/form-data

photo=<file>
displayName=我的明中都角色
stylePreset=ming-zhongdu-traveler
clientPlatform=wechat-mini-game
manifestVersion=2
```

响应和查询：

```json
{
  "jobId": "uuid",
  "status": "queued | running | succeeded | failed",
  "progress": 60,
  "message": "正在生成四方向动画",
  "avatar": {}
}
```

查询地址为 `GET /v1/avatar/jobs/:jobId`。成功时 `avatar` 必须满足：

```json
{
  "version": 2,
  "avatarId": "avatar-001",
  "displayName": "我的明中都角色",
  "createdAt": "2026-08-12T10:00:00.000Z",
  "provider": "your-provider",
  "stylePreset": "ming-zhongdu-traveler",
  "canvas": { "width": 384, "height": 512, "feetY": 480 },
  "previewUrl": "https://cdn.example.com/avatar-001/preview.png",
  "idle": {
    "down": "https://.../idle/down.png",
    "up": "https://.../idle/up.png",
    "left": "https://.../idle/left.png",
    "right": "https://.../idle/right.png"
  },
  "walk": {
    "down": ["8 个透明 PNG 地址"],
    "up": ["8 个透明 PNG 地址"],
    "left": ["8 个透明 PNG 地址"],
    "right": ["8 个透明 PNG 地址"]
  },
  "run": {
    "down": ["8 个透明 PNG 地址"],
    "up": ["8 个透明 PNG 地址"],
    "left": ["8 个透明 PNG 地址"],
    "right": ["8 个透明 PNG 地址"]
  }
}
```

这些 URL 必须能被小游戏长期访问。不要把数小时后失效的临时签名 URL 永久保存到角色清单；可使用稳定 CDN 地址，或增加刷新清单接口。

## 购买/部署后你要做的事

1. 确认供应商能稳定输出同一角色的多姿态透明图，而不只是“识别照片”或生成一张立绘。
2. 让供应商实现上面的 manifest，或在 `HttpManifestAvatarProvider` 前加一层格式转换与切帧服务。
3. 将 `server/avatar-service` 部署到国内可访问的 HTTPS 域名，把密钥写入服务器环境变量。
4. 在微信公众平台把服务域名加入 request/upload/download 合法域名；不要在客户端关闭域名校验作为上线方案。
5. 在 `AvatarWorkshop.scene` 的 `Api Base Url` 填入生产地址，并关闭 `Demo Mode`。
6. 增加隐私政策、照片用途说明、明确同意、删除入口、限流与内容安全审核。若项目面向未成年人，需按学校和平台要求进一步收紧数据处理。
7. 真机检查弱网、任务超时、退出后重新查询、资源 URL 失效和生成失败的回退体验。

## 可在编辑器中调整的字段

选中 `AvatarWorkshop.scene` 的 Canvas，可调整：

- `Api Base Url`：角色服务地址；
- `Demo Mode`：是否允许无 API 演示；
- `Style Preset`：发给后端的风格标识；
- `Poll Interval Seconds`：轮询间隔；
- `Job Timeout Seconds`：超时时间；
- `Preset Cards / Preset Frames`：默认角色卡片与图片。

角色卡片、按钮、文字、布局尺寸和位置均在场景层级中直接编辑。
