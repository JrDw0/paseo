package expo.modules.paseodownloads

import android.content.ActivityNotFoundException
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import androidx.core.content.FileProvider
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.io.FileInputStream

private const val COPY_BUFFER_BYTES = 64 * 1024

/**
 * expo-file-system can only write content:// URIs as one whole buffer (a base64
 * string through readAsStringAsync/writeAsStringAsync), which runs Android out
 * of heap on large downloads. This streams through a fixed buffer instead, and
 * opens downloaded files via ACTION_VIEW since the vivo share sheet offers no
 * save/open targets.
 */
class PaseoDownloadsModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("PaseoDownloads")

    AsyncFunction("copyToSaf") { sourceUri: String, safUri: String ->
      val context = appContext.reactContext ?: throw Exceptions.ReactContextLost()
      val source = localFile(sourceUri)
      val output = context.contentResolver.openOutputStream(Uri.parse(safUri), "wt")
        ?: throw CopyToSafException("Could not open the chosen destination for writing.")
      val buffer = ByteArray(COPY_BUFFER_BYTES)
      FileInputStream(source).use { inputStream ->
        output.use { outputStream ->
          while (true) {
            val read = inputStream.read(buffer)
            if (read < 0) break
            outputStream.write(buffer, 0, read)
          }
          outputStream.flush()
        }
      }
    }

    AsyncFunction("openFile") { sourceUri: String, mimeType: String? ->
      val context = appContext.reactContext ?: throw Exceptions.ReactContextLost()
      val file = localFile(sourceUri)
      val contentUri = FileProvider.getUriForFile(
        context,
        context.applicationInfo.packageName + ".FileSystemFileProvider",
        file
      )
      val intent = Intent(Intent.ACTION_VIEW).apply {
        setDataAndType(contentUri, mimeType ?: "*/*")
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
      }
      // FileProvider's manifest grant does not cover every target; grant each
      // handler explicitly the way expo-sharing does.
      context.packageManager.queryIntentActivities(intent, PackageManager.MATCH_DEFAULT_ONLY).forEach {
        context.grantUriPermission(
          it.activityInfo.packageName,
          contentUri,
          Intent.FLAG_GRANT_READ_URI_PERMISSION
        )
      }
      try {
        appContext.throwingActivity.startActivity(intent)
      } catch (e: ActivityNotFoundException) {
        throw CantOpenFileException("No app on this device can open this file type.")
      }
    }
  }

  private fun localFile(sourceUri: String): File {
    val uri = Uri.parse(sourceUri)
    if (uri.scheme != null && uri.scheme != "file") {
      throw CopyToSafException("Only local file URLs are supported (got scheme '${uri.scheme}').")
    }
    val path = uri.path ?: throw CopyToSafException("Path component of the source URL is missing.")
    val file = File(path)
    if (!file.isFile) {
      throw CopyToSafException("The downloaded file is no longer available.")
    }
    return file
  }
}

class CopyToSafException(message: String, cause: Throwable? = null) : CodedException(message, cause)

class CantOpenFileException(message: String) : CodedException(message)
