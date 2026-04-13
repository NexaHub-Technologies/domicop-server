-- Migration: Remove onboarding fields from profiles
-- Created: 2026-04-13
-- Description: Drops onboarding_step and onboarding_done columns since onboarding is now consolidated into registration

-- Remove onboarding fields from profiles table
ALTER TABLE public.profiles 
  DROP COLUMN IF EXISTS onboarding_step,
  DROP COLUMN IF EXISTS onboarding_done;

-- Also update the handle_new_user trigger to not reference these columns
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
    role
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
    'member'
  )
  ON CONFLICT (id) DO NOTHING;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Update comment
COMMENT ON FUNCTION public.handle_new_user() IS 'Creates complete profile with all fields when new auth user is created';
