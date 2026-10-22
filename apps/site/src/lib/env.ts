// Build-time settings, read from the environment when `astro build` runs.
// CI sets them in .github/workflows/preview.yml; see README.md.

/** The public address. Canonical URLs, the sitemap and Open Graph use it on every build. */
export const SITE_URL = "https://seply.app"

/**
 * `SITE_ENV=preview` marks a PR preview build: every page says `noindex`
 * (meta tag and `X-Robots-Tag` header) and the analytics beacon is left out.
 * Anything else (unset locally, `production` in CI) builds the production site.
 */
export const isPreview = process.env.SITE_ENV === "preview"

/**
 * The Cloudflare Web Analytics site token. The beacon is added only when it is
 * set and this is not a preview, so local and preview builds never report.
 */
export const analyticsToken = isPreview
  ? undefined
  : process.env.CF_ANALYTICS_TOKEN?.trim() || undefined

/** Where "Sign in" and other app links go. */
export const APP_URL = "https://learn.seply.app"
