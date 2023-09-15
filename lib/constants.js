/** @constant */
export const DEFAULT_HEADERS = {
  // Ensures that the page can't be displayed in a frame,
  // regardless of where the request came from.
  // It's a security feature to prevent "clickjacking" attacks,
  // where an attacker might use an iframe to overlay a legitimate page over a deceptive page.
  'X-Frame-Options': 'deny',
  // The browser should enable the XSS filter and if a XSS attack is detected,
  // rather than sanitizing the page, the browser will prevent rendering of the page entirely.
  'X-XSS-Protection': '1; mode=block',
  // Trust what the server says and not to perform MIME type sniffing.
  // This can prevent certain security risks where the browser might interpret
  // files as a different MIME type, which can be exploited in attacks.
  'X-Content-Type-Options': 'nosniff',
  // By default, do not load content from any source (default-src 'none').
  // Images can be loaded from data: URLs (like Base64 encoded images).
  // Styles can be loaded inline (style-src 'unsafe-inline'),
  // which usually means from within the HTML itself rather than from external files.
  'Content-Security-Policy':
    "default-src 'none'; img-src data:; style-src 'unsafe-inline'",
  // This header is often called HSTS (HTTP Strict Transport Security).
  // It's a security feature that ensures a website can only be accessed over HTTPS instead of HTTP.
  // The max-age parameter specifies how long (in seconds) the browser should remember to enforce this policy.
  // The includeSubDomains directive extends this rule to all subdomains of the domain sending the header.
  // This ensures that even if a user tries to access the site or its subdomains via HTTP,
  // their browser will automatically upgrade the request to HTTPS.
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains'
}

/**
 * http request headers that are acceptable to pass from
 * the client to the remote server. Only those present and true, are forwarded.
 * @constant
 */
export const REQUEST_HEADERS = new Map([
  ['Accept', true],
  ['Accept-Charset', true],
  ['Accept-Encoding', false], // images (aside from xml/svg), don't typically benefit from compression
  ['Accept-Language', true],
  ['Cache-Control', true],
  ['If-None-Match', true],
  ['If-Modified-Since', true],
  ['X-Forwarded-For', false], // x-forwarded-for header is not blindly passed without additional custom processing
  ['Range', true] // required to support safari byte range requests for video
])

/**
 * http response headers that are acceptable to pass from
 * the remote server to the client. Only those present and true, are forwarded.
 * @constant
 */
export const RESPONSE_HEADERS = new Map([
  ['Accept-Ranges', true], // required to support Safari byte range requests for video
  ['Content-Length', true],
  ['Content-Range', true],

  ['Cache-Control', true],
  ['Content-Encoding', true],
  ['Content-Type', true],
  ['ETag', true],
  ['Expires', true],
  ['Last-Modified', true],
  ['Server', false], // override in response with either nothing, or ServerNameVer
  ['Transfer-Encoding', true]
])

/** @constant */
export const IMAGE_MIME_TYPES = [
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
