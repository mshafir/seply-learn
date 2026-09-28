# web

**Lane:** D: App & UI

## Contract

The Vite SPA (installable PWA): routes and screens from docs/spec/v1/03-screens-and-flows.md, composed from @umbel/ui, @umbel/views and @umbel/sync.

## Allowed dependencies

@umbel/ui, @umbel/views, @umbel/sync, @umbel/domain.

## Notes

- **`/showcase`** renders every token, Kind hue, type style and component, side by side in the light and dark palettes (WP-0.3). Until routing lands (WP-1.5), `App.tsx` picks the page from the path.
- **Theme:** `index.html` has an inline script that sets `.dark` and `color-scheme` before first paint, from the `umbel-theme` key the `ThemeProvider` writes.
- **Public directory** is `packages/ui/brand`, so the favicon and PWA icons are served from the site root and the brand stays one swappable folder.
