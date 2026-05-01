/** Public id used by user-land code (`import ... from 'virtual:vue-middleware'`) */
export const VIRTUAL_MODULE_ID = 'virtual:vue-middleware';

/** Internal id returned from `resolveId` — must be prefixed with `\0` so other plugins skip it */
export const RESOLVED_VIRTUAL_MODULE_ID = '\0' + VIRTUAL_MODULE_ID;

export const PLUGIN_NAME = 'vite-plugin-vue-middleware';

export const RUNTIME_IMPORT_PATH = 'vite-plugin-vue-middleware/runtime';
