# 网络音频候选

index.html 现为四个网络来源的试听审查页，需要联网。原单曲离线审查页保留为 single-track.html。
此轮没有下载或制作新增音频，播放器按点击从公开原站地址加载。
未切片、改响度或处理循环，未接入 Cocos 游戏。标题、作者、来源、授权、处理状态见 online-sources.json。
未下载的文件没有本地 SHA-256；正式入库时补充原始文件哈希与许可证快照。
原先的 REVIEW.md、manifest.json 和 qa.json 仅对应首版本地合成 WAV，不代表本轮网络候选的检查结果。

复现：python tools/audio/create-online-review.py。没有 Python 第三方依赖。
