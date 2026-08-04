import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { Keyboard, useWindowDimensions } from "react-native";
import type { GestureType } from "react-native-gesture-handler";
import {
  cancelAnimation,
  useSharedValue,
  withSpring,
  type SharedValue,
} from "react-native-reanimated";
import { scheduleOnRN, scheduleOnUI } from "react-native-worklets";
import { isNative } from "@/constants/platform";
import {
  usePanelStore,
  type MobilePanelSelection,
  type MobilePanelView,
} from "@/stores/panel-store";
import {
  canBeginMobilePanelGesture,
  createMobilePanelMotionState,
  getMobilePanelAnchor,
  isMobilePanelGestureCurrent,
  transitionMobilePanel,
  type MobilePanelCommit,
  type MobilePanelMotionState,
  type MobilePanelTransition,
} from "./model";

// Slightly underdamped drawer spring: fast, with a small settle bounce so the
// panel reads as physical rather than a fixed-timer move. Gesture release feeds
// its velocity in so a fling keeps the finger's momentum (things/Fantastical feel).
const SPRING_DAMPING = 22;
const SPRING_STIFFNESS = 200;
const SPRING_MASS = 1;
// Released past an anchor, position keeps a damped overrun before the spring
// settles back — a constrained rubber-band, not a wall.
const OVERRUN_DAMPING = 0.35;
const OVERRUN_LIMIT = 0.06;
// A fling's traversal speed is carried by the spring stiffness itself — from
// rest a full-panel swing already reaches ~5 units/s — so the fed release
// velocity mostly sets the settle bounce, not the speed. Overshoot past the
// anchor ≈ velocity / ω_d, and with damping 22 / stiffness 200 the damped
// frequency ω_d ≈ 8.9. Capping at 0.55 lands that bounce at ≈ OVERRUN_LIMIT
// (6%); the old 6 units/s let a rage-fling rubber-band ~⅔ of the window
// off-screen before settling back.
const MAX_SETTLE_VELOCITY = 0.55;

const LEFT_PANEL_MASK = 1;
const RIGHT_PANEL_MASK = 2;

function getPanelMask(panel: MobilePanelView): number {
  if (panel === "agent-list") {
    return LEFT_PANEL_MASK;
  }
  if (panel === "file-explorer") {
    return RIGHT_PANEL_MASK;
  }
  return 0;
}

interface MobilePanelsRuntime {
  beginGesture: (input: BeginGestureInput) => number;
  finishGesture: (input: FinishGestureInput) => MobilePanelCommit | null;
  leftCloseGestureRef: RefObject<GestureType | undefined>;
  leftOpenGestureRef: RefObject<GestureType | undefined>;
  motionState: SharedValue<MobilePanelMotionState>;
  openGesturesBlocked: SharedValue<boolean>;
  position: SharedValue<number>;
  rightCloseGestureRef: RefObject<GestureType | undefined>;
  rightOpenGestureRef: RefObject<GestureType | undefined>;
  updateGesture: (startedRevision: number, nextPosition: number) => boolean;
  setOpenGestureBlocked: (owner: symbol, blocked: boolean) => void;
  windowWidth: number;
}

interface BeginGestureInput {
  origin: MobilePanelView;
  preview: MobilePanelView;
}

interface FinishGestureInput {
  startedRevision: number;
  success: boolean;
  target: MobilePanelView;
  /** Finger release velocity in px/s; routed into the settle spring so flings keep momentum. */
  velocityX?: number;
}

const MobilePanelsContext = createContext<MobilePanelsRuntime | null>(null);
const MobilePanelPresentationContext = createContext(0);

export function MobilePanelsProvider({ children }: { children: ReactNode }) {
  const { width: windowWidth } = useWindowDimensions();
  const initialSelection = useRef(usePanelStore.getState().mobilePanel).current;
  const position = useSharedValue(getMobilePanelAnchor(initialSelection.target));
  const motionState = useSharedValue(createMobilePanelMotionState(initialSelection));
  const openGesturesBlocked = useSharedValue(false);
  const openGestureBlockersRef = useRef(new Set<symbol>());
  const leftOpenGestureRef = useRef<GestureType | undefined>(undefined);
  const leftCloseGestureRef = useRef<GestureType | undefined>(undefined);
  const rightOpenGestureRef = useRef<GestureType | undefined>(undefined);
  const rightCloseGestureRef = useRef<GestureType | undefined>(undefined);
  const [presentedPanels, setPresentedPanels] = useState(getPanelMask(initialSelection.target));

  const setOpenGestureBlocked = useCallback(
    (owner: symbol, blocked: boolean) => {
      if (blocked) {
        openGestureBlockersRef.current.add(owner);
      } else {
        openGestureBlockersRef.current.delete(owner);
      }
      openGesturesBlocked.value = openGestureBlockersRef.current.size > 0;
    },
    [openGesturesBlocked],
  );

  const presentPanel = useCallback((panel: MobilePanelView) => {
    const mask = getPanelMask(panel);
    if (mask) {
      setPresentedPanels((current) => current | mask);
    }
  }, []);

  const settlePresentation = useCallback((panel: MobilePanelView, revision: number) => {
    const selection = usePanelStore.getState().mobilePanel;
    if (selection.revision !== revision || selection.target !== panel) {
      return;
    }
    setPresentedPanels(getPanelMask(panel));
  }, []);

  const animateTransition = useCallback(
    (transition: MobilePanelTransition, velocityPositionUnits = 0) => {
      "worklet";
      if (!transition.animationTarget) {
        return;
      }
      const target = transition.animationTarget;
      const revision = transition.state.revision;
      position.value = withSpring(
        getMobilePanelAnchor(target),
        {
          damping: SPRING_DAMPING,
          stiffness: SPRING_STIFFNESS,
          mass: SPRING_MASS,
          // Position is normalized to window width, so px/s becomes units/s.
          velocity: velocityPositionUnits,
          // Settle once the remaining travel is below ~0.1% of the window so the
          // spring doesn't run a long invisible micro-bounce tail.
          energyThreshold: 0.0001,
        },
        (finished) => {
          if (!finished) {
            return;
          }
          const currentState = motionState.value;
          const settled = transitionMobilePanel(currentState, {
            type: "animation.finished",
            revision,
            target,
          });
          if (settled.state === currentState) {
            return;
          }
          motionState.value = settled.state;
          scheduleOnRN(settlePresentation, target, revision);
        },
      );
    },
    [motionState, position, settlePresentation],
  );

  const applySelection = useCallback(
    (selection: MobilePanelSelection) => {
      "worklet";
      const currentState = motionState.value;
      const transition = transitionMobilePanel(currentState, {
        type: "command",
        selection,
      });
      if (transition.state === currentState) {
        return;
      }
      motionState.value = transition.state;
      animateTransition(transition, 0);
    },
    [animateTransition, motionState],
  );

  useEffect(() => {
    return usePanelStore.subscribe((state, previousState) => {
      const selection = state.mobilePanel;
      if (selection === previousState.mobilePanel) {
        return;
      }
      if (selection.target !== "agent") {
        presentPanel(selection.target);
        if (isNative) {
          Keyboard.dismiss();
        }
      }
      scheduleOnUI(applySelection, selection);
    });
  }, [applySelection, presentPanel]);

  const beginGesture = useCallback(
    ({ origin, preview }: BeginGestureInput): number => {
      "worklet";
      const currentState = motionState.value;
      if (!canBeginMobilePanelGesture(currentState, origin, position.value)) {
        return -1;
      }
      const transition = transitionMobilePanel(currentState, {
        type: "gesture.begin",
        origin,
      });
      motionState.value = transition.state;
      cancelAnimation(position);
      scheduleOnRN(presentPanel, preview);
      return transition.state.gesture?.startedRevision ?? -1;
    },
    [motionState, position, presentPanel],
  );

  const updateGesture = useCallback(
    (startedRevision: number, nextPosition: number): boolean => {
      "worklet";
      if (!isMobilePanelGestureCurrent(motionState.value, startedRevision)) {
        return false;
      }
      let bounded = nextPosition;
      if (nextPosition > 1) {
        bounded = Math.min(1 + OVERRUN_LIMIT, 1 + (nextPosition - 1) * OVERRUN_DAMPING);
      } else if (nextPosition < -1) {
        bounded = Math.max(-1 - OVERRUN_LIMIT, -1 + (nextPosition + 1) * OVERRUN_DAMPING);
      }
      position.value = bounded;
      return true;
    },
    [motionState, position],
  );

  const finishGesture = useCallback(
    ({
      startedRevision,
      target,
      success,
      velocityX = 0,
    }: FinishGestureInput): MobilePanelCommit | null => {
      "worklet";
      const currentState = motionState.value;
      const transition = transitionMobilePanel(currentState, {
        type: "gesture.finish",
        startedRevision,
        success,
        target,
      });
      if (transition.state === currentState) {
        return null;
      }
      motionState.value = transition.state;
      // Position always maps as -translationX/windowWidth (or its offset), so the
      // spring's unit velocity is the NEGATED finger velocity; feeding +velocityX
      // made flings counter-kick against the flick before settling.
      const settleVelocity = Math.max(
        -MAX_SETTLE_VELOCITY,
        Math.min(MAX_SETTLE_VELOCITY, -velocityX / windowWidth),
      );
      animateTransition(transition, settleVelocity);
      return transition.commit ?? null;
    },
    [animateTransition, motionState, windowWidth],
  );

  const value = useMemo<MobilePanelsRuntime>(
    () => ({
      beginGesture,
      finishGesture,
      leftCloseGestureRef,
      leftOpenGestureRef,
      motionState,
      openGesturesBlocked,
      position,
      rightCloseGestureRef,
      rightOpenGestureRef,
      updateGesture,
      setOpenGestureBlocked,
      windowWidth,
    }),
    [
      beginGesture,
      finishGesture,
      motionState,
      openGesturesBlocked,
      position,
      setOpenGestureBlocked,
      updateGesture,
      windowWidth,
    ],
  );

  return (
    <MobilePanelsContext.Provider value={value}>
      <MobilePanelPresentationContext.Provider value={presentedPanels}>
        {children}
      </MobilePanelPresentationContext.Provider>
    </MobilePanelsContext.Provider>
  );
}

/** Internal to the mobile-panels module. Callers use gesture and presentation adapters. */
export function useMobilePanelsRuntime(): MobilePanelsRuntime {
  const context = useContext(MobilePanelsContext);
  if (!context) {
    throw new Error("useMobilePanelsRuntime must be used within MobilePanelsProvider");
  }
  return context;
}

export function useIsMobilePanelPresented(panel: MobilePanelView): boolean {
  const presentedPanels = useContext(MobilePanelPresentationContext);
  return (presentedPanels & getPanelMask(panel)) !== 0;
}

export function useBlockMobilePanelOpenGestures(blocked: boolean): void {
  const { setOpenGestureBlocked } = useMobilePanelsRuntime();
  const owner = useRef(Symbol("mobile-panel-open-gesture-blocker")).current;

  useLayoutEffect(() => {
    setOpenGestureBlocked(owner, blocked);
    return () => setOpenGestureBlocked(owner, false);
  }, [blocked, owner, setOpenGestureBlocked]);
}
