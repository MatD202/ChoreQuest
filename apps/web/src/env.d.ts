/// <reference types="vite/client" />

// Allow TypeScript tools without Vue language support to resolve .vue imports.
// vue-tsc still checks the components themselves during typecheck and build.
declare module "*.vue" {
  import type { DefineComponent } from "vue";

  const component: DefineComponent;
  export default component;
}
