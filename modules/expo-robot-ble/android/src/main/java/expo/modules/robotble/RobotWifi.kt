package expo.modules.robotble

import android.content.Context
import android.location.LocationManager
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import android.net.wifi.WifiManager
import android.net.wifi.WifiNetworkSpecifier
import android.os.Build
import android.os.Handler
import android.os.Looper
import expo.modules.kotlin.Promise

/** Join the BLE-provisioned AP with Android's confirmation, and route app
 * sockets over it even when the AP has no Internet validation. */
class RobotWifi(private val context: Context) {
  private val handler = Handler(Looper.getMainLooper())
  private val manager = context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
  private var callback: ConnectivityManager.NetworkCallback? = null
  private var pending: Promise? = null
  private var network: Network? = null
  private var ssid: String? = null
  private var host: String? = null

  fun join(name: String, password: String, endpointHost: String, promise: Promise) {
    if (Build.VERSION.SDK_INT < 29) {
      promise.reject("WIFI_VERSION", "需要 Android 10 或更新版本 / Android 10+ required", null)
      return
    }
    if (name == ssid && endpointHost == host && network != null && manager.getNetworkCapabilities(network!!) != null) {
      promise.resolve(null)
      return
    }
    release()
    pending = promise
    try {
      val wifi = context.applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager
      if (!wifi.isWifiEnabled) throw IllegalStateException("请打开手机 Wi-Fi 后重试 / Enable Wi-Fi")
      val location = context.getSystemService(Context.LOCATION_SERVICE) as LocationManager
      if (Build.VERSION.SDK_INT < 33 && !location.isLocationEnabled) {
        throw IllegalStateException("连接热点需要打开手机定位开关 / Enable Location to join Wi-Fi")
      }
      val specifier = WifiNetworkSpecifier.Builder().setSsid(name).setWpa2Passphrase(password).build()
      val request = NetworkRequest.Builder()
        .addTransportType(NetworkCapabilities.TRANSPORT_WIFI)
        .removeCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
        .setNetworkSpecifier(specifier).build()
      val cb = object : ConnectivityManager.NetworkCallback() {
        override fun onAvailable(available: Network) {
          if (callback !== this) return
          if (!manager.bindProcessToNetwork(available)) {
            release("无法使用热点数据通道 / Cannot bind hotspot")
            return
          }
          network = available
          ssid = name
          host = endpointHost
          pending?.resolve(null)
          pending = null
        }
        override fun onUnavailable() {
          if (callback === this) release("未连接热点，请确认系统连接提示后重试 / Wi-Fi request declined or timed out")
        }
        override fun onLost(lost: Network) {
          if (callback === this && network == lost) release("热点连接已断开 / Hotspot disconnected")
        }
      }
      callback = cb
      manager.requestNetwork(request, cb, handler, 45000)
    } catch (error: Exception) {
      release(error.message ?: "Wi-Fi connection failed")
    }
  }

  fun prepareEndpoint(endpoint: String) {
    // Keep the requested AP through BLE -> WebSocket handoff and reconnects;
    // release only for an explicit connection to a different network endpoint.
    if (host != null && !endpoint.startsWith("ble://") && android.net.Uri.parse(endpoint).host != host) release()
  }

  fun release(reason: String = "Wi-Fi request cancelled") {
    val old = callback
    callback = null
    pending?.reject("WIFI_CONNECT", reason, null)
    pending = null
    if (network != null) manager.bindProcessToNetwork(null)
    network = null; ssid = null; host = null
    if (old != null) try { manager.unregisterNetworkCallback(old) } catch (_: IllegalArgumentException) {}
  }
}
