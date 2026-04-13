-- Migration: Remove preferences column from profiles table
-- Created: 2026-04-13
-- Description: Drops preferences JSONB column since notification preferences are now in their own table

ALTER TABLE public.profiles DROP COLUMN IF EXISTS preferences;
