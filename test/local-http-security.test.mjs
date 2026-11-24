import { test } from "node:test";
import assert from "node:assert/strict";
import { createLocalHttpSecurity } from "../src/window-app/local-http-security.mjs";

const request = ({ method = "GET", pathname = "/", host = "127.0.0.1:43123", origin, fetchSite, cookie } = {}) => ({
  method,
  headers: {
    host,
    ...(origin === undefined ? {} : { origin }),
    ...(fetchSite === undefined ? {} : { "sec-fetch-site": fetchSite }),
    ...(cookie === undefined ? {} : { cookie }),
  },
});

test("local HTTP security rejects untrusted Host and Origin values", () => {
  const security = createLocalHttpSecurity();
  for (const host of ["attacker.example", "localhost.evil", "127.0.0.1.evil", "[::1]evil", "localhost:abc", "localhost:65536"]) {
    assert.equal(security.check(request({ host }), "/" )?.status, 403, `accepted Host ${host}`);
  }
  assert.equal(security.check(request({ origin: "http://attacker.example" }), "/api/state")?.status, 403);
  assert.equal(security.check(request({ origin: "https://localhost" }), "/api/state")?.status, 403);
  assert.equal(security.check(request({ origin: "http://localhost.evil" }), "/api/state")?.status, 403);
});

test("UI routes require the session cookie issued by the public root bootstrap", () => {
  const security = createLocalHttpSecurity();
  const host = "localhost:43123";
  assert.equal(security.check(request({ host, origin: `http://${host}` }), "/api/state")?.status, 401);
  assert.equal(security.check(request({ host, origin: `http://${host}`, cookie: "synvox_session=wrong" }), "/api/state")?.status, 401);
  assert.equal(security.check(request({ host, origin: "http://localhost:43124" }), "/api/state")?.status, 403);

  assert.equal(security.check(request({ host }), "/"), null);
  assert.equal(security.check(request({ method: "HEAD", host }), "/"), null);
  const response = { headers: {}, setHeader(name, value) { this.headers[name.toLowerCase()] = value; } };
  security.issueCookie(response, request({ host }));
  const cookie = response.headers["set-cookie"];
  assert.match(cookie, /^synvox_session_43123=[A-Za-z0-9_-]{43};/);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Strict/);
  assert.match(cookie, /Path=\//);
  const authenticated = request({ host, origin: `http://${host}`, cookie: cookie.split(";", 1)[0] });
  assert.equal(security.check(authenticated, "/api/state"), null);
  assert.equal(security.check({ ...authenticated, method: "POST" }, "/api/shutdown"), null);
});

test("API preflights allow loopback origins and reject external origins", () => {
  const security = createLocalHttpSecurity();
  assert.equal(security.check(request({ method: "OPTIONS", pathname: "/v1/messages", host: "127.0.0.1:43123", origin: "http://localhost:3000" }), "/v1/messages"), null);
  assert.equal(security.check(request({ method: "OPTIONS", host: "127.0.0.1:43123", origin: "http://attacker.example" }), "/v1/messages")?.status, 403);
  assert.equal(security.check(request({ method: "POST", host: "127.0.0.1:43123" }), "/v1/messages"), null);
});

test("cross-site iframe navigation is blocked even for public embed bootstrap routes", () => {
  const security = createLocalHttpSecurity();
  assert.equal(security.check(request({ host: "127.0.0.1:43123", origin: "http://127.0.0.1:43123", fetchSite: "cross-site" }), "/embed/workspace")?.status, 403);
  assert.equal(security.check(request({ host: "127.0.0.1:43123" }), "/embed/workspace"), null);
  assert.equal(security.check(request({ host: "127.0.0.1:43123" }), "/assets/synvox-watermark.png"), null);
  assert.equal(security.check(request({ method: "HEAD", host: "127.0.0.1:43123" }), "/assets/synvox-watermark.png"), null);
  assert.equal(security.check(request({ host: "127.0.0.1:43123" }), "/api/heartbeat"), null);
  assert.equal(security.check(request({ method: "POST", host: "127.0.0.1:43123" }), "/api/heartbeat")?.status, 401);
});

test('IDE iframe bootstrap and same-origin browser requests remain usable without third-party cookies', () => {
  const security = createLocalHttpSecurity();
  const iframe = request({ host: '127.0.0.1:43123' });
  iframe.headers['sec-fetch-site'] = 'cross-site';
  iframe.headers['sec-fetch-dest'] = 'iframe';
  assert.equal(security.check(iframe, '/'), null);
  const browser = request({ host: '127.0.0.1:43123' });
  browser.headers['sec-fetch-site'] = 'same-origin';
  assert.equal(security.check(browser, '/api/state'), null);
  assert.equal(security.check({ ...browser, method: 'POST' }, '/api/shutdown'), null);
});
