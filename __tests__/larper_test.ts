import * as fs from 'fs';

import * as express from 'express';
import * as request from 'supertest';
import { Server } from 'http';

import { Larper } from '../src';

const app = express();
const upstreamApp = express();
const testOutPath = 'larps/test.json';

process.env.LARP_WRITE = '1';

let server: Server;
let upstream: Server;
const larper = new Larper('http://localhost:3002/', { outPath: testOutPath });

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
});

afterAll(() => {
  server.close();
  upstream.close();
});

beforeEach(() => {
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
      url: '/api/foo',
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
    .expect('Content-Type', /json/)
    .expect('from-larper', 'true')
    .then((resp) => {
      expect(resp.body).toBe('ok');
      done();
    });
});

// test when set to read but file does not exist
