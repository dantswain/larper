import * as fs from 'fs';

import * as express from 'express';
import * as request from 'supertest';
import { Server } from 'http';

import { Larp, Larper, LarpRequest } from '../src';

const app = express();
const upstreamApp = express();
const testOutPath = 'larps/test.json';

process.env.LARP = '1';
process.env.LARP_WRITE = '1';

let server: Server;
let upstream: Server;
const testLarperOptions = { outPath: testOutPath };
const larper = new Larper('http://localhost:3002/', testLarperOptions);

function clearTestOutput() {
  if (fs.existsSync(testOutPath)) {
    fs.unlinkSync(testOutPath);
  }
}

beforeAll(() => {
  upstreamApp.get('/api/foo', (req, res) => {
    res.set('upstream-header', 'true');
    res.json('ok');
  });

  app.get('/non-api', (req, res) => {
    res.send('not an api response');
  });

  server = app.listen(3001);
  upstream = upstreamApp.listen(3002);

  app.use(express.json());
  app.use(larper.larp.bind(larper));
  app.use((err, req, res, next) => {
    if (err) {
      console.log(err);
    }
    next();
  });
});

afterAll(() => {
  server.close();
  upstream.close();
});

beforeEach(() => {
  larper.doWrite = true;
  larper.setOptions(testLarperOptions);
  clearTestOutput();
});

test('proxies to upstream', (done) => {
  request(app)
    .get('/api/foo')
    .expect(200)
    .expect('Content-Type', /json/)
    .expect('upstream-header', 'true')
    .then((resp) => {
      expect(resp.body).toBe('ok');
      done();
    });
});

function dropDate(larp: Larp) {
  // eslint-disable-next-line no-param-reassign
  delete larp.response.headers.date;
  return larp;
}

test('writes the larp to json', (done) => {
  request(app)
    .get('/api/foo?bar=baz')
    .expect(200)
    .expect('Content-Type', /json/)
    .expect('upstream-header', 'true')
    .then((resp) => {
      expect(resp.body).toBe('ok');
      fs.readFile(testOutPath, (err, data) => {
        expect(err).toBe(null);

        const parsed = JSON.parse(data.toString());
        expect(Object.keys(parsed)).toStrictEqual(['/api/foo']);
        expect(parsed['/api/foo'].length).toBe(1);

        const withoutDate = dropDate(parsed['/api/foo'][0]);

        expect(withoutDate).toStrictEqual({
          request: {
            path: '/api/foo',
            method: 'GET',
            query: { bar: 'baz' },
            body: {},
            headers: {},
          },
          response: {
            body: '"ok"',
            status: 200,
            headers: {
              connection: 'close',
              'content-length': '4',
              'content-type': 'application/json; charset=utf-8',
              etag: 'W/"4-Ut1MdMgT2zeQF5xPI2zq2so0Z6g"',
              'upstream-header': 'true',
              'x-powered-by': 'Express',
            },
          },
        });

        done();
      });
    });
});

test('does not proxy when path does not match', (done) => {
  request(app)
    .get('/non-api')
    .expect(200)
    .expect('Content-Type', /html/)
    .then((resp) => {
      expect(resp.text).toBe('not an api response');
      done();
    });
});

test('reads a request from the larp file', (done) => {
  larper.doWrite = false;

  const larp = {
    request: {
      path: '/api/foo',
      method: 'GET',
      query: {},
      body: {},
      headers: {},
    },
    response: {
      headers: {
        'from-larper': 'true',
        'content-type': 'application/json; charset=utf-8',
      },
      body: '"ok"',
    },
  };

  fs.writeFileSync(testOutPath, JSON.stringify(
    { '/api/foo': [larp] },
  ));

  request(app)
    .get('/api/foo')
    .expect(200)
    .expect('Content-Type', /json/)
    .expect('from-larper', 'true')
    .then((resp) => {
      expect(resp.body).toBe('ok');
      done();
    });
});

test('returns a 404 when there is no larps file', (done) => {
  larper.doWrite = false;

  request(app)
    .get('/api/foo')
    .expect(404)
    .then((resp) => {
      expect(resp.body).toStrictEqual({ error: `${testOutPath} not found` });
      done();
    });
});

test('read defers to local filter', (done) => {
  larper.doWrite = false;

  request(app)
    .get('/non-api')
    .expect(200)
    .expect('Content-Type', /html/)
    .then((resp) => {
      expect(resp.text).toBe('not an api response');
      done();
    });
});

test('allows us to provide a request matcher', (done) => {
  larper.doWrite = false;

  larper.matcher = (req: LarpRequest, larp: Larp, fallback) => {
    if (
      req.path === '/api/foo'
      && larp.request.path === '/api/foo'
      && req.method === 'GET'
      && larp.request.method === 'GET') {
      return true;
    }
    return fallback(req, larp);
  };

  const larp = {
    request: {
      path: '/api/foo',
      method: 'GET',
      query: { foo: 'bar' },
      body: {},
      headers: {},
    },
    response: {
      headers: {
        'from-larper': 'true',
        'content-type': 'application/json; charset=utf-8',
      },
      body: '"ok"',
    },
  };

  fs.writeFileSync(testOutPath, JSON.stringify(
    { '/api/foo': [larp] },
  ));

  request(app)
    .get('/api/foo?foo=baz')
    .expect(200)
    .expect('Content-Type', /json/)
    .expect('from-larper', 'true')
    .then((resp) => {
      expect(resp.body).toBe('ok');
      done();
    });
});

test('allows us to filter what is written', (done) => {
  larper.recFilter = (larp: Larp) => larp.request.path !== '/api/foo';

  request(app)
    .get('/api/foo?bar=baz')
    .expect(200)
    .expect('Content-Type', /json/)
    .expect('upstream-header', 'true')
    .then((resp) => {
      expect(resp.body).toBe('ok');
      expect(fs.existsSync(testOutPath)).toBe(false);
      done();
    });
});

test('allows us to disable everything but the proxy', (done) => {
  larper.enabled = false;

  request(app)
    .get('/api/foo?bar=baz')
    .expect(200)
    .expect('Content-Type', /json/)
    .expect('upstream-header', 'true')
    .then((resp) => {
      expect(resp.body).toBe('ok');
      expect(fs.existsSync(testOutPath)).toBe(false);
      done();
    });
});

test('returns a 404 when no match is found', (done) => {
  larper.doWrite = false;

  fs.writeFileSync(testOutPath, JSON.stringify({ }));

  request(app)
    .get('/api/foo')
    .expect(404)
    .then((resp) => {
      expect(resp.body).toStrictEqual({ });
      done();
    });
});
