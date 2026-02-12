/**
 * App-wide Link that disables Qwik City's viewport prefetch.
 *
 * Qwik's default <Link> prefetches when the link enters the viewport (on:qvisible),
 * which on feed pages with many post/profile links causes a burst of requests to
 * every visible link. This wrapper sets prefetch={false} so navigation is on-demand
 * only (like the old ArtSky TypeScript-only behavior).
 */

import { component$ } from '@builder.io/qwik';
import { Link as QwikCityLink, type LinkProps } from '@builder.io/qwik-city';

export const Link = component$<LinkProps>((props) => {
  return <QwikCityLink {...props} prefetch={false} />;
});
