import * as path from 'path';
import * as fs from 'fs';

import * as express from 'express';
import * as proxy from 'express-http-proxy';
import * as pino from 'pino';

type Query = Record<string, unknown>;
type Headers = Record<string, unknown>;

export type LarpRequest = {
  path: string;
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

export type Larp = {
  request: LarpRequest;
  response: LarpResponse;
}

type RequestFilter = (req: express.Request) => boolean;
type LarpFilter = (larp: Larp) => boolean;
type RequestMatcher = (
  req: LarpRequest,
  larp: Larp,
  fallback: ((req: LarpRequest, larp: Larp) => boolean)
) => boolean;

export type LarperOptions = {
  outPath?: string;
  modeParam?: string;
  filter?: RequestFilter;
  matcher?: RequestMatcher;
  recFilter?: LarpFilter;
}

export type Middleware = (
  req: express.Request,
  resp: express.Response,
  next: () => void
) => void;

const logger = pino({ prettyPrint: { colorize: true } });

function filterKeys(m, keysToKeep) {
  return Object
    .keys(m)
    .filter((k) => keysToKeep.includes(k))
    .reduce((acc, k) => {
      acc[k] = m[k];
      return acc;
    }, {});
}

function sameRequest(req: LarpRequest, larp: Larp) {
  return JSON.stringify(req) === JSON.stringify(larp.request);
}

function makeReqLarp(req: express.Request): LarpRequest {
  return {
    path: req.path,
    method: req.method,
    query: req.query,
    body: req.body || {},
    headers: filterKeys(req.headers, ['accept', 'content-type', 'authorization']),
  };
}

function makeLarp(req, res, resData) {
  return {
    request: {
      path: req.path,
      method: req.method,
      query: req.query,
      body: req.body || {},
      headers: filterKeys(req.headers, ['accept', 'content-type', 'authorization']),
    },
    response: {
      status: res.status,
      headers: res.headers,
      body: resData.toString(),
    },
  };
}

function addLarp(larps, larp) {
  const key = larp.request.path;
  if (key in larps) {
    const found = larps[key].findIndex((l) => sameRequest(l, larp.request));
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

function readLarps(outPath) {
  return JSON.parse(fs.readFileSync(outPath).toString());
}

function readLarpsOrEmpty(outPath) {
  if (fs.existsSync(outPath)) {
    return readLarps(outPath);
  }
  return {};
}

function writeLarp(outPath, req, res, resData, recFilter) {
  const larp = makeLarp(req, res, resData);
  if (recFilter(larp)) {
    const larps = readLarpsOrEmpty(outPath);
    addLarp(larps, larp);
    fs.writeFileSync(outPath, JSON.stringify(larps, null, 2));
  }
}

function ensureOutDir(outPath: string): void {
  const dir = path.dirname(outPath);
  fs.mkdirSync(dir, { recursive: true });
}

const defaultOptions: LarperOptions = {
  outPath: 'larps.json',
  modeParam: 'LARP_WRITE',
  filter: (req: express.Request) => req.path.startsWith('/api'),
  matcher: (req: LarpRequest, larp: Larp, fallback) => fallback(req, larp),
  recFilter: () => true,
};

export class Larper {
  upstream: string;

  outPath: string;

  doWrite: boolean;

  proxy: Middleware;

  filter: RequestFilter;

  matcher: RequestMatcher;

  recFilter: LarpFilter;

  constructor(upstream: string, options: LarperOptions = {}) {
    this.upstream = upstream;
    this.setOptions(options);
  }

  setOptions(options: LarperOptions): void {
    this.outPath = options.outPath || defaultOptions.outPath;
    const modeParam = options.modeParam || defaultOptions.modeParam;
    this.doWrite = false;
    if (process.env[modeParam]) {
      this.doWrite = true;
    }
    this.filter = options.filter || defaultOptions.filter;
    this.matcher = options.matcher || defaultOptions.matcher;
    this.recFilter = options.recFilter || defaultOptions.recFilter;

    ensureOutDir(this.outPath);

    this.proxy = proxy(
      this.upstream,
      {
        filter: this.filter,
        userResDecorator: (proxyRes, proxyResData, userReq) => {
          writeLarp(this.outPath, userReq, proxyRes, proxyResData, this.recFilter);
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

    const larp = makeReqLarp(req);
    const match = this.findMatchingLarp(larp);

    if (!match) {
      next();
    }

    resp.set(match.response.headers);
    resp.send(match.response.body);
  }

  findMatchingLarp(larpIn: LarpRequest): Larp | null {
    const larps = readLarps(this.outPath);
    const key = larpIn.path;

    if (key in larps) {
      const found = larps[key].findIndex((l: Larp) => this.matcher(larpIn, l, sameRequest));
      if (found >= 0) {
        const foundLarp = larps[key][found];
        logger.debug(`Found matching larp for key ${key}: ${JSON.stringify(foundLarp)}`);
        return foundLarp;
      }
      logger.warn(`Could not find a matching larp for key ${key} with request ${JSON.stringify(larpIn)}`);
      return null;
    }
    logger.warn(`Could not find any larps for key ${key}`);
    return null;
  }
}
