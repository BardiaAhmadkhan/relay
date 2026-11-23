package ca.relaygearlab.experimental.offline

import android.app.ActivityManager
import android.content.Context
import android.net.Uri
import android.os.Build
import com.facebook.react.bridge.*
import com.facebook.react.modules.core.DeviceEventManagerModule
import com.facebook.react.ReactPackage
import com.facebook.react.uimanager.ViewManager
import org.json.JSONObject
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.security.MessageDigest
import java.util.concurrent.Executors

class RelayOfflineAssets(private val app: ReactApplicationContext) : ReactContextBaseJavaModule(app) {
  private val worker = Executors.newSingleThreadExecutor()
  override fun getName() = "RelayOfflineAssets"
  private fun manifest() = JSONObject(app.assets.open("relay-models/manifest.json").bufferedReader().use { it.readText() })
  private var lastProgress = ""
  private fun progress(phase: String, completed: Long, total: Long) {
    val percent = ((completed * 100L) / total.coerceAtLeast(1)).toInt().coerceIn(0, 100)
    val key = "$phase:$percent"
    if (key == lastProgress) return
    lastProgress = key
    val event = Arguments.createMap()
    event.putString("phase", phase); event.putInt("percent", percent)
    app.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java).emit("RelayOfflinePreparation", event)
  }
  private fun digest(file: File, onBytes: ((Long) -> Unit)? = null): String {
    val hash = MessageDigest.getInstance("SHA-256")
    FileInputStream(file).use { input -> val buffer = ByteArray(1024 * 1024); var bytes = 0L; while (true) { val count = input.read(buffer); if (count < 0) break; hash.update(buffer, 0, count); bytes += count; onBytes?.invoke(bytes) } }
    return hash.digest().joinToString("") { "%02x".format(it) }
  }
  @ReactMethod fun status(promise: Promise) {
    try {
      val memory = ActivityManager.MemoryInfo()
      (app.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager).getMemoryInfo(memory)
      val result = Arguments.createMap()
      result.putString("profile", manifest().getString("profile"))
      result.putBoolean("arm64", Build.SUPPORTED_ABIS.firstOrNull() == "arm64-v8a")
      result.putDouble("totalMemoryBytes", memory.totalMem.toDouble())
      result.putDouble("availableMemoryBytes", memory.availMem.toDouble())
      result.putBoolean("networkRequired", false)
      promise.resolve(result)
    } catch (error: Exception) { promise.reject("offline_assets_missing", "The bundled offline engine is unavailable. Reinstall this Relay build.") }
  }
  @ReactMethod fun prepare(promise: Promise) {
    worker.execute {
      try {
        val config = manifest()
        val folder = File(app.filesDir, "relay-models/" + config.getString("revision"))
        if (!folder.exists() && !folder.mkdirs()) throw IllegalStateException("model_directory")
        val result = Arguments.createMap()
        val total = config.getJSONObject("model").getLong("bytes") + config.getJSONObject("projector").getLong("bytes")
        var completed = 0L
        lastProgress = ""
        for (key in listOf("model", "projector")) {
          val entry = config.getJSONObject(key)
          val filename = if (key == "model") "vision.gguf" else "projector.gguf"
          val target = File(folder, filename)
          val expected = entry.getString("sha256")
          val size = entry.getLong("bytes")
          // All files are private app-owned fixed names; no image or remote path is accepted.
          if (!target.exists() || target.length() != size || digest(target) { bytes -> progress("verify", completed + bytes, total) } != expected) {
            val temp = File(folder, filename + ".part")
            val hash = MessageDigest.getInstance("SHA-256")
            var copied = 0L
            progress("copy", completed, total)
            app.assets.open("relay-models/" + filename).use { input ->
              FileOutputStream(temp).use { output ->
                val buffer = ByteArray(1024 * 1024)
                while (true) { val count = input.read(buffer); if (count < 0) break; output.write(buffer, 0, count); hash.update(buffer, 0, count); copied += count; progress("copy", completed + copied, total) }
                output.fd.sync()
              }
            }
            val actual = hash.digest().joinToString("") { "%02x".format(it) }
            if (temp.length() != size || actual != expected) { temp.delete(); throw IllegalStateException("model_integrity") }
            if (target.exists() && !target.delete()) throw IllegalStateException("model_replace")
            if (!temp.renameTo(target)) throw IllegalStateException("model_commit")
          }
          completed += size
          result.putString(key, target.absolutePath)
        }
        progress("load", total, total)
        result.putString("profile", config.getString("profile"))
        promise.resolve(result)
      } catch (error: Exception) { promise.reject("offline_prepare_failed", "The offline engine could not be prepared. Check free storage and try again.") }
    }
  }
  @ReactMethod fun photoInfo(uri: String, promise: Promise) {
    worker.execute {
      try {
        val parsed = Uri.parse(uri)
        if (parsed.scheme != "file") throw IllegalArgumentException("photo_uri")
        val file = File(parsed.path ?: "").canonicalFile
        val allowed = listOf(app.filesDir.canonicalPath, app.cacheDir.canonicalPath).any { file.path.startsWith(it + File.separator) }
        if (!allowed || !file.isFile || file.length() <= 0 || file.length() > 8_000_000L) throw IllegalArgumentException("photo_scope")
        val result = Arguments.createMap(); result.putString("sha256", digest(file)); result.putDouble("byteLength", file.length().toDouble()); promise.resolve(result)
      } catch (error: Exception) { promise.reject("offline_photo_unavailable", "This photograph could not be read. Choose it again.") }
    }
  }
}
class RelayOfflinePackage : ReactPackage {
  override fun createNativeModules(context: ReactApplicationContext): List<NativeModule> = listOf(RelayOfflineAssets(context))
  override fun createViewManagers(context: ReactApplicationContext): List<ViewManager<*, *>> = emptyList()
}
