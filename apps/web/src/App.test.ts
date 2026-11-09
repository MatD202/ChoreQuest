// @vitest-environment jsdom
import { afterEach, it, expect, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createPinia } from "pinia";
import { createMemoryHistory, createRouter } from "vue-router";
import App from "./App.vue";
import { useHousehold } from "./store";
afterEach(() => vi.restoreAllMocks());
async function render(path = "/") {
  const pinia = createPinia();
  const store = useHousehold(pinia);
  store.user = { _id: "alex", name: "Alex", email: "alex@example.com" };
  store.activeId = "home";
  store.households = [
    { _id: "home", name: "Maple House", timezone: "UTC", ownerId: "alex" },
  ];
  store.members = [
    {
      userId: "alex",
      name: "Alex",
      xp: 40,
      coins: 10,
      completions: 1,
      level: 1,
    },
    { userId: "sam", name: "Sam", xp: 0, coins: 0, completions: 0, level: 1 },
  ];
  const chore = {
    title: "Water plants",
    description: "",
    effort: 10,
    xp: 20,
    coins: 10,
    recurrence: "weekly",
    active: true,
  };
  store.dashboard = {
    week: "2026-11-02",
    membership: store.members[0],
    level: 1,
    assignments: [
      {
        ...chore,
        _id: "own",
        assigneeId: "alex",
        dueAt: "2026-11-04T23:59:59Z",
        week: "2026-11-02",
        status: "pending",
      },
      {
        ...chore,
        title: "Laundry",
        _id: "other",
        assigneeId: "sam",
        dueAt: "2026-11-04T23:59:59Z",
        week: "2026-11-02",
        status: "pending",
      },
    ],
    achievements: [],
    ledger: [],
    progress: { completed: 0, total: 2 },
  };
  store.rewards = [
    {
      _id: "reward",
      title: "Movie night",
      description: "Pick a movie",
      cost: 50,
      active: true,
    },
  ];
  vi.spyOn(store, "initialize").mockResolvedValue();
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      "/",
      "/rewards",
      "/chores",
      "/assignments",
      "/profile",
      "/settings",
    ].map((path) => ({ path, component: { template: "<div />" } })),
  });
  await router.push(path);
  await router.isReady();
  const wrapper = mount(App, { global: { plugins: [pinia, router] } });
  await flushPromises();
  return { wrapper, store };
}
it("shows personal chores and prevents completing another member’s chore", async () => {
  const { wrapper } = await render();
  expect(wrapper.text()).toContain("Hey Alex");
  expect(wrapper.find('[aria-label="Complete Laundry"]').exists()).toBe(false);
  await wrapper
    .findAll("button")
    .find((b) => b.text() === "Everyone")!
    .trigger("click");
  expect(
    wrapper.get('[aria-label="Complete Laundry"]').attributes("disabled"),
  ).toBeDefined();
  expect(
    wrapper.get('[aria-label="Complete Water plants"]').attributes("disabled"),
  ).toBeUndefined();
  wrapper.unmount();
});
it("disables rewards until the household coin balance covers their cost", async () => {
  const { wrapper, store } = await render("/rewards");
  const button = wrapper
    .findAll("button")
    .find((b) => b.text().includes("Keep going"))!;
  expect(button.attributes("disabled")).toBeDefined();
  store.dashboard!.membership.coins = 60;
  await flushPromises();
  expect(button.text()).toBe("Redeem reward");
  expect(button.attributes("disabled")).toBeUndefined();
  wrapper.unmount();
});
it("opens a chore form with usable defaults and closes with Escape", async () => {
  const { wrapper } = await render("/chores");
  await wrapper
    .findAll("button")
    .find((b) => b.text().includes("Add chore"))!
    .trigger("click");
  expect(wrapper.get('[role="dialog"]').text()).toContain("Effort");
  expect(wrapper.get('input[type="number"]').element).toHaveProperty(
    "value",
    "10",
  );
  await wrapper.get('[role="dialog"]').trigger("keydown", { key: "Escape" });
  expect(wrapper.find('[role="dialog"]').exists()).toBe(false);
  wrapper.unmount();
});
