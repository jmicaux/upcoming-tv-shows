// Public Supabase settings for the optional account feature. Both values are meant to be
// public (the anon key is safe to ship: Row Level Security guards the data). Leave URL empty
// to disable accounts entirely. NEVER put the service_role key here or anywhere in the repo.
window.UPCOMING_SUPABASE = {
  URL: "https://orgatovxrihmodicvwya.supabase.co",
  ANON_KEY: "sb_publishable_ImCA9HYV1MCJQiING9w3tg_Gfj2Itzy", // publishable (public) key
  EMAIL_LOGIN: false, // true once a custom SMTP sender (own domain) is configured in Supabase
};
