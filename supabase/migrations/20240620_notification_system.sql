-- Migration: Notification System with Expo Push and WebSocket Support
-- Created: 2024-06-20
-- Description: Sets up notification infrastructure with auto-cleanup

-- ============================================================================
-- 1. UPDATE PROFILES TABLE
-- Remove FCM token, add Expo Push token
-- ============================================================================

-- Drop old FCM column if exists
ALTER TABLE public.profiles 
  DROP COLUMN IF EXISTS fcm_token,
  DROP COLUMN IF EXISTS web_push_subscription;

-- Add Expo push token column
ALTER TABLE public.profiles 
  ADD COLUMN IF NOT EXISTS expo_push_token TEXT,
  ADD COLUMN IF NOT EXISTS push_notifications_enabled BOOLEAN DEFAULT true;

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_profiles_expo_token ON public.profiles(expo_push_token) 
  WHERE expo_push_token IS NOT NULL;

COMMENT ON COLUMN public.profiles.expo_push_token IS 'Expo Push Notification token for mobile app';
COMMENT ON COLUMN public.profiles.push_notifications_enabled IS 'Whether user wants to receive push notifications';

-- ============================================================================
-- 2. NOTIFICATION PREFERENCES TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.notification_preferences (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    member_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
    payments_enabled BOOLEAN DEFAULT true,
    loans_enabled BOOLEAN DEFAULT true,
    announcements_enabled BOOLEAN DEFAULT true,
    messages_enabled BOOLEAN DEFAULT true,
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(member_id)
);

COMMENT ON TABLE public.notification_preferences IS 'User notification preferences by type';

-- Enable RLS
ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_preferences FORCE ROW LEVEL SECURITY;

-- RLS Policies for notification_preferences
CREATE POLICY "Users can view own preferences"
  ON public.notification_preferences FOR SELECT
  USING (auth.uid() = member_id);

CREATE POLICY "Users can update own preferences"
  ON public.notification_preferences FOR ALL
  USING (auth.uid() = member_id);

CREATE POLICY "Admins can view all preferences"
  ON public.notification_preferences FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

-- ============================================================================
-- 3. NOTIFICATION LOGS TABLE
-- Tracks all sent notifications for debugging and history
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.notification_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    recipient_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    type TEXT NOT NULL CHECK (type IN ('payment', 'loan', 'announcement', 'message', 'system')),
    channel TEXT NOT NULL CHECK (channel IN ('push', 'websocket')),
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    data JSONB DEFAULT '{}',
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'delivered', 'failed')),
    error_message TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    delivered_at TIMESTAMPTZ
);

COMMENT ON TABLE public.notification_logs IS 'Audit log of all notifications sent';

-- Create indexes for performance and cleanup
CREATE INDEX IF NOT EXISTS idx_notification_logs_created_at ON public.notification_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_notification_logs_recipient ON public.notification_logs(recipient_id);
CREATE INDEX IF NOT EXISTS idx_notification_logs_status ON public.notification_logs(status);

-- Enable RLS
ALTER TABLE public.notification_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_logs FORCE ROW LEVEL SECURITY;

-- RLS Policies for notification_logs
CREATE POLICY "Users can view own notification history"
  ON public.notification_logs FOR SELECT
  USING (auth.uid() = recipient_id);

CREATE POLICY "Admins can view all logs"
  ON public.notification_logs FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

-- ============================================================================
-- 4. AUTO-CLEANUP FUNCTION
-- Removes notifications older than 60 days
-- ============================================================================

CREATE OR REPLACE FUNCTION public.cleanup_old_notifications()
RETURNS INTEGER AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM public.notification_logs 
  WHERE created_at < NOW() - INTERVAL '60 days';
  
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  
  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION public.cleanup_old_notifications() IS 
'Deletes notification logs older than 60 days. Returns count of deleted records.';

-- ============================================================================
-- 5. TRIGGER TO AUTO-CREATE PREFERENCES
-- Creates default preferences when new profile is created
-- ============================================================================

CREATE OR REPLACE FUNCTION public.handle_new_notification_preferences()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.notification_preferences (
    member_id,
    payments_enabled,
    loans_enabled,
    announcements_enabled,
    messages_enabled
  )
  VALUES (
    NEW.id,
    true,
    true,
    true,
    true
  )
  ON CONFLICT (member_id) DO NOTHING;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Drop if exists and create trigger
DROP TRIGGER IF EXISTS on_profile_create_preferences ON public.profiles;

CREATE TRIGGER on_profile_create_preferences
  AFTER INSERT ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_notification_preferences();

COMMENT ON TRIGGER on_profile_create_preferences ON public.profiles IS 
'Auto-creates default notification preferences for new users';

-- ============================================================================
-- 6. NOTIFICATION DELIVERY STATUS UPDATE TRIGGER
-- Automatically sets delivered_at timestamp when status changes to delivered
-- ============================================================================

CREATE OR REPLACE FUNCTION public.set_notification_delivered_at()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'delivered' AND OLD.status != 'delivered' THEN
    NEW.delivered_at = NOW();
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS on_notification_status_change ON public.notification_logs;

CREATE TRIGGER on_notification_status_change
  BEFORE UPDATE ON public.notification_logs
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION public.set_notification_delivered_at();

-- ============================================================================
-- 7. GRANT PERMISSIONS
-- ============================================================================

-- Allow authenticated users to access their own data
GRANT SELECT, INSERT, UPDATE ON public.notification_preferences TO authenticated;
GRANT SELECT ON public.notification_logs TO authenticated;

-- Allow service role full access (for backend)
GRANT ALL ON public.notification_preferences TO service_role;
GRANT ALL ON public.notification_logs TO service_role;

-- ============================================================================
-- MIGRATION COMPLETE
-- ============================================================================
