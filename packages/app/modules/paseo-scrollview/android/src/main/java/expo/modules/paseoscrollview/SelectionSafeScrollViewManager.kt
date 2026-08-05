package expo.modules.paseoscrollview

import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.views.scroll.ReactScrollView
import com.facebook.react.views.scroll.ReactScrollViewManager

/**
 * Registered under the same "RCTScrollView" component name so the stock JS <ScrollView>
 * (and therefore the conversation FlatList) mounts SelectionSafeScrollView instead of a
 * plain ReactScrollView. Every @ReactProp, exported scroll event, and scroll command is
 * inherited from ReactScrollViewManager, so no JS-facing behavior changes — only the
 * focus-scroll suppression on the view itself.
 */
class SelectionSafeScrollViewManager : ReactScrollViewManager() {
  override fun createViewInstance(context: ThemedReactContext): ReactScrollView =
    SelectionSafeScrollView(context)
}
