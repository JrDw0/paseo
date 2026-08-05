package expo.modules.paseoscrollview

import android.content.Context
import android.graphics.Rect
import android.util.Log
import android.view.View
import android.widget.TextView
import com.facebook.react.views.scroll.ReactScrollView

/**
 * Long-press on a selectable <Text> gives that TextView focus so Android can start
 * native text selection. Both stock ScrollView and ReactScrollView.requestChildFocus
 * respond by scrolling the newly focused child fully on screen, aligning its top edge
 * to the viewport. For a message body taller than the viewport that rect is far off
 * screen, so the page yanks the pressed content out from under the user's finger.
 *
 * We suppress that focus-driven scroll only on the touch long-press path. Both the RN
 * scrollToChild path and stock ScrollView's own focus scroll funnel through the
 * protected virtual [computeScrollDeltaToGetChildRectOnScreen], so returning 0 there
 * during a selection focus intercepts every code path without skipping any super
 * bookkeeping.
 *
 * The [isInTouchMode] guard scopes the suppression to touch: hardware-keyboard TAB and
 * D-pad focus navigation run outside touch mode and still need the original
 * scroll-to-child (RN's requestChildFocus override exists precisely to fix that path).
 * TalkBack is unaffected because accessibility focus never routes through
 * requestChildFocus — it drives scrolling via requestChildRectangleOnScreen.
 *
 * Deliberately left alone:
 *  - Real text inputs (ReactEditText.isTextSelectable is false), which still need the
 *    keyboard-reveal scroll.
 *  - Selection-handle drag auto-scroll, which uses requestChildRectangleOnScreen and
 *    never passes through requestChildFocus.
 */
class SelectionSafeScrollView(context: Context) : ReactScrollView(context) {
  private var suppressFocusScroll = false

  init {
    Log.d("PaseoScrollView", "SelectionSafeScrollView mounted")
  }

  override fun requestChildFocus(child: View, focused: View) {
    // Save/restore (not set/clear) so a nested requestChildFocus re-entering during
    // super can't drop the outer frame's suppression and reintroduce the yank.
    val previous = suppressFocusScroll
    suppressFocusScroll =
      isInTouchMode && focused is TextView && focused.isTextSelectable
    try {
      super.requestChildFocus(child, focused)
    } finally {
      suppressFocusScroll = previous
    }
  }

  override fun computeScrollDeltaToGetChildRectOnScreen(rect: Rect): Int =
    if (suppressFocusScroll) 0 else super.computeScrollDeltaToGetChildRectOnScreen(rect)
}
