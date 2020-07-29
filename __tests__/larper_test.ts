import * as express from 'express';
import * as request from 'supertest';
import { Server } from 'http';

import { larper } from '../src';

const app = express();
const upstreamApp = express();
let server: Server;
let upstream: Server;

process.env.LARP_MODE = '1';
process.env.LARP_WRITE = '1';

beforeAll(() => {
  upstreamApp.get('/api/foo', (req, res) => {
    res.json('ok');
  });

  server = app.listen(3001);
  upstream = upstreamApp.listen(3002);
});

afterAll(() => {
  server.close();
  upstream.close();
});

test('larper', (done) => {
  larper(app, 'http://localhost:3002', '_test_larps.json');

  request(app)
    .get('/api/foo')
    .expect('Content-Type', /json/)
    .expect(200)
    .then((resp) => {
      expect(resp.body).toBe('ok');
      done();
    });
});
