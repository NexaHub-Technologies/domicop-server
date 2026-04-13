-- Migration: Create missing profiles for existing auth users
-- Created: 2026-04-13
-- Description: Ensures all auth.users have corresponding profiles

-- Create profiles for any auth users that don't have one
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
SELECT 
    au.id,
    COALESCE(
      au.raw_user_meta_data->>'full_name',
      au.raw_user_meta_data->>'name',
      'New Member'
    ),
    au.email,
    COALESCE(au.raw_user_meta_data->>'phone', ''),
    COALESCE(au.raw_user_meta_data->>'address', ''),
    COALESCE(au.raw_user_meta_data->>'bank_name', ''),
    COALESCE(au.raw_user_meta_data->>'bank_account', ''),
    COALESCE(au.raw_user_meta_data->>'bank_code', ''),
    au.raw_user_meta_data->>'avatar_url',
    au.raw_user_meta_data->>'next_of_kin',
    'pending',
    COALESCE(au.raw_user_meta_data->>'role', 'member')
FROM auth.users au
LEFT JOIN public.profiles p ON au.id = p.id
WHERE p.id IS NULL;
