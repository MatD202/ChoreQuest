<script setup lang="ts">
import { computed } from "vue";
const props = defineProps<{ completed: number; total: number }>();
const percent = computed(() =>
  props.total ? Math.round((props.completed / props.total) * 100) : 0,
);
</script>
<template>
  <div class="progress-label">
    <span>{{ completed }} of {{ total }} quests complete</span
    ><strong>{{ percent }}%</strong>
  </div>
  <div
    class="progress-track"
    role="progressbar"
    aria-label="Weekly household progress"
    :aria-valuenow="percent"
    :aria-valuemin="0"
    :aria-valuemax="100"
  >
    <div :style="{ width: percent + '%' }" />
  </div>
</template>
