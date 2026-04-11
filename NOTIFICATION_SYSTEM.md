# Notification System Documentation

Complete notification service implementation for DOMICOP with Expo Push Notifications and WebSocket real-time updates.

## Overview

The notification system supports:
- **Mobile Push Notifications** via Expo Push API
- **Real-time Admin Dashboard** updates via WebSocket
- **User Preferences** for notification types
- **Notification History** with 60-day auto-cleanup
- **Batch Sending** (up to 500 per batch)

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    NOTIFICATION SERVICE                      │
├─────────────────────────────────────────────────────────────┤
│  REST API (/notifications/*)                                │
│  WebSocket Server (/ws/notifications)                      │
│  └── Mobile clients (Expo)                                 │
│  └── Admin dashboard (TanStack Start)                      │
└─────────────────────────────────────────────────────────────┘
                              │
        ┌─────────────────────┼─────────────────────┐
        ▼                     ▼                     ▼
┌──────────────┐    ┌──────────────┐    ┌──────────────────┐
│  Expo Push   │    │  WebSocket   │    │  Auto Cleanup    │
│  (Mobile)    │    │  (Real-time) │    │  (60 days)       │
└──────────────┘    └──────────────┘    └──────────────────┘
```

## Database Schema

### Tables

**notification_preferences**
```sql
- member_id (UUID)
- payments_enabled (boolean)
- loans_enabled (boolean)
- announcements_enabled (boolean)
- messages_enabled (boolean)
```

**notification_logs**
```sql
- id (UUID)
- recipient_id (UUID)
- type (payment|loan|announcement|message|system)
- channel (push|websocket)
- title (text)
- body (text)
- status (pending|sent|delivered|failed)
- created_at (timestamp)
```

### Auto-Cleanup

Notifications older than 60 days are automatically deleted via database function:
```sql
SELECT cleanup_old_notifications();
```

## API Endpoints

### User Endpoints (Authenticated)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/notifications/expo-token` | POST | Register Expo push token |
| `/notifications/expo-token` | DELETE | Remove push token |
| `/notifications/preferences` | GET | Get notification preferences |
| `/notifications/preferences` | PATCH | Update preferences |
| `/notifications/me` | GET | Get notification history |
| `/notifications/me/read` | PATCH | Mark notification as read |

### Admin Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/notifications/broadcast` | POST | Send notification to users |

### WebSocket

| Endpoint | Protocol | Description |
|----------|----------|-------------|
| `/ws/notifications` | WebSocket | Real-time notification stream |

## Configuration

### Environment Variables

```env
# Required
EXPO_ACCESS_TOKEN=your-expo-access-token

# Optional
WS_URL=wss://api.domicop.com
REQUIRE_EMAIL_VERIFICATION=true
```

### Expo Setup

1. Get your Expo Access Token:
   - Go to https://expo.dev/accounts/[username]/settings/access-tokens
   - Create new token
   - Copy to `.env`

2. Update your Expo project ID in the mobile app:
   ```typescript
   const token = await Notifications.getExpoPushTokenAsync({
     projectId: "005a3826-e772-4bfa-8f5c-6be57a2232ca",
   });
   ```

## Usage Examples

### Sending Push Notifications

**From Backend:**
```typescript
import { NotificationService } from './services/notificationService';

const service = NotificationService.getInstance();

// Send to specific users
await service.sendPushNotifications(
  ['user-id-1', 'user-id-2'],
  {
    title: "Loan Approved",
    body: "Your loan application has been approved!",
    data: { type: "loan", loanId: "123" }
  }
);

// Broadcast to all admins
service.broadcastToAdmins(server, {
  title: "New Member",
  body: "A new member has registered"
});
```

**Via API:**
```bash
curl -X POST https://api.domicop.com/notifications/broadcast \
  -H "Authorization: Bearer <admin-token>" \
  -H "Content-Type: application/json" \
  -d '{
    "target": { "role": "member", "all": true },
    "notification": {
      "title": "Meeting Tomorrow",
      "body": "Monthly meeting at 2 PM"
    },
    "channels": ["push", "admin"]
  }'
```

### Mobile App Integration

```typescript
import { registerForPushNotifications, setupNotificationHandlers } from './notifications';

// In your app initialization
useEffect(() => {
  registerForPushNotifications();
  setupNotificationHandlers();
}, []);
```

### Admin Dashboard Integration

```typescript
import { useEffect } from 'react';

// WebSocket connection
useEffect(() => {
  const ws = new WebSocket('wss://api.domicop.com/ws/notifications');
  
  ws.onopen = () => {
    ws.send(JSON.stringify({ type: 'auth', token: accessToken }));
  };
  
  ws.onmessage = (event) => {
    const data = JSON.parse(event.data);
    if (data.type === 'notification') {
      showToast(data.title, data.body);
    }
  };
  
  return () => ws.close();
}, []);
```

## Testing

### Test Push Notifications

1. **Register device:**
   ```bash
   curl -X POST http://localhost:3000/notifications/expo-token \
     -H "Authorization: Bearer <token>" \
     -H "Content-Type: application/json" \
     -d '{"expo_push_token": "ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]"}'
   ```

2. **Send test notification:**
   ```bash
   curl -X POST http://localhost:3000/notifications/broadcast \
     -H "Authorization: Bearer <admin-token>" \
     -H "Content-Type: application/json" \
     -d '{
       "target": { "userIds": ["your-user-id"] },
       "notification": { "title": "Test", "body": "Hello!" },
       "channels": ["push"]
     }'
   ```

### Test WebSocket

```javascript
const ws = new WebSocket('ws://localhost:3000/ws/notifications');
ws.onopen = () => {
  ws.send(JSON.stringify({ type: 'auth', token: 'your-token' }));
};
ws.onmessage = (e) => console.log(e.data);
```

## Migration

Apply the database migration:

```bash
supabase db push
```

Or manually run in SQL Editor:
```sql
-- File: supabase/migrations/20240620_notification_system.sql
```

## Cleanup Job

The cleanup job runs automatically via database trigger. To run manually:

```bash
# Via SQL
SELECT cleanup_old_notifications();

# Via TypeScript
import { cleanupOldNotifications } from './jobs/cleanupNotifications';
await cleanupOldNotifications();
```

## Troubleshooting

### Push notifications not received

1. Check Expo token is saved: `SELECT expo_push_token FROM profiles`
2. Verify `EXPO_ACCESS_TOKEN` is set correctly
3. Check notification preferences are enabled
4. Test with Expo Push Tool: https://expo.dev/notifications

### WebSocket not connecting

1. Verify token is valid and not expired
2. Check CORS settings for WebSocket
3. Ensure `ws://` or `wss://` protocol is used
4. Check browser console for errors

### Notifications not being logged

1. Check `notification_logs` table exists
2. Verify RLS policies allow inserts
3. Check service role has proper permissions

## File Structure

```
src/
├── services/
│   └── notificationService.ts    # Main notification service
├── routes/
│   ├── notifications.ts          # REST API endpoints
│   └── websocket.ts              # WebSocket routes
├── jobs/
│   └── cleanupNotifications.ts   # Cleanup job
└── index.ts                      # Main app (updated)

supabase/migrations/
└── 20240620_notification_system.sql  # Database schema

mobile-examples/
└── notifications.ts              # Mobile integration
```

## Dependencies

```bash
# Backend
bun add expo-server-sdk

# Mobile
npx expo install expo-notifications expo-device
```

## Next Steps

1. ✅ Apply database migration
2. ✅ Set `EXPO_ACCESS_TOKEN` in `.env`
3. ✅ Test push notifications on mobile
4. ✅ Test WebSocket on admin dashboard
5. ✅ Schedule cleanup job in production

## Support

For issues with:
- **Expo Push**: Check https://docs.expo.dev/push-notifications/overview/
- **WebSocket**: See Elysia WebSocket docs
- **Database**: Check Supabase logs
