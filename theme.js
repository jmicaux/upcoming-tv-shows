// Applies the theme chosen in the app (light / dark) on the static pages (About,
// Privacy, Accessibility), which otherwise follow the system theme only. Loaded in
// <head>, before rendering, to avoid a flash of the wrong theme.
(function () {
  try {
    var t = localStorage.getItem("tv:theme");
    if (t === "light" || t === "dark") document.documentElement.setAttribute("data-theme", t);
  } catch (e) { /* storage blocked: keep the system theme */ }
})();
