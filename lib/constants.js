/** @type {Readonly<Record<string, string>>} */
export const securityHeaders = {
  /**
   * Ensures that the page can’t be displayed in a frame,
   * regardless of where the request came from.
   * It’s a security feature to prevent “clickjacking” attacks,
   * where an attacker might use an iframe to overlay a legitimate page over a
   * deceptive page.
   */
  'X-Frame-Options': 'deny',
  /**
   * The browser should enable the XSS filter and if a XSS attack is detected,
   * rather than sanitizing the page, the browser will prevent rendering of the
   * page entirely.
   */
  'X-XSS-Protection': '1; mode=block',
  /**
   * Trust what the server says and not to perform MIME type sniffing.
   * This can prevent certain security risks where the browser might interpret
   * files as a different MIME type, which can be exploited in attacks.
   */
  'X-Content-Type-Options': 'nosniff',
  /**
   * By default, do not load content from any source (`default-src 'none'`),
   * images can be loaded from `data:` URLs (like Base64 encoded images),
   * and styles can be loaded inline (`style-src 'unsafe-inline'`),
   * which usually means from within the HTML itself rather than from external
   * files.
   */
  'Content-Security-Policy':
    "default-src 'none'; img-src data:; style-src 'unsafe-inline'",
  /**
   * This header is often called HSTS (HTTP Strict Transport Security).
   * It’s a security feature that ensures a website can only be accessed over
   * HTTPS instead of HTTP.
   * The `max-age` parameter specifies how long (in seconds) the browser should
   * remember to enforce this policy.
   * The `includeSubDomains` directive extends this rule to all subdomains of
   * the domain sending the header.
   * This ensures that even if a user tries to access the site or its
   * subdomains via HTTP,
   * their browser will automatically upgrade the request to HTTPS.
   */
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains'
}

/**
 * HTTP request headers that are acceptable to pass from the client to the
 * remote server.
 * Only those present and true are forwarded.
 *
 * @type {Readonly<Set<string>>}
 */
export const defaultRequestHeaders = new Set([
  'Accept',
  'Accept-Charset',
  'Accept-Language',
  'Cache-Control',
  'If-None-Match',
  'If-Modified-Since',
  // Used by Safari for byte range requests on video:
  'Range'
])

/**
 * HTTP response headers that are acceptable to pass from the remote server to
 * the client.
 * Only those present and true are forwarded.
 *
 * @type {Readonly<Set<string>>}
 */
export const defaultResponseHeaders = new Set([
  // Used by Safari for byte range requests on video:
  'Accept-Ranges',
  'Cache-Control',
  'Content-Length',
  'Content-Encoding',
  'Content-Range',
  'Content-Type',
  'ETag',
  'Expires',
  'Last-Modified',
  'Transfer-Encoding'
])

/**
 * MIME types that we allow.
 *
 * @type {ReadonlyArray<string>}
 */
export const defaultMimeTypes = [
  'image/bmp',
  'image/cgm',
  'image/g3fax',
  'image/gif',
  'image/ief',
  'image/jp2',
  'image/jpeg',
  'image/jpg',
  'image/pict',
  'image/png',
  'image/prs.btif',
  'image/svg+xml',
  'image/tiff',
  'image/vnd.adobe.photoshop',
  'image/vnd.djvu',
  'image/vnd.dwg',
  'image/vnd.dxf',
  'image/vnd.fastbidsheet',
  'image/vnd.fpx',
  'image/vnd.fst',
  'image/vnd.fujixerox.edmics-mmr',
  'image/vnd.fujixerox.edmics-rlc',
  'image/vnd.microsoft.icon',
  'image/vnd.ms-modi',
  'image/vnd.net-fpx',
  'image/vnd.wap.wbmp',
  'image/vnd.xiff',
  'image/webp',
  'image/x-cmu-raster',
  'image/x-cmx',
  'image/x-icon',
  'image/x-macpaint',
  'image/x-pcx',
  'image/x-pict',
  'image/x-portable-anymap',
  'image/x-portable-bitmap',
  'image/x-portable-graymap',
  'image/x-portable-pixmap',
  'image/x-quicktime',
  'image/x-rgb',
  'image/x-xbitmap',
  'image/x-xpixmap',
  'image/x-xwindowdump'
]
