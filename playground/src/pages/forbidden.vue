<script setup lang="ts">
definePage({
  meta: {
    middleware: 'abort-navigation'
  },
});
</script>

<template>
  <div class="flex items-center justify-center">
    <h1 class="text-4xl text-red-500 font-bold">403 Forbidden (You should not see this!)</h1>
  </div>
</template>
