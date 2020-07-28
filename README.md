# Larper

Larper is an express middleware intended to help UI testing of microservices
applications.  It has two modes of operation:

* Write mode - In write mode, Larper acts as a reverse proxy (using
  [express-http-proxy](https://github.com/villadora/express-http-proxy)) to your
  upstream API server.  It records to a file all requests sent to the API and their
  corresponding responses.

* Playback mode - In playback mode, Larper replaces your upstream API server and
  responds to API requests using the responses recorded while in write mode.

This is very much work in progress!
