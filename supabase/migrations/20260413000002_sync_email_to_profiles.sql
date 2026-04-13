-- Migration: Sync email from auth.users to profiles
-- Created: 2026-04-13
-- Description: Ensures email is synced from auth.users to profiles table

-- ============================================================================
-- UPDATE PROFILE CREATION TRIGGER TO INCLUDE EMAIL
-- ============================================================================

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (
    id, 
    full_name, 
    email,
    status, 
    role, 
    onboarding_step, 
    onboarding_done
  )
  VALUES (
    NEW.id,
    COALESCE(
      NEW.raw_user_meta_data->>'full_name',
      NEW.raw_user_meta_data->>'name',
      'New Member'
    ),
    NEW.email,
    'pending',
    'member',
    1,
    false
  )
  ON CONFLICT (id) DO NOTHING;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- CREATE TRIGGER TO SYNC EMAIL ON AUTH.USER UPDATE
-- ============================================================================

CREATE OR REPLACE FUNCTION public.handle_user_email_update()
RETURNS TRIGGER AS $$
BEGIN
  -- Only update if email has changed
  IF NEW.email IS DISTINCT FROM OLD.email THEN
    UPDATE public.profiles
    SET email = NEW.email,
        updated_at = NOW()
    WHERE id = NEW.id;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Drop if exists and recreate trigger
DROP TRIGGER IF EXISTS on_auth_user_email_updated ON auth.users;

CREATE TRIGGER on_auth_user_email_updated
  AFTER UPDATE ON auth.users
  FOR EACH ROW 
  EXECUTE FUNCTION public.handle_user_email_update();

-- Add comments
COMMENT ON FUNCTION public.handle_new_user() IS 'Creates profile with email when new auth user is created';
COMMENT ON FUNCTION public.handle_user_email_update() IS 'Syncs email to profiles when auth.users email changes';
