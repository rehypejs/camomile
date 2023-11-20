/**
 * @typedef {import('node:net').ListenOptions} ListenOptions
 * @typedef {import('node:net').Server} Server
 */

/**
 * @callback ListeningListener
 *   Callback for when the server is listening.
 * @returns {undefined | void}
 *   Nothing.
 *
 * @typedef Options
 *   Configuration.
 * @property {number | null | undefined} [maxSize=104857600]
 *   Max size in bytes per resource to download (`number`, default:
 *   `100 * 1024 * 1024`);
 *   a `413` is sent if the resource is larger than the maximum size.
 * @property {string} secret
 *   HMAC key to decrypt the URLs and used by `rehype-github-image` (required).
 * @property {string | null | undefined} [serverName='camomile']
 *   Server name sent in `Via` (`string`, default: `'camomile'`).
 */

import {Buffer} from 'node:buffer'
import crypto from 'node:crypto'
import {EventEmitter} from 'node:events'
import http from 'node:http'
import {Headers} from 'undici'
import {
  defaultRequestHeaders,
  defaultResponseHeaders,
  securityHeaders
} from './constants.js'
import {HttpError, checkUrl, safeFetch} from './safe-http-client.js'

/*
 * Node.js HTTP server to proxy insecure content via HTTPS.
 */
export class Camomile extends EventEmitter {
  /**
   * Create a new camomile server with options.
   *
   * @param {Readonly<Options>} options
   *   Configuration (required).
   * @returns
   *   Server.
   */
  constructor(options) {
    super()

    if (!options || !options.secret) {
      throw new Error('Expected `secret` in options')
    }

    /** @type {number} */
    this.maxSize = options.maxSize || 100 * 1024 * 1024 // 100 MB
    /** @type {string} */
    this.secret = options.secret
    /** @type {string} */
    this.serverName = options.serverName || 'camomile'
  }

  /**
   * Start the server.
   *
   * @overload
   * @param {number} [port]
   * @param {string} [hostname]
   * @param {number} [backlog]
   * @param {ListeningListener} [listeningListener]
   * @returns {Server}
   *
   * @overload
   * @param {number} [port]
   * @param {string} [hostname]
   * @param {ListeningListener} [listeningListener]
   * @returns {Server}
   *
   * @overload
   * @param {number} [port]
   * @param {number} [backlog]
   * @param {ListeningListener} [listeningListener]
   * @returns {Server}
   *
   * @overload
   * @param {number} [port]
   * @param {ListeningListener} [listeningListener]
   * @returns {Server}
   *
   * @overload
   * @param {string} path
   * @param {number} [backlog]
   * @param {ListeningListener} [listeningListener]
   * @returns {Server}
   *
   * @overload
   * @param {string} path
   * @param {ListeningListener} [listeningListener]
   * @returns {Server}
   *
   * @overload
   * @param {ListenOptions} options
   * @param {ListeningListener} [listeningListener]
   * @returns {Server}
   *
   * @overload
   * @param {unknown} handle
   * @param {number} [backlog]
   * @param {ListeningListener} [listeningListener]
   * @returns {Server}
   *
   * @overload
   * @param {unknown} handle
   * @param {ListeningListener} [listeningListener]
   * @returns {Server}
   *
   * @param {unknown} [port]
   * @param {ListeningListener | number | string} [hostname]
   * @param {ListeningListener | number} [backlog]
   * @param {ListeningListener} [listeningListener]
   * @returns {Server}
   *
   * @satisfies {Server['listen']}
   */
  listen(port, hostname, backlog, listeningListener) {
    const handle = this.handle.bind(this)
    return (
      http
        .createServer(handle)
        // @ts-expect-error: assume overloads correct.
        .listen(port, hostname, backlog, listeningListener)
    )
  }

  /**
   * The main request handler handles all incoming requests.
   * Integrate with your own server by calling this method and routing all requests to it.
   *
   * @param {http.IncomingMessage} request
   *   Request.
   * @param {http.ServerResponse} response
   *   Response.
   * @returns
   *   Promise to a server response.
   */
  async handle(request, response) {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return this.write(response, 405, 'Method not allowed')
    }

    const paths = request.url?.split('/')

    if (!paths || paths.length < 3) {
      return this.write(response, 404, 'Malformed request')
    }

    /** @type {string} */
    let decodedUrl

    try {
      const [, receivedDigest, hex] = paths
      decodedUrl = this.verifyHmac(receivedDigest, hex)
    } catch {
      return this.write(response, 403, 'Bad signature')
    }

    try {
      await checkUrl(decodedUrl)
    } catch (error) {
      const cause = /** @type {Error} */ (error)
      return this.write(response, 400, cause.message)
    }

    const controller = new AbortController()
    const {signal} = controller

    request.on('close', function () {
      controller.abort()
    })

    try {
      // To do: respect forwarded headers (check if not private IP).
      const {buffer, headers: responseHeaders} = await safeFetch(
        decodedUrl,
        {
          headers: filterHeaders(
            // @ts-expect-error: `IncomingHttpHeaders` can be passed to `Headers`
            new Headers(request.headers),
            defaultRequestHeaders
          ),
          method: request.method,
          // We can't blindly follow redirects as the initial checkUrl
          // might have been safe, but the redirect location might not be.
          // safeFetch will check the redirect location before following it.
          redirect: 'manual',
          signal
        },
        this.maxSize
      )

      const headers = {
        ...securityHeaders,
        ...filterHeaders(responseHeaders, defaultResponseHeaders),
        Via: this.serverName
      }

      if (request.method === 'HEAD') {
        response.writeHead(204, headers)
        return response.end()
      }

      response.writeHead(200, headers)
      response.write(buffer)
      return response.end()
    } catch (error) {
      const cause = /** @type {Error} */ (error)

      if (cause instanceof HttpError) {
        return this.write(response, cause.statusCode, cause.message)
        /* c8 ignore next 9 -- debug our own errors. */
      }

      if (cause.name === 'AbortError') {
        return
      }

      console.error(cause)
      return this.write(response, 500, 'Internal server error')
    }
  }

  /**
   * @param {string} receivedDigest
   *   Digest.
   * @param {string} hex
   *   Hex.
   * @returns {string}
   *   Decoded URL.
   */
  verifyHmac(receivedDigest, hex) {
    // Hex-decode the URL
    const decodedUrl = String(Buffer.from(hex, 'hex'))

    // Verify the HMAC digest to ensure the URL hasn't been tampered with
    const hmac = crypto.createHmac('sha1', this.secret)
    hmac.update(decodedUrl)
    const expectedDigest = hmac.digest('hex')

    if (expectedDigest !== receivedDigest) {
      throw new Error('URL integrity check failed')
    }

    return decodedUrl
  }

  /**
   * @param {http.ServerResponse} response
   *   Response.
   * @param {number} status
   *   Status code.
   * @param {Buffer | string} body
   *   Body.
   * @param {Readonly<Record<string, string | undefined>> | undefined} [headers]
   *   Headers (optional).
   * @returns
   *   Server response.
   */
  write(response, status, body, headers) {
    const headersCopy = {...(headers || securityHeaders)}

    if (status !== 204) {
      headersCopy['Content-Length'] = String(Buffer.byteLength(body, 'utf8'))
    }

    response.writeHead(status, headersCopy)
    response.write(body)
    return response.end()
  }
}

/**
 * Filter incoming headers based on allowed headers.
 *
 * We always want to send Pascal-Case headers so we use the key from constants
 * with the value from the incoming header.
 *
 * @param {Readonly<Headers>} incomingHeaders
 *   Remote headers.
 * @param {Readonly<Set<string>>} allowedHeaders
 *   Allowed headers.
 * @returns {Record<string, string>}
 *   Filtered headers.
 * */
function filterHeaders(incomingHeaders, allowedHeaders) {
  /** @type {Record<string, string>} */
  const filteredHeaders = {}
  const allowed = allowedHeaders.keys()

  for (const key of allowed) {
    const value = incomingHeaders.get(key.toLowerCase())

    if (value !== null && value !== undefined) {
      filteredHeaders[key] = value
    }
  }

  return filteredHeaders
}
