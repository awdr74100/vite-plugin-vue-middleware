<script setup lang="ts">
definePage({
  meta: {
    // middleware: ['aaa']
    // middleware:['']
  },
});
</script>

<template>
  <button type="button" @click="$router.push('/about')">about</button>
</template>
