import express, {
  type Request,
  type Response,
  type NextFunction,
} from "express";
import mongoose from "mongoose";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import cookieParser from "cookie-parser";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { randomBytes, createHash } from "node:crypto";
import { z } from "zod";
import { DateTime } from "luxon";
import {
  User,
  Household,
  Membership,
  Chore,
  Assignment,
  Reward,
  WalletTransaction,
  Achievement,
} from "./models.js";
import { allocate, occurrences, weekStart, levelFor } from "./scheduling.js";
declare module "express-serve-static-core" {
  interface Request {
    userId: string;
  }
}
class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
const fail = (status: number, message: string): never => {
  throw new HttpError(status, message);
};
const id = (value: unknown) =>
  z
    .string()
    .regex(/^[a-f\d]{24}$/i)
    .parse(value);
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
const authInput = z.object({
  email: z.email().transform((v) => v.toLowerCase().trim()),
  password: z
    .string()
    .min(10)
    .max(72)
    .refine(
      (v) => Buffer.byteLength(v, "utf8") <= 72,
      "Password must fit within 72 UTF-8 bytes",
    ),
});
const choreInput = z.object({
  title: z.string().trim().min(1).max(100),
  description: z.string().max(1000).default(""),
  effort: z.number().int().min(1).max(100),
  xp: z.number().int().min(0).max(1000),
  coins: z.number().int().min(0).max(1000),
  recurrence: z.enum(["once", "daily", "weekly"]),
  preferredDay: z.number().int().min(1).max(7).optional(),
  active: z.boolean().default(true),
});
const rewardInput = z.object({
  title: z.string().trim().min(1).max(100),
  description: z.string().max(1000).default(""),
  cost: z.number().int().min(1).max(100000),
  active: z.boolean().default(true),
});
export function createApp(config: {
  secret: string;
  origin: string;
  production?: boolean;
}) {
  if (config.secret.length < 32)
    throw new Error("JWT_SECRET must have at least 32 characters");
  const app = express();
  app.use(
    helmet(),
    cors({ origin: config.origin, credentials: true }),
    express.json({ limit: "32kb" }),
    cookieParser(),
  );
  app.use((req, res, next) => {
    if (
      !["GET", "HEAD", "OPTIONS"].includes(req.method) &&
      (req.get("Origin") !== config.origin || req.get("X-ChoreQuest") !== "1")
    )
      return next(new HttpError(403, "Request origin or CSRF header invalid"));
    next();
  });
  const router = express.Router();
  app.use("/api/v1", router);
  const cookie = {
    httpOnly: true,
    secure: !!config.production,
    sameSite: "lax" as const,
    path: "/api/v1",
  };
  function signIn(res: Response, userId: string) {
    res.cookie(
      "session",
      jwt.sign({}, config.secret, {
        subject: userId,
        expiresIn: "7d",
        algorithm: "HS256",
      }),
      { ...cookie, maxAge: 604800000 },
    );
  }
  const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 30,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
      error: { message: "Too many authentication attempts. Try again later." },
    },
  });
  router.post("/auth/register", limiter, async (req, res) => {
    const input = authInput
      .extend({ name: z.string().trim().min(1).max(60) })
      .parse(req.body);
    const user = await User.create({
      ...input,
      passwordHash: await bcrypt.hash(input.password, 12),
    });
    signIn(res, String(user._id));
    res.status(201).json({ id: user._id, name: user.name, email: user.email });
  });
  router.post("/auth/login", limiter, async (req, res) => {
    const input = authInput.parse(req.body);
    const user = await User.findOne({ email: input.email }).select(
      "+passwordHash",
    );
    if (!user || !(await bcrypt.compare(input.password, user.passwordHash)))
      fail(401, "Email or password incorrect");
    signIn(res, String(user!._id));
    res.json({ id: user!._id, name: user!.name, email: user!.email });
  });
  router.use((req, res, next) => {
    try {
      const token = jwt.verify(req.cookies.session ?? "", config.secret, {
        algorithms: ["HS256"],
      });
      if (typeof token === "string" || !token.sub) throw new Error();
      req.userId = token.sub;
      next();
    } catch {
      next(new HttpError(401, "Please sign in"));
    }
  });
  router.get("/auth/me", async (req, res) => {
    const user = await User.findById(req.userId);
    if (!user) fail(401, "Please sign in");
    res.json(user);
  });
  router.post("/auth/logout", (req, res) => {
    res.clearCookie("session", cookie);
    res.json({ ok: true });
  });
  async function member(householdId: unknown, userId: string) {
    const m = await Membership.findOne({
      householdId: id(householdId),
      userId,
    });
    if (!m) fail(404, "Household not found");
    return m!;
  }
  router.get("/households", async (req, res) => {
    const ms = await Membership.find({ userId: req.userId });
    res.json(
      await Household.find({
        _id: { $in: ms.map((m) => m.householdId) },
      }).select("-inviteHash"),
    );
  });
  router.post("/households", async (req, res) => {
    const input = z
      .object({
        name: z.string().trim().min(1).max(80),
        timezone: z
          .string()
          .refine((v) => DateTime.now().setZone(v).isValid)
          .default("UTC"),
      })
      .parse(req.body);
    const household = await mongoose.connection.transaction(async (session) => {
      const [h] = await Household.create([{ ...input, ownerId: req.userId }], {
        session,
      });
      await Membership.create([{ householdId: h._id, userId: req.userId }], {
        session,
      });
      return h;
    });
    res.status(201).json(household);
  });
  router.post("/households/join", limiter, async (req, res) => {
    const { code } = z
      .object({ code: z.string().min(16).max(100) })
      .parse(req.body);
    const h = await Household.findOne({ inviteHash: hash(code) });
    if (!h) fail(404, "Invite is invalid or revoked");
    await Membership.updateOne(
      { householdId: h!._id, userId: req.userId },
      { $setOnInsert: { xp: 0, coins: 0, completions: 0 } },
      { upsert: true },
    );
    res.json({ _id: h!._id });
  });
  router.post("/households/:id/invite", async (req, res) => {
    await member(req.params.id, req.userId);
    const h = await Household.findById(req.params.id);
    if (String(h!.ownerId) !== req.userId)
      fail(403, "Only the household owner can manage invites");
    const code = randomBytes(18).toString("hex");
    h!.inviteHash = req.body.revoke ? undefined : hash(code);
    await h!.save();
    res.json({ code: req.body.revoke ? null : code });
  });
  router.get("/households/:id/members", async (req, res) => {
    await member(req.params.id, req.userId);
    const ms = await Membership.find({ householdId: req.params.id }).lean();
    const users = await User.find({ _id: { $in: ms.map((m) => m.userId) } });
    res.json(
      ms.map((m) => ({
        ...m,
        name: users.find((u) => String(u._id) === String(m.userId))?.name,
        level: levelFor(m.xp),
      })),
    );
  });
  router.get("/households/:id/chores", async (req, res) => {
    await member(req.params.id, req.userId);
    res.json(
      await Chore.find({ householdId: req.params.id }).sort({ createdAt: -1 }),
    );
  });
  router.post("/households/:id/chores", async (req, res) => {
    await member(req.params.id, req.userId);
    res.status(201).json(
      await Chore.create({
        ...choreInput.parse(req.body),
        householdId: req.params.id,
      }),
    );
  });
  router.put("/households/:id/chores/:choreId", async (req, res) => {
    await member(req.params.id, req.userId);
    const c = await Chore.findOneAndUpdate(
      { _id: id(req.params.choreId), householdId: req.params.id },
      choreInput.parse(req.body),
      { new: true },
    );
    if (!c) fail(404, "Chore not found");
    res.json(c);
  });
  router.delete("/households/:id/chores/:choreId", async (req, res) => {
    await member(req.params.id, req.userId);
    const c = await Chore.findOneAndUpdate(
      { _id: id(req.params.choreId), householdId: req.params.id },
      { active: false },
      { new: true },
    );
    if (!c) fail(404, "Chore not found");
    res.json(c);
  });
  const weekQuery = (v: unknown) =>
    z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .refine(
        (value) => DateTime.fromISO(value).isValid,
        "Invalid calendar date",
      )
      .parse(v);
  router.post("/households/:id/assignments/generate", async (req, res) => {
    await member(req.params.id, req.userId);
    const input = weekQuery(req.body.week);
    const result = await mongoose.connection.transaction(async (session) => {
      const h = await Household.findOneAndUpdate(
        { _id: req.params.id },
        { $inc: { generationVersion: 1 } },
        { new: true, session },
      );
      const start = weekStart(input, h!.timezone);
      const week = start.toISODate()!;
      const ms = await Membership.find({ householdId: h!._id }).session(
        session,
      );
      if (!ms.length) fail(409, "Add a household member first");
      const existing = await Assignment.find({ householdId: h!._id }).session(
        session,
      );
      const chores = await Chore.find({
        householdId: h!._id,
        active: true,
      }).session(session);
      const tasks = chores.flatMap((c) =>
        occurrences(c, week, h!.timezone)
          .filter(
            (o) =>
              !existing.some(
                (a) =>
                  String(a.choreId) === String(c._id) &&
                  a.occurrenceKey === o.key,
              ),
          )
          .map((o) => ({
            key: `${c._id}:${o.key}`,
            occurrenceKey: o.key,
            dueAt: o.dueAt,
            choreId: c._id,
            title: c.title,
            description: c.description,
            effort: c.effort!,
            xp: c.xp,
            coins: c.coins,
          })),
      );
      const allocations = allocate(
        tasks,
        ms.map((m) => ({
          id: String(m.userId),
          assigned: existing
            .filter(
              (a) =>
                String(a.assigneeId) === String(m.userId) && a.week === week,
            )
            .reduce((s, a) => s + a.effort!, 0),
          history: existing
            .filter(
              (a) =>
                String(a.assigneeId) === String(m.userId) &&
                a.status === "completed" &&
                a.completedAt! >= start.minus({ weeks: 4 }).toJSDate() &&
                a.completedAt! < start.toJSDate(),
            )
            .reduce((s, a) => s + a.effort!, 0),
        })),
      );
      if (allocations.length)
        await Assignment.insertMany(
          allocations.map(({ task, assigneeId }) => ({
            ...task,
            assigneeId,
            householdId: h!._id,
            week,
          })),
          { session },
        );
      return { created: allocations.length, week };
    });
    res.json(result);
  });
  router.get("/households/:id/assignments", async (req, res) => {
    await member(req.params.id, req.userId);
    const h = await Household.findById(req.params.id);
    const week = weekStart(weekQuery(req.query.week), h!.timezone).toISODate();
    res.json(
      await Assignment.find({ householdId: req.params.id, week }).sort({
        dueAt: 1,
      }),
    );
  });
  router.patch(
    "/households/:id/assignments/:assignmentId",
    async (req, res) => {
      await member(req.params.id, req.userId);
      const assigneeId = id(req.body.assigneeId);
      await member(req.params.id, assigneeId);
      const a = await Assignment.findOneAndUpdate(
        {
          _id: id(req.params.assignmentId),
          householdId: req.params.id,
          status: "pending",
        },
        { assigneeId },
        { new: true },
      );
      if (!a) fail(409, "Pending assignment not found");
      res.json(a);
    },
  );
  router.post("/assignments/:id/complete", async (req, res) => {
    const a = await Assignment.findById(id(req.params.id));
    if (!a) fail(404, "Assignment not found");
    await member(a!.householdId.toString(), req.userId);
    if (String(a!.assigneeId) !== req.userId)
      fail(403, "Only the assignee can complete this chore");
    await mongoose.connection.transaction(async (session) => {
      const done = await Assignment.findOneAndUpdate(
        { _id: a!._id, assigneeId: req.userId, status: "pending" },
        { $set: { status: "completed", completedAt: new Date() } },
        { new: true, session },
      );
      if (!done) return;
      const m = await Membership.findOneAndUpdate(
        { householdId: a!.householdId, userId: req.userId },
        { $inc: { xp: done.xp, coins: done.coins, completions: 1 } },
        { new: true, session },
      );
      await WalletTransaction.create(
        [
          {
            householdId: a!.householdId,
            userId: req.userId,
            key: `complete:${a!._id}`,
            kind: "completion",
            coins: done.coins,
            xp: done.xp,
            title: done.title,
          },
        ],
        { session },
      );
      for (const [count, key, title] of [
        [1, "first", "First little win"],
        [10, "ten", "Helping hands"],
      ] as const)
        if (m!.completions >= count)
          await Achievement.updateOne(
            { householdId: a!.householdId, userId: req.userId, key },
            { $setOnInsert: { title } },
            { upsert: true, session },
          );
      // Serialize team-goal checks so concurrent final completions cannot miss an unlock.
      await Household.updateOne(
        { _id: a!.householdId },
        { $inc: { generationVersion: 1 } },
        { session },
      );
      const remaining = await Assignment.countDocuments({
        householdId: a!.householdId,
        week: a!.week,
        status: "pending",
      }).session(session);
      if (!remaining) {
        const ms = await Membership.find({
          householdId: a!.householdId,
        }).session(session);
        for (const teammate of ms)
          await Achievement.updateOne(
            {
              householdId: a!.householdId,
              userId: teammate.userId,
              key: `team:${a!.week}`,
            },
            { $setOnInsert: { title: "A week well shared" } },
            { upsert: true, session },
          );
      }
    });
    res.json({ ok: true });
  });
  router.get("/households/:id/rewards", async (req, res) => {
    await member(req.params.id, req.userId);
    res.json(
      await Reward.find({ householdId: req.params.id }).sort({ cost: 1 }),
    );
  });
  router.post("/households/:id/rewards", async (req, res) => {
    await member(req.params.id, req.userId);
    res.status(201).json(
      await Reward.create({
        ...rewardInput.parse(req.body),
        householdId: req.params.id,
      }),
    );
  });
  router.put("/households/:id/rewards/:rewardId", async (req, res) => {
    await member(req.params.id, req.userId);
    const r = await Reward.findOneAndUpdate(
      { _id: id(req.params.rewardId), householdId: req.params.id },
      rewardInput.parse(req.body),
      { new: true },
    );
    if (!r) fail(404, "Reward not found");
    res.json(r);
  });
  router.delete("/households/:id/rewards/:rewardId", async (req, res) => {
    await member(req.params.id, req.userId);
    const r = await Reward.findOneAndUpdate(
      { _id: id(req.params.rewardId), householdId: req.params.id },
      { active: false },
      { new: true },
    );
    if (!r) fail(404, "Reward not found");
    res.json(r);
  });
  router.post("/rewards/:id/redeem", async (req, res) => {
    const key = z.string().uuid().parse(req.get("Idempotency-Key"));
    const reward = await Reward.findById(id(req.params.id));
    if (!reward) fail(404, "Reward not found");
    await member(String(reward!.householdId), req.userId);
    const result = await mongoose.connection.transaction(async (session) => {
      const filter = {
        householdId: reward!.householdId,
        userId: req.userId,
        key: `redeem:${key}`,
      };
      const prior = await WalletTransaction.findOne(filter).session(session);
      if (prior) return prior;
      if (!reward!.active) fail(409, "Reward is no longer available");
      const m = await Membership.findOneAndUpdate(
        {
          householdId: reward!.householdId,
          userId: req.userId,
          coins: { $gte: reward!.cost },
        },
        { $inc: { coins: -reward!.cost! } },
        { session },
      );
      if (!m) fail(409, "Not enough coins yet");
      const [entry] = await WalletTransaction.create(
        [
          {
            ...filter,
            kind: "redemption",
            coins: -reward!.cost!,
            xp: 0,
            title: reward!.title,
          },
        ],
        { session },
      );
      return entry;
    });
    res.json(result);
  });
  router.get("/households/:id/dashboard", async (req, res) => {
    const m = await member(req.params.id, req.userId);
    const h = await Household.findById(req.params.id);
    const week = weekStart(
      req.query.week
        ? weekQuery(req.query.week)
        : DateTime.now().setZone(h!.timezone).toISODate()!,
      h!.timezone,
    ).toISODate();
    const assignments = await Assignment.find({
      householdId: h!._id,
      week,
    }).sort({ dueAt: 1 });
    const achievements = await Achievement.find({
      householdId: h!._id,
      userId: req.userId,
    });
    const page = z.coerce
      .number()
      .int()
      .min(1)
      .max(10000)
      .default(1)
      .parse(req.query.page);
    const ledger = await WalletTransaction.find({
      householdId: h!._id,
      userId: req.userId,
    })
      .sort({ createdAt: -1 })
      .skip((page - 1) * 20)
      .limit(20);
    res.json({
      week,
      membership: m,
      level: levelFor(m.xp),
      assignments,
      achievements,
      ledger,
      progress: {
        completed: assignments.filter((a) => a.status === "completed").length,
        total: assignments.length,
      },
    });
  });
  app.use((_req, _res, next) => next(new HttpError(404, "Route not found")));
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof z.ZodError)
      return res.status(400).json({
        error: { message: "Please check your input", details: err.issues },
      });
    if (err instanceof HttpError)
      return res.status(err.status).json({ error: { message: err.message } });
    if (err instanceof Error && "code" in err && err.code === 11000)
      return res.status(409).json({
        error: {
          message: "This record already exists. Refresh and try again.",
        },
      });
    if (err instanceof SyntaxError)
      return res.status(400).json({ error: { message: "Invalid JSON" } });
    console.error(err);
    res
      .status(500)
      .json({ error: { message: "Something went wrong. Please try again." } });
  });
  return app;
}
