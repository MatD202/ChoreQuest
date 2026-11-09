import "dotenv/config";
import mongoose from "mongoose";
import bcrypt from "bcrypt";
import { DateTime } from "luxon";
import {
  User,
  Household,
  Membership,
  Chore,
  Assignment,
  Reward,
  initializeModels,
} from "./models.js";
import { allocate, occurrences } from "./scheduling.js";
if (process.env.NODE_ENV === "production")
  throw new Error("Demo seed is disabled in production");
await mongoose.connect(
  process.env.MONGODB_URI ??
    "mongodb://127.0.0.1:27017/chorequest?replicaSet=rs0&directConnection=true",
);
await initializeModels();
const users = [];
for (const [name, email] of [
  ["Alex", "alex@chorequest.demo"],
  ["Sam", "sam@chorequest.demo"],
]) {
  users.push(
    await User.findOneAndUpdate(
      { email },
      {
        $setOnInsert: {
          name,
          passwordHash: await bcrypt.hash("DemoOnly!123", 12),
        },
      },
      { upsert: true, new: true },
    ),
  );
}
let household = await Household.findOne({
  ownerId: users[0]._id,
  name: "The Maple House",
});
if (!household) {
  household = await Household.create({
    name: "The Maple House",
    timezone: "Europe/Ljubljana",
    ownerId: users[0]._id,
  });
  for (const user of users)
    await Membership.create({ householdId: household._id, userId: user._id });
  for (const [title, description, effort, recurrence, preferredDay] of [
    [
      "Give the kitchen a little love",
      "Wipe the counters and put everything in its place.",
      20,
      "daily",
      1,
    ],
    [
      "Laundry, fresh & folded",
      "Wash, dry, and fold the shared laundry.",
      35,
      "weekly",
      3,
    ],
    [
      "Take out the recycling",
      "Sort the recycling and empty the bins.",
      10,
      "weekly",
      2,
    ],
    [
      "A fresh start for the floors",
      "Vacuum the living room and hallway.",
      25,
      "weekly",
      5,
    ],
    [
      "Water our leafy friends",
      "Check the soil and give the plants a drink.",
      10,
      "weekly",
      6,
    ],
  ] as const)
    await Chore.create({
      householdId: household._id,
      title,
      description,
      effort,
      xp: effort * 2,
      coins: effort,
      recurrence,
      preferredDay,
    });
  await Reward.insertMany(
    [
      {
        title: "Your pick, movie night",
        description: "Choose the movie. Your teammate brings the popcorn.",
        cost: 50,
      },
      {
        title: "Breakfast in bed",
        description: "A slow morning and your favorite breakfast.",
        cost: 100,
      },
      {
        title: "An afternoon all yours",
        description: "A little time off. We’ll take care of the rest.",
        cost: 150,
      },
    ].map((r) => ({ ...r, householdId: household!._id })),
  );
}
const week = DateTime.now()
  .setZone(household.timezone)
  .startOf("week")
  .toISODate()!;
const chores = await Chore.find({ householdId: household._id, active: true });
const existing = await Assignment.find({ householdId: household._id });
const tasks = chores.flatMap((c) =>
  occurrences(c, week, household!.timezone)
    .filter(
      (o) =>
        !existing.some(
          (a) =>
            String(a.choreId) === String(c._id) && a.occurrenceKey === o.key,
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
  users.map((u) => ({
    id: String(u._id),
    assigned: existing
      .filter((a) => String(a.assigneeId) === String(u._id) && a.week === week)
      .reduce((sum, a) => sum + a.effort!, 0),
    history: 0,
  })),
);
if (allocations.length)
  await Assignment.insertMany(
    allocations.map(({ task, assigneeId }) => ({
      ...task,
      assigneeId,
      householdId: household!._id,
      week,
    })),
  );
console.log(
  "Demo ready: alex@chorequest.demo / sam@chorequest.demo — password: DemoOnly!123 (local development only)",
);
await mongoose.disconnect();
