# Robot speech

Android 离线中文转写：sherpa-onnx 2.0.1 + SenseVoiceSmall INT8 + Silero VAD。
不需要云端 Key；模块只返回文字，不发送机器人指令。

- `prepare()`：后台预加载并复用模型，不申请麦克风、不录音。
- `recognize()`：调用方先申请 `RECORD_AUDIO`；录音启动后发出 `listening` 状态。
  检测约 0.8 秒尾静音后停止麦克风，再识别整句；最长录音 15 秒。
  中文识别启用数字和标点规范化，空结果返回 `null`。
- `onStateChanged`：`preparing` / `listening` / `recognizing`，只属于当前识别。
- `cancel()`、应用退到后台、模块销毁都会取消当前结果并停止录音。
  取消不会把晚到的识别文字发给机器人；并发识别会被拒绝。

进入控制页时预热，界面显示“请说话”后再开始说话。
模型加载、录音、推理和 JNI 清理在同一后台线程串行执行，不阻塞 UI。

## 构建输入

下载固定官方版本，构建前在 `omni_deck` 目录运行准备脚本：

- [SenseVoice INT8 模型](https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17.tar.bz2)
- [sherpa-onnx 静态链接 AAR](https://github.com/k2-fsa/sherpa-onnx/releases/download/v2.0.1/sherpa-onnx-static-link-onnxruntime-2.0.1.aar)
- [Silero VAD](https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/silero_vad.onnx)

```bash
python3 scripts/prepare-speech-model.py \
  /path/to/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17.tar.bz2 \
  /path/to/sherpa-onnx-static-link-onnxruntime-2.0.1.aar \
  /path/to/silero_vad.onnx
```

脚本校验固定 SHA256，只提取模型与词表，复制 VAD/AAR，并删除旧 Vosk 生成资产。
模型与 AAR 不提交 Git；缺少输入时构建会给出准备命令。
SenseVoice 权重约 228 MiB，APK 比旧版增大。

来源：[SenseVoice 模型与性能](https://k2-fsa.github.io/sherpa/onnx/sense-voice/pretrained.html)、
[官方 Android VAD+ASR 示例](https://github.com/k2-fsa/sherpa-onnx/tree/v2.0.1/android/SherpaOnnxVadAsr)。
