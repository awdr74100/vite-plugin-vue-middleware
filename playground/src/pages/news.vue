<script setup lang="ts">
definePage({
  meta: {
    middleware: 'redirect-to-about',
  },
});
</script>

<template>
  <div class="flex items-center justify-center">
    <h1 class="text-4xl">News (You should not see this!)</h1>
  </div>
</template>
