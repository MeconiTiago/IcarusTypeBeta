import { APP_CONFIG, getAppConfig } from './runtime-config.js';

export const SUPABASE_URL = APP_CONFIG.SUPABASE_URL;
export const SUPABASE_ANON_KEY = APP_CONFIG.SUPABASE_ANON_KEY;

export function getSupabaseConfig() {
  const cfg = getAppConfig();
  return {
    SUPABASE_URL: cfg.SUPABASE_URL,
    SUPABASE_ANON_KEY: cfg.SUPABASE_ANON_KEY
  };
}
