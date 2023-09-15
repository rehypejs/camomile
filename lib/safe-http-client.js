import dns from 'node:dns/promises'

import {fetch} from 'undici'
import ipaddr from 'ipaddr.js'

import {defaultMimeTypes} from './constants.js'

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
    this.statusCode = statusCode
    this.name = 'HttpError'

    // Exclude the constructor call from the stack trace.
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, HttpError)
    }
  }
}

export class SafeHttpClient {
  /** @param {number} [maxSize] */
  constructor(maxSize) {
    this.maxSize = maxSize
  }

  /**
   * Check if the URL is a valid URL or IP, that the prototol is valid,
   * and the host is a safe unicast address.
   * @param {string} url
   */
  static async checkUrl(url) {
    // Throws if the URL is invalid
    const validUrl = new URL(url)
    const {protocol, hostname} = validUrl

    // Don't allow aother protocols like file:// URLs
    if (!['http:', 'https:'].includes(protocol)) {
      throw new Error('Bad protocol')
    }

    try {
      var {address} = await dns.lookup(hostname)
    } catch (err) {
      throw new Error('Bad url host')
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
    if (ipaddr.process(address).range() !== 'unicast') {
      throw new Error('Bad url host')
    }

    return validUrl
  }

  /**
   * Fetch a URL.
   *
   * @param {URL | string} url
   *   URL.
   * @param {import('undici').RequestInit} options
   *   Configuration, passed through to `fetch`.
   * @returns {Promise<{buffer?: Buffer, headers: import('undici').Headers}>}
   *   Buffer of response (except when `HEAD`) and headers.
   */
  async safeFetch(url, options) {
    let response = await fetch(url, options)

    // If there's a redirect, check the redirected URL for SSRF and then follow it if it's valid.
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const redirectedUrl = response.headers.get('location')

      if (!redirectedUrl) {
        throw new HttpError(400, 'Missing `Location` header')
      }

      await SafeHttpClient.checkUrl(redirectedUrl)

      response = await fetch(redirectedUrl, {
        ...options,
        // Do not allow another redirect
        redirect: 'error'
      })
    }

    const contentType = response.headers.get('content-type')
    if (!contentType) {
      throw new HttpError(400, 'Empty content-type header')
    }

    if (!defaultMimeTypes.includes(contentType)) {
      throw new HttpError(400, 'Unsupported content-type returned')
    }

    if (options.method === 'HEAD') {
      return {headers: response.headers}
    }

    if (!response.body) {
      throw new HttpError(400, 'No response body')
    }

    /** @type {Uint8Array[]} */
    const chunks = []
    const reader = response.body.getReader()
    let currentByteLength = 0

    while (true) {
      const {done, value} = await reader.read()
      if (done) {
        break
      }
      chunks.push(value)

      if (this.maxSize) {
        currentByteLength += value.length
        if (currentByteLength > this.maxSize) {
          throw new HttpError(404, 'Content-Length exceeded')
        }
      }
    }

    return {buffer: Buffer.concat(chunks), headers: response.headers}
  }
}
