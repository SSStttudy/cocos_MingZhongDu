# 明中都 AI 角色服务

这是小游戏与图像生成供应商之间的服务端边界。小游戏只上传照片和查询任务；密钥、内容审核、生成流水线、临时文件删除都留在服务器。

本地联调：

```powershell
cd "D:\Desktop\三下乡\cocos_MingZhongDu\server\avatar-service"
Copy-Item .env.example .env
npm install
npm start
```

默认 `mock` 供应商不收费，约两秒后返回一套可玩的演示角色。若要让游戏连接本机服务，在 Cocos Creator 打开 `AvatarWorkshop.scene`，把 Canvas 上组件的 `Api Base Url` 改成 `http://127.0.0.1:8787`。网页构建可这样联调；微信真机必须改成已备案、配置过合法域名的 HTTPS 地址。

正式接入时，把 `.env` 中的 `AVATAR_PROVIDER` 改为 `http-manifest`，填写上游服务地址与密钥。上游只需实现 `POST /generate` 并返回项目规定的 v2 manifest；具体格式见 `docs/AI_AVATAR_SETUP.md`。
