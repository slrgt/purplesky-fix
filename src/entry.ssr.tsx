/**
 * SSR entry point for PurpleSky.
 *
 * This file is used by Qwik for server-side rendering / static site generation.
 * You generally don't need to edit this unless you're adding custom SSR logic.
 */

import { renderToStream, type RenderToStreamOptions } from '@builder.io/qwik/server';
import { manifest } from '@qwik-client-manifest';
import Root from './root';

export default function (opts: RenderToStreamOptions) {
  return renderToStream(<Root />, {
    manifest,
    ...opts,
    containerAttributes: {
      lang: 'en',
      ...opts.containerAttributes,
    },
  });
}
