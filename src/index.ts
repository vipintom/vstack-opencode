/**
 * vstack OpenCode Plugin
 * Main entry point for the vstack workflow engine
 */

import { Plugin } from "@opencode/plugin";
import { vstackTools } from "./tools/index.js";
import { createAgentDispatch } from "./orchestration/agent-dispatch.js";
import { resolveVstackRoot, ensureVstackDirs } from "./persistence/repository-root.js";
import { initializeEventLog } from "./persistence/event-log.js";
import { initializeRuntimeState, refreshRuntimeState } from "./runtime/state.js";
import { publishProjections } from "./dashboard/projection-publisher.js";
import { loadSkillsFromDirectory, findAgentsSkillsRoot } from "./skills/skill-loader.js";
import { installAgents } from "./agents/agent-installer.js";
import { createMemoryStore } from "./memory/memory-store.js";
import { createDeliveryStore } from "./deliveries/delivery-store.js";
import { createTaskStore } from "./tasks/task-store.js";
import { createAgentRunStore } from "./agents/agent-run-store.js";
import { createHistoryService } from "./history/history-service.js";
import { createCheckService } from "./quality/check-service.js";
import { createEnforcementService } from "./enforcement/enforcement-service.js";
import { createAssignmentStore } from "./tasks/assignment-store.js";
import { createDecisionStore } from "./tasks/decision-store.js";
import { createCheckpointStore } from "./tasks/checkpoint-store.js";
import { createLessonStore } from "./tasks/lesson-store.js";
import { createRecoveryStore } from "./tasks/recovery-store.js";
import { createProjectVerificationStore } from "./tasks/verification-index-store.js";
import { createReviewStore } from "./quality/review-store.js";
import { join, resolve, dirname } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_VERSION = JSON.parse(readFileSync(join(__dirname, "..", "package.json"), "utf-8")).version;

export default Plugin.define({
  id: "vstack",
  
  async setup(ctx) {
    const projectRoot = ctx.location.project.canonical || ctx.location.directory;
    const vstackRoot = await resolveVstackRoot(projectRoot);
    
    console.log(`[vstack] Initializing for project: ${projectRoot}`);
    
    // Ensure .vstack directories exist
    await ensureVstackDirs(vstackRoot);
    
    // Initialize event log
    await initializeEventLog(vstackRoot);
    
    // Initialize runtime state (manifest + dashboard index)
    const initialIndex = await initializeRuntimeState(vstackRoot);
    console.log(`[vstack] Dashboard index initialized: revision ${initialIndex.revision}`);
    
    // Initialize core services (simplified runtime)
    // New simplified stores
    const memoryStore = await createMemoryStore(vstackRoot);
    const deliveryStore = await createDeliveryStore(vstackRoot);
    const taskStore = await createTaskStore(vstackRoot);
    const historyService = await createHistoryService(vstackRoot);
    const checkService = await createCheckService(vstackRoot);
    const enforcementService = await createEnforcementService(vstackRoot);
    const agentRunStore = await createAgentRunStore(vstackRoot);
    
    // Phase 2: New v2 stores
    const assignmentStore = await createAssignmentStore(vstackRoot);
    const decisionStore = await createDecisionStore(vstackRoot);
    const checkpointStore = await createCheckpointStore(vstackRoot);
    const lessonStore = await createLessonStore(vstackRoot);
    const recoveryStore = await createRecoveryStore(vstackRoot);
    const verificationIndexStore = await createProjectVerificationStore(vstackRoot);
    
    // Phase 4: Review store
    const reviewStore = await createReviewStore(vstackRoot);
    
    const agentDispatchConfig = {
      defaultModel: null,
      maxSteps: { default: 50 },
      defaultPermissions: ["read", "glob", "grep", "edit", "shell", "tool", "subagent", "skill"],
      enableWorktrees: false,
    };
    const agentDispatch = createAgentDispatch(vstackRoot, agentDispatchConfig, ctx, agentRunStore);
    
    // Legacy services (kept for compatibility during transition)
    const lifecycleEngine = await import("./lifecycle/lifecycle-engine.js").then(m => m.createLifecycleEngine(vstackRoot));
    const legacyTaskService = await import("./tasks/task-service.js").then(m => m.createTaskService(vstackRoot));
    
    // Load skills from playbook package (preferred) or agents-skills (legacy)
    const skillsRoot = findAgentsSkillsRoot(projectRoot, vstackRoot.root);
    if (skillsRoot) {
      const skills = await loadSkillsFromDirectory(join(skillsRoot, "skills"));
      console.log(`[vstack] Loaded ${skills.length} skills from ${skillsRoot}`);
      
      const skillRegistration = await ctx.skill.transform((editor) => {
        for (const skill of skills) {
          editor.add({
            id: skill.id as any,
            name: skill.name as any,
            description: skill.description,
            autoinvoke: skill.autoinvoke,
            path: skill.path as any,
            content: skill.content,
          });
        }
      });
    }
    
    // Install agent definitions from playbook adapters (preferred) or agents-skills (legacy)
    if (skillsRoot) {
      // Try playbook adapters first
      let agentSourceDir = join(skillsRoot, "agents", "adapters", "opencode");
      if (!existsSync(agentSourceDir)) {
        // Fallback to legacy agents-skills
        agentSourceDir = join(skillsRoot, "agents", "opencode-v2");
      }
      const agentTargetDir = join(projectRoot, ".opencode", "agents");
      const statePath = join(vstackRoot.root, "agents.json");
      
      const result = await installAgents(agentSourceDir, agentTargetDir, statePath, PKG_VERSION);
      console.log(`[vstack] Agent install: ${result.installed.length} installed, ${result.updated.length} updated, ${result.unchanged.length} unchanged, ${result.skipped.length} skipped`);
      
      // Reload agents so OpenCode picks them up
      await ctx.agent.reload();
    }
    
    // Register tools
    const toolRegistration = await ctx.tool.transform((editor) => {
      editor.namespace({
        name: "vstack",
        description: "vstack workflow engine tools",
      });
      
      // Register all vstack tools
      for (const tool of vstackTools) {
        editor.add({
          name: tool.name,
          description: tool.description,
          input: tool.input,
          options: { namespace: "vstack" },
          execute: async (input: any, context: any) => {
            const result = await tool.execute(input, { 
              ...context, 
              vstack: {
                // New simplified services
                memoryStore,
                deliveryStore,
                taskStore,
                agentRunStore,
                historyService,
                checkService,
                enforcementService,
                agentDispatch,
                // Phase 2: New v2 stores
                assignmentStore,
                decisionStore,
                checkpointStore,
                lessonStore,
                recoveryStore,
                verificationIndexStore,
                // Phase 4: Review store
                reviewStore,
                // Legacy services (for compatibility)
                lifecycleEngine,
                legacyTaskService,
                vstackRoot,
              }
            });
            return { content: JSON.stringify(result) };
          },
        });
      }
    });
    
    // Register slash commands
    const commandRegistration = await ctx.command.transform((editor) => {
      editor.add({
        name: "vstack",
        description: "Show vstack status and available actions",
        execute: async (invocation) => {
          // Would show status
        },
      });
      
      editor.add({
        name: "vstack-start",
        description: "Start a new delivery workflow",
        execute: async (invocation) => {
          // Would start workflow
        },
      });
      
      editor.add({
        name: "vstack-status",
        description: "Show current workflow status",
        execute: async (invocation) => {
          // Would show status
        },
      });
      
      editor.add({
        name: "vstack-review",
        description: "Start a review cycle",
        execute: async (invocation) => {
          // Would start review
        },
      });
      
      editor.add({
        name: "vstack-resume",
        description: "Resume interrupted workflow",
        execute: async (invocation) => {
          // Would resume workflow
        },
      });
      
      editor.add({
        name: "vstack-report",
        description: "Generate delivery report",
        execute: async (invocation) => {
          // Would generate report
        },
      });
    });
    
    // Session context hook - inject vstack context into agent sessions
    const sessionHook = await ctx.session.hook("context", async (event) => {
      // event is SessionContext - add workflow context
      // This runs before the model request is built
    });
    
    // Tool hook - record evidence and refresh dashboard index after vstack tool execution
    const toolHook = await ctx.tool.hook("execute.after", async (event) => {
      if (event.tool.startsWith("vstack_") && event.status === "completed") {
        // Refresh dashboard index so OpenChamber sees the update
        await refreshRuntimeState(vstackRoot);
        // Publish comprehensive projections for OpenChamber
        await publishProjections(vstackRoot);
      }
    });
    
    // Permission hook - enforce vstack approval policies
    const permissionHook = await ctx.permission.hook("evaluate", async (event) => {
      // Check if operation requires approval via policyManager
      // The actual enforcement happens in tool execution
    });
    
    // Run recovery on startup
    const { performRecovery } = await import("./recovery/recovery-manager.js");
    const recoveryResults = await performRecovery(vstackRoot);
    if (recoveryResults.length > 0) {
      console.log(`[vstack] Recovery completed: ${recoveryResults.length} deliveries recovered`);
    }
    
    // Cleanup on unload
    return () => {
      toolRegistration.dispose();
      commandRegistration.dispose();
      sessionHook.dispose();
      toolHook.dispose();
      permissionHook.dispose();
    };
  },
});