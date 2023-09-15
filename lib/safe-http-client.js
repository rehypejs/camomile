import dns from 'node:dns/promises'

import {fetch} from 'undici'
import ipaddr from 'ipaddr.js'

import {IMAGE_MIME_TYPES} from './constants.js'

export class HttpError extends Error {
  /**
   * @param {number} statusCode
   * @param {string} message
   */
  constructor(statusCode, message) {
    super(message)
    this.statusCode = statusCode
    this.name = 'HttpError'

    // Captures the stack trace, excluding the constructor call from the stack trace.
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
   * @param {string|URL} url
   * @param {import('undici').RequestInit} options
   */
  async safeFetch(url, options) {
    let response = await fetch(url, options)

    // If there's a redirect, check the redirected URL for SSRF and then follow it if it's valid.
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const redirectedUrl = response.headers.get('location')
      // @ts-ignore can pass undefined redirectedUrl
      await SafeHttpClient.checkUrl(redirectedUrl)

      // @ts-ignore redirectedUrl guarded by checkUrl
      response = await fetch(redirectedUrl, {
        ...options,
        // Do not allow another redirect
        redirect: 'error'
      })
    }

    const contentType = response.headers.get('content-type')
    if (!contentType || contentType.length === 0) {
      throw new HttpError(400, 'Empty content-type header')
    }

    if (!IMAGE_MIME_TYPES.includes(contentType)) {
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
