-- Admin accounts get their own table, separate from member profiles.
--
-- Previously "admin" was a role flag on public.profiles, but the REST API
-- gated admin routes on a JWT claim (app_metadata.user_role) that nothing ever
-- set, so admin authorization never actually worked. This makes admin_profiles
-- the single source of truth: an account is an admin iff it has a row here.

-- ============================================================================
-- 1. TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.admin_profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    full_name TEXT NOT NULL,
    email TEXT,
    phone TEXT,
    avatar_url TEXT,
    is_super_admin BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.admin_profiles IS 'Administrator accounts, separate from member profiles. A row here grants admin authorization.';

CREATE INDEX IF NOT EXISTS idx_admin_profiles_email ON public.admin_profiles(email);

DROP TRIGGER IF EXISTS handle_admin_profiles_updated_at ON public.admin_profiles;
CREATE TRIGGER handle_admin_profiles_updated_at
  BEFORE UPDATE ON public.admin_profiles
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- ============================================================================
-- 2. is_admin() — authoritative admin check for RLS.
--    SECURITY DEFINER so a policy on any table (including profiles) can call it
--    without recursively invoking that table's own policies.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.is_admin(uid UUID DEFAULT auth.uid())
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.admin_profiles WHERE id = uid);
$$;

-- ============================================================================
-- 3. RLS on admin_profiles
-- ============================================================================
ALTER TABLE public.admin_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_profiles FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can view admin profiles" ON public.admin_profiles;
CREATE POLICY "Admins can view admin profiles"
  ON public.admin_profiles FOR SELECT
  USING (public.is_admin(auth.uid()));

DROP POLICY IF EXISTS "Admins can manage admin profiles" ON public.admin_profiles;
CREATE POLICY "Admins can manage admin profiles"
  ON public.admin_profiles FOR ALL
  USING (public.is_admin(auth.uid()));

GRANT ALL ON public.admin_profiles TO service_role;

-- ============================================================================
-- 4. Migrate any existing admins out of profiles, then remove them so the two
--    populations never overlap. (Production currently has zero admins.)
-- ============================================================================
INSERT INTO public.admin_profiles (id, full_name, email, phone, avatar_url)
SELECT id, full_name, email, phone, avatar_url
FROM public.profiles
WHERE role = 'admin'
ON CONFLICT (id) DO NOTHING;

DELETE FROM public.profiles WHERE role = 'admin';

-- ============================================================================
-- 5. Repoint every admin RLS check from profiles.role='admin' to is_admin().
-- ============================================================================
DROP POLICY IF EXISTS "Admins have full access to profiles" ON public.profiles;
CREATE POLICY "Admins have full access to profiles"
  ON public.profiles FOR ALL
  USING (public.is_admin(auth.uid()));

DROP POLICY IF EXISTS "Admins can manage announcements" ON public.announcements;
CREATE POLICY "Admins can manage announcements"
  ON public.announcements FOR ALL
  USING (public.is_admin(auth.uid()));

DROP POLICY IF EXISTS "Admins can view audit log" ON public.audit_log;
CREATE POLICY "Admins can view audit log"
  ON public.audit_log FOR SELECT
  USING (public.is_admin(auth.uid()));

DROP POLICY IF EXISTS "Admins can view all preferences" ON public.notification_preferences;
CREATE POLICY "Admins can view all preferences"
  ON public.notification_preferences FOR SELECT
  USING (public.is_admin(auth.uid()));

DROP POLICY IF EXISTS "Admins can view all logs" ON public.notification_logs;
CREATE POLICY "Admins can view all logs"
  ON public.notification_logs FOR ALL
  USING (public.is_admin(auth.uid()));

-- ============================================================================
-- 6. Route new admin signups to admin_profiles. A signup carrying
--    raw_user_meta_data.account_type = 'admin' becomes an admin; everyone else
--    gets a member profile as before.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.raw_user_meta_data->>'account_type' = 'admin' THEN
    INSERT INTO public.admin_profiles (id, full_name, email, phone, avatar_url)
    VALUES (
      NEW.id,
      COALESCE(
        NEW.raw_user_meta_data->>'full_name',
        NEW.raw_user_meta_data->>'name',
        'Admin'
      ),
      NEW.email,
      NEW.raw_user_meta_data->>'phone',
      NEW.raw_user_meta_data->>'avatar_url'
    )
    ON CONFLICT (id) DO NOTHING;
    RETURN NEW;
  END IF;

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

-- ============================================================================
-- 7. Keep admin emails in sync too when the auth email changes.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.handle_user_email_update()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.email IS DISTINCT FROM OLD.email THEN
    UPDATE public.profiles
      SET email = NEW.email, updated_at = NOW()
      WHERE id = NEW.id;
    UPDATE public.admin_profiles
      SET email = NEW.email, updated_at = NOW()
      WHERE id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
