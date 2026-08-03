import { useEffect } from "react";
import { Platform } from "react-native";
import * as Notifications from "expo-notifications";
import { isWeb } from "@/constants/platform";

// Initialize the native notification channel and permission so attention
// notifications can be presented on Android. Local-only: the app presents
// them itself when the daemon streams an attention event over the WebSocket.
// Remote Expo push (getExpoPushTokenAsync / registerPushToken) was dropped —
// it depended on GMS and never worked on domestic Chinese Android.
async function ensurePermission(): Promise<boolean> {
  const existing = await Notifications.getPermissionsAsync();
  if (existing.status === Notifications.PermissionStatus.GRANTED) {
    return true;
  }
  if (!existing.canAskAgain) {
    return false;
  }
  const requested = await Notifications.requestPermissionsAsync();
  return requested.status === Notifications.PermissionStatus.GRANTED;
}

export function useNativeNotificationSetup(): void {
  useEffect(() => {
    if (isWeb) {
      return;
    }
    let cancelled = false;

    void (async () => {
      const granted = await ensurePermission();
      if (cancelled || !granted) {
        return;
      }
      if (Platform.OS === "android") {
        await Notifications.setNotificationChannelAsync("default", {
          name: "通知",
          importance: Notifications.AndroidImportance.HIGH,
        });
      }
    })().catch(() => {});

    return () => {
      cancelled = true;
    };
  }, []);
}
