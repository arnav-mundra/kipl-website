"use strict";

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { boot, client, A, PASSWORDS } = require("./helpers");

let ctx;
before(async () => { ctx = await boot(); });
after(() => ctx.server.close());

test("repeated failed sign-ins lock the account out, even for the right password", async () => {
  const c = client(ctx.base);
  for (let i = 0; i < 5; i++) {
    const r = await c.post(A + "/login", { username: "owner", password: "wrong-" + i });
    assert.equal(r.status, 401);
  }
  const locked = await c.post(A + "/login", { username: "owner", password: "wrong-again" });
  assert.equal(locked.status, 429);
  assert.match(locked.data.error, /Too many/);

  const stillLocked = await c.post(A + "/login", { username: "owner", password: PASSWORDS.owner });
  assert.equal(stillLocked.status, 429, "a correct password doesn't bypass the lock");
});
