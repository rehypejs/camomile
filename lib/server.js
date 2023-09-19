import {EventEmitter} from 'node:events'
import crypto from 'node:crypto'
import http from 'node:http'
import net from 'node:net'
import {Headers} from 'undici'
import {checkUrl, safeFetch, HttpError} from './safe-http-client.js'
import {
  securityHeaders,
  defaultRequestHeaders,
  defaultResponseHeaders
} from './constants.js'

/**
 * @typedef {Object} Options
 * @property {string} secret
 * @property {string} serverName Server name used in Headers and Via checks
 * @property {number|undefined} [maxSize] The max size in bytes per resource to download. Sends 500 if exceeded.
 */

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
export class Server extends EventEmitter {
  /**
   * @param {Readonly<Options>} options
   */
  constructor(options) {
    super()
    if (!options.secret) {
      throw new Error('secret is required')
    }
    this.options = {
      ...options,
      serverName: options.serverName || 'camo',
      maxSize: options.maxSize || 100 * 1024 * 1024 // 100 MB
    }
  }

  /**
   * Start the server.
   *
   * @param {Parameters<InstanceType<typeof net.Server>['listen']>} args
   *   Arguments passedf to `net.Server.listen`.
   * @returns {net.Server}
   *   Server.
   */
  listen(...args) {
    return http.createServer(this.handle.bind(this)).listen(...args)
  }

  /**
   * The main request handler handles all incoming requests.
   * Integrate with your own server by calling this method and routing all requests to it.
   * @param {http.IncomingMessage} req
   * @param {http.ServerResponse} res
   */
  async handle(req, res) {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return this.write(res, 405, 'Method not allowed')
    }

    const paths = req.url?.split('/')

    if (!paths || paths.length < 3) {
      return this.write(res, 404, 'Malformed request')
    }

    try {
      const [, receivedDigest, hex] = paths
      var decodedUrl = this.verifyHmac(receivedDigest, hex)
    } catch (err) {
      return this.write(res, 403, 'Bad signature')
    }

    try {
      await checkUrl(decodedUrl)
    } catch (err) {
      const exception = /** @type {Error} */ (err)
      return this.write(res, 400, exception.message)
    }

    const controller = new AbortController()
    const {signal} = controller

    req.on('close', () => {
      controller.abort()
    })

    try {
      // TODO: respect forwarded headers (check if not private IP)
      const filterRequestHeaders = filterHeaders(defaultRequestHeaders)
      const filterResponseHeaders = filterHeaders(defaultResponseHeaders)
      const {buffer, headers: resHeaders} = await safeFetch(
        decodedUrl,
        {
          // @ts-expect-error: `IncomingHttpHeaders` can be passed to `Headers`
          headers: filterRequestHeaders(new Headers(req.headers)),
          method: req.method,
          // We can't blindly follow redirects as the initial checkUrl
          // might have been safe, but the redirect location might not be.
          // safeFetch will check the redirect location before following it.
          redirect: 'manual',
          signal
        },
        this.options.maxSize
      )

      const headers = {
        ...securityHeaders,
        ...filterResponseHeaders(resHeaders),
        Via: this.options.serverName
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
        console.error(err)
        return this.write(res, 500, 'Internal server error')
      }
    }
  }

  /**
   * @param {string} receivedDigest
   * @param {string} hex
   * @private
   */
  verifyHmac(receivedDigest, hex) {
    // Hex-decode the URL
    const decodedUrl = String(Buffer.from(hex, 'hex'))

    // Verify the HMAC digest to ensure the URL hasn't been tampered with
    const hmac = crypto.createHmac('sha1', this.options.secret)
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
   * @param {Buffer | string} body
   * @param {Record<string, string | undefined>} [headers]
   * @private
   */
  write(res, status, body, headers = securityHeaders) {
    if (status !== 204) {
      headers['Content-Length'] = String(Buffer.byteLength(body, 'utf8'))
    }
    res.writeHead(status, headers)
    res.write(body)
    return res.end()
  }
}
