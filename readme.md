# comomile

**camomile** is a Node.js HTTP proxy to route images through SSL,
compatible with unified plugins, to safely embed user content on the web.

## Contents

*   [What is this?](#what-is-this)
*   [When should I use this?](#when-should-i-use-this)
*   [Install](#install)
*   [Use](#use)
*   [API](#api)
    *   [`new Server(options)`](#new-serveroptions)
*   [Examples](#examples)
    *   [Example: integrate camomile into Express](#example-integrate-camomile-into-express)
    *   [Example: integrate camomile into Koa](#example-integrate-camomile-into-koa)
    *   [Example: integrate camomile into Fastify](#example-integrate-camomile-into-fastify)
    *   [Example: integrate camomile into Next.js](#example-integrate-camomile-into-nextjs)
*   [Types](#types)
*   [Compatibility](#compatibility)
*   [Contribute](#contribute)
*   [Acknowledgments](#acknowledgments)
*   [License](#license)

## What is this?

A Node.js HTTP proxy to route images through SSL,
integrable in any Node.js server (even a front-end framework like Next.js).

camomile works together with [`rehype-github-image`][],
which does the following at build time:

1.  The original URL in the content is parsed.
2.  An [HMAC][] signature of the URL is generated.
3.  The URL and HMAC are encoded.
4.  The encoded URL and HMAC are placed into the expected format,
    creating the signed URL.
5.  The signed URL replaces the original image URL.

After your web app serves the content to the user, camomile takes over:

1.  The client requests the signed URL from camomile.
2.  camomile validates the [HMAC][], decodes the URL,
    then requests the content from the origin server
    and streams it to the client.

## When should I use this?

When you want to embed user content on the web in a safe way.
Sometimes user content is served over HTTP, which is not secure:

> An HTTPS page that includes content fetched using cleartext HTTP is called a
> mixed content page.  Pages like this are only partially encrypted, leaving the
> unencrypted content accessible to sniffers and man-in-the-middle attackers.
> — [MDN](https://developer.mozilla.org/en-US/docs/Web/Security/Mixed_content)

## Install

This package is [ESM only][esm].
In Node.js (version 18+), install with [npm][]:

```sh
npm install camomile
```

## Use

A standalone server.

```js
import {Server} from 'camomile'

const secret = process.env.CAMOMILE_SECRET

if (!secret) throw new Error('Missing `CAMOMILE_SECRET` in environment')

const server = new Server({secret})

server.listen({host: '127.0.0.1', port: 1080})
```

## API

This package exports `Server` and all [`constants`][].
There is no default export.

### `new Server(options)`

Creates a new camomile server with options.

#### `options.secret`

The HMAC key to decrypt the URLs and used by [`rehype-github-image`][]
(`string`, required).

#### `options.serverName`

Name used for the `Via` HTTP header (`string`, default: `'camomile'`).

#### `options.maxSize`

Limit the maximum size of a resource in bytes (`number`, default: `100 * 1024 * 1024`).

The server responds with `404` and `Content-Length exceeded`
if the resource is larger than the maximum size.

## Examples

### Example: integrate camomile into Express

```js
import express from 'express'
import {Server} from 'camomile'

const secret = process.env.CAMOMILE_SECRET
if (!secret) throw new Error('Missing `CAMOMILE_SECRET` in environment')

const host = '127.0.0.1'
const port = 1080
const app = express()
const uploadApp = express()
const camomile = new Server({secret})
uploadApp.all('*', camomile.handle.bind(camomile))

app.use('/uploads', uploadApp)
app.listen(port, host)

console.log('Listening on `http://' + host + ':' + port + '/uploads/`')
```

### Example: integrate camomile into Koa

```js
import http from 'node:http'
import url from 'node:url'
import {Server} from 'camomile'
import Koa from 'koa'

const secret = process.env.CAMOMILE_SECRET
if (!secret) throw new Error('Missing `CAMOMILE_SECRET` in environment')

const port = 1080
const app = new Koa()
const appCallback = app.callback()
const camomile = new Server({secret})

const server = http.createServer((req, res) => {
  const urlPath = url.parse(req.url || '').pathname || ''

  // handle any requests with the `/files/*` pattern
  if (/^\/files\/.+/.test(urlPath.toLowerCase())) {
    return camomile.handle(req, res)
  }

  appCallback(req, res)
})

server.listen(port)
```

### Example: integrate camomile into Fastify

```js
import createFastify from 'fastify'
import {Server} from 'camomile'

const secret = process.env.CAMOMILE_SECRET
if (!secret) throw new Error('Missing `CAMOMILE_SECRET` in environment')

const fastify = createFastify({logger: true})
const camomile = new Server({secret})

/**
 * Add `content-type` so fastify forewards without a parser to the leave body untouched.
 *
 * @see https://www.fastify.io/docs/latest/Reference/ContentTypeParser/
 */
fastify.addContentTypeParser(
  'application/offset+octet-stream',
  (request, payload, done) => done(null)
)

/**
 * Use camomile to handle preparation and filehandling requests.
 * `.raw` gets the raw Node HTTP request and response objects.
 *
 * @see https://www.fastify.io/docs/latest/Reference/Request/
 * @see https://www.fastify.io/docs/latest/Reference/Reply/#raw
 */
fastify.all('/files', (req, res) => {
  camomile.handle(req.raw, res.raw)
})
fastify.all('/files/*', (req, res) => {
  camomile.handle(req.raw, res.raw)
})

fastify.listen({port: 3000}, (err) => {
  if (err) {
    fastify.log.error(err)
    process.exit(1)
  }
})
```

### Example: integrate camomile into Next.js

Attach the camomile server handler to a Next.js route handler in an [optional catch-all route file](https://nextjs.org/docs/routing/dynamic-routes#optional-catch-all-routes)

`/pages/api/upload/[[...file]].ts`

```ts
import type {NextApiRequest, NextApiResponse} from 'next'
import {Server} from 'camomile'

/**
 * !Important. This will tell Next.js NOT Parse the body as camomile requires
 * @see https://nextjs.org/docs/api-routes/request-helpers
 */
export const config = {
  api: {
    bodyParser: false,
  },
}

const camomile = new Server({
  secret: process.env.CAMOMILE_SECRET,
})

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  return camomile.handle(req, res)
}
```

## Types

This package is fully typed with [TypeScript][].

## Compatibility

Projects maintained by the unified collective are compatible with maintained
versions of Node.js.

When we cut a new major release, we drop support for unmaintained versions of
Node.

## Contribute

See [`contributing.md`][contributing] in [`unifiedjs/.github`][health] for ways
to get started.
See [`support.md`][support] for ways to get help.

This project has a [code of conduct][coc].
By interacting with this repository, organization, or community you agree to
abide by its terms.

For info on how to submit a security report, see our
[security policy][security].

## Acknowledgments

In 2010 GitHub introduced [camo][], a similar server in CoffeeScript,
which is now deprecated and in public archive.
This project is a spiritual successor to `camo`.

A lot of inspiration was also taken from [go-camo][], which is a modern
and maintained image proxy in Go.

## License

[MIT][license] © [Merlijn Vos][author]

<!-- Definitions -->

[`rehype-github-image`]: https://github.com/rehypejs/rehype-github/tree/main/packages/image

[hmac]: https://en.wikipedia.org/wiki/HMAC

[`constants`]: https://rehypejs/camomile/tree/main/lib/constants.js

[esm]: https://gist.github.com/sindresorhus/a39789f98801d908bbc7ff3ecc99d99c

[typescript]: https://www.typescriptlang.org

[health]: https://github.com/unifiedjs/.github

[contributing]: https://github.com/unifiedjs/.github/blob/main/contributing.md

[support]: https://github.com/unifiedjs/.github/blob/main/support.md

[coc]: https://github.com/unifiedjs/.github/blob/main/code-of-conduct.md

[security]: https://github.com/unifiedjs/.github/blob/main/security.md

[license]: license

[author]: https://github.com/Murderlon

[npm]: https://docs.npmjs.com/cli/install

[camo]: https://github.com/atmos/camo

[go-camo]: https://github.com/cactus/go-camo
