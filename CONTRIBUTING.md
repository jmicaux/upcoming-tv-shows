# Contributing to Lineup

Thanks for your interest in improving Lineup! It's a dependency-free static web app —
contributions that keep it simple are very welcome.

## Getting started

No build step and no backend. TVMaze sends permissive CORS headers, so you can usually
open `index.html` directly; if your browser blocks `fetch` on `file://`, serve the folder:

```bash
python -m http.server 8000   # then open http://localhost:8000
```

The French channels (Canal+, Arte…) need a free TMDB key — copy `config.example.js` to
`config.js` and paste your key. `config.js` is git-ignored, so it never lands in the repo.

## Coding conventions

- **Vanilla JavaScript**, no framework, no build tooling, no runtime dependencies.
- Match the existing style (2-space indent, double quotes, small focused functions).
- **Escape/sanitize all external data** before it hits the DOM: use `escapeHtml`/`escapeAttr`,
  and run community-editable HTML (TVMaze summaries) through `sanitizeHtml`. Never widen
  the Content-Security-Policy to allow inline scripts.

## Submitting changes

1. Create a feature branch from `main`.
2. Keep the change focused and describe the *why* in the PR.
3. On a release, bump the version in the three places noted in the README's *Versioning*
   section and add a `CHANGELOG.md` entry.

## Reporting bugs

Open a [GitHub issue](https://github.com/jmicaux/upcoming-tv-shows/issues) with steps to
reproduce, the channel/show involved and your browser. For security issues, see
[SECURITY.md](SECURITY.md) instead.

## License

By contributing, you agree that your contributions are licensed under the
[PolyForm Noncommercial License 1.0.0](LICENSE.md) — noncommercial use only.
