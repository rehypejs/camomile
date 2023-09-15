import http from 'node:http'
import net from 'node:net'
import {EventEmitter} from 'node:events'
import crypto from 'node:crypto'
import url from 'node:url'

import {Headers} from 'undici'

import {SafeHttpClient, HttpError} from './safe-http-client.js'
import {
  DEFAULT_HEADERS,
  REQUEST_HEADERS,
  RESPONSE_HEADERS
} from './constants.js'

/**
 * @typedef {Object} Config
 * @property {string} HMACKey
 * @property {string} serverName Server name used in Headers and Via checks
 * @property {number|undefined} [maxSize] The max size in bytes per resource to download. Sends 500 if exceeded.
 */

/**
 * @param {string} hex
 */
function hexDecode(hex) {
  const bytes = []
  for (let i = 0; i < hex.length; i += 2) {
    bytes.push(parseInt(hex.substr(i, 2), 16))
  }
  return Buffer.from(bytes)
}

/**
 * Filter incoming headers based on allowed headers.
 * We always want to send Pascal-Case headers so we use the key from constants
 * with the value from the incoming header.
 * @param {Map<string, boolean>} allowedHeaders
 * @returns {(incomingHeaders: Headers) => Record<string, string>}
 * */
function filterHeaders(allowedHeaders) {
  return function (incomingHeaders) {
    /** @type {Record<string, string>} */
    const filteredHeaders = {}

    for (const [key, bool] of allowedHeaders.entries()) {
      if (incomingHeaders.has(key.toLowerCase()) && bool) {
        // @ts-ignore
        filteredHeaders[key] = incomingHeaders.get(key.toLowerCase())
      }
    }

    return filteredHeaders
  }
}

/*
 * Node.js HTTP server to proxy insecure content via HTTPS.
 */
export class Server extends EventEmitter {
  /**
   * @param {Config} config
   */
  constructor(config) {
    super()
    if (!config.HMACKey) {
      throw new Error('HMACKey is required')
    }
    this.config = config
    this.config.serverName ??= 'camo'
  }

  /**
   * Start the server. Identical to `net.Server.listen()`.
   * @param {Parameters<InstanceType<typeof net.Server>['listen']>} args
   * @public
   */
  listen(...args) {
    return http.createServer(this.handle.bind(this)).listen(...args)
  }

  /**
   * The main request handler handles all incoming requests.
   * Integrate with your own server by calling this method and routing all requests to it.
   * @param {http.IncomingMessage} req
   * @param {http.ServerResponse} res
   * @public
   */
  async handle(req, res) {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return this.write(res, 405, 'Method not allowed')
    }

    // @ts-ignore req.url is fine
    const paths = url.parse(req.url)?.path?.split('/')

    if (!paths || paths.length < 3) {
      return this.write(res, 404, 'Malformed request')
    }

    try {
      const [, receivedDigest, hex] = paths
      var decodedUrl = this.verifyHMAC(receivedDigest, hex)
    } catch (err) {
      return this.write(res, 403, 'Bad signature')
    }

    try {
      var validUrl = await SafeHttpClient.checkUrl(decodedUrl)
    } catch (err) {
      // @ts-ignore err does have message
      return this.write(res, 400, err.message)
    }

    const controller = new AbortController()
    const {signal} = controller

    req.on('close', () => {
      controller.abort()
    })

    try {
      // TODO: respect forwarded headers (check if not private IP)
      const filterRequestHeaders = filterHeaders(REQUEST_HEADERS)
      const filterResponseHeaders = filterHeaders(RESPONSE_HEADERS)
      const client = new SafeHttpClient(this.config.maxSize)
      const {buffer, headers: resHeaders} = await client.safeFetch(validUrl, {
        // @ts-ignore we can convert req.headers to Headers
        headers: filterRequestHeaders(new Headers(req.headers)),
        method: req.method,
        // We can't blindly follow redirects as the initial checkUrl
        // might have been safe, but the redirect location might not be.
        // SafeHttpClient will check the redirect location before following it.
        redirect: 'manual',
        signal
      })

      const headers = {
        ...DEFAULT_HEADERS,
        ...filterResponseHeaders(resHeaders),
        Via: this.config.serverName
      }

      if (req.method === 'HEAD') {
        res.writeHead(204, headers)
        return res.end()
      }
      res.writeHead(200, headers)
      res.write(buffer)
      return res.end()
    } catch (err) {
      if (err instanceof HttpError) {
        return this.write(res, err.statusCode, err.message)
      }
      if (err instanceof Error) {
        if (err.name === 'AbortError') {
          return
        }
        const msg = err.message || 'Internal server error'
        return this.write(res, 500, msg)
      }
    }
  }

  /**
   * @param {string} receivedDigest
   * @param {string} hex
   * @private
   */
  verifyHMAC(receivedDigest, hex) {
    // Hex-decode the URL
    const originalUrlBuffer = hexDecode(hex)

    // Convert the buffer to a string
    const decodedUrl = originalUrlBuffer.toString('utf-8')

    // Verify the HMAC digest to ensure the URL hasn't been tampered with
    const hmac = crypto.createHmac('sha1', this.config.HMACKey)
    hmac.update(decodedUrl)
    const expectedDigest = hmac.digest('hex')

    if (expectedDigest !== receivedDigest) {
      throw new Error('URL integrity check failed')
    }

    return decodedUrl
  }

  /**
   * @param {http.ServerResponse} res
   * @param {number} status
   * @param {unknown} [body]
   * @param {Record<string, string | undefined>} [headers]
   * @private
   */
  write(res, status, body, headers = DEFAULT_HEADERS) {
    if (status !== 204) {
      // @ts-expect-error not explicitly typed but possible
      headers['Content-Length'] = Buffer.byteLength(body, 'utf8')
    }
    res.writeHead(status, headers)
    res.write(body)
    return res.end()
  }
}