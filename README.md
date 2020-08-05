# Larper

[![Build Status](https://travis-ci.org/dantswain/larper.svg?branch=master)](https://travis-ci.org/dantswain/larper)
[![npm version](https://badge.fury.io/js/larper.svg)](https://badge.fury.io/js/larper)

Larper is an express middleware intended to help UI testing of microservices
applications.  It has three modes of operation:

* Fixture-write mode - In fixture-write mode, Larper acts as a reverse proxy (using
  [express-http-proxy](https://github.com/villadora/express-http-proxy)) to your
  upstream API server.  It records to a fixture file all requests sent to the API and their
  corresponding responses.

* Fixture-read mode - In playback mode, Larper replaces your upstream API server and
  responds to API requests using the responses recorded while in write mode.

* Proxy mode - Proxy mode is identical to fixture-write mode except that it does
  not write the fixture file.

Larper is built for use with
[webpack-dev-server](https://github.com/webpack/webpack-dev-server) and
[cypress](htts://cypress.io). We provide directions below for using it with
these tools, but it could theoretically be used with any express server.

The inspiration for Larper is to make it easier to perform UI tests on
applications that have a separate fronte-end and back-end.  It provides a
middle-ground between full end-to-end testing and unit testing.  The intended
workflow is something like the following.

1. Build and launch your front-end using webpack-dev-server with Larper.

2. Launch your front-end tests (e.g., Cypress) pointing at webpack dev server
    in fixture-write mode.

3. Commit the generated fixtures and use Larper in fixture-read mode in your CI
    pipeline.

## Installation

```bash
npm install --save-dev larper
```

## Usage with webpack-dev-server

The easiest way to integrate Larper into your webpack config is to use the
[`devServer.after`](https://webpack.js.org/configuration/dev-server/#devserverafter)
config setting to add the Larper middleware.

```js
// webpack.config.js

const express = require('express');
const larper = require('larper');

// set to whatever you use for development as the upstream API server
const upstream_api = 'http://localhost:3000/';

module.exports = {
  // ...

  devServer: {
    // ...
    after: function(app) {
      app.use(express.json()); // if your API uses json
      app.use(larper.larper(upstream_api));
    }
  }
}
```

Then, to run in each of the three modes:

1. Fixture-write mode: `LARP=1 LARP_WRITE=1 npm run webpack-dev-server`

2. Fixture-read mode: `LARP=1 npm run webpack-dev-server`

3. Proxy mode: `npm run webpack-dev-server`

It may be worth adding these as npm run commands in your `package.json` file.

## API

The intended usage of Larper is to `use` the return value of
`larper(upstream: string, options: LarperOptions)` as an (express
middleware)[https://expressjs.com/en/guide/using-middleware.html].

### Options

The `LarpOptions` type has the following fields.  Some of them depend on other
types, such as `Larp` or `LarpRequest`, which are described below.

#### `outPath: string`

The path (including filename) where Larper should store the fixtures.  The
output file is json plaintext.  Defaults to `larps.json`.

#### `enableParam: string`

The environment variable that Larper uses to determine if Larper should be
enabled for fixture reads/writes (if it is set) or proxy only (if it is not
set).  Defaults to `LARP`.

#### `modeParam: string`

The environment variable that Larper uses to determine if Larper should write
(if it is set) or read (if it is not set) fixtures.  Only applies if the
`enableParam` env var is set.  Defaults to `LARP_WRITE`.

#### `filter: (req: express.Request) => boolean`

A callback function that Larper calls to determine whether or not it should
handle the given request.  Defaults to `(req) => req.path.startsWith('/api')` -
i.e., handle any requests whose paths start with `/api`.

#### `matcher: (req: LarpRequest, larp: Larp, fallback) => boolean`

A callback function that Larper calls during fixture-read mode to determine if
the given request matches the stored larp.  Alternatively, you can call
`fallback` which will in turn return true if the requests are equal (by JSON
comparison).  Default: `(req, larp, fallback) => fallback(req, larp)`

Example - always return the same fixture for `/api/search` regardless of search
terms:

```js
(req, larp, fallback) => {
  // note we need to make sure that the method and path match
  if (req.method === 'GET' && larp.request.method === req.method
    && req.path === '/api/search' && larp.request.path === '/api/search') {
    // ignore the headers and query params, just return true
    return true;
  }
  // fall back to the default behavior for all other routes
  return fallback(req, larp);
}
```

#### `recFilter: (larp: Larp) => boolean`

A callback function that Larper calls during fixture-write mode to determine if
it should record the given request/response pair.  Defaults to `() => true`,
i.e., record every pair.

Example - Only record requests to `/api/widgets` that return non-empty array
results:

```js
(larp) => {
  if (larp.request.path === '/api/widgets' && larp.request.method === 'GET') {
    return larp.response.body.length > 2; // not '[]'
  }
  // record all requests for all other routes
  return true;
}
```

### Other Types

#### LarpRequest

This is how Larper represents an HTTP request.

```ts
type LarpRequest = {
  path: string;
  method: string;
  query: Record<string, unknown>;
  body: unknown;
  headers: Record<string, unknown>;
}
```

Note that the body is treated as an opaque entity.

#### LarpResponse

This is how Larper represents an HTTP response.

```ts
type LarpResponse = {
  status: number;
  headers: Record<string, unknown>;
  body: unknown;
}
```

Note that the body is treated as an opaque entity.

#### Larp

A combination of a request and a response.

```ts
type Larp = {
  request: LarpRequest;
  response: LarpResponse;
}
```

## Contributing

1. Fork this repo.

2. Make sure `npm run build && npm run lint && npm run test` passes.

3. Open a pull request.
