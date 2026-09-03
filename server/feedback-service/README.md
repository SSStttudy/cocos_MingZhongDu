# 明中都体验问卷接收与导出服务

服务只使用 Node.js 内置模块，不需要 `npm install`。网页和微信小游戏均向同一个接口提交 15 题匿名答卷；本地提交失败会在下次打开问卷时重试。

- `POST /feedback`：接收并按 `responseId` 去重。
- `GET /health`：健康检查。
- `GET /feedback/admin`：后台导出页。
- `GET /feedback/export.csv`：Excel 可直接打开的 UTF-8 CSV（需要 Bearer 令牌）。
- `GET /feedback/export.json`：原始备份（需要 Bearer 令牌）。
- `GET /feedback/summary`：数量统计（需要 Bearer 令牌）。

数据以 NDJSON 追加保存到 `DATA_DIR/feedback.ndjson`。把随机强令牌写入 `/etc/mingzhongdu-feedback.env`：

```ini
FEEDBACK_ADMIN_TOKEN=请替换为至少32位随机字符串
```

令牌文件应仅允许 root 读取。部署后访问 `https://nyasd.net/api/mingzhongdu/feedback/admin`，输入令牌即可反复导出 CSV 或 JSON。
