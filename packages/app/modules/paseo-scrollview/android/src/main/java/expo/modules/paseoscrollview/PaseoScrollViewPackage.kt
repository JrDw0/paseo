package expo.modules.paseoscrollview

import com.facebook.react.BaseReactPackage
import com.facebook.react.ViewManagerOnDemandReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.module.model.ReactModuleInfoProvider
import com.facebook.react.uimanager.ViewManager

/**
 * Under bridgeless, Fabric resolves each component's ViewManager by name in a lazy
 * "first claimant wins" pass over the packages list (BridgelessViewManagerResolver).
 * MainReactPackage is always index 0 of that list and lazily owns "RCTScrollView", so
 * for our subclass to win this package must (a) behave lazily like MainReactPackage and
 * (b) be inserted ahead of it. The with-selection-safe-scroll config plugin prepends it
 * inside MainApplication.getPackages().
 */
class PaseoScrollViewPackage :
  BaseReactPackage(),
  ViewManagerOnDemandReactPackage {

  override fun getViewManagerNames(reactContext: ReactApplicationContext): Collection<String> =
    listOf(RCT_SCROLL_VIEW)

  override fun createViewManager(
    reactContext: ReactApplicationContext,
    viewManagerName: String
  ): ViewManager<*, *>? =
    if (viewManagerName == RCT_SCROLL_VIEW) SelectionSafeScrollViewManager() else null

  override fun getModule(name: String, reactContext: ReactApplicationContext): NativeModule? = null

  override fun getReactModuleInfoProvider(): ReactModuleInfoProvider =
    ReactModuleInfoProvider { emptyMap() }

  private companion object {
    const val RCT_SCROLL_VIEW = "RCTScrollView"
  }
}
