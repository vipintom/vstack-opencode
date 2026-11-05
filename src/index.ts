import { Plugin } from "@opencode/plugin";
import { ensureRouteInstruction } from "./bootstrap.js";
import { StateStore } from "./state/store.js";
import { createTools } from "./tools/index.js";

export default Plugin.define({
  id: "vstack",
  async setup(ctx) {
    const root = ctx.location.project?.canonical || ctx.location.directory;
    const store = new StateStore(root);
    const tools = createTools(store);

    const toolRegistration = await ctx.tool.transform((editor) => {
      for (const tool of tools) {
        editor.add({
          name: tool.name,
          description: tool.description,
          input: tool.input as never,
          execute: async (args: unknown, toolContext: unknown) => {
            return tool.execute((args ?? {}) as Record<string, unknown>, toolContext);
          },
        });
      }
    });

    const contextRegistration = await ctx.session.hook("context", (input) => {
      ensureRouteInstruction(input.system as Array<{ type: "text"; text: string }>);
    });

    return async () => {
      await toolRegistration.dispose();
      await contextRegistration.dispose();
    };
  },
});
