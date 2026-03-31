<script setup lang="ts">
definePage({
  meta: {
    middleware: 'named-one',
  },
});
</script>

<template>
  <div class="flex flex-col items-center justify-center space-y-6">
    <div class="text-center">
      <h1 class="text-4xl font-black mb-2 italic">About Page</h1>
      <p class="text-fuchsia-400 font-mono text-sm">
        Executing: Global 1 -> Global 2 -> Named 1 (Only)
      </p>
    </div>

    <button
      @click="$router.push('/')"
      class="border border-white/20 hover:border-white/60 bg-white/5 backdrop-blur-xl px-8 py-3 rounded-full font-bold transition-all"
    >
      Return Home
    </button>
  </div>
</template>
