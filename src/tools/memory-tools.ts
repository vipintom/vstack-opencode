/**
 * vstack_memory - Search/read memory; propose or apply bounded memory update
 */

import { VstackTool } from "./index.js";

export const memoryTool: VstackTool = {
  name: "vstack_memory",
  description: "Manage project memory: search, read, create, update, supersede",
  input: {
    type: "object",
    properties: {
      action: { 
        type: "string", 
        enum: ["search", "read", "create", "update", "supersede", "list"],
        description: "Action to perform" 
      },
      category: { 
        type: "string", 
        enum: ["overview", "architecture", "conventions", "decisions", "lessons", "handoffs", "constraints"],
        description: "Memory category" 
      },
      query: { type: "string", description: "Search query (for search action)" },
      id: { type: "string", description: "Memory item ID (for read/update/supersede)" },
      title: { type: "string", description: "Title (for create)" },
      content: { type: "string", description: "Content (for create/update)" },
      tags: { type: "array", items: { type: "string" }, description: "Tags (for create)" },
      source: { type: "string", description: "Source reference (for create)" },
      newItemId: { type: "string", description: "New item ID that supersedes this (for supersede)" },
    },
    required: ["action"],
  },
  execute: async (input, context) => {
    const { vstack } = context;
    const { memoryStore } = vstack;
    
    switch (input.action) {
      case "list": {
        const categories = await memoryStore.listCategories();
        return { content: JSON.stringify({ categories }) };
      }
      
      case "search": {
        if (!input.query) return { content: JSON.stringify({ error: "query required for search" }) };
        const results = await memoryStore.searchItems(input.query, input.category ? [input.category] : undefined);
        return { content: JSON.stringify({ results }) };
      }
      
      case "read": {
        if (!input.category || !input.id) return { content: JSON.stringify({ error: "category and id required" }) };
        const item = await memoryStore.getItem(input.category, input.id);
        return { content: JSON.stringify({ item }) };
      }
      
      case "create": {
        if (!input.category || !input.title || !input.content) {
          return { content: JSON.stringify({ error: "category, title, content required" }) };
        }
        const item = await memoryStore.createItem(input.category, {
          title: input.title,
          content: input.content,
          tags: input.tags,
          source: input.source,
        });
        return { content: JSON.stringify({ item }) };
      }
      
      case "update": {
        if (!input.category || !input.id) return { content: JSON.stringify({ error: "category and id required" }) };
        const item = await memoryStore.updateItem(input.category, input.id, {
          title: input.title,
          content: input.content,
          tags: input.tags,
        });
        return { content: JSON.stringify({ item }) };
      }
      
      case "supersede": {
        if (!input.category || !input.id || !input.newItemId) {
          return { content: JSON.stringify({ error: "category, id, newItemId required" }) };
        }
        await memoryStore.supersedeItem(input.category, input.id, input.newItemId);
        return { content: JSON.stringify({ success: true }) };
      }
      
      default:
        return { content: JSON.stringify({ error: "Invalid action" }) };
    }
  },
};

export const memoryTools = [memoryTool];