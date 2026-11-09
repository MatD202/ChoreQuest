<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import {
  Home,
  CheckCheck,
  CalendarDays,
  Gift,
  Trophy,
  Settings,
  Leaf,
  Plus,
  ArrowRight,
  Coins,
  Sparkles,
  LogOut,
  Check,
  Users,
  ChevronLeft,
  ChevronRight,
} from "lucide-vue-next";
import { api, ApiError, useHousehold, type Chore, type Reward } from "./store";
import ProgressMeter from "./components/ProgressMeter.vue";
const store = useHousehold(),
  route = useRoute(),
  router = useRouter();
const ready = ref(false),
  busy = ref(false),
  error = ref(""),
  toast = ref(""),
  invite = ref(""),
  filter = ref("mine");
const auth = ref({ name: "", email: "", password: "" });
const house = ref({
  name: "",
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
});
const joinCode = ref("");
const modal = ref<"chore" | "reward" | null>(null),
  editId = ref("");
const dialog = ref<HTMLElement | null>(null);
let previousFocus: HTMLElement | null = null;
watch(modal, async (value) => {
  if (value) {
    previousFocus = document.activeElement as HTMLElement;
    await nextTick();
    dialog.value?.querySelector<HTMLInputElement>("input")?.focus();
  } else {
    previousFocus?.focus();
  }
});
function trapFocus(event: KeyboardEvent) {
  if (event.key !== "Tab") return;
  const elements = Array.from(
    dialog.value?.querySelectorAll<HTMLElement>(
      "button:not(:disabled), input, textarea, select, a[href]",
    ) ?? [],
  );
  const first = elements[0],
    last = elements[elements.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last?.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first?.focus();
  }
}
const chore = ref({
  title: "",
  description: "",
  effort: 10,
  xp: 30,
  coins: 10,
  recurrence: "weekly",
  preferredDay: 1,
  active: true,
});
const reward = ref({ title: "", description: "", cost: 50, active: true });
const nav = [
  { to: "/", label: "Overview", icon: Home },
  { to: "/assignments", label: "Weekly quests", icon: CalendarDays },
  { to: "/chores", label: "Chore library", icon: CheckCheck },
  { to: "/rewards", label: "Reward shop", icon: Gift },
  { to: "/profile", label: "Your journey", icon: Trophy },
  { to: "/settings", label: "Household", icon: Settings },
];
const tasks = computed(
  () =>
    store.dashboard?.assignments.filter(
      (a) => filter.value === "all" || a.assigneeId === store.userId,
    ) ?? [],
);
const pending = computed(() =>
  tasks.value.filter((a) => a.status === "pending"),
);
const greeting = computed(() => store.user?.name.split(" ")[0]);
const weekLabel = computed(() =>
  store.dashboard
    ? new Date(store.dashboard.week + "T12:00:00Z").toLocaleDateString(
        undefined,
        { month: "long", day: "numeric", timeZone: "UTC" },
      )
    : "",
);
const nextLevel = computed(() => 100 * (store.dashboard?.level ?? 1) ** 2);
async function run(action: () => Promise<void>, message = "") {
  if (busy.value) return;
  busy.value = true;
  error.value = "";
  try {
    await action();
    if (message) {
      toast.value = message;
      setTimeout(() => (toast.value = ""), 4000);
    }
  } catch (e) {
    error.value = e instanceof Error ? e.message : "Something went wrong";
  } finally {
    busy.value = false;
  }
}
onMounted(async () => {
  try {
    await store.initialize();
  } catch (e) {
    store.user = null;
    if (!(e instanceof ApiError && e.status === 401))
      error.value =
        "Could not connect to your household. Check that the API is running, then refresh.";
  }
  ready.value = true;
});
watch(
  () => store.activeId,
  () => {
    invite.value = "";
  },
);
async function signIn() {
  await run(async () => {
    store.user = await api(
      `/auth/${route.path === "/register" ? "register" : "login"}`,
      "POST",
      auth.value,
    );
    await store.loadHouseholds();
    await router.push(store.activeId ? "/" : "/households");
  });
}
async function chooseHouse() {
  store.dashboard = null;
  await run(() => store.refresh());
}
async function signOut() {
  await run(async () => {
    await api("/auth/logout", "POST", {});
    store.$reset();
    await router.push("/login");
  });
}
async function generate() {
  await run(async () => {
    await api(`/households/${store.activeId}/assignments/generate`, "POST", {
      week: store.dashboard!.week,
    });
    await store.refresh(store.dashboard!.week);
  }, "Your weekly quests are ready.");
}
async function complete(id: string) {
  await run(async () => {
    await api(`/assignments/${id}/complete`, "POST", {});
    await store.refresh(store.dashboard!.week);
  }, "A little win for you. A big help for home!");
}
function editChore(c?: Chore) {
  editId.value = c?._id ?? "";
  chore.value = c
    ? { ...c, preferredDay: c.preferredDay ?? 1 }
    : {
        title: "",
        description: "",
        effort: 10,
        xp: 30,
        coins: 10,
        recurrence: "weekly",
        preferredDay: 1,
        active: true,
      };
  modal.value = "chore";
}
function editReward(r?: Reward) {
  editId.value = r?._id ?? "";
  reward.value = r
    ? { ...r }
    : { title: "", description: "", cost: 50, active: true };
  modal.value = "reward";
}
async function save() {
  await run(async () => {
    const kind = modal.value === "chore" ? "chores" : "rewards";
    await api(
      `/households/${store.activeId}/${kind}${editId.value ? "/" + editId.value : ""}`,
      editId.value ? "PUT" : "POST",
      modal.value === "chore" ? chore.value : reward.value,
    );
    modal.value = null;
    await store.refresh(store.dashboard!.week);
  }, "Saved to your household.");
}
async function archive(kind: string, id: string) {
  if (!confirm("Archive this item? Existing history will be kept.")) return;
  await run(async () => {
    await api(`/households/${store.activeId}/${kind}/${id}`, "DELETE");
    await store.refresh(store.dashboard!.week);
  }, "Item archived.");
}
const redemptionKeys = new Map<string, string>();
async function redeem(r: Reward) {
  if (!confirm(`Redeem ${r.title} for ${r.cost} coins?`)) return;
  await run(async () => {
    const key = redemptionKeys.get(r._id) ?? crypto.randomUUID();
    redemptionKeys.set(r._id, key);
    await api(`/rewards/${r._id}/redeem`, "POST", {}, key);
    redemptionKeys.delete(r._id);
    await store.refresh(store.dashboard!.week);
  }, "Reward redeemed. You earned this!");
}
async function moveWeek(delta: number) {
  await run(async () => {
    const date = new Date(store.dashboard!.week + "T12:00:00Z");
    date.setUTCDate(date.getUTCDate() + delta * 7);
    await store.refresh(date.toISOString().slice(0, 10));
  });
}
async function reassign(id: string, event: Event) {
  await run(async () => {
    await api(`/households/${store.activeId}/assignments/${id}`, "PATCH", {
      assigneeId: (event.target as HTMLSelectElement).value,
    });
    await store.refresh(store.dashboard!.week);
  }, "Assignment updated.");
}
function isOverdue(date: string) {
  return new Date(date).getTime() < Date.now();
}
function cannotAfford(cost: number) {
  return (store.dashboard?.membership.coins ?? 0) < cost;
}
function due(date: string) {
  return new Date(date).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: store.active?.timezone,
  });
}
</script>

<template>
  <div v-if="!ready" class="loading" role="status">
    <Leaf :size="36" /> Getting your home ready…
  </div>
  <template v-else>
    <div v-if="!store.user" class="auth-layout">
      <section class="welcome">
        <a class="brand" href="/"
          ><span class="brand-mark"><Leaf /></span> ChoreQuest</a
        >
        <div>
          <span class="eyebrow">A HAPPIER HOME, TOGETHER</span>
          <h1>Little chores.<br />Shared wins.</h1>
          <p>
            Turn everyday to-dos into a little teamwork.<br />Make space for
            more of the good stuff.
          </p>
          <div class="home-art">
            <Home :size="110" :stroke-width="1" /><span class="art-spark"
              >✦</span
            >
            <div class="art-note"><Check :size="18" /> Home feels good.</div>
          </div>
        </div>
        <small>Less keeping score. More caring for your space.</small>
      </section>
      <section class="auth-form">
        <div>
          <span class="pill">WELCOME TO YOUR NEXT CHAPTER</span>
          <h2>
            {{
              route.path === "/register"
                ? "Make yourself at home."
                : "Welcome home."
            }}
          </h2>
          <p class="muted">A little progress starts with showing up.</p>
          <form @submit.prevent="signIn">
            <label v-if="route.path === '/register'"
              >Your name<input
                v-model="auth.name"
                autocomplete="name"
                required
                maxlength="60" /></label
            ><label
              >Email address<input
                v-model="auth.email"
                type="email"
                autocomplete="email"
                required /></label
            ><label
              >Password<input
                v-model="auth.password"
                type="password"
                :autocomplete="
                  route.path === '/register'
                    ? 'new-password'
                    : 'current-password'
                "
                minlength="10"
                maxlength="72"
                required
              /><small>At least 10 characters.</small></label
            ><button class="primary" :disabled="busy">
              {{
                busy
                  ? "One moment…"
                  : route.path === "/register"
                    ? "Create account"
                    : "Sign in"
              }}
              <ArrowRight :size="18" />
            </button>
          </form>
          <p>
            {{
              route.path === "/register"
                ? "Already part of the team?"
                : "New here?"
            }}
            <RouterLink
              :to="route.path === '/register' ? '/login' : '/register'"
              >{{
                route.path === "/register" ? "Sign in" : "Create an account"
              }}</RouterLink
            >
          </p>
        </div>
      </section>
    </div>
    <div v-else class="app-shell" :inert="modal ? true : undefined">
      <aside class="sidebar">
        <RouterLink class="brand" to="/"
          ><span class="brand-mark"><Leaf /></span> ChoreQuest</RouterLink
        >
        <div class="house-select">
          <label for="household">YOUR HOUSEHOLD</label
          ><select
            id="household"
            v-model="store.activeId"
            :disabled="busy"
            @change="chooseHouse"
          >
            <option v-if="!store.households.length" value="">
              Create your home
            </option>
            <option v-for="h in store.households" :key="h._id" :value="h._id">
              {{ h.name }}
            </option>
          </select>
        </div>
        <nav aria-label="Main navigation">
          <RouterLink
            v-for="item in nav"
            :key="item.to"
            :to="item.to"
            :class="{ selected: route.path === item.to }"
            ><component :is="item.icon" :size="20" />{{
              item.label
            }}</RouterLink
          >
        </nav>
        <div class="sidebar-note">
          <Sparkles :size="24" /><strong>Better, together.</strong>
          <p>Every little thing you do makes home a little happier.</p>
        </div>
        <div class="user-card">
          <span class="avatar">{{ store.user.name.charAt(0) }}</span>
          <div>
            <strong>{{ store.user.name }}</strong
            ><small>Home team member</small>
          </div>
          <button
            class="icon-button"
            aria-label="Sign out"
            :disabled="busy"
            @click="
              run(async () => {
                await api('/auth/logout', 'POST', {});
                store.$reset();
                router.push('/login');
              })
            "
          >
            <LogOut :size="18" />
          </button>
        </div>
      </aside>
      <main>
        <header class="topbar">
          <span>{{
            nav.find((n) => n.to === route.path)?.label ?? "Welcome home"
          }}</span
          ><span class="topbar-right"
            ><span class="coin-pill"
              ><Coins :size="17" />
              {{ store.dashboard?.membership.coins ?? 0 }} coins</span
            ><span class="avatar small">{{ store.user.name.charAt(0) }}</span
            ><button
              class="icon-button mobile-signout"
              aria-label="Sign out"
              :disabled="busy"
              @click="signOut"
            >
              <LogOut :size="18" /></button
          ></span>
        </header>
        <div class="content">
          <template v-if="!store.activeId || route.path === '/households'"
            ><div class="page-heading">
              <div>
                <span class="eyebrow">YOUR PEOPLE. YOUR PLACE.</span>
                <h1>Start something good.</h1>
                <p>Create a household or join your team with an invite.</p>
              </div>
            </div>
            <div class="two-columns">
              <form
                class="panel"
                @submit.prevent="
                  run(async () => {
                    const h = await api<{ _id: string }>(
                      '/households',
                      'POST',
                      house,
                    );
                    store.activeId = h._id;
                    await store.loadHouseholds();
                    router.push('/');
                  })
                "
              >
                <h2>Create a household</h2>
                <label
                  >Household name<input
                    v-model="house.name"
                    placeholder="The Maple House"
                    required
                    maxlength="80" /></label
                ><label
                  >Timezone<input
                    v-model="house.timezone"
                    required
                    placeholder="Europe/Ljubljana" /></label
                ><button class="primary" :disabled="busy">
                  Create home <Plus :size="18" />
                </button>
              </form>
              <form
                class="panel"
                @submit.prevent="
                  run(async () => {
                    const h = await api<{ _id: string }>(
                      '/households/join',
                      'POST',
                      { code: joinCode },
                    );
                    store.activeId = h._id;
                    await store.loadHouseholds();
                    router.push('/');
                  })
                "
              >
                <h2>Join your team</h2>
                <label
                  >Invite code<input
                    v-model="joinCode"
                    required
                    placeholder="Paste the code from your household" /></label
                ><button class="primary" :disabled="busy">
                  Join household <ArrowRight :size="18" />
                </button>
              </form></div
          ></template>
          <template v-else-if="store.dashboard">
            <div class="page-heading">
              <div>
                <span class="eyebrow"
                  >{{ store.active?.name }} / LET’S MAKE HOME FEEL GOOD</span
                >
                <h1>
                  {{
                    route.path === "/"
                      ? `Hey ${greeting}, you’ve got this.`
                      : route.path === "/chores"
                        ? "Small tasks. Real impact."
                        : route.path === "/assignments"
                          ? "A week well shared."
                          : route.path === "/rewards"
                            ? "A little something for you."
                            : route.path === "/profile"
                              ? "Look how far you’ve come."
                              : "Your home team."
                  }}
                </h1>
                <p>
                  {{
                    route.path === "/"
                      ? "A little teamwork goes a long way. Here’s your week at a glance."
                      : route.path === "/rewards"
                        ? "Shared effort deserves something worth looking forward to."
                        : "Make it yours, and keep moving together."
                  }}
                </p>
              </div>
              <button
                v-if="route.path === '/chores'"
                class="primary"
                @click="editChore()"
              >
                <Plus :size="18" /> Add chore</button
              ><button
                v-if="route.path === '/rewards'"
                class="primary"
                @click="editReward()"
              >
                <Plus :size="18" /> Add reward
              </button>
            </div>
            <template
              v-if="route.path === '/' || route.path === '/assignments'"
            >
              <div class="week-toolbar">
                <span class="pill"
                  ><CalendarDays :size="15" /> WEEK OF
                  {{ weekLabel.toUpperCase() }}</span
                >
                <div class="row">
                  <button
                    class="icon-button"
                    aria-label="Previous week"
                    :disabled="busy"
                    @click="moveWeek(-1)"
                  >
                    <ChevronLeft :size="18" /></button
                  ><button
                    class="icon-button"
                    aria-label="Next week"
                    :disabled="busy"
                    @click="moveWeek(1)"
                  >
                    <ChevronRight :size="18" /></button
                  ><button class="secondary" :disabled="busy" @click="generate">
                    <Sparkles :size="16" /> Plan this week
                  </button>
                </div>
              </div>
              <div class="dashboard-grid">
                <section class="team-banner">
                  <div>
                    <span class="eyebrow">ONE HOME. ONE TEAM.</span>
                    <h2>Good things happen<br />when we pitch in.</h2>
                    <p>Every quest counts toward a happier shared space.</p>
                    <ProgressMeter
                      :completed="store.dashboard.progress.completed"
                      :total="store.dashboard.progress.total"
                    />
                  </div>
                  <div class="plant-art" aria-hidden="true">
                    <Leaf :size="104" :stroke-width="1.1" /><span>✦</span>
                    <div class="plant-pot" />
                  </div>
                </section>
                <section class="panel level-card">
                  <span class="icon-tile gold"><Trophy :size="25" /></span
                  ><span class="eyebrow">YOUR GROWING IMPACT</span>
                  <h2>Level {{ store.dashboard.level }}</h2>
                  <p>{{ store.dashboard.membership.xp }} XP earned</p>
                  <div class="progress-track">
                    <div
                      :style="{
                        width:
                          Math.min(
                            100,
                            (store.dashboard.membership.xp / nextLevel) * 100,
                          ) + '%',
                      }"
                    />
                  </div>
                  <small
                    >{{ nextLevel - store.dashboard.membership.xp }} XP to your
                    next level</small
                  >
                </section>
              </div>
              <div class="dashboard-grid bottom-grid">
                <section class="panel quests">
                  <div class="section-heading">
                    <h2>
                      Your weekly quests
                      <span class="count">{{ pending.length }}</span>
                    </h2>
                    <div class="tabs">
                      <button
                        :class="{ active: filter === 'mine' }"
                        @click="filter = 'mine'"
                      >
                        Mine</button
                      ><button
                        :class="{ active: filter === 'all' }"
                        @click="filter = 'all'"
                      >
                        Everyone
                      </button>
                    </div>
                  </div>
                  <p class="muted small-text">
                    Small steps. A lighter load for everyone.
                  </p>
                  <div v-if="!tasks.length" class="empty">
                    <CheckCheck :size="34" />
                    <h3>A fresh start for your week.</h3>
                    <p>
                      Add chores to your library, then plan the week to share
                      them fairly.
                    </p>
                    <RouterLink to="/chores"
                      >Visit chore library <ArrowRight :size="16"
                    /></RouterLink>
                  </div>
                  <article
                    v-for="a in tasks"
                    :key="a._id"
                    class="quest-row"
                    :class="{ done: a.status === 'completed' }"
                  >
                    <button
                      class="complete-circle"
                      :class="{ checked: a.status === 'completed' }"
                      :aria-label="`Complete ${a.title}`"
                      :disabled="
                        busy ||
                        a.status === 'completed' ||
                        a.assigneeId !== store.userId
                      "
                      @click="complete(a._id)"
                    >
                      <Check v-if="a.status === 'completed'" :size="17" />
                    </button>
                    <div class="quest-info">
                      <h3>{{ a.title }}</h3>
                      <p>
                        <span
                          :class="{
                            overdue:
                              a.status === 'pending' && isOverdue(a.dueAt),
                          }"
                          >{{
                            a.status === "completed"
                              ? "Complete"
                              : isOverdue(a.dueAt)
                                ? "Overdue · " + due(a.dueAt)
                                : due(a.dueAt)
                          }}</span
                        >
                        · {{ a.effort }} effort<span v-if="filter === 'all'">
                          ·
                          {{
                            store.members.find((m) => m.userId === a.assigneeId)
                              ?.name
                          }}</span
                        >
                      </p>
                      <select
                        v-if="
                          route.path === '/assignments' &&
                          a.status === 'pending'
                        "
                        :value="a.assigneeId"
                        :disabled="busy"
                        :aria-label="`Assign ${a.title}`"
                        @change="reassign(a._id, $event)"
                      >
                        <option
                          v-for="m in store.members"
                          :key="m.userId"
                          :value="m.userId"
                        >
                          {{ m.name }}
                        </option>
                      </select>
                    </div>
                    <div class="quest-points">
                      <span>+{{ a.xp }} XP</span
                      ><small><Coins :size="13" /> {{ a.coins }}</small>
                    </div>
                  </article>
                </section>
                <aside class="right-stack">
                  <section class="panel treat-card">
                    <span class="icon-tile pink"><Gift :size="24" /></span>
                    <h2>You've earned a little joy.</h2>
                    <p>Turn your everyday effort into a well-deserved treat.</p>
                    <RouterLink class="text-link" to="/rewards"
                      >Explore rewards <ArrowRight :size="17"
                    /></RouterLink>
                  </section>
                  <section class="panel">
                    <div class="section-heading">
                      <h2>The home team</h2>
                      <Users :size="18" />
                    </div>
                    <div
                      v-for="m in store.members"
                      :key="m.userId"
                      class="member-row"
                    >
                      <span class="avatar">{{ m.name.charAt(0) }}</span>
                      <div>
                        <strong
                          >{{ m.name
                          }}{{
                            m.userId === store.userId ? " (you)" : ""
                          }}</strong
                        ><small
                          >Level {{ m.level }} · {{ m.completions }} little
                          wins</small
                        >
                      </div>
                      <Leaf :size="17" class="muted" />
                    </div>
                  </section>
                </aside>
              </div>
            </template>
            <template v-else-if="route.path === '/chores'"
              ><div v-if="!store.chores.length" class="panel empty">
                <CheckCheck :size="38" />
                <h2>A clean slate.</h2>
                <p>Add your first chore to begin sharing the load.</p>
                <button class="primary" @click="editChore()">
                  Add a chore
                </button>
              </div>
              <div class="card-grid">
                <article
                  v-for="c in store.chores"
                  :key="c._id"
                  class="panel item-card"
                >
                  <span class="icon-tile"><CheckCheck /></span
                  ><span class="pill">{{
                    c.active ? c.recurrence : "Archived"
                  }}</span>
                  <h2>{{ c.title }}</h2>
                  <p>
                    {{
                      c.description || "A little care for your shared space."
                    }}
                  </p>
                  <div class="item-meta">
                    <span>{{ c.effort }} effort</span><span>{{ c.xp }} XP</span
                    ><span>{{ c.coins }} coins</span>
                  </div>
                  <div class="card-actions">
                    <button class="secondary" @click="editChore(c)">
                      Edit chore</button
                    ><button
                      v-if="c.active"
                      class="quiet"
                      :disabled="busy"
                      @click="archive('chores', c._id)"
                    >
                      Archive
                    </button>
                  </div>
                </article>
              </div></template
            >
            <template v-else-if="route.path === '/rewards'"
              ><div class="balance-banner">
                <Coins :size="30" />
                <div>
                  <strong
                    >{{ store.dashboard.membership.coins }} coins to
                    enjoy</strong
                  >
                  <p>Earned together. Spent on something good.</p>
                </div>
              </div>
              <div v-if="!store.rewards.length" class="panel empty">
                <Gift :size="38" />
                <h2>What would make your day?</h2>
                <p>Agree on a reward with your household and add it here.</p>
              </div>
              <div class="card-grid">
                <article
                  v-for="r in store.rewards"
                  :key="r._id"
                  class="panel item-card"
                >
                  <div class="reward-illustration">
                    <Gift :size="48" :stroke-width="1.3" />
                  </div>
                  <h2>{{ r.title }}{{ r.active ? "" : " (archived)" }}</h2>
                  <p>{{ r.description }}</p>
                  <strong class="price"
                    ><Coins :size="17" /> {{ r.cost }} coins</strong
                  ><button
                    class="primary"
                    :disabled="busy || !r.active || cannotAfford(r.cost)"
                    @click="redeem(r)"
                  >
                    {{
                      cannotAfford(r.cost)
                        ? "Keep going — almost there"
                        : "Redeem reward"
                    }}
                  </button>
                  <div class="card-actions">
                    <button class="quiet" @click="editReward(r)">Edit</button
                    ><button
                      v-if="r.active"
                      class="quiet"
                      :disabled="busy"
                      @click="archive('rewards', r._id)"
                    >
                      Archive
                    </button>
                  </div>
                </article>
              </div></template
            >
            <template v-else-if="route.path === '/profile'"
              ><div class="stats-grid">
                <div class="panel">
                  <Trophy />
                  <h2>Level {{ store.dashboard.level }}</h2>
                  <p>
                    {{ store.dashboard.membership.xp }} lifetime household XP
                  </p>
                </div>
                <div class="panel">
                  <CheckCheck />
                  <h2>
                    {{ store.dashboard.membership.completions }} little wins
                  </h2>
                  <p>Every one made a difference.</p>
                </div>
                <div class="panel">
                  <Coins />
                  <h2>{{ store.dashboard.membership.coins }} coins</h2>
                  <p>A little thank-you for your effort.</p>
                </div>
              </div>
              <section class="panel">
                <h2>Your achievements</h2>
                <p class="muted">
                  First completion, ten completions, and a fully completed team
                  week unlock badges.
                </p>
                <div v-if="!store.dashboard.achievements.length" class="empty">
                  Your first win is waiting. Complete a quest to earn your first
                  badge.
                </div>
                <div class="badges">
                  <div v-for="a in store.dashboard.achievements" :key="a._id">
                    <span class="icon-tile gold"><Trophy /></span
                    ><strong>{{ a.title }}</strong>
                  </div>
                </div>
              </section>
              <section class="panel ledger">
                <h2>Wallet activity</h2>
                <p v-if="!store.dashboard.ledger.length" class="muted">
                  Your earned coins and redeemed rewards will appear here.
                </p>
                <div
                  v-for="entry in store.dashboard.ledger"
                  :key="entry._id"
                  class="ledger-row"
                >
                  <div>
                    <strong>{{ entry.title }}</strong
                    ><small>{{
                      new Date(entry.createdAt).toLocaleString()
                    }}</small>
                  </div>
                  <span
                    >{{ entry.coins > 0 ? "+" : ""
                    }}{{ entry.coins }} coins</span
                  >
                </div>
              </section></template
            >
            <template v-else-if="route.path === '/settings'"
              ><div class="two-columns">
                <section class="panel">
                  <h2>{{ store.active?.name }}</h2>
                  <p class="muted">
                    Weekly boundaries follow {{ store.active?.timezone }}.
                  </p>
                  <div
                    v-for="m in store.members"
                    :key="m.userId"
                    class="member-row"
                  >
                    <span class="avatar">{{ m.name.charAt(0) }}</span>
                    <div>
                      <strong>{{ m.name }}</strong
                      ><small>{{
                        m.userId === store.active?.ownerId
                          ? "Household owner"
                          : "Household member"
                      }}</small>
                    </div>
                  </div>
                  <RouterLink class="text-link" to="/households"
                    ><Plus :size="16" /> Create or join another
                    household</RouterLink
                  >
                </section>
                <section class="panel">
                  <h2>Room for one more.</h2>
                  <p class="muted">
                    Invite someone to share the little wins. A new code revokes
                    the previous one.
                  </p>
                  <template v-if="store.active?.ownerId === store.userId"
                    ><div class="row wrap">
                      <button
                        class="primary"
                        :disabled="busy"
                        @click="
                          run(async () => {
                            const result = await api<{ code: string }>(
                              `/households/${store.activeId}/invite`,
                              'POST',
                              {},
                            );
                            invite = result.code;
                          })
                        "
                      >
                        Generate invite</button
                      ><button
                        class="secondary"
                        :disabled="busy"
                        @click="
                          run(async () => {
                            await api(
                              `/households/${store.activeId}/invite`,
                              'POST',
                              { revoke: true },
                            );
                            invite = '';
                          }, 'Invite revoked.')
                        "
                      >
                        Revoke invite
                      </button>
                    </div>
                    <label v-if="invite"
                      >Share this invite code<input
                        :value="invite"
                        readonly
                        @focus="
                          ($event.target as HTMLInputElement).select()
                        " /></label
                  ></template>
                  <p v-else>Ask your household owner for an invite code.</p>
                </section>
              </div></template
            >
          </template>
          <section v-else class="panel empty" role="status">
            <p>
              {{
                busy
                  ? "Loading your household…"
                  : "Your household could not be loaded."
              }}
            </p>
            <button v-if="!busy" class="secondary" @click="chooseHouse">
              Try again
            </button>
          </section>
          <footer>A little effort. A lot of good. <Leaf :size="14" /></footer>
        </div>
      </main>
    </div>
    <div v-if="error" class="notification error" role="alert">
      <span>{{ error }}</span
      ><button aria-label="Dismiss error" @click="error = ''">×</button>
    </div>
    <div v-if="toast" class="notification" role="status">
      <Check :size="18" />{{ toast }}
    </div>
    <div
      v-if="modal"
      class="modal-backdrop"
      @click.self="modal = null"
      @keydown.esc="modal = null"
    >
      <section
        ref="dialog"
        class="modal panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="dialog-title"
        @keydown="trapFocus"
      >
        <div class="section-heading">
          <h2 id="dialog-title">{{ editId ? "Edit" : "Add" }} {{ modal }}</h2>
          <button
            class="icon-button"
            aria-label="Close dialog"
            @click="modal = null"
          >
            ×
          </button>
        </div>
        <form @submit.prevent="save">
          <template v-if="modal === 'chore'"
            ><label
              >Chore title<input
                v-model="chore.title"
                required
                maxlength="100"
                autofocus /></label
            ><label
              >Description<textarea
                v-model="chore.description"
                maxlength="1000"
              />
            </label>
            <div class="three-fields">
              <label
                >Effort<input
                  v-model.number="chore.effort"
                  type="number"
                  min="1"
                  max="100"
                  required /></label
              ><label
                >XP<input
                  v-model.number="chore.xp"
                  type="number"
                  min="0"
                  max="1000"
                  required /></label
              ><label
                >Coins<input
                  v-model.number="chore.coins"
                  type="number"
                  min="0"
                  max="1000"
                  required
              /></label>
            </div>
            <label
              >Recurrence<select v-model="chore.recurrence">
                <option value="once">One time</option>
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
              </select></label
            ><label v-if="chore.recurrence !== 'daily'"
              >Preferred day<select v-model.number="chore.preferredDay">
                <option
                  v-for="(day, i) in [
                    'Monday',
                    'Tuesday',
                    'Wednesday',
                    'Thursday',
                    'Friday',
                    'Saturday',
                    'Sunday',
                  ]"
                  :key="day"
                  :value="i + 1"
                >
                  {{ day }}
                </option>
              </select></label
            ><label class="checkbox-label"
              ><input v-model="chore.active" type="checkbox" /> Active
              chore</label
            ></template
          ><template v-else
            ><label
              >Reward title<input
                v-model="reward.title"
                required
                maxlength="100"
                autofocus /></label
            ><label
              >Description<textarea
                v-model="reward.description"
                maxlength="1000"
              /></label
            ><label
              >Coin cost<input
                v-model.number="reward.cost"
                type="number"
                min="1"
                max="100000"
                required /></label
            ><label class="checkbox-label"
              ><input v-model="reward.active" type="checkbox" /> Available to
              redeem</label
            ></template
          ><button class="primary" :disabled="busy">
            {{ busy ? "Saving…" : "Save " + modal }}
          </button>
        </form>
      </section>
    </div>
  </template>
</template>
