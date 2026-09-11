import assert from "node:assert/strict";
import test from "node:test";

import {
  assertPublicUrl,
  fetchPublicUrl,
  handler,
  isBlockedAddress,
} from "../cook.ts";

const publicResolver = async () => [{ address: "93.184.216.34", family: 4 }];

test("remote fetch address validation blocks private and reserved networks", async () => {
  [
    "0.0.0.0",
    "10.0.0.1",
    "100.64.0.1",
    "127.0.0.1",
    "169.254.169.254",
    "172.16.0.1",
    "192.168.1.1",
    "198.18.0.1",
    "224.0.0.1",
    "::",
    "::1",
    "fc00::1",
    "fe80::1",
    "2001:db8::1",
    "::ffff:127.0.0.1",
  ].forEach(address => assert.equal(isBlockedAddress(address), true, address));
  assert.equal(isBlockedAddress("93.184.216.34"), false);
  assert.equal(isBlockedAddress("2606:2800:220:1:248:1893:25c8:1946"), false);

  await assert.rejects(
    assertPublicUrl(new URL("https://internal.example/data"), async () => [{ address: "10.0.0.4", family: 4 }]),
    /unsupported_url/,
  );
  await assert.rejects(
    assertPublicUrl(new URL("https://user:secret@example.com/data"), publicResolver),
    /unsupported_url/,
  );
  await assert.doesNotReject(assertPublicUrl(new URL("https://example.com/data"), publicResolver));
});

test("remote fetch validates every redirect before following it", async () => {
  let fetchCalls = 0;
  const fetcher = async () => {
    fetchCalls++;
    return new Response(null, {
      status: 302,
      headers: { location: "http://internal.example/private" },
    });
  };
  const resolver = async hostname => hostname === "internal.example"
    ? [{ address: "169.254.169.254", family: 4 }]
    : [{ address: "93.184.216.34", family: 4 }];
  await assert.rejects(
    fetchPublicUrl(new URL("https://example.com/data"), new AbortController().signal, resolver, fetcher),
    /unsupported_url/,
  );
  assert.equal(fetchCalls, 1);
});

test("remote fetch permits validated relative redirects and surfaces network failures", async () => {
  const responses = [
    new Response(null, { status: 307, headers: { location: "/final.csv" } }),
    new Response("a,b\n1,2", { status: 200, headers: { "content-type": "text/csv" } }),
  ];
  const result = await fetchPublicUrl(
    new URL("https://example.com/start"),
    new AbortController().signal,
    publicResolver,
    async () => responses.shift(),
  );
  assert.equal(await result.text(), "a,b\n1,2");
  await assert.rejects(
    fetchPublicUrl(
      new URL("https://example.com/data"),
      new AbortController().signal,
      publicResolver,
      async () => { throw new Error("network down"); },
    ),
    /network down/,
  );
});

function event(path, body, sourceIp = `test-${Math.random()}`) {
  return {
    rawPath: path,
    requestContext: { http: { method: "POST", sourceIp } },
    body: typeof body === "string" ? body : JSON.stringify(body),
  };
}

test("Lambda validates methods, JSON, prompts, and allowlisted telemetry", async () => {
  delete process.env.RATE_LIMIT_TABLE;
  assert.equal((await handler({ requestContext: { http: { method: "GET", sourceIp: "method" } } })).statusCode, 405);
  assert.equal((await handler(event("/api/cook", "{", "json"))).statusCode, 400);
  assert.equal((await handler(event("/api/cook", { kind: "plan", prompt: "" }, "prompt"))).statusCode, 400);
  assert.equal(JSON.parse((await handler(event("/api/cook", { kind: "other", prompt: "hello" }, "kind"))).body).error, "invalid_kind");
  assert.equal((await handler(event("/api/events", {
    version: 1,
    event: "export_created",
    properties: { type: "html" },
  }, "valid-event"))).statusCode, 204);
  assert.equal((await handler(event("/api/events", {
    version: 1,
    event: "export_created",
    properties: { type: "revenue" },
  }, "invalid-event"))).statusCode, 400);
});

test("Lambda fallback limiter returns a Retry-After after the shared quota", async () => {
  delete process.env.RATE_LIMIT_TABLE;
  const payload = { kind: "other", prompt: "not sent upstream" };
  const responses = [];
  for (let index = 0; index < 31; index++) {
    responses.push(await handler(event("/api/cook", payload, "rate-test")));
  }
  assert.equal(responses[29].statusCode, 400);
  assert.equal(responses[30].statusCode, 429);
  assert.ok(Number(responses[30].headers["retry-after"]) > 0);
});
