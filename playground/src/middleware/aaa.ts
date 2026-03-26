import { defineMiddleware } from "virtual:vue-middleware";

export default defineMiddleware(async (to, from) => {
  await new Promise((resolve) => setTimeout(resolve, 3000));

  return true;
  // return { path: "/news" };
  // console.log("aaa", to.path, from.path);
});
