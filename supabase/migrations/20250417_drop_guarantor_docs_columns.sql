-- Drop guarantor_id and documents_url columns from loans table
ALTER TABLE public.loans DROP COLUMN IF EXISTS guarantor_id;
ALTER TABLE public.loans DROP COLUMN IF EXISTS documents_url;