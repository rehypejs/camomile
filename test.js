import assert from 'node:assert/strict'
import {Buffer} from 'node:buffer'
import {afterEach, beforeEach, test} from 'node:test'
import {Camomile} from 'camomile'
import {MockAgent, fetch, setGlobalDispatcher} from 'undici'
import {securityHeaders} from './lib/constants.js'
// To do: use published version of this plugin
import {camo} from './rehype-github-image/camo.js'

const host = '127.0.0.1'
const port = 1080
const address = 'http://' + host + ':' + port
const secret = 'myVerySecretSecret'
const toProxyUrl = camo(address, secret)

const server = new Camomile({secret}).listen({host, port})

test('camo', async function (t) {
  /** @type {MockAgent} */
  let mockAgent

  afterEach(async function () {
    await mockAgent.close()
  })

  beforeEach(function () {
    mockAgent = new MockAgent()
    setGlobalDispatcher(mockAgent)
  })

  await t.test('should expose the public api', async function () {
    assert.deepEqual(Object.keys(await import('camomile')).sort(), ['Camomile'])
  })

  await t.test('should fail w/o secret', async function () {
    assert.throws(function () {
      // @ts-expect-error: check how missing options are handled.
      // eslint-disable-next-line no-new
      new Camomile()
    }, /Expected `secret` in options/)
  })

  await t.test('should 403 for url with invalid secret', async function () {
    const invalidProxy = camo(address, 'invalid')
    const response = await fetch(invalidProxy('http://example.com/index.png'))

    assert.equal(response.status, 403)
    checkDefaultHeaders(response)
  })

  await t.test('should 405 for non-head/get', async function () {
    const response = await fetch(toProxyUrl('http://example.com/index.png'), {
      method: 'DELETE'
    })

    assert.equal(response.status, 405)
    checkDefaultHeaders(response)
  })

  await t.test('should 404 for url with only the digest', async function () {
    const proxyUrl = toProxyUrl('http://example.com/index.png')
    const response = await fetch(proxyUrl.slice(0, proxyUrl.lastIndexOf('/')))

    assert.equal(response.status, 404)
    checkDefaultHeaders(response)
  })

  await t.test('should 400 for unsupported protocol', async function () {
    const response = await fetch(toProxyUrl('file:///etc/passwd'))

    assert.equal(response.status, 400)
    assert.equal(
      await response.text(),
      'Unexpected non-http protocol `file:`, expected `http:` or `https:`'
    )
    checkDefaultHeaders(response)
  })

  await t.test('should 400 for non-host', async function () {
    const response = await fetch(toProxyUrl('http://some-address'))

    assert.equal(response.status, 400)
    assert.equal(await response.text(), 'Could not look up host `some-address`')
    checkDefaultHeaders(response)
  })

  // Testing all cases of SSRF would be endless, we just test one case to
  // make sure the library is used which handles all these cases.
  await t.test('should 400 for private IP address as URL', async function () {
    // Zero-prefix = octal number -> converted to 192.168.0.1
    const response = await fetch(toProxyUrl('http://0300.0250.0.01'))

    assert.equal(response.status, 400)
    assert.equal(await response.text(), 'Bad url host')
    checkDefaultHeaders(response)
  })

  await t.test('should 400 for empty Content-Type', async function () {
    mockAgent
      .get('https://avatars.githubusercontent.com')
      .intercept({path: '/u/944406'})
      .reply(200, Buffer.alloc(1024), {
        headers: {'Content-Length': '1024', 'Content-Type': ''}
      })

    const response = await fetch(
      toProxyUrl('https://avatars.githubusercontent.com/u/944406')
    )

    assert.equal(response.status, 400)
    assert.equal(
      await response.text(),
      'Unexpected missing `Content-type` header in remote server response'
    )
    checkDefaultHeaders(response)
  })

  await t.test('should 400 for unsupported Content-Type', async function () {
    mockAgent
      .get('https://avatars.githubusercontent.com')
      .intercept({path: '/u/944406'})
      .reply(200, Buffer.alloc(1024), {
        headers: {'Content-Length': '1024', 'Content-Type': 'video/mp4'}
      })

    const response = await fetch(
      toProxyUrl('https://avatars.githubusercontent.com/u/944406')
    )

    assert.equal(response.status, 400)
    assert.equal(
      await response.text(),
      'Unexpected non-image `Content-type` in remote server response, this might not be an image or it might not be supported by camomile'
    )
    checkDefaultHeaders(response)
  })

  await t.test(
    'should 413 for download over defined max size',
    async function () {
      const size = 100 * 1024 * 1024 + 1

      mockAgent
        .get('https://avatars.githubusercontent.com')
        .intercept({path: '/u/944406'})
        .reply(200, Buffer.alloc(size), {
          headers: {'Content-Length': String(size), 'Content-Type': 'image/png'}
        })

      const response = await fetch(
        toProxyUrl('https://avatars.githubusercontent.com/u/944406')
      )

      assert.equal(response.status, 413)
      assert.equal(
        await response.text(),
        'Unexpected too large `Content-Length`'
      )
      checkDefaultHeaders(response)
    }
  )

  await t.test('should 204 for HEAD with valid proxy url', async function () {
    mockAgent
      .get('https://avatars.githubusercontent.com')
      .intercept({method: 'HEAD', path: '/u/944406'})
      .reply(200, Buffer.alloc(1024), {
        headers: {'Content-Length': '1024', 'Content-Type': 'image/png'}
      })

    const response = await fetch(
      toProxyUrl('https://avatars.githubusercontent.com/u/944406'),
      {method: 'HEAD'}
    )

    assert.equal(response.status, 204)
    assert.equal(response.headers.get('content-length'), '1024')
    assert.equal(response.headers.get('content-type'), 'image/png')
    checkDefaultHeaders(response)
  })

  await t.test(
    'should 200 for GET with valid proxy url with filtered headers',
    async function () {
      mockAgent
        .get('https://avatars.githubusercontent.com')
        .intercept({method: 'GET', path: '/u/944406'})
        .reply(function (request) {
          const headers = /** @type {Record<string, string>} */ (
            request.headers
          )

          assert.equal(headers['X-Forwarded-For'], undefined)
          assert.equal(headers['Cache-Control'], 'no-cache')

          return {
            data: Buffer.alloc(1024),
            responseOptions: {
              headers: {
                'Content-Length': '1024',
                'Content-Type': 'image/png',
                Server: 'iwillbefiltered'
              }
            },
            statusCode: 200
          }
        })

      const response = await fetch(
        toProxyUrl('https://avatars.githubusercontent.com/u/944406'),
        {
          headers: {
            'Cache-Control': 'no-cache',
            'X-Forwarded-For': '2001:db8:85a3:8d3:1319:8a2e:370:7348'
          }
        }
      )

      assert.equal(response.status, 200)
      assert.equal(response.headers.get('content-length'), '1024')
      assert.equal(response.headers.get('content-type'), 'image/png')
      assert.equal(response.headers.get('server'), null)
      const blob = await response.blob()
      assert.equal(blob.size, 1024)
      checkDefaultHeaders(response)
    }
  )

  await t.test(
    'should 200 for GET after following two redirects',
    async function () {
      const pool = mockAgent.get('https://avatars.githubusercontent.com')

      pool
        .intercept({method: 'GET', path: '/u/944406'})
        .reply(302, 'Moved Temporarily', {
          headers: {Location: 'https://avatars.githubusercontent.com/redirect1'}
        })
      pool
        .intercept({method: 'GET', path: '/redirect1'})
        .reply(302, 'Moved Temporarily', {
          headers: {Location: 'https://avatars.githubusercontent.com/redirect2'}
        })
      pool
        .intercept({method: 'GET', path: '/redirect2'})
        .reply(200, Buffer.alloc(1024), {
          headers: {'Content-Length': '1024', 'Content-Type': 'image/png'}
        })

      const response = await fetch(
        toProxyUrl('https://avatars.githubusercontent.com/u/944406'),
        {method: 'GET'}
      )

      assert.equal(response.status, 200)
      assert.equal(response.headers.get('content-length'), '1024')
      assert.equal(response.headers.get('content-type'), 'image/png')
      checkDefaultHeaders(response)
    }
  )

  await t.test('should 400 for redirect w/o `Location`', async function () {
    const pool = mockAgent.get('https://avatars.githubusercontent.com')

    pool
      .intercept({method: 'GET', path: '/u/944406'})
      .reply(302, 'Moved Temporarily')

    const response = await fetch(
      toProxyUrl('https://avatars.githubusercontent.com/u/944406')
    )

    assert.equal(response.status, 400)
    assert.equal(
      await response.text(),
      'Unexpected missing `Location` header in redirect response by remote server'
    )
    checkDefaultHeaders(response)
  })

  server.close(function (error) {
    if (error) {
      throw error
    }
  })
})

/**
 * @param {Response} response
 *   Response.
 * @returns {undefined}
 *   Nothing.
 */
function checkDefaultHeaders(response) {
  for (const key of Object.keys(securityHeaders)) {
    assert.ok(response.headers.has(key), key)
  }
}
