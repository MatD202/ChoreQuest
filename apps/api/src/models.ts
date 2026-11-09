import mongoose, { Schema } from "mongoose";
const ref = { type: Schema.Types.ObjectId, required: true };
const options = { timestamps: true };
export const User = mongoose.model(
  "User",
  new Schema(
    {
      name: { type: String, required: true },
      email: { type: String, unique: true, required: true },
      passwordHash: { type: String, required: true, select: false },
    },
    options,
  ),
);
export const Household = mongoose.model(
  "Household",
  new Schema(
    {
      name: String,
      timezone: { type: String, default: "UTC" },
      ownerId: ref,
      inviteHash: { type: String, index: true },
      generationVersion: { type: Number, default: 0 },
    },
    options,
  ),
);
const member = new Schema(
  {
    householdId: ref,
    userId: ref,
    xp: { type: Number, default: 0 },
    coins: { type: Number, default: 0 },
    completions: { type: Number, default: 0 },
  },
  options,
);
member.index({ householdId: 1, userId: 1 }, { unique: true });
export const Membership = mongoose.model("HouseholdMembership", member);
export const Chore = mongoose.model(
  "ChoreTemplate",
  new Schema(
    {
      householdId: ref,
      title: String,
      description: String,
      effort: Number,
      xp: Number,
      coins: Number,
      recurrence: String,
      preferredDay: Number,
      active: { type: Boolean, default: true },
    },
    options,
  ).index({ householdId: 1 }),
);
const assignment = new Schema(
  {
    householdId: ref,
    choreId: ref,
    assigneeId: ref,
    occurrenceKey: String,
    week: String,
    dueAt: Date,
    status: { type: String, default: "pending" },
    completedAt: Date,
    title: String,
    description: String,
    effort: Number,
    xp: Number,
    coins: Number,
  },
  options,
);
assignment.index(
  { householdId: 1, choreId: 1, occurrenceKey: 1 },
  { unique: true },
);
assignment.index({ householdId: 1, assigneeId: 1, dueAt: 1, status: 1 });
export const Assignment = mongoose.model("ChoreAssignment", assignment);
export const Reward = mongoose.model(
  "Reward",
  new Schema(
    {
      householdId: ref,
      title: String,
      description: String,
      cost: Number,
      active: { type: Boolean, default: true },
    },
    options,
  ).index({ householdId: 1 }),
);
const ledger = new Schema(
  {
    householdId: ref,
    userId: ref,
    key: String,
    kind: String,
    coins: Number,
    xp: Number,
    title: String,
  },
  options,
);
ledger.index({ householdId: 1, userId: 1, key: 1 }, { unique: true });
export const WalletTransaction = mongoose.model("WalletTransaction", ledger);
const achievement = new Schema(
  { householdId: ref, userId: ref, key: String, title: String },
  options,
);
achievement.index({ householdId: 1, userId: 1, key: 1 }, { unique: true });
export const Achievement = mongoose.model("AchievementUnlock", achievement);
export async function initializeModels() {
  await Promise.all(
    Object.values(mongoose.models).map((model) => model.init()),
  );
}
