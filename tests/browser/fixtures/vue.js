import { createApp, h, onMounted } from "vue";
import { createTracewayPlugin, useTraceway } from "@tracewayapp/vue";
import { connectionString, options, mountActions } from "./shared";
const app = createApp({
  setup() {
    const api = useTraceway();
    onMounted(() => {
      window.ready = true;
    });
    return () => [
      h("button", { id: "checkout", onClick: mountActions(api) }, "Checkout"),
      h(
        "button",
        {
          id: "error",
          onClick: () => {
            throw new Error("checkout failed");
          },
        },
        "Report error",
      ),
      h("input", { id: "private" }),
      h("div", { id: "result" }),
    ];
  },
});
app.use(createTracewayPlugin({ connectionString, options }));
app.mount("#app");
