# comomile

[![Build][badge-build-image]][badge-build-url]
[![Coverage][badge-coverage-image]][badge-coverage-url]
[![Downloads][badge-downloads-image]][badge-downloads-url]
[![Sponsors][badge-funding-sponsors-image]][badge-funding-url]
[![Backers][badge-funding-backers-image]][badge-funding-url]
[![Chat][badge-chat-image]][badge-chat-url]

**camomile** is a Node.js HTTP proxy to route images through SSL,
compatible with unified plugins,
to safely embed user content on the web.

## Contents

*   [What is this?](#what-is-this)
*   [When should I use this?](#when-should-i-use-this)
*   [Install](#install)
*   [Use](#use)
*   [API](#api)
    *   [`new Camomile(options)`](#new-camomileoptions)
    *   [`Options`](#options)
*   [Examples](#examples)
    *   [Example: integrate camomile into Express](#example-integrate-camomile-into-express)
    *   [Example: integrate camomile into Koa](#example-integrate-camomile-into-koa)
    *   [Example: integrate camomile into Fastify](#example-integrate-camomile-into-fastify)
    *   [Example: integrate camomile into Next.js](#example-integrate-camomile-into-nextjs)
*   [Compatibility](#compatibility)
*   [Contribute](#contribute)
*   [Acknowledgments](#acknowledgments)
*   [License](#license)

## What is this?

This is a Node.js HTTP proxy to route images through SSL,
integrable in any Node.js server such as Express, Koa, Fastify, or Next.js.

camomile works together with [rehype-github-image][github-rehype-github-image],
which does the following at build time:

1.  find all insecure HTTP image URLs in content
2.  generate [HMAC][wikipedia-hmac] signature of each URL
3.  replace the URL with a signed URL containing the encoded URL and HMAC

When a user visits your app and views the content:

1.  their browser requests the URLs going to your server
2.  camomile validates the HMAC,
    decodes the URL,
    requests the content from the origin server without sensitive headers,
    and streams it to the client

## When should I use this?

Use this when you want to embed user content on the web in a safe way.
Sometimes user content is served over HTTP,
which is not secure:

> An HTTPS page that includes content fetched using cleartext HTTP is called a
> mixed content page.
> Pages like this are only partially encrypted,
> leaving the unencrypted content accessible to sniffers and man-in-the-middle
> attackers.
>
> — [MDN][mdn-mixed-content]

This also prevents information about your users leaking to other servers.

## Install

This package is [ESM only][github-gist-esm].
In Node.js (version 18+),
install with [npm][npm-install]:

```sh
npm install camomile
```

## Use

```js
import process from 'node:process'
import {Camomile} from 'camomile'

const secret = process.env.CAMOMILE_SECRET

if (!secret) throw new Error('Missing `CAMOMILE_SECRET` in environment')

const server = new Camomile({secret})

server.listen({host: '127.0.0.1', port: 1080})
```

## API

This package exports the identifier
[`Camomile`][api-camomile].
It exports the [TypeScript][] type
[`Options`][api-options].
There is no default export.

### `new Camomile(options)`

Create a new camomile server with options.

###### Parameters

*   `options` ([`Options`][api-options], required)
    — configuration

###### Returns

Server.

### `Options`

Configuration (TypeScript type).

###### Fields

*   `maxSize` (`number`, default: `100 * 1024 * 1024`)
    — max size in bytes per resource to download;
    a `413` is sent if the resource is larger than the maximum size
*   `secret` (`string`, **required**)
    — HMAC key to decrypt the URLs and used by
    [`rehype-github-image`][github-rehype-github-image]
*   `serverName` (`string`, default: `'camomile'`)
    — server name sent in `Via`

## Examples

### Example: integrate camomile into Express

```js
import process from 'node:process'
import {Camomile} from 'camomile'
import express from 'express'

const secret = process.env.CAMOMILE_SECRET
if (!secret) throw new Error('Missing `CAMOMILE_SECRET` in environment')

const uploadApp = express()
const camomile = new Camomile({secret})
uploadApp.all('*', camomile.handle.bind(camomile))

const host = '127.0.0.1'
const port = 1080
const app = express()
app.use('/uploads', uploadApp)
app.listen(port, host)

console.log('Listening on `http://' + host + ':' + port + '/uploads/`')
```

### Example: integrate camomile into Koa

```js
import process from 'node:process'
import {Camomile} from 'camomile'
import Koa from 'koa'

const secret = process.env.CAMOMILE_SECRET
if (!secret) throw new Error('Missing `CAMOMILE_SECRET` in environment')
const camomile = new Camomile({secret})

const port = 1080
const app = new Koa()

app.use(function (ctx, next) {
  if (/^\/files\/.+/.test(ctx.path.toLowerCase())) {
    return camomile.handle(ctx.req, ctx.res)
  }

  return next()
})

app.listen(port)
```

### Example: integrate camomile into Fastify

```js
import process from 'node:process'
import {Camomile} from 'camomile'
import createFastify from 'fastify'

const secret = process.env.CAMOMILE_SECRET
if (!secret) throw new Error('Missing `CAMOMILE_SECRET` in environment')

const fastify = createFastify({logger: true})
const camomile = new Camomile({secret})

/**
 * Add `content-type` so fastify forewards without a parser to the leave body untouched.
 *
 * @see https://www.fastify.io/docs/latest/Reference/ContentTypeParser/
 */
fastify.addContentTypeParser(
  'application/offset+octet-stream',
  function (request, payload, done) {
    done(null)
  }
)

/**
 * Use camomile to handle preparation and filehandling requests.
 * `.raw` gets the raw Node HTTP request and response objects.
 *
 * @see https://www.fastify.io/docs/latest/Reference/Request/
 * @see https://www.fastify.io/docs/latest/Reference/Reply/#raw
 */
fastify.all('/files', function (request, response) {
  camomile.handle(request.raw, response.raw)
})
fastify.all('/files/*', function (request, response) {
  camomile.handle(request.raw, response.raw)
})

fastify.listen({port: 3000}, function (error) {
  if (error) {
    fastify.log.error(error)
    process.exit(1)
  }
})
```

### Example: integrate camomile into Next.js

Attach the camomile server handler to a Next.js route handler in an [optional catch-all route file](https://nextjs.org/docs/routing/dynamic-routes#optional-catch-all-routes)

`/pages/api/upload/[[...file]].ts`

```ts
import process from 'node:process'
import {Camomile} from 'camomile'
import type {NextApiRequest, NextApiResponse} from 'next'

const secret = process.env.CAMOMILE_SECRET
if (!secret) throw new Error('Missing `CAMOMILE_SECRET` in environment')

/**
 * Important: this tells Next.js not to parse the body, as camomile requires
 * @see https://nextjs.org/docs/api-routes/request-helpers
 */
export const config = {api: {bodyParser: false}}

const camomile = new Camomile({secret})

export default async function handler(
  request: NextApiRequest,
  response: NextApiResponse
) {
  return camomile.handle(request, response)
}
```

## Compatibility

Projects maintained by the unified collective are compatible with maintained
versions of Node.js.

When we cut a new major release,
we drop support for unmaintained versions of Node.
This means we try to keep the current release line,
`camomile@^1`,
compatible with Node.js 18.

## Contribute

See [`contributing.md`][github-dotfiles-contributing] in
[`rehypejs/.github`][github-dotfiles-health] for ways
to get started.
See [`support.md`][github-dotfiles-support] for ways to get help.

This project has a [code of conduct][github-dotfiles-coc].
By interacting with this repository, organization, or community you agree to
abide by its terms.

For info on how to submit a security report,
see our [security policy][github-dotfiles-security].

## Acknowledgments

In 2010 GitHub introduced [camo][github-atmos-camo],
a similar server in CoffeeScript,
which is now deprecated and in public archive.
This project is a spiritual successor to `camo`.

A lot of inspiration was also taken from [`go-camo`][github-cactus-camo],
which is a modern and maintained image proxy in Go.

Thanks to [**@kytta**][github-kytta] for the npm package name `comomile`!

## License

[MIT][file-license] © [Merlijn Vos][github-murderlon]

<!-- Definitions -->

[api-camomile]: #new-camomileoptions

[api-options]: #options

[badge-build-image]: https://github.com/wooorm/dead-or-alive/workflows/main/badge.svg

[badge-build-url]: https://github.com/wooorm/dead-or-alive/actions

[badge-chat-image]: https://img.shields.io/badge/chat-discussions-success.svg

[badge-chat-url]: https://github.com/rehypejs/rehype/discussions

[badge-coverage-image]: https://img.shields.io/codecov/c/github/wooorm/dead-or-alive.svg

[badge-coverage-url]: https://codecov.io/github/wooorm/dead-or-alive

[badge-downloads-image]: https://img.shields.io/npm/dm/dead-or-alive.svg

[badge-downloads-url]: https://www.npmjs.com/package/dead-or-alive

[badge-funding-backers-image]: https://opencollective.com/unified/backers/badge.svg

[badge-funding-sponsors-image]: https://opencollective.com/unified/sponsors/badge.svg

[badge-funding-url]: https://opencollective.com/unified

[file-license]: license

[github-atmos-camo]: https://github.com/atmos/camo

[github-cactus-camo]: https://github.com/cactus/go-camo

[github-dotfiles-coc]: https://github.com/rehypejs/.github/blob/main/code-of-conduct.md

[github-dotfiles-contributing]: https://github.com/rehypejs/.github/blob/main/contributing.md

[github-dotfiles-health]: https://github.com/rehypejs/.github

[github-dotfiles-security]: https://github.com/rehypejs/.github/blob/main/security.md

[github-dotfiles-support]: https://github.com/rehypejs/.github/blob/main/support.md

[github-gist-esm]: https://gist.github.com/sindresorhus/a39789f98801d908bbc7ff3ecc99d99c

[github-kytta]: https://github.com/kytta

[github-murderlon]: https://github.com/Murderlon

[github-rehype-github-image]: https://github.com/rehypejs/rehype-github/tree/main/packages/image

[mdn-mixed-content]: https://developer.mozilla.org/en-US/docs/Web/Security/Mixed_content

[npm-install]: https://docs.npmjs.com/cli/install

[typescript]: https://www.typescriptlang.org

[wikipedia-hmac]: https://en.wikipedia.org/wiki/HMAC
