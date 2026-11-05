package expo.modules.robotspeech

import android.Manifest
import android.content.pm.PackageManager
import android.os.Handler
import android.os.Looper
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import org.json.JSONObject
import org.vosk.Model
import org.vosk.Recognizer
import org.vosk.android.RecognitionListener
import org.vosk.android.SpeechService
import org.vosk.android.StorageService

class ExpoRobotSpeechModule : Module() {
  private class Session(val promise: Promise)
  private val handler = Handler(Looper.getMainLooper())
  private var pending: Session? = null
  private var model: Model? = null
  private var loading = false
  private var destroyed = false
  private var service: SpeechService? = null
  private var recognizer: Recognizer? = null

  override fun definition() = ModuleDefinition {
    Name("ExpoRobotSpeech")

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
        if (model != null) {
          listen(session)
        } else if (!loading) {
          loading = true
          StorageService.unpack(context, "model-cn", "vosk-model-cn", { loaded ->
            loading = false
            if (destroyed) {
              loaded.close()
            } else {
              model = loaded
              pending?.let { listen(it) }
            }
          }, { error ->
            loading = false
            pending?.let { finish(it, error = error) }
          })
        }
      }
    } }

    AsyncFunction("cancel") { promise: Promise -> handler.post {
      pending?.let { finish(it) }
      promise.resolve(null)
    } }

    OnActivityEntersBackground { handler.post { pending?.let { finish(it) } } }
    OnDestroy { handler.post {
      destroyed = true
      pending?.let { finish(it) }
      model?.close()
      model = null
    } }
  }

  private fun listen(session: Session) {
    if (pending !== session) return
    try {
      recognizer = Recognizer(model!!, 16000f)
      recognizer!!.setEndpointerDelays(15f, 1.5f, 15f)
      service = SpeechService(recognizer, 16000f)
      val listener = object : RecognitionListener {
        override fun onPartialResult(hypothesis: String) = Unit
        override fun onResult(hypothesis: String) {
          if (pending !== session) return
          try {
            val text = JSONObject(hypothesis).optString("text").trim()
            if (text.isNotEmpty()) finish(session, text)
          } catch (error: Exception) { finish(session, error = error) }
        }
        override fun onFinalResult(hypothesis: String) {
          if (pending !== session) return
          try { finish(session, JSONObject(hypothesis).optString("text").trim().ifEmpty { null }) }
          catch (error: Exception) { finish(session, error = error) }
        }
        override fun onError(error: Exception) { finish(session, error = error) }
        override fun onTimeout() { finish(session, readFinal = true) }
      }
      check(service!!.startListening(listener, 15000)) { "无法启动录音" }
    } catch (error: Exception) { finish(session, error = error) }
  }

  private fun finish(session: Session, text: String? = null, error: Exception? = null, readFinal: Boolean = false) {
    if (pending !== session) return
    pending = null
    val activeService = service
    val activeRecognizer = recognizer
    service = null
    recognizer = null
    var result = text
    var failure = error
    try {
      // cancel joins the audio thread before any recognizer JNI access or close.
      activeService?.cancel()
      if (readFinal && activeRecognizer != null) {
        result = JSONObject(activeRecognizer.finalResult).optString("text").trim().ifEmpty { null }
      }
    } catch (cleanupError: Exception) { failure = failure ?: cleanupError }
    try { activeService?.shutdown() }
    catch (cleanupError: Exception) { failure = failure ?: cleanupError }
    try { activeRecognizer?.close() }
    catch (cleanupError: Exception) { failure = failure ?: cleanupError }
    if (failure != null) session.promise.reject("SPEECH_FAILED", "语音识别失败：${failure.message}", failure)
    else session.promise.resolve(result)
  }
}
