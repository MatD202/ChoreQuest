import { beforeAll, afterAll, describe, it, expect } from "vitest";
import request from "supertest";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import mongoose from "mongoose";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { createApp } from "./app.js";
import {
  initializeModels,
  Membership,
  Assignment,
  WalletTransaction,
  Household,
} from "./models.js";
const origin = "http://localhost:5173";
const app = createApp({
  secret: "test-secret-that-is-at-least-32-characters",
  origin,
});
let mongo: MongoMemoryReplSet;
const a = request.agent(app),
  b = request.agent(app),
  outsider = request.agent(app);
const headers = { Origin: origin, "X-ChoreQuest": "1" };
beforeAll(async () => {
  mongo = await MongoMemoryReplSet.create({
    replSet: { count: 1 },
    instanceOpts: [{ launchTimeout: 60000 }],
  });
  await mongoose.connect(mongo.getUri());
  await initializeModels();
}, 300000);
afterAll(async () => {
  await mongoose.disconnect();
  await mongo?.stop();
});
describe("household flow and safety", () => {
  it("seeds a repeatable demo with working credentials", async () => {
    const run = promisify(execFile);
    for (let i = 0; i < 2; i++)
      await run(process.execPath, ["--import", "tsx", "src/seed.ts"], {
        cwd: fileURLToPath(new URL("../", import.meta.url)),
        env: { ...process.env, MONGODB_URI: mongo.getUri(), NODE_ENV: "test" },
      });
    const h = await Household.findOne({ name: "The Maple House" });
    expect(h).toBeTruthy();
    expect(await Membership.countDocuments({ householdId: h!._id })).toBe(2);
    expect(await Assignment.countDocuments({ householdId: h!._id })).toBe(11);
    expect(
      (
        await request(app)
          .post("/api/v1/auth/login")
          .set(headers)
          .send({ email: "alex@chorequest.demo", password: "DemoOnly!123" })
      ).status,
    ).toBe(200);
  }, 30000);
  it("validates auth and rejects missing CSRF headers", async () => {
    expect((await a.post("/api/v1/auth/register").send({})).status).toBe(403);
    expect(
      (
        await a
          .post("/api/v1/auth/register")
          .set(headers)
          .send({ email: "bad", password: "short", name: "" })
      ).status,
    ).toBe(400);
  });
  it("keeps households isolated and awards / spends only once", async () => {
    for (const [client, name] of [
      [a, "Alex"],
      [b, "Sam"],
      [outsider, "Other"],
    ] as const) {
      const response = await client
        .post("/api/v1/auth/register")
        .set(headers)
        .send({
          name,
          email: `${name}@test.com`,
          password: "LongPassword123!",
        });
      expect(response.status).toBe(201);
      expect(response.headers["set-cookie"][0]).toContain("HttpOnly");
    }
    expect((await request(app).get("/api/v1/households")).status).toBe(401);
    expect(
      (
        await request(app)
          .post("/api/v1/auth/login")
          .set(headers)
          .send({ email: "Alex@test.com", password: "WrongPassword!" })
      ).status,
    ).toBe(401);
    const login = await request(app)
      .post("/api/v1/auth/login")
      .set(headers)
      .send({ email: "Alex@test.com", password: "LongPassword123!" });
    expect(login.status).toBe(200);
    const h = (
      await a
        .post("/api/v1/households")
        .set(headers)
        .send({ name: "Home", timezone: "Europe/Ljubljana" })
    ).body._id;
    const code = (
      await a.post(`/api/v1/households/${h}/invite`).set(headers).send({})
    ).body.code;
    expect(
      (await b.post("/api/v1/households/join").set(headers).send({ code }))
        .status,
    ).toBe(200);
    const base = `/api/v1/households/${h}`;
    for (const resource of [
      "members",
      "chores",
      "rewards",
      "dashboard",
      "assignments?week=2026-11-02",
    ])
      expect((await outsider.get(`${base}/${resource}`)).status).toBe(404);
    const chore = {
      title: "Kitchen",
      effort: 20,
      xp: 40,
      coins: 30,
      recurrence: "daily",
    };
    expect(
      (await outsider.post(`${base}/chores`).set(headers).send(chore)).status,
    ).toBe(404);
    const c = (await a.post(`${base}/chores`).set(headers).send(chore)).body;
    await a
      .post(`${base}/chores`)
      .set(headers)
      .send({ ...chore, title: "Inactive", active: false });
    await a
      .post(`${base}/chores`)
      .set(headers)
      .send({ ...chore, title: "Once", recurrence: "once" });
    const generation = await Promise.all([
      a
        .post(`${base}/assignments/generate`)
        .set(headers)
        .send({ week: "2026-11-02" }),
      b
        .post(`${base}/assignments/generate`)
        .set(headers)
        .send({ week: "2026-11-02" }),
    ]);
    expect(generation.map((r) => r.status)).toEqual([200, 200]);
    expect(await Assignment.countDocuments({ householdId: h })).toBe(8);
    const assignments = (await a.get(`${base}/assignments?week=2026-11-02`))
      .body;
    const me = (await a.get("/api/v1/auth/me")).body._id;
    const own = assignments.find(
      (x: { assigneeId: string }) => x.assigneeId === me,
    );
    expect(
      (
        await outsider
          .post(`/api/v1/assignments/${own._id}/complete`)
          .set(headers)
          .send({})
      ).status,
    ).toBe(404);
    expect(
      (
        await b
          .post(`/api/v1/assignments/${own._id}/complete`)
          .set(headers)
          .send({})
      ).status,
    ).toBe(403);
    const completion = await Promise.all([
      a.post(`/api/v1/assignments/${own._id}/complete`).set(headers).send({}),
      a.post(`/api/v1/assignments/${own._id}/complete`).set(headers).send({}),
    ]);
    expect(completion.map((r) => r.status)).toEqual([200, 200]);
    expect(
      (await Membership.findOne({ householdId: h, userId: me }))!.coins,
    ).toBe(30);
    expect(await WalletTransaction.countDocuments({ kind: "completion" })).toBe(
      1,
    );
    await a
      .put(`${base}/chores/${c._id}`)
      .set(headers)
      .send({ ...chore, xp: 999 });
    expect((await Assignment.findById(own._id))!.xp).toBe(40);
    const reward = (
      await a
        .post(`${base}/rewards`)
        .set(headers)
        .send({ title: "Movie", cost: 20 })
    ).body;
    const key = "12345678-1234-4234-8234-123456789abc";
    const redeemed = await Promise.all([
      a
        .post(`/api/v1/rewards/${reward._id}/redeem`)
        .set({ ...headers, "Idempotency-Key": key })
        .send({}),
      a
        .post(`/api/v1/rewards/${reward._id}/redeem`)
        .set({ ...headers, "Idempotency-Key": key })
        .send({}),
    ]);
    expect(redeemed.map((r) => r.status)).toEqual([200, 200]);
    expect(
      (await Membership.findOne({ householdId: h, userId: me }))!.coins,
    ).toBe(10);
    expect(
      (
        await a
          .post(`/api/v1/rewards/${reward._id}/redeem`)
          .set({
            ...headers,
            "Idempotency-Key": "12345678-1234-4234-8234-123456789abd",
          })
          .send({})
      ).status,
    ).toBe(409);
    expect(
      (
        await outsider
          .post(`/api/v1/rewards/${reward._id}/redeem`)
          .set({ ...headers, "Idempotency-Key": key })
          .send({})
      ).status,
    ).toBe(404);
    await a
      .post(`${base}/assignments/generate`)
      .set(headers)
      .send({ week: "2026-11-09" });
    expect(await Assignment.countDocuments({ occurrenceKey: "once" })).toBe(1);
    await a.post(`${base}/invite`).set(headers).send({ revoke: true });
    expect(
      (
        await outsider
          .post("/api/v1/households/join")
          .set(headers)
          .send({ code })
      ).status,
    ).toBe(404);
    expect(
      (await a.post("/api/v1/auth/logout").set(headers).send({})).status,
    ).toBe(200);
    expect((await a.get("/api/v1/auth/me")).status).toBe(401);
  }, 60000);
});
