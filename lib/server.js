/**
 * @typedef {import('node:net').Server} Server
 */

/**
 * @typedef Options
 *   Configuration.
 * @property {number | null | undefined} [maxSize=104857600]
 *   Max size in bytes per resource to download (`number`, default: `104857600`);
 *   sends 500 if exceeded.
 * @property {string} secret
 *   HMAC key to decrypt the URLs and used by `rehype-github-image` (required).
 * @property {string | null | undefined} [serverName='camomile']
 *   Server name used in Headers and Via checks (`string`, default: `'camomile'`).
 */

import {Buffer} from 'node:buffer'
import {EventEmitter} from 'node:events'
import crypto from 'node:crypto'
import http from 'node:http'
import {Headers} from 'undici'
import {checkUrl, safeFetch, HttpError} from './safe-http-client.js'
import {
  securityHeaders,
  defaultRequestHeaders,
  defaultResponseHeaders
} from './constants.js'

/**
 * Filter incoming headers based on allowed headers.
 * We always want to send Pascal-Case headers so we use the key from constants
 * with the value from the incoming header.
 * @param {Set<string>} allowedHeaders
 * @returns {(incomingHeaders: Headers) => Record<string, string>}
 * */
function filterHeaders(allowedHeaders) {
  return function (incomingHeaders) {
    /** @type {Record<string, string>} */
    const filteredHeaders = {}

    for (const key of allowedHeaders.keys()) {
      const value = incomingHeaders.get(key.toLowerCase())

      if (value !== null && value !== undefined) {
        filteredHeaders[key] = value
      }
    }

    return filteredHeaders
  }
}

/*
 * Node.js HTTP server to proxy insecure content via HTTPS.
 */
export class Camomile extends EventEmitter {
  /**
   * Node.js HTTP server to proxy insecure content via HTTPS.
   *
   * @param {Readonly<Options>} options
   *   Configuration.
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
   * @param {[handle: unknown, listeningListener?: (() => void) | undefined]} args
   *   Arguments passed to `net.Server.listen`.
   * @returns {Server}
   *   Server.
   */
  listen(...args) {
    const handle = this.handle.bind(this)
    return http.createServer(handle).listen(...args)
  }

  /**
   * The main request handler handles all incoming requests.
   * Integrate with your own server by calling this method and routing all requests to it.
   * @param {http.IncomingMessage} request
   * @param {http.ServerResponse} response
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

    request.on('close', () => {
      controller.abort()
    })

    try {
      // To do: respect forwarded headers (check if not private IP).
      const filterRequestHeaders = filterHeaders(defaultRequestHeaders)
      const filterResponseHeaders = filterHeaders(defaultResponseHeaders)
      const {buffer, headers: responseHeaders} = await safeFetch(
        decodedUrl,
        {
          // @ts-expect-error: `IncomingHttpHeaders` can be passed to `Headers`
          headers: filterRequestHeaders(new Headers(request.headers)),
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
        ...filterResponseHeaders(responseHeaders),
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
   * @param {string} hex
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
   * @param {number} status
   * @param {Buffer | string} body
   * @param {Record<string, string | undefined>} [headers]
   */
  write(response, status, body, headers = securityHeaders) {
    if (status !== 204) {
      headers['Content-Length'] = String(Buffer.byteLength(body, 'utf8'))
    }

    response.writeHead(status, headers)
    response.write(body)
    return response.end()
  }
}
