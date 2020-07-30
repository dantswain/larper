import * as express from 'express';
import * as request from 'supertest';
import { Server } from 'http';

import { Larper } from '../src';

const app = express();
const upstreamApp = express();
let server: Server;
let upstream: Server;

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

test('larper (middleware)', (done) => {
  const larper = new Larper('http://localhost:3002/');
  app.use(express.json());
  app.use(larper.larp.bind(larper));

  request(app)
    .get('/api/foo')
    .expect(200)
    .expect('Content-Type', /json/)
    .then((resp) => {
      expect(resp.body).toBe('ok');
      done();
    });
});
