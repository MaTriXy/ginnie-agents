/**
 * Agent Scheduler — reads each agent's schedules.json and fires routines
 * at scheduled times. Timezone defaults to UTC; override globally with the
 * `TZ` env var. Watches files for changes so agents can modify their own
 * schedules at runtime.
 *
 * Rejected entries (wrong shape, bad cron, etc.) are written to
 * data/scheduler-rejects.json so the watcher can DM the operator. Without
 * this, an agent that writes schedules.json with the wrong field names
 * (e.g. "name"/"prompt" instead of "id"/"message") would have its routines
 * silently dropped — no fire, no error, no signal.
 */

import cron, { ScheduledTask } from "node-cron";
import { readFileSync, existsSync, watch, writeFileSync, mkdirSync } from "fs";
import path from "path";
import type { AgentConfig } from "./runner";

interface ScheduleEntry {
	id: string;
	cron: string;
	message: string;
	description?: string;
	enabled?: boolean;
}

interface AgentSchedules {
	schedules: ScheduleEntry[];
}

interface RejectRecord {
	id?: string;        // entry.id if present, or the value the agent put under "name"
	reason: string;     // human-readable
}

type RejectsFile = Record<string, RejectRecord[]>;

// Tracks active scheduled tasks per agent
const activeTasks = new Map<string, Map<string, ScheduledTask>>();

const REPO = path.resolve(__dirname, "..", "..");
const REJECTS_FILE = path.join(REPO, "data", "scheduler-rejects.json");

function loadRejectsFile(): RejectsFile {
	if (!existsSync(REJECTS_FILE)) return {};
	try {
		return JSON.parse(readFileSync(REJECTS_FILE, "utf-8"));
	} catch {
		return {};
	}
}

function writeRejects(agentName: string, rejects: RejectRecord[]): void {
	const all = loadRejectsFile();
	if (rejects.length === 0) {
		delete all[agentName];
	} else {
		all[agentName] = rejects;
	}
	try {
		mkdirSync(path.dirname(REJECTS_FILE), { recursive: true });
		writeFileSync(REJECTS_FILE, JSON.stringify(all, null, 2));
	} catch (err) {
		console.error(`[scheduler] failed to write ${REJECTS_FILE}:`, err);
	}
}

function describeEntryId(entry: any): string | undefined {
	if (entry && typeof entry === "object") {
		if (typeof entry.id === "string" && entry.id) return entry.id;
		if (typeof entry.name === "string" && entry.name) return entry.name;
	}
	return undefined;
}

export function loadAgentSchedules(
	agent: AgentConfig,
	onFire: (agent: AgentConfig, entry: ScheduleEntry) => void,
): void {
	const schedulesPath = path.join(agent.dir, "schedules.json");

	// Clear any existing tasks for this agent
	const existing = activeTasks.get(agent.name);
	if (existing) {
		for (const task of existing.values()) task.stop();
		existing.clear();
	}
	activeTasks.set(agent.name, new Map());

	const rejects: RejectRecord[] = [];

	if (!existsSync(schedulesPath)) {
		console.log(`[scheduler] ${agent.name}: no schedules.json (no routines)`);
		writeRejects(agent.name, rejects);
		return;
	}

	let data: AgentSchedules;
	try {
		data = JSON.parse(readFileSync(schedulesPath, "utf-8"));
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		console.error(`[scheduler] ${agent.name}: failed to parse schedules.json:`, err);
		rejects.push({ reason: `schedules.json invalid JSON: ${msg}` });
		writeRejects(agent.name, rejects);
		return;
	}

	if (!Array.isArray(data.schedules)) {
		console.error(`[scheduler] ${agent.name}: schedules.json missing "schedules" array`);
		rejects.push({ reason: `schedules.json is missing the top-level "schedules" array` });
		writeRejects(agent.name, rejects);
		return;
	}

	const tasks = activeTasks.get(agent.name)!;

	for (const entry of data.schedules) {
		if (entry.enabled === false) continue;
		const missing: string[] = [];
		if (!entry.id) missing.push("id");
		if (!entry.cron) missing.push("cron");
		if (!entry.message) missing.push("message");
		if (missing.length > 0) {
			const reason = `missing required field(s): ${missing.join(", ")} (see framework/skills/routines/SKILL.md)`;
			console.warn(`[scheduler] ${agent.name}: skipping invalid entry — ${reason}`, entry);
			rejects.push({ id: describeEntryId(entry), reason });
			continue;
		}

		if (!cron.validate(entry.cron)) {
			const reason = `invalid cron expression "${entry.cron}" (use 5 fields: minute hour dom month dow)`;
			console.error(`[scheduler] ${agent.name}: ${reason} for ${entry.id}`);
			rejects.push({ id: entry.id, reason });
			continue;
		}

		try {
			const tz = process.env.TZ || "UTC";
			const task = cron.schedule(
				entry.cron,
				() => {
					console.log(`[scheduler] ${agent.name}: firing "${entry.id}" (${entry.description || entry.cron})`);
					onFire(agent, entry);
				},
				{ timezone: tz } as any,
			);
			tasks.set(entry.id, task);
			console.log(`[scheduler] ${agent.name}: loaded "${entry.id}" @ ${entry.cron} ${tz}`);
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			console.error(`[scheduler] ${agent.name}: failed to schedule ${entry.id}:`, err);
			rejects.push({ id: entry.id, reason: `scheduler error: ${msg}` });
		}
	}

	writeRejects(agent.name, rejects);
}

/** Watch each agent's schedules.json for changes and reload automatically */
export function watchAgentSchedules(
	agent: AgentConfig,
	onFire: (agent: AgentConfig, entry: ScheduleEntry) => void,
): void {
	const schedulesPath = path.join(agent.dir, "schedules.json");

	// Watch the agent directory for schedules.json changes
	// (fs.watch on the file itself doesn't survive edits via rename/move)
	try {
		watch(agent.dir, (_eventType, filename) => {
			if (filename === "schedules.json") {
				// Debounce — file edits often trigger multiple events
				setTimeout(() => {
					console.log(`[scheduler] ${agent.name}: schedules.json changed, reloading...`);
					loadAgentSchedules(agent, onFire);
				}, 500);
			}
		});
	} catch (err) {
		console.error(`[scheduler] ${agent.name}: failed to watch directory:`, err);
	}
	void schedulesPath;
}

export type { ScheduleEntry };
