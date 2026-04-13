-- Migration: Consolidate onboarding into registration
-- Created: 2026-04-13
-- Description: Updates the handle_new_user trigger to include all profile fields during registration

-- ============================================================================
-- UPDATE PROFILE CREATION TRIGGER TO INCLUDE ALL FIELDS
-- ============================================================================

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (
    id, 
    full_name, 
    email,
    phone,
    address,
    bank_name,
    bank_account,
    bank_code,
    avatar_url,
    next_of_kin,
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
    COALESCE(NEW.raw_user_meta_data->>'phone', ''),
    COALESCE(NEW.raw_user_meta_data->>'address', ''),
    COALESCE(NEW.raw_user_meta_data->>'bank_name', ''),
    COALESCE(NEW.raw_user_meta_data->>'bank_account', ''),
    COALESCE(NEW.raw_user_meta_data->>'bank_code', ''),
    NEW.raw_user_meta_data->>'avatar_url',
    NEW.raw_user_meta_data->>'next_of_kin',
    'pending',
    'member',
    3,
    true
  )
  ON CONFLICT (id) DO NOTHING;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Update comment
COMMENT ON FUNCTION public.handle_new_user() IS 'Creates complete profile with all onboarding fields when new auth user is created';

-- ============================================================================
-- NOTE: The onboarding routes can now be removed from the application
-- All profile fields are collected during registration
-- ============================================================================
