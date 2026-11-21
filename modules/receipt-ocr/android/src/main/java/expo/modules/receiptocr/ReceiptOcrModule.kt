package expo.modules.receiptocr

import android.net.Uri
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.latin.TextRecognizerOptions
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Reads the text of a photo with ML Kit's bundled Latin-script model. Everything happens on the phone: the
 * model is part of the app, no network and no Google Play services are needed.
 *
 * Returns every recognised line with its position in pixels (top-left origin). Joining pieces that belong to
 * the same printed row happens in JavaScript (src/features/expenses/textRows.ts), shared with the iPhone.
 */
class ReceiptOcrModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("ReceiptOcr")

    AsyncFunction("recognizeText") { uri: String, promise: Promise ->
      val context = appContext.reactContext
      if (context == null) {
        promise.reject(CodedException("NO_CONTEXT", "The app is not ready yet.", null))
        return@AsyncFunction
      }
      try {
        // Handles file:// and content:// URIs alike, and applies the photo's orientation.
        val image = InputImage.fromFilePath(context, Uri.parse(uri))
        val recognizer = TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS)
        recognizer.process(image)
          .addOnSuccessListener { result ->
            val pieces = result.textBlocks.flatMap { block -> block.lines }.map { line ->
              val rect = line.boundingBox
              mapOf(
                "text" to line.text,
                "box" to rect?.let {
                  mapOf(
                    "left" to it.left.toDouble(),
                    "top" to it.top.toDouble(),
                    "right" to it.right.toDouble(),
                    "bottom" to it.bottom.toDouble(),
                  )
                },
              )
            }
            recognizer.close()
            promise.resolve(pieces)
          }
          .addOnFailureListener { error ->
            recognizer.close()
            promise.reject(CodedException("OCR_FAILED", error.message ?: "Text recognition failed.", error))
          }
      } catch (error: Exception) {
        promise.reject(CodedException("OCR_FAILED", error.message ?: "Could not read the image.", error))
      }
    }
  }
}
