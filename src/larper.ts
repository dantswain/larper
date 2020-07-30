import * as path from 'path';
import * as fs from 'fs';
import { readFile, writeFile, readFileSync } from 'fs';

import * as express from 'express';
import * as proxy from 'express-http-proxy';

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

function larpRead(outpath): Middleware {
  const larps = readLarps(outpath);
  return (req, res, next) => {
    if (req.path.startsWith('/api')) {
      const larp = makeReqLarp(req);
      const key = larp.request.url;
      if (key in larps) {
        const found = larps[key].findIndex((l) => sameLarp(l, larp));
        if (found >= 0) {
        // eslint-disable-next-line no-param-reassign
          const foundLarp = larps[key][found];
          res.set(foundLarp.response.headers);
          res.send(foundLarp.response.body);
        } else {
          console.log(`Could not find a matching larp for key ${key} with request ${JSON.stringify(larp)}`);
          next();
        }
      } else {
        console.log(`Could not find any larps for key ${key}`);
        next();
      }
    } else {
      next();
    }
  };
}

function ensureOutDir(outPath: string): void {
  const dir = path.dirname(outPath);
  fs.mkdirSync(dir, { recursive: true });
}

export type LarperOptions = {
  outPath?: string;
  modeParam?: string;
}

const defaultOptions = {
  outPath: 'larps.json',
  modeParam: 'LARP_WRITE',
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

  constructor(upstream: string, options: LarperOptions = {}) {
    this.upstream = upstream;
    this.outPath = options.outPath || defaultOptions.outPath;
    const modeParam = options.modeParam || defaultOptions.modeParam;
    this.doWrite = false;
    if (process.env[modeParam]) {
      this.doWrite = true;
    }

    ensureOutDir(this.outPath);

    this.proxy = proxy(
      upstream,
      {
        filter: (req) => req.url.startsWith('/api'),
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
      larpRead(this.outPath)(req, resp, next);
    }
  }
}
