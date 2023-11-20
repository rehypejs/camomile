import test, {describe, after, beforeEach, afterEach} from 'node:test'
import net from 'node:net'
import assert from 'node:assert'

import {MockAgent, setGlobalDispatcher, fetch} from 'undici'

// TODO: use published version of this plugin
import {camo} from './rehype-github-image/camo.js'
import {Camomile} from './index.js'
import {securityHeaders} from './lib/constants.js'

const host = '127.0.0.1'
const port = 1080
const addr = `http://${host}:${port}`
const secret = 'myVerySecretSecret'
const toProxyUrl = camo(addr, secret)

/**
 * @returns {Promise<net.Server>}
 */
function createTestServer() {
  return new Promise((resolve) => {
    const server = new Camomile({secret}).listen({host, port})
    server.on('listening', () => resolve(server))
  })
}

/**
 * @param {net.Server} server
 * @returns {Promise<void>}
 */
function closeTestServer(server) {
  return new Promise((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()))
  })
}

/** @param {import('undici').Response} res */
function testDefaultHeaders(res) {
  Object.keys(securityHeaders).forEach((key) => {
    assert.ok(res.headers.has(key), key)
  })
}

const server = await createTestServer()

describe('camo', () => {
  /** @type {MockAgent} */
  let mockAgent

  beforeEach(() => {
    mockAgent = new MockAgent()
    setGlobalDispatcher(mockAgent)
  })
  afterEach(async () => mockAgent.close())
  after(async () => closeTestServer(server))

  test('should fail w/o secret', async () => {
    assert.throws(function () {
      // @ts-expect-error: check how missing options are handled.
      new Camomile()
    }, /Expected `secret` in options/)
  })

  test('should 403 for url with invalid secret', async () => {
    const invalidProxy = camo(addr, 'invalid')
    const res = await fetch(invalidProxy('http://example.com/index.png'))
    assert.strictEqual(res.status, 403)
    testDefaultHeaders(res)
  })

  test('should 405 for non-head/get', async () => {
    const proxyUrl = toProxyUrl('http://example.com/index.png')
    const res = await fetch(proxyUrl.slice(0, proxyUrl.lastIndexOf('/')), {
      method: 'DELETE'
    })
    assert.strictEqual(res.status, 405)
    testDefaultHeaders(res)
  })

  test('should 404 for url with only the digest', async () => {
    const proxyUrl = toProxyUrl('http://example.com/index.png')
    const res = await fetch(proxyUrl.slice(0, proxyUrl.lastIndexOf('/')))
    assert.strictEqual(res.status, 404)
    testDefaultHeaders(res)
  })

  test('should 400 for unsupported protocol', async () => {
    const proxyUrl = toProxyUrl('file:///etc/passwd')
    const res = await fetch(proxyUrl)
    assert.strictEqual(res.status, 400)
    assert.strictEqual(
      await res.text(),
      'Unexpected non-http protocol `file:`, expected `http:` or `https:`'
    )
    testDefaultHeaders(res)
  })

  test('should 400 for non-host', async () => {
    const proxyUrl = toProxyUrl('http://some-address')
    const res = await fetch(proxyUrl)
    assert.strictEqual(res.status, 400)
    assert.strictEqual(
      await res.text(),
      'Could not look up host `some-address`'
    )
    testDefaultHeaders(res)
  })

  // Testing all cases of SSRF would be endless, we just test one case to
  // make sure the library is used which handles all these cases.
  test('should 400 for private IP address as URL', async () => {
    // zero-prefix = octal number -> converted to 192.168.0.1
    const proxyUrl = toProxyUrl('http://0300.0250.0.01')
    const res = await fetch(proxyUrl)
    assert.strictEqual(res.status, 400)
    assert.strictEqual(await res.text(), 'Bad url host')
    testDefaultHeaders(res)
  })

  test('should 400 for empty Content-Type', async () => {
    mockAgent
      .get('https://avatars.githubusercontent.com')
      .intercept({path: '/u/944406'})
      .reply(200, Buffer.alloc(1024), {
        headers: {
          'Content-Length': '1024',
          'Content-Type': ''
        }
      })

    const proxyUrl = toProxyUrl(
      'https://avatars.githubusercontent.com/u/944406'
    )
    const res = await fetch(proxyUrl)
    assert.strictEqual(res.status, 400)
    assert.strictEqual(
      await res.text(),
      'Unexpected missing `Content-type` header in remote server response'
    )
    testDefaultHeaders(res)
  })

  test('should 400 for unsupported Content-Type', async () => {
    mockAgent
      .get('https://avatars.githubusercontent.com')
      .intercept({path: '/u/944406'})
      .reply(200, Buffer.alloc(1024), {
        headers: {
          'Content-Length': '1024',
          'Content-Type': 'video/mp4'
        }
      })

    const proxyUrl = toProxyUrl(
      'https://avatars.githubusercontent.com/u/944406'
    )
    const res = await fetch(proxyUrl)
    assert.strictEqual(res.status, 400)
    assert.strictEqual(
      await res.text(),
      'Unexpected non-image `Content-type` in remote server response, this might not be an image or it might not be supported by camomile'
    )
    testDefaultHeaders(res)
  })

  test('should 413 for download over defined max size', async () => {
    const size = 100 * 1024 * 1024 + 1

    mockAgent
      .get('https://avatars.githubusercontent.com')
      .intercept({path: '/u/944406'})
      .reply(200, Buffer.alloc(size), {
        headers: {
          'Content-Length': size.toString(),
          'Content-Type': 'image/png'
        }
      })

    const proxyUrl = toProxyUrl(
      'https://avatars.githubusercontent.com/u/944406'
    )
    const res = await fetch(proxyUrl)
    assert.strictEqual(res.status, 413)
    assert.strictEqual(
      await res.text(),
      'Unexpected too large `Content-Length`'
    )
    testDefaultHeaders(res)
  })

  test('should 204 for HEAD with valid proxy url', async () => {
    mockAgent
      .get('https://avatars.githubusercontent.com')
      .intercept({method: 'HEAD', path: '/u/944406'})
      .reply(200, Buffer.alloc(1024), {
        headers: {
          'Content-Length': '1024',
          'Content-Type': 'image/png'
        }
      })

    const proxyUrl = toProxyUrl(
      'https://avatars.githubusercontent.com/u/944406'
    )
    const res = await fetch(proxyUrl, {method: 'HEAD'})
    assert.strictEqual(res.status, 204)
    assert.strictEqual(res.headers.get('content-length'), '1024')
    assert.strictEqual(res.headers.get('content-type'), 'image/png')
    testDefaultHeaders(res)
  })

  test('should 200 for GET with valid proxy url with filtered headers', async () => {
    let headersOk = false
    mockAgent
      .get('https://avatars.githubusercontent.com')
      .intercept({method: 'GET', path: '/u/944406'})
      .reply((req) => {
        if (
          // @ts-ignore
          !req.headers['X-Forwarded-For'] &&
          // @ts-ignore
          req.headers['Cache-Control'] === 'no-cache'
        ) {
          headersOk = true
        }

        return {
          statusCode: 200,
          data: Buffer.alloc(1024),
          responseOptions: {
            headers: {
              'Content-Length': '1024',
              'Content-Type': 'image/png',
              Server: 'iwillbefiltered'
            }
          }
        }
      })

    const proxyUrl = toProxyUrl(
      'https://avatars.githubusercontent.com/u/944406'
    )
    const res = await fetch(proxyUrl, {
      headers: {
        'Cache-Control': 'no-cache',
        'X-Forwarded-For': '2001:db8:85a3:8d3:1319:8a2e:370:7348'
      }
    })

    assert.ok(headersOk, 'headers not correctly filtered')
    assert.strictEqual(res.status, 200)
    assert.strictEqual(res.headers.get('content-length'), '1024')
    assert.strictEqual(res.headers.get('content-type'), 'image/png')
    assert.strictEqual(res.headers.get('server'), null)
    assert.strictEqual((await res.blob()).size, 1024)
    testDefaultHeaders(res)
  })

  test('should 200 for GET after following two redirects', async () => {
    const pool = mockAgent.get('https://avatars.githubusercontent.com')

    pool
      .intercept({method: 'GET', path: '/u/944406'})
      .reply(302, 'Moved Temporarily', {
        headers: {
          Location: 'https://avatars.githubusercontent.com/redirect1'
        }
      })
    pool
      .intercept({method: 'GET', path: '/redirect1'})
      .reply(302, 'Moved Temporarily', {
        headers: {
          Location: 'https://avatars.githubusercontent.com/redirect2'
        }
      })
    pool
      .intercept({method: 'GET', path: 'redirect2'})
      .reply(200, Buffer.alloc(1024), {
        headers: {
          'Content-Length': '1024',
          'Content-Type': 'image/png'
        }
      })

    const proxyUrl = toProxyUrl(
      'https://avatars.githubusercontent.com/u/944406'
    )
    const res = await fetch(proxyUrl, {method: 'GET'})
    assert.strictEqual(res.status, 200)
    assert.strictEqual(res.headers.get('content-length'), '1024')
    assert.strictEqual(res.headers.get('content-type'), 'image/png')
    testDefaultHeaders(res)
  })

  test('should 400 for redirect wo `Location`', async () => {
    const pool = mockAgent.get('https://avatars.githubusercontent.com')

    pool
      .intercept({method: 'GET', path: '/u/944406'})
      .reply(302, 'Moved Temporarily', {headers: {}})

    const res = await fetch(
      toProxyUrl('https://avatars.githubusercontent.com/u/944406')
    )
    assert.strictEqual(res.status, 400)
    assert.strictEqual(
      await res.text(),
      'Unexpected missing `Location` header in redirect response by remote server'
    )
    testDefaultHeaders(res)
  })
})
