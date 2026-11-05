package expo.modules.robotspeech

import android.Manifest
import android.content.pm.PackageManager
import android.content.res.AssetManager
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.util.Log
import com.k2fsa.sherpa.onnx.FeatureConfig
import com.k2fsa.sherpa.onnx.OfflineModelConfig
import com.k2fsa.sherpa.onnx.OfflineRecognizer
import com.k2fsa.sherpa.onnx.OfflineRecognizerConfig
import com.k2fsa.sherpa.onnx.OfflineSenseVoiceModelConfig
import com.k2fsa.sherpa.onnx.SileroVadModelConfig
import com.k2fsa.sherpa.onnx.Vad
import com.k2fsa.sherpa.onnx.VadModelConfig
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.util.concurrent.Executors

class ExpoRobotSpeechModule : Module() {
  private class Session(val promise: Promise) {
    @Volatile var cancelled = false
  }

  private val handler = Handler(Looper.getMainLooper())
  // Serialize model loading, capture, inference and release so JNI cannot race cleanup.
  private val worker = Executors.newSingleThreadExecutor()
  private var pending: Session? = null
  private var recognizer: OfflineRecognizer? = null
  private var vad: Vad? = null
  @Volatile private var destroyed = false

  override fun definition() = ModuleDefinition {
    Name("ExpoRobotSpeech")
    Events("onStateChanged")

    AsyncFunction("prepare") { promise: Promise -> handler.post {
      val assets = appContext.reactContext?.assets
      if (destroyed || assets == null) {
        promise.reject("SPEECH_INACTIVE", "语音界面已关闭", null)
      } else worker.execute {
        try {
          if (!destroyed) prepare(assets)
          handler.post { promise.resolve(null) }
        } catch (error: Exception) {
          handler.post { promise.reject("SPEECH_FAILED", "语音模型加载失败：" + error.message, error) }
        }
      }
    } }

    AsyncFunction("recognize") { promise: Promise -> handler.post {
      val context = appContext.reactContext
      if (destroyed || context == null || appContext.currentActivity == null) {
        promise.reject("SPEECH_INACTIVE", "语音界面已关闭", null)
      } else if (pending != null) {
        promise.reject("SPEECH_BUSY", "正在识别语音", null)
      } else if (context.checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
        promise.reject("SPEECH_PERMISSION", "请允许麦克风权限", null)
      } else {
        val session = Session(promise)
        pending = session
        state(session, "preparing")
        worker.execute {
          try {
            var text: String? = null
            if (!session.cancelled && !destroyed) {
              prepare(context.assets)
              if (!session.cancelled && !destroyed) {
                val samples = record(session)
                if (samples != null && !session.cancelled && !destroyed) {
                  state(session, "recognizing")
                  val start = SystemClock.elapsedRealtime()
                  val stream = recognizer!!.createStream()
                  try {
                    stream.acceptWaveform(samples, SAMPLE_RATE)
                    recognizer!!.decode(stream)
                    text = recognizer!!.getResult(stream).text.trim().ifEmpty { null }
                  } finally { stream.release() }
                  Log.i("RobotSpeech", "Decoded " + samples.size + " samples in " + (SystemClock.elapsedRealtime() - start) + " ms")
                }
              }
            }
            handler.post { finish(session, text) }
          } catch (error: Exception) {
            handler.post { finish(session, error = error) }
          }
        }
      }
    } }

    AsyncFunction("cancel") { promise: Promise -> handler.post {
      pending?.cancelled = true
      // Resolve after the worker has stopped the microphone and discarded its result.
      worker.execute { handler.post { promise.resolve(null) } }
    } }

    OnActivityEntersBackground { handler.post { pending?.cancelled = true } }
    OnDestroy { handler.post {
      destroyed = true
      pending?.cancelled = true
      worker.execute {
        vad?.release(); vad = null
        recognizer?.release(); recognizer = null
      }
      worker.shutdown()
    } }
  }

  private fun prepare(assets: AssetManager) {
    if (recognizer == null) {
      val start = SystemClock.elapsedRealtime()
      recognizer = OfflineRecognizer(assets, OfflineRecognizerConfig(
        featConfig = FeatureConfig(sampleRate = SAMPLE_RATE, featureDim = 80),
        modelConfig = OfflineModelConfig(
          senseVoice = OfflineSenseVoiceModelConfig(
            model = "speech/model.int8.onnx", language = "zh", useInverseTextNormalization = true,
          ),
          tokens = "speech/tokens.txt", numThreads = 3, provider = "cpu",
        ),
      ))
      Log.i("RobotSpeech", "Model ready in " + (SystemClock.elapsedRealtime() - start) + " ms")
    }
    if (vad == null) vad = Vad(assets, VadModelConfig(
      sileroVadModelConfig = SileroVadModelConfig(
        model = "speech/silero_vad.onnx", threshold = 0.5f,
        minSilenceDuration = 0.8f, minSpeechDuration = 0.25f, maxSpeechDuration = 15f,
      ),
      sampleRate = SAMPLE_RATE, numThreads = 1, provider = "cpu",
    ))
  }

  private fun record(session: Session): FloatArray? {
    val channel = AudioFormat.CHANNEL_IN_MONO
    val encoding = AudioFormat.ENCODING_PCM_16BIT
    val size = AudioRecord.getMinBufferSize(SAMPLE_RATE, channel, encoding)
    check(size > 0) { "手机不支持 16kHz 录音" }
    val recorder = AudioRecord(MediaRecorder.AudioSource.VOICE_RECOGNITION, SAMPLE_RATE, channel, encoding, maxOf(size * 2, 4096))
    try {
      check(recorder.state == AudioRecord.STATE_INITIALIZED) { "无法初始化麦克风" }
      if (session.cancelled || destroyed) return null
      vad!!.reset()
      recorder.startRecording()
      check(recorder.recordingState == AudioRecord.RECORDSTATE_RECORDING) { "无法启动录音" }
      state(session, "listening")
      val buffer = ShortArray(512)
      var count = 0
      while (!session.cancelled && !destroyed && count < SAMPLE_RATE * 15) {
        val read = recorder.read(buffer, 0, buffer.size)
        check(read > 0) { "麦克风读取失败：" + read }
        count += read
        vad!!.acceptWaveform(FloatArray(read) { buffer[it] / 32768f })
        if (!vad!!.empty()) return vad!!.front().samples
      }
      if (!session.cancelled && !destroyed) {
        vad!!.flush()
        if (!vad!!.empty()) return vad!!.front().samples
      }
      return null
    } finally {
      try {
        if (recorder.recordingState == AudioRecord.RECORDSTATE_RECORDING) recorder.stop()
      } finally { recorder.release() }
    }
  }

  private fun state(session: Session, value: String) { handler.post {
    if (pending === session && !session.cancelled && !destroyed) sendEvent("onStateChanged", mapOf("state" to value))
  } }

  private fun finish(session: Session, text: String? = null, error: Exception? = null) {
    if (pending !== session) return
    pending = null
    if (session.cancelled || destroyed) session.promise.resolve(null)
    else if (error != null) session.promise.reject("SPEECH_FAILED", "语音识别失败：" + error.message, error)
    else session.promise.resolve(text)
  }

  companion object { private const val SAMPLE_RATE = 16000 }
}
