package expo.modules.paseoscrollview

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * The scroll fix lives entirely in the native view/manager/package classes; this Module
 * exists only so expo autolinking treats modules/paseo-scrollview as a first-class Expo
 * module (matching the modules/paseo-downloads precedent) and links its android project.
 * It exposes no JS-facing API.
 */
class PaseoScrollViewModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("PaseoScrollView")
  }
}
