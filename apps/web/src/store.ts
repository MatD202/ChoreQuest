import { defineStore } from "pinia";
export type Household = {
  _id: string;
  name: string;
  timezone: string;
  ownerId: string;
};
export type Chore = {
  _id: string;
  title: string;
  description: string;
  effort: number;
  xp: number;
  coins: number;
  recurrence: string;
  preferredDay?: number;
  active: boolean;
};
export type Assignment = Chore & {
  assigneeId: string;
  dueAt: string;
  status: string;
  week: string;
};
export type Reward = {
  _id: string;
  title: string;
  description: string;
  cost: number;
  active: boolean;
};
export type Member = {
  userId: string;
  name: string;
  xp: number;
  coins: number;
  completions: number;
  level: number;
};
export type Dashboard = {
  week: string;
  membership: Member;
  level: number;
  assignments: Assignment[];
  achievements: { _id: string; title: string }[];
  ledger: { _id: string; title: string; coins: number; createdAt: string }[];
  progress: { completed: number; total: number };
};
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
export async function api<T>(
  path: string,
  method = "GET",
  body?: unknown,
  key?: string,
): Promise<T> {
  const response = await fetch(
    `${import.meta.env.VITE_API_BASE_URL ?? "/api/v1"}${path}`,
    {
      method,
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        "X-ChoreQuest": "1",
        ...(key ? { "Idempotency-Key": key } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    },
  );
  const data = await response.json().catch(() => {
    throw new ApiError(
      "ChoreQuest could not reach the API. Please try again shortly.",
      response.status,
    );
  });
  if (!response.ok)
    throw new ApiError(
      data.error?.message ?? "Request failed",
      response.status,
    );
  return data;
}
export const useHousehold = defineStore("household", {
  state: () => ({
    user: null as null | {
      _id?: string;
      id?: string;
      name: string;
      email: string;
    },
    households: [] as Household[],
    activeId: "",
    dashboard: null as Dashboard | null,
    members: [] as Member[],
    chores: [] as Chore[],
    rewards: [] as Reward[],
  }),
  getters: {
    active: (state) => state.households.find((h) => h._id === state.activeId),
    userId: (state) => state.user?._id ?? state.user?.id,
  },
  actions: {
    async initialize() {
      this.user = await api("/auth/me");
      await this.loadHouseholds();
    },
    async loadHouseholds() {
      this.households = await api("/households");
      if (!this.households.some((h) => h._id === this.activeId))
        this.activeId = this.households[0]?._id ?? "";
      await this.refresh();
    },
    async refresh(week?: string) {
      if (!this.activeId) {
        this.dashboard = null;
        return;
      }
      const base = `/households/${this.activeId}`;
      const [dashboard, members, chores, rewards] = await Promise.all([
        api<Dashboard>(`${base}/dashboard${week ? "?week=" + week : ""}`),
        api<Member[]>(`${base}/members`),
        api<Chore[]>(`${base}/chores`),
        api<Reward[]>(`${base}/rewards`),
      ]);
      this.dashboard = dashboard;
      this.members = members;
      this.chores = chores;
      this.rewards = rewards;
    },
  },
});
