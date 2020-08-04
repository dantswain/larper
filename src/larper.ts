import * as path from 'path';
import * as fs from 'fs';

import * as express from 'express';
import * as proxy from 'express-http-proxy';
import * as pino from 'pino';

type Query = Record<string, unknown>;
type Headers = Record<string, unknown>;

// this field is present when we get the response but it is not part of the
// express.Response type
interface Response extends express.Response {
  headers: Headers;
}

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

type LarpDict = Record<string, Array<Larp>>;

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
  enableParam?: string;
  filter?: RequestFilter;
  matcher?: RequestMatcher;
  recFilter?: LarpFilter;
}

export type Middleware = (
  req: express.Request,
  resp: express.Response,
  next: express.NextFunction,
) => void;

const logger = pino({ prettyPrint: { colorize: true } });

type KeyType = string | number | symbol;
function filterKeys<Tv>(m: Record<KeyType, Tv>, keysToKeep: Array<KeyType>): Record<KeyType, Tv> {
  return Object
    .keys(m)
    .filter((k) => keysToKeep.includes(k))
    .reduce((acc, k) => {
      acc[k] = m[k];
      return acc;
    }, {});
}

function sameRequest(req: LarpRequest, larp: Larp): boolean {
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

function makeLarp(req: express.Request, res: Response, resData: Buffer): Larp {
  return {
    request: {
      path: req.path,
      method: req.method,
      query: req.query,
      body: req.body || {},
      headers: filterKeys(req.headers, ['accept', 'content-type', 'authorization']),
    },
    response: {
      status: res.statusCode,
      headers: res.headers,
      body: resData.toString(),
    },
  };
}

function addLarp(larps: LarpDict, larp: Larp): void {
  const key = larp.request.path;
  if (key in larps) {
    const found = larps[key].findIndex((l) => sameRequest(larp.request, l));
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

function readLarps(outPath: string): LarpDict {
  return JSON.parse(fs.readFileSync(outPath).toString());
}

function readLarpsOrEmpty(outPath): LarpDict {
  if (fs.existsSync(outPath)) {
    return readLarps(outPath);
  }
  return {};
}

function writeLarp(
  outPath: string,
  req: express.Request,
  res: express.Response,
  resData: Buffer,
  recFilter: LarpFilter,
) {
  const larp = makeLarp(req, res as Response, resData);
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
  enableParam: 'LARP',
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

  enabled: boolean;

  constructor(upstream: string, options: LarperOptions = {}) {
    this.upstream = upstream;
    this.setOptions(options);
  }

  setOptions(options: LarperOptions): void {
    this.outPath = options.outPath || defaultOptions.outPath;
    const modeParam = options.modeParam || defaultOptions.modeParam;
    const enableParam = options.enableParam || defaultOptions.enableParam;

    this.doWrite = false;
    if (process.env[modeParam]) {
      this.doWrite = true;
    }

    this.enabled = false;
    if (process.env[enableParam]) {
      this.enabled = true;
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
          if (this.enabled) {
            writeLarp(this.outPath, userReq, proxyRes, proxyResData, this.recFilter);
          }
          return proxyResData;
        },
      },
    );
  }

  larp(req: express.Request, resp: express.Response, next: express.NextFunction): void {
    if (this.doWrite || !this.enabled) {
      this.proxy(req, resp, next);
    } else {
      this.onRead(req, resp, next);
    }
  }

  onRead(req: express.Request, resp: express.Response, next: express.NextFunction): void {
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

    if (match == null) {
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
