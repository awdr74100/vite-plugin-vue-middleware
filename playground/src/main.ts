import '@/assets/css/tailwind.css';
import { createApp } from 'vue';

import App from '@/App.vue';
import router from '@/router';

const app = createApp(App);

app.provide('test', 1234);
app.provide('test2', 5678)

app.use(router);

app.mount('#app');
