// @vitest-environment jsdom
import { mount } from "@vue/test-utils";
import { it, expect } from "vitest";
import ProgressMeter from "./ProgressMeter.vue";
it("announces team progress and handles an empty week", async () => {
  const wrapper = mount(ProgressMeter, { props: { completed: 0, total: 0 } });
  expect(wrapper.get('[role="progressbar"]').attributes("aria-valuenow")).toBe(
    "0",
  );
  await wrapper.setProps({ completed: 3, total: 4 });
  expect(wrapper.text()).toContain("3 of 4");
  expect(wrapper.get('[role="progressbar"]').attributes("aria-valuenow")).toBe(
    "75",
  );
});
