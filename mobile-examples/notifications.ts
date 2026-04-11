/**
 * Expo Push Notifications Integration
 *
 * Complete implementation for handling push notifications in Expo mobile app.
 * Includes permission handling, token registration, and notification handlers.
 *
 * @module mobile/notifications
 * @requires expo-notifications
 * @requires expo-device
 *
 * @example
 * ```typescript
 * import { registerForPushNotifications, setupNotificationHandlers } from './notifications';
 *
 * // In your app initialization:
 * useEffect(() => {
 *   registerForPushNotifications();
 *   setupNotificationHandlers();
 * }, []);
 * ```
 */

import * as Notifications from "expo-notifications";
import * as Device from "expo-device";
import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";
import { router } from "expo-router";

const API_URL = process.env.EXPO_PUBLIC_API_URL || "https://your-api.com";

/**
 * Register for push notifications and save token to backend
 *
 * Requests permissions, gets Expo push token, and sends it to the backend.
 * Should be called on app startup or after user login.
 *
 * @returns {Promise<string | null>} Expo push token or null if failed
 *
 * @example
 * ```typescript
 * const token = await registerForPushNotificationsAsync();
 * if (token) {
 *   console.log('Push token:', token);
 * }
 * ```
 */
export async function registerForPushNotificationsAsync(): Promise<string | null> {
  let token: string | null = null;

  // Configure Android notification channel
  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("default", {
      name: "default",
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: "#FF231F7C",
    });
  }

  // Only get token on physical device (not simulator)
  if (Device.isDevice) {
    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;

    // Request permission if not granted
    if (existingStatus !== "granted") {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }

    if (finalStatus !== "granted") {
      console.log("[Notifications] Permission not granted");
      return null;
    }

    // Get Expo push token
    try {
      const expoToken = await Notifications.getExpoPushTokenAsync({
        projectId: "005a3826-e772-4bfa-8f5c-6be57a2232ca",
      });
      token = expoToken.data;

      // Save to backend
      await saveExpoPushToken(token);
    } catch (error) {
      console.error("[Notifications] Error getting push token:", error);
      return null;
    }
  } else {
    console.log("[Notifications] Must use physical device for push notifications");
  }

  return token;
}

/**
 * Save Expo push token to backend
 *
 * @private
 * @param {string} token - Expo push token
 * @returns {Promise<void>}
 */
async function saveExpoPushToken(token: string): Promise<void> {
  try {
    const accessToken = await SecureStore.getItemAsync("access_token");

    if (!accessToken) {
      console.error("[Notifications] No access token available");
      return;
    }

    const response = await fetch(`${API_URL}/notifications/expo-token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ expo_push_token: token }),
    });

    if (!response.ok) {
      console.error("[Notifications] Failed to save token:", await response.text());
    } else {
      console.log("[Notifications] Token saved successfully");
    }
  } catch (error) {
    console.error("[Notifications] Error saving token:", error);
  }
}

/**
 * Delete push token from backend
 *
 * Call this on logout to stop receiving notifications
 *
 * @returns {Promise<void>}
 *
 * @example
 * ```typescript
 * await deleteExpoPushToken();
 * ```
 */
export async function deleteExpoPushToken(): Promise<void> {
  try {
    const accessToken = await SecureStore.getItemAsync("access_token");

    if (!accessToken) return;

    const response = await fetch(`${API_URL}/notifications/expo-token`, {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (response.ok) {
      console.log("[Notifications] Token deleted successfully");
    }
  } catch (error) {
    console.error("[Notifications] Error deleting token:", error);
  }
}

/**
 * Setup notification handlers
 *
 * Configures how the app handles received notifications.
 * Should be called once on app initialization.
 *
 * @returns {void}
 *
 * @example
 * ```typescript
 * useEffect(() => {
 *   setupNotificationHandlers();
 * }, []);
 * ```
 */
export function setupNotificationHandlers(): void {
  // Handle notifications received while app is foregrounded
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldPlaySound: true,
      shouldSetBadge: true,
    }),
  });

  // Handle notification response (user taps notification)
  Notifications.addNotificationResponseReceivedListener((response) => {
    const data = response.notification.request.content.data;

    console.log("[Notifications] User tapped notification:", data);

    // Navigate based on notification type
    handleNotificationNavigation(data);
  });

  // Handle notifications received while app is backgrounded
  Notifications.addNotificationReceivedListener((notification) => {
    console.log("[Notifications] Received in background:", notification);
  });
}

/**
 * Handle navigation from notification tap
 *
 * @private
 * @param {any} data - Notification data payload
 */
function handleNotificationNavigation(data: any): void {
  if (!data?.type) return;

  switch (data.type) {
    case "loan":
      router.push("/loans");
      break;
    case "payment":
    case "contribution":
      router.push("/contributions");
      break;
    case "message":
      router.push("/messages");
      break;
    case "announcement":
      router.push("/announcements");
      break;
    default:
      console.log("[Notifications] Unknown type:", data.type);
  }
}

/**
 * Hook for using notifications in React components
 *
 * @example
 * ```typescript
 * import { usePushNotifications } from './notifications';
 *
 * function MyComponent() {
 *   const { expoPushToken, notification } = usePushNotifications();
 *
 *   return (
 *     <View>
 *       <Text>Token: {expoPushToken}</Text>
 *     </View>
 *   );
 * }
 * ```
 */
export function usePushNotifications() {
  const [expoPushToken, setExpoPushToken] = useState<string | null>(null);
  const [notification, setNotification] = useState<Notifications.Notification | null>(null);

  useEffect(() => {
    registerForPushNotificationsAsync().then((token) => {
      setExpoPushToken(token);
    });

    setupNotificationHandlers();

    const subscription = Notifications.addNotificationReceivedListener((notification) => {
      setNotification(notification);
    });

    return () => {
      subscription.remove();
    };
  }, []);

  return { expoPushToken, notification };
}

// Import React hook dependencies
import { useState, useEffect } from "react";
