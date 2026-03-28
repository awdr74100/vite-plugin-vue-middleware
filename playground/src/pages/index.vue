<script setup lang="ts">
definePage({
  meta: {
    // Only broad globals will run here
  },
});
</script>

<template>
  <div class="flex flex-col items-center justify-center space-y-6">
    <div class="text-center">
      <h1 class="text-4xl font-black mb-2">Home Page</h1>
      <p class="text-gray-400">Wait, check the console for logs!</p>
    </div>

    <div class="grid grid-cols-2 gap-4">
      <button
        @click="$router.push('/test')"
        class="bg-blue-600 hover:bg-blue-700 px-6 py-3 rounded-xl font-bold transition-all shadow-lg"
      >
        Go to Test Page (Multiple Named)
      </button>
      <button
        @click="$router.push('/about')"
        class="bg-purple-600 hover:bg-purple-700 px-6 py-3 rounded-xl font-bold transition-all shadow-lg"
      >
        Go to About Page (Single Named)
      </button>
      <button
        @click="$router.push('/news')"
        class="bg-red-600 hover:bg-red-700 px-6 py-3 rounded-xl font-bold transition-all shadow-lg col-span-2"
      >
        Go to News (Redirect to About)
      </button>
      <button
        @click="$router.push('/forbidden')"
        class="bg-black border border-red-500 text-red-500 hover:bg-red-500 hover:text-white px-6 py-3 rounded-xl font-bold transition-all shadow-lg col-span-2"
      >
        Try Forbidden Page (Abort Navigation)
      </button>
    </div>
  </div>
</template>
