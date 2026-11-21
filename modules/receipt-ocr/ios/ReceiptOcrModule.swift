import ExpoModulesCore
import UIKit
import Vision

/**
 * Reads the text of a photo with Apple's Vision framework, on the phone. No network is used.
 *
 * Returns every recognised line with its position (fractions of the photo, top-left origin). Joining pieces
 * that belong to the same printed row happens in JavaScript (src/features/expenses/textRows.ts), shared with
 * Android.
 */
public class ReceiptOcrModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ReceiptOcr")

    // Runs off the main thread (async functions use the module's own queue).
    AsyncFunction("recognizeText") { (uri: URL) throws -> [[String: Any]] in
      guard let data = try? Data(contentsOf: uri), let image = UIImage(data: data), let cgImage = image.cgImage else {
        throw Exception(name: "OCR_FAILED", description: "Could not read the image.")
      }

      let request = VNRecognizeTextRequest()
      request.recognitionLevel = .accurate

      // Photos from the camera are stored sideways with an orientation flag; Vision needs to know it.
      let handler = VNImageRequestHandler(
        cgImage: cgImage,
        orientation: CGImagePropertyOrientation(image.imageOrientation),
        options: [:]
      )
      do {
        try handler.perform([request])
      } catch {
        throw Exception(name: "OCR_FAILED", description: error.localizedDescription)
      }

      let observations = request.results ?? []
      return observations.compactMap { observation -> [String: Any]? in
        guard let text = observation.topCandidates(1).first?.string else { return nil }
        // Vision measures from the bottom-left corner; turn it into top-left like Android.
        let box = observation.boundingBox
        let position: [String: Any] = [
          "left": Double(box.minX),
          "top": Double(1 - box.maxY),
          "right": Double(box.maxX),
          "bottom": Double(1 - box.minY),
        ]
        return ["text": text, "box": position]
      }
    }
  }
}

private extension CGImagePropertyOrientation {
  init(_ orientation: UIImage.Orientation) {
    switch orientation {
    case .up: self = .up
    case .upMirrored: self = .upMirrored
    case .down: self = .down
    case .downMirrored: self = .downMirrored
    case .left: self = .left
    case .leftMirrored: self = .leftMirrored
    case .right: self = .right
    case .rightMirrored: self = .rightMirrored
    @unknown default: self = .up
    }
  }
}
