// Public Supabase settings for the optional account feature. Both values are meant to be
// public (the anon key is safe to ship: Row Level Security guards the data). Leave URL empty
// to disable accounts entirely. NEVER put the service_role key here or anywhere in the repo.
window.UPCOMING_SUPABASE = {
  URL: "",          // e.g. "https://abcdefghijklmnop.supabase.co"
  ANON_KEY: "",     // Project Settings → API → anon public key
  EMAIL_LOGIN: false, // true once a custom SMTP sender (own domain) is configured in Supabase
};
