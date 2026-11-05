# Robot speech

Android 离线中文转写，使用 Vosk；模块只返回文字，不发送机器人指令。

`ExpoRobotSpeech.recognize()` 在约 1.5 秒尾静音后返回第一次非空完整识别结果；最长录音 15 秒，超时返回最终文字，空结果返回 `null`。
`cancel()`、应用退到后台或模块销毁都会停止录音，当前识别返回 `null`。
调用方先申请 `RECORD_AUDIO` 权限；并发识别请求会被拒绝。

从官方模型页下载 `vosk-model-small-cn-0.22.zip`，构建前在 `omni_deck` 目录运行：

```bash
python3 scripts/prepare-speech-model.py /path/to/vosk-model-small-cn-0.22.zip
```

脚本校验固定 SHA256，将模型准备到 `android/src/main/assets/model-cn/`，并写入版本 `uuid`。
缺少模型时 Android 构建会给出准备提示。模型资产不提交 Git。
首次使用通过 Vosk `StorageService.unpack` 将该资产模型展开到应用专属目录，后续复用。

来源：<https://alphacephei.com/vosk/android>、<https://alphacephei.com/vosk/models>。
