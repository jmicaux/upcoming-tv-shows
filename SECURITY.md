# Security Policy

## Supported versions

Only the latest release receives security fixes.

| Version  | Supported |
| -------- | --------- |
| latest   | ✅        |
| older    | ❌        |

## Reporting a vulnerability

Please **do not** open a public issue for security problems.

Report vulnerabilities privately via GitHub's
[private vulnerability reporting](https://github.com/jmicaux/upcoming-tv-shows/security/advisories/new)
— on the repository, go to **Security → Advisories → Report a vulnerability**. This keeps the
report private and notifies the maintainer directly (no public issue).

Include a description of the issue and its impact, steps to reproduce (or a proof of
concept), and the affected version. You can expect an acknowledgement within a few days.

## Scope

Upcoming TV Shows is a static, client-side app. It reads public data from TVMaze and TMDB and stores
your preferences locally. The optional account feature stores an email address and a
preferences record in Supabase, guarded by Row Level Security (each user can only reach their
own row); the repo ships only the public project URL and `anon` key, never a privileged key. A TMDB key, if configured for a public deployment, is exposed
client-side by design — proxy it behind a backend if that matters for your deployment
(see the README's *Limitations*). Reports about TVMaze/TMDB services themselves are out
of scope.
