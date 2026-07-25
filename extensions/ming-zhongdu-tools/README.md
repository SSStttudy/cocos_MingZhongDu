# 明中都工具

这是项目级 Cocos Creator 3.8 扩展，用于避免误把空白的“当前场景”当作游戏入口运行。

启用扩展后，在 Creator 顶部菜单选择：

- `扩展 > 明中都工具 > 打开大地图场景`
- `扩展 > 明中都工具 > 刷新资源并打开大地图`

场景打开后，再点击 Creator 顶部的三角形“运行当前场景”。

大地图固定入口：`db://assets/scenes/Overworld.scene`

## 本机控制桥

扩展加载后会监听 `127.0.0.1:32123`，只提供三个固定接口：

- `GET /health`
- `POST /open-overworld`
- `POST /refresh-and-open-overworld`

控制桥只绑定本机地址，不接受局域网访问，也不提供任意代码执行接口。
