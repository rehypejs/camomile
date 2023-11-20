/**
 * @typedef {import('node:stream/web').ReadableStream<Uint8Array>} Uint8ArrayStream
 */

/**
 * @typedef SafeFetchResult
 *   Result.
 * @property {Buffer | undefined} buffer
 *   Buffer.
 * @property {Headers} headers
 *   Headers.
 */

import {Buffer} from 'node:buffer'
import dns from 'node:dns/promises'
import ipaddr from 'ipaddr.js'
import {fetch} from 'undici'
import {defaultMimeTypes} from './constants.js'

const maxRedirects = 3
const redirectCodes = new Set([301, 302, 303, 307, 308])

export class HttpError extends Error {
  /**
   * Create an HTTP error.
   *
   * @param {number} statusCode
   *   Status code.
   * @param {string} message
   *   Message.
   * @returns
   *   HTTP error.
   */
  constructor(statusCode, message) {
    super(message)

    /** @type {'HttpError'} */
    this.name = 'HttpError'
    /** @type {number} */
    this.statusCode = statusCode

    // Exclude the constructor call from the stack trace.
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, HttpError)
    }
  }
}

/**
 * Check that the URL is valid, the prototol is allowed, and that the host is
 * a safe unicast address.
 *
 * @param {string} url
 *   URL to check.
 * @returns {Promise<undefined>}
 *   Nothing.
 */
export async function checkUrl(url) {
  // Throws if the URL is invalid.
  const validUrl = new URL(url)
  const {hostname, protocol} = validUrl

  // Don’t allow other protocols like `file:`.
  if (!['http:', 'https:'].includes(protocol)) {
    throw new Error(
      'Unexpected non-http protocol `' +
        protocol +
        '`, expected `http:` or `https:`'
    )
  }

  /** @type {string} */
  let address

  try {
    const lookupAddress = await dns.lookup(hostname)
    address = lookupAddress.address
  } catch (error) {
    const cause = /** @type {Error} */ (error)
    throw new Error('Could not look up host `' + hostname + '`', {cause})
  }

  /**
   * Server Side Request Forgery (SSRF) Protection.
   *
   * SSRF is an attack where an attacker can trick a server into making unexpected network connections.
   * This can lead to unauthorized access to internal resources, information disclosure,
   * denial-of-service attacks, or even remote code execution.
   *
   * One common SSRF vector is tricking the server into making requests to internal IP addresses
   * or to other services within the network that the server shouldn't be accessing. This can
   * expose sensitive internal data or systems.
   *
   * Unicast addresses are typically used for communication between hosts on the public internet.
   * By only allowing addresses in the 'unicast' range, we can prevent SSRF attacks targeting
   * non-public IP ranges, such as private, multicast, and reserved IPs.
   */
  const range = ipaddr.process(address).range()

  if (range !== 'unicast') {
    throw new Error('Bad url host')
  }
}

/**
 * Fetch a URL.
 *
 * @param {Readonly<URL> | string} url
 *   URL.
 * @param {Readonly<RequestInit>} options
 *   Configuration, passed through to `fetch`.
 * @param {number | undefined} [maxSize]
 *   The max size in bytes to download (optional).
 * @returns {Promise<SafeFetchResult>}
 *   Buffer of response (except when `HEAD`) and headers.
 */
export async function safeFetch(url, options, maxSize) {
  let redirectCount = 0
  /** @type {Response} */
  let response

  while (true) {
    // @ts-expect-error: undici types currently fail w/ `exactOptionalPropertyTypes`.
    response = await fetch(url, options)

    if (!redirectCodes.has(response.status) || redirectCount >= maxRedirects) {
      break
    }

    const redirectedUrl = response.headers.get('location')

    if (!redirectedUrl) {
      throw new HttpError(
        400,
        'Unexpected missing `Location` header in redirect response by remote server'
      )
    }

    await checkUrl(redirectedUrl)
    url = redirectedUrl
    redirectCount++
  }

  const contentType = response.headers.get('content-type')

  if (!contentType) {
    throw new HttpError(
      400,
      'Unexpected missing `Content-type` header in remote server response'
    )
  }

  if (!defaultMimeTypes.includes(contentType)) {
    throw new HttpError(
      400,
      'Unexpected non-image `Content-type` in remote server response, this might not be an image or it might not be supported by camomile'
    )
  }

  if (options.method === 'HEAD') {
    return {buffer: undefined, headers: response.headers}
  }

  /* c8 ignore next 3 - seems to always exist */
  if (!response.body) {
    throw new HttpError(400, 'Unexpected missing remote server response body')
  }

  /** @type {Array<Uint8Array>} */
  const chunks = []
  /** @type {Uint8ArrayStream} */
  // type-coverage:ignore-next-line
  const body = response.body
  const reader = body.getReader()
  let currentByteLength = 0

  while (true) {
    const {done, value} = await reader.read()

    if (done) {
      break
    }

    chunks.push(value)

    if (maxSize) {
      currentByteLength += value.length

      if (currentByteLength > maxSize) {
        throw new HttpError(413, 'Unexpected too large `Content-Length`')
      }
    }
  }

  return {buffer: Buffer.concat(chunks), headers: response.headers}
}
