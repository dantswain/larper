import * as path from 'path';
import * as fs from 'fs';
import { readFile, writeFile, readFileSync } from 'fs';

import * as express from 'express';
import * as proxy from 'express-http-proxy';

type Query = Record<string, unknown>;
type Headers = Record<string, unknown>;

type LarpRequest = {
  url: string;
  method: string;
  query: Query;
  body: unknown;
  headers: Headers;
}

type LarpResponse = {
  status: number;
  headers: Headers;
  body: unknown;
}

type Larp = {
  request: LarpRequest;
  response: LarpResponse;
}

function filterKeys(m, keysToKeep) {
  return Object
    .keys(m)
    .filter((k) => keysToKeep.includes(k))
    .reduce((acc, k) => {
      acc[k] = m[k];
      return acc;
    }, {});
}

function sameLarp(l1, l2) {
  return JSON.stringify(l1.request) === JSON.stringify(l2.request);
}

function makeReqLarp(req) {
  return {
    request: {
      url: req.url,
      method: req.method,
      query: req.query,
      body: req.body || {},
      headers: filterKeys(req.headers, ['accept', 'content-type', 'authorization']),
    },
  };
}

function makeLarp(req, res, resData) {
  return {
    request: {
      url: req.url,
      method: req.method,
      query: req.query,
      body: req.body,
      headers: filterKeys(req.headers, ['accept', 'content-type', 'authorization']),
    },
    response: {
      status: res.status,
      headers: res.headers,
      body: resData.toString(),
    },
  };
}

function parseLarps(err, data) {
  if (err) {
    if (err.code === 'ENOENT') {
      return {};
    }
    throw err;
  } else {
    return JSON.parse(data);
  }
}

function addLarp(larps, larp) {
  const key = larp.request.url;
  if (key in larps) {
    const found = larps[key].findIndex((l) => sameLarp(l, larp));
    if (found >= 0) {
      // eslint-disable-next-line no-param-reassign
      larps[key][found] = larp;
    } else {
      larps[key].push(larp);
    }
  } else {
    // eslint-disable-next-line no-param-reassign
    larps[key] = [larp];
  }
}

function writeLarp(outPath, req, res, resData) {
  const larp = makeLarp(req, res, resData);
  readFile(outPath, (err, data) => {
    const larps = parseLarps(err, data);
    addLarp(larps, larp);
    writeFile(outPath, JSON.stringify(larps, null, 2), (errW) => {
      if (errW) throw errW;
    });
  });
}

function readLarps(outPath) {
  return JSON.parse(readFileSync(outPath).toString());
}

function ensureOutDir(outPath: string): void {
  const dir = path.dirname(outPath);
  fs.mkdirSync(dir, { recursive: true });
}

type RequestFilter = (req: express.Request) => boolean;

export type LarperOptions = {
  outPath?: string;
  modeParam?: string;
  filter?: RequestFilter;
}

const defaultOptions = {
  outPath: 'larps.json',
  modeParam: 'LARP_WRITE',
  filter: (req: express.Request) => req.path.startsWith('/api'),
};

type Middleware = (
  req: express.Request,
  resp: express.Response,
  next: () => void
) => void;

export class Larper {
  upstream: string;

  outPath: string;

  doWrite: boolean;

  proxy: Middleware;

  filter: RequestFilter;

  constructor(upstream: string, options: LarperOptions = {}) {
    this.upstream = upstream;
    this.outPath = options.outPath || defaultOptions.outPath;
    const modeParam = options.modeParam || defaultOptions.modeParam;
    this.doWrite = false;
    if (process.env[modeParam]) {
      this.doWrite = true;
    }
    this.filter = options.filter || defaultOptions.filter;

    ensureOutDir(this.outPath);

    this.proxy = proxy(
      upstream,
      {
        filter: this.filter,
        userResDecorator: (proxyRes, proxyResData, userReq) => {
          writeLarp(this.outPath, userReq, proxyRes, proxyResData);
          return proxyResData;
        },
      },
    );
  }

  larp(req: express.Request, resp: express.Response, next: () => void): void {
    if (this.doWrite) {
      this.proxy(req, resp, next);
    } else {
      this.onRead(req, resp, next);
    }
  }

  onRead(req: express.Request, resp: express.Response, next: () => void): void {
    if (!fs.existsSync(this.outPath)) {
      resp.status(404);
      resp.json({ error: `${this.outPath} not found` });
      return;
    }

    if (!this.filter(req)) {
      next();
      return;
    }

    const larps = readLarps(this.outPath);
    const larp = makeReqLarp(req);
    const key = larp.request.url;

    if (key in larps) {
      const found = larps[key].findIndex((l) => sameLarp(l, larp));
      if (found >= 0) {
        const foundLarp = larps[key][found];
        resp.set(foundLarp.response.headers);
        resp.send(foundLarp.response.body);
      } else {
        console.log(`Could not find a matching larp for key ${key} with request ${JSON.stringify(larp)}`);
        next();
      }
    } else {
      console.log(`Could not find any larps for key ${key}`);
      next();
    }
  }
}
