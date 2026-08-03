import type pino from "pino";

import { PushService, type PushPayload } from "./push-service.js";
import type { PushTokenStore } from "./token-store.js";

export type { PushPayload };

export interface PushNotificationSender {
  send(payload: PushPayload): Promise<void>;
}

/**
 * Remote Expo push is disabled (it routes via GMS and never reaches domestic
 * Chinese Android). The app now presents notifications itself from WebSocket
 * attention events, so the default sender is a no-op. `createPushNotificationSender`
 * / `PushService` are kept for re-enabling a vendor channel later.
 */
export function createDisabledPushNotificationSender(logger: pino.Logger): PushNotificationSender {
  return {
    async send(payload) {
      logger.info({ title: payload.title }, "Push notification skipped: remote push disabled");
    },
  };
}

export function createPushNotificationSender(
  logger: pino.Logger,
  tokenStore: PushTokenStore,
): PushNotificationSender {
  const pushService = new PushService(logger, tokenStore);

  return {
    async send(payload) {
      const tokens = tokenStore.getAllTokens();
      logger.info({ tokenCount: tokens.length }, "Sending push notification");
      if (tokens.length === 0) {
        return;
      }

      await pushService.sendPush(tokens, payload);
    },
  };
}
