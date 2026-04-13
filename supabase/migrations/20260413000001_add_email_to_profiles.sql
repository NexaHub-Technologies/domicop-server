-- Migration: Add email column to profiles table
-- Created: 2026-04-13
-- Description: Adds email column to store user email in profiles

-- Add email column to profiles table
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS email TEXT;

-- Create index for email lookups
CREATE INDEX IF NOT EXISTS idx_profiles_email ON public.profiles(email);

-- Add comment for documentation
COMMENT ON COLUMN public.profiles.email IS 'User email address (synced from auth.users)';
