import '@/assets/css/tailwind.css';
import { createApp } from 'vue';

import App from '@/App.vue';
import router from '@/router';

const app = createApp(App);

app.provide('hobbies', ['coding', 'reading', 'running']);
app.provide('name', 'Zack');

app.use(router);

app.mount('#app');
