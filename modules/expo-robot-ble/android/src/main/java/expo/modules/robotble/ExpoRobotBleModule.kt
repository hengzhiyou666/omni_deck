package expo.modules.robotble

import android.annotation.SuppressLint
import android.bluetooth.*
import android.bluetooth.le.*
import android.content.Context
import android.os.Handler
import android.os.Looper
import android.os.ParcelUuid
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.ByteArrayOutputStream
import java.util.ArrayDeque
import java.util.UUID

@SuppressLint("MissingPermission")
class ExpoRobotBleModule : Module() {
  private val handler = Handler(Looper.getMainLooper())
  private val serviceId = UUID.fromString("7c840001-9d2a-4b71-a22c-6d6f6e690004")
  private val rxId = UUID.fromString("7c840002-9d2a-4b71-a22c-6d6f6e690004")
  private val txId = UUID.fromString("7c840003-9d2a-4b71-a22c-6d6f6e690004")
  private val cccd = UUID.fromString("00002902-0000-1000-8000-00805f9b34fb")
  private var gatt: BluetoothGatt? = null
  private var connectPromise: Promise? = null
  private var scanning = false
  private var ready = false
  private var payloadSize = 20
  private var robotWifi: RobotWifi? = null
  private val incoming = ByteArrayOutputStream()
  private var incomingSequence = 0L
  private val fragments = mutableMapOf<Long, ByteArray>()
  private data class Outbound(val data: ByteArray, val promise: Promise, var offset: Int = 0)
  private val writes = ArrayDeque<Outbound>()
  private fun adapter(): BluetoothAdapter =
    (appContext.reactContext!!.getSystemService(Context.BLUETOOTH_SERVICE) as BluetoothManager).adapter
      ?: throw IllegalStateException("Bluetooth is unavailable")

  override fun definition() = ModuleDefinition {
    Name("ExpoRobotBle")
    Events("device", "message", "connection", "scanError")
    AsyncFunction("scan") { promise: Promise -> handler.post {
      try {
        if (!adapter().isEnabled) throw IllegalStateException("请先打开手机蓝牙 / Enable Bluetooth")
        stopScan()
        adapter().bluetoothLeScanner.startScan(
          listOf(
            ScanFilter.Builder().setServiceUuid(ParcelUuid(UUID.fromString("12345678-1234-5678-1234-56789abcdef0"))).build(),
            ScanFilter.Builder().setDeviceName("8010002BHQ26EUA0008").build()),
          ScanSettings.Builder().setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY).build(), scanner)
        scanning = true
        handler.postDelayed({ stopScan() }, 10000)
        promise.resolve(null)
      } catch (e: Exception) { promise.reject("BLE_SCAN", e.message, e) }
    } }
    AsyncFunction("stopScan") { handler.post { stopScan() }; Unit }
    AsyncFunction("connect") { address: String, promise: Promise -> handler.post {
      try {
        close("Connection replaced")
        stopScan()
        connectPromise = promise
        gatt = adapter().getRemoteDevice(address).connectGatt(appContext.reactContext, false, callback, BluetoothDevice.TRANSPORT_LE)
        val session = gatt
        handler.postDelayed({ if (gatt === session && !ready) close("Bluetooth connection timed out") }, 15000)
      } catch (e: Exception) { close(e.message ?: "Bluetooth connection failed") }
    } }
    AsyncFunction("write") { message: String, promise: Promise -> handler.post {
      if (!ready || message.toByteArray(Charsets.UTF_8).size > 16000 || writes.size >= 32) {
        promise.reject("BLE_WRITE", "Bluetooth unavailable or send queue full", null)
      } else {
        writes.add(Outbound((message + "\n").toByteArray(Charsets.UTF_8), promise))
        if (writes.size == 1) writeNext()
      }
    } }
    AsyncFunction("disconnect") { handler.post { close("Disconnected") }; Unit }
    AsyncFunction("joinWifi") { ssid: String, password: String, host: String, promise: Promise -> handler.post {
      val wifi = robotWifi ?: RobotWifi(appContext.reactContext!!).also { robotWifi = it }
      wifi.join(ssid, password, host, promise)
    } }
    AsyncFunction("prepareNetworkEndpoint") { endpoint: String, promise: Promise -> handler.post {
      robotWifi?.prepareEndpoint(endpoint)
      promise.resolve(null)
    } }
    AsyncFunction("releaseWifi") { promise: Promise -> handler.post {
      robotWifi?.release()
      promise.resolve(null)
    } }
    OnDestroy { handler.post { robotWifi?.release(); stopScan(); close("Module destroyed") } }
  }

  private val scanner = object : ScanCallback() {
    override fun onScanResult(callbackType: Int, result: ScanResult) {
      sendEvent("device", mapOf("id" to result.device.address,
        "name" to (result.scanRecord?.deviceName ?: result.device.name ?: "Omni dog"), "rssi" to result.rssi))
    }
    override fun onScanFailed(errorCode: Int) {
      scanning = false
      sendEvent("scanError", mapOf("error" to "Bluetooth scan failed: $errorCode"))
    }
  }

  private fun stopScan() {
    if (scanning) { adapter().bluetoothLeScanner?.stopScan(scanner); scanning = false }
  }

  private fun close(reason: String) {
    ready = false
    val old = gatt; gatt = null
    old?.disconnect(); old?.close()
    connectPromise?.reject("BLE_CONNECT", reason, null); connectPromise = null
    while (writes.isNotEmpty()) writes.remove().promise.reject("BLE_WRITE", reason, null)
    incoming.reset(); fragments.clear(); incomingSequence = 0L; payloadSize = 20
    sendEvent("connection", mapOf("connected" to false, "error" to reason))
  }

  @Suppress("DEPRECATION")
  private fun writeNext() {
    val packet = writes.peek() ?: return
    val connection = gatt ?: return close("Disconnected")
    val characteristic = connection.getService(serviceId)?.getCharacteristic(rxId)
      ?: return close("Control characteristic missing")
    val end = minOf(packet.offset + payloadSize, packet.data.size)
    characteristic.writeType = BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT
    characteristic.value = packet.data.copyOfRange(packet.offset, end)
    if (!connection.writeCharacteristic(characteristic)) return close("Bluetooth write failed")
    packet.offset = end
    handler.postDelayed({ if (writes.peek() === packet && packet.offset == end) close("Bluetooth write timed out") }, 5000)
  }

  private fun accept(value: ByteArray) {
    if (value.size < 5) return close("Invalid Bluetooth notification")
    var sequence = 0L
    for (i in 0..3) sequence = (sequence shl 8) or (value[i].toLong() and 255)
    if (((sequence - incomingSequence) and 0xffffffffL) >= 128 || fragments.containsKey(sequence)) {
      return close("Bluetooth notification sequence is out of bounds")
    }
    fragments[sequence] = value.copyOfRange(4, value.size)
    // Enhanced ATT can deliver fragments on different bearers out of order.
    while (true) {
      val next = fragments.remove(incomingSequence) ?: break
      incomingSequence = (incomingSequence + 1) and 0xffffffffL
      acceptOrdered(next)
      if (!ready) return
    }
  }

  private fun acceptOrdered(value: ByteArray) {
    for (byte in value) {
      if (byte.toInt() == 10) {
        val message = incoming.toString("UTF-8"); incoming.reset()
        sendEvent("message", mapOf("data" to message))
      } else {
        incoming.write(byte.toInt())
        if (incoming.size() > 16384) { close("Bluetooth message exceeds size limit"); return }
      }
    }
  }

  private val callback = object : BluetoothGattCallback() {
    override fun onConnectionStateChange(g: BluetoothGatt, status: Int, state: Int) = handler.post {
      if (g !== gatt) return@post
      if (status != BluetoothGatt.GATT_SUCCESS || state == BluetoothProfile.STATE_DISCONNECTED) {
        close("Bluetooth disconnected ($status)")
      } else if (state == BluetoothProfile.STATE_CONNECTED) {
        if (!g.requestMtu(185)) g.discoverServices()
      }
    }.let { Unit }

    override fun onMtuChanged(g: BluetoothGatt, mtu: Int, status: Int) = handler.post {
      if (g !== gatt) return@post
      payloadSize = if (status == BluetoothGatt.GATT_SUCCESS) minOf(mtu - 3, 180) else 20
      g.discoverServices()
    }.let { Unit }

    @Suppress("DEPRECATION")
    override fun onServicesDiscovered(g: BluetoothGatt, status: Int) = handler.post {
      if (g !== gatt) return@post
      val tx = g.getService(serviceId)?.getCharacteristic(txId)
      val descriptor = tx?.getDescriptor(cccd)
      if (status != BluetoothGatt.GATT_SUCCESS || tx == null || descriptor == null || !g.setCharacteristicNotification(tx, true)) {
        close("Omni Bluetooth service unavailable"); return@post
      }
      descriptor.value = BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE
      if (!g.writeDescriptor(descriptor)) close("Cannot enable telemetry")
    }.let { Unit }

    override fun onDescriptorWrite(g: BluetoothGatt, descriptor: BluetoothGattDescriptor, status: Int) = handler.post {
      if (g !== gatt) return@post
      if (status != BluetoothGatt.GATT_SUCCESS) { close("Telemetry subscription failed"); return@post }
      ready = true
      connectPromise?.resolve(null); connectPromise = null
      sendEvent("connection", mapOf("connected" to true))
    }.let { Unit }

    override fun onCharacteristicWrite(g: BluetoothGatt, characteristic: BluetoothGattCharacteristic, status: Int) = handler.post {
      if (g !== gatt) return@post
      if (status != BluetoothGatt.GATT_SUCCESS) { close("Control write failed ($status)"); return@post }
      val packet = writes.peek() ?: return@post
      if (packet.offset >= packet.data.size) { writes.remove(); packet.promise.resolve(null) }
      writeNext()
    }.let { Unit }

    @Suppress("DEPRECATION")
    override fun onCharacteristicChanged(g: BluetoothGatt, c: BluetoothGattCharacteristic) {
      val data = c.value?.clone() ?: return
      handler.post { if (g === gatt) accept(data) }
    }
  }
}
