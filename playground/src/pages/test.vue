<script setup lang="ts">
definePage({
  meta: {
    middleware: ['named-one', 'named-two']
  },
});
</script>

<template>
  <div class="flex flex-col items-center justify-center space-y-6">
    <div class="text-center">
      <h1 class="text-4xl font-black mb-2">Test Page</h1>
      <p class="text-sky-400 font-mono text-sm underline decoration-wavy">Executing: Global 1 -> Global 2 -> Named 1 -> Named 2</p>
    </div>

    <button
      @click="$router.push('/')"
      class="border border-white/20 hover:border-white/60 bg-white/5 backdrop-blur-xl px-8 py-3 rounded-full font-bold transition-all"
    >
      Return Home
    </button>
  </div>
</template>
